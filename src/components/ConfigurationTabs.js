import { Alert } from '../services/browserAlert';
import React, { useState } from 'react';
import { Button, StyleSheet, Text, TextInput, View } from 'react-native';
import Picker from './ReadablePicker';
import { PRESET_CATALOG } from '../constants/presetCatalog';
import { canFields, readCan, readCanWorkbook, writeCan } from '../services/canConfiguration';
import { fromBase64, pickControllerFiles, saveBinary, saveWorkbook, toBase64, unpackControllerZip } from '../services/controllerFiles';
import { compareSettings, desktopPresetBytes, parseDesktopPreset, readSettingsPayload, settingsReport, writeSettingsPayload } from '../services/settingsPreset';

const confirmWrite = (title, action) => Alert.alert(title, 'Apply these changes to the connected controller?', [
  { text: 'Cancel', style: 'cancel' },
  { text: 'Apply', onPress: action },
]);

export function CanTab({ port }) {
  const [kind, setKind] = useState('parameters');
  const [records, setRecords] = useState([]);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  async function run(operation) {
    setBusy(true);
    setStatus('');
    try {
      await operation();
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  function select(nextKind, nextRecords = []) {
    setKind(nextKind);
    setRecords(nextRecords);
    setIndex(0);
  }

  const current = records[index];
  const title = kind === 'parameters' ? 'J1939 Parameters' : 'J1939 Diagnostics';
  const identifier = kind === 'parameters' ? 'PGN' : 'SPN';
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>{title}</Text>
      <View style={styles.actions}>
        <Button title="Parameters" disabled={busy || kind === 'parameters'} onPress={() => select('parameters')} />
        <Button title="Diagnostic codes" disabled={busy || kind === 'faults'} onPress={() => select('faults')} />
      </View>
      <Button title="Read from controller" disabled={busy} onPress={() => run(async () => select(kind, await readCan(port, kind)))} />
      <Button title="Import Excel workbook" disabled={busy} onPress={() => run(async () => {
        const files = await pickControllerFiles();
        if (!files) return;
        const workbook = Object.entries(files).find(([name]) => /\.xlsx$/i.test(name));
        if (!workbook) throw new Error('Select an Excel workbook.');
        const configuration = await readCanWorkbook(workbook[1]);
        select(configuration.kind, configuration.records);
      })} />
      <Button title="Save Excel workbook" disabled={busy || !records.length} onPress={() => run(() =>
        saveWorkbook(title, { [title]: records.map((record) => ({
          Enabled: Number(record[identifier]) === 0 ? 'No' : 'Yes', ...record,
        })) }))} />
      <Button title="Compare with controller" disabled={busy || !records.length} onPress={() => run(async () => {
        const enabled = (rows) => rows.filter((record) => Number(record[identifier]) > 0);
        const device = enabled(await readCan(port, kind));
        const pending = enabled(records);
        const changes = Math.max(device.length, pending.length) -
          pending.filter((record, row) => canFields(kind).every((key) => String(record[key]) === String(device[row]?.[key]))).length;
        setStatus(changes ? `${changes} row(s) differ.` : 'Configuration matches the controller.');
      })} />
      <Button title="Write configuration" disabled={busy || !records.length} onPress={() => confirmWrite('Write J1939 configuration', () =>
        run(async () => { await writeCan(port, kind, records); setStatus('Configuration acknowledged.'); }))} />
      <Button title="Add record" disabled={busy} onPress={() => {
        setRecords([...records, Object.fromEntries(canFields(kind).map((key) => [key, '']))]);
        setIndex(records.length);
      }} />
      {!!status && <Text style={styles.text} accessibilityLiveRegion="polite">{status}</Text>}
      {current && (
        <>
          <View style={styles.actions}>
            <Button title="Previous" disabled={busy || index === 0} onPress={() => setIndex(index - 1)} />
            <Text style={styles.text}>{index + 1} / {records.length}</Text>
            <Button title="Next" disabled={busy || index === records.length - 1} onPress={() => setIndex(index + 1)} />
          </View>
          {canFields(kind).map((key) => (
            <View key={key}>
              <Text style={styles.text}>{key}</Text>
              <TextInput accessibilityLabel={key} style={styles.input} editable={!busy}
                value={String(current[key] ?? '')} onChangeText={(value) =>
                  setRecords((all) => all.map((record, row) => row === index ? { ...record, [key]: value } : record))} />
            </View>
          ))}
          <Button title="Remove record" disabled={busy} onPress={() => {
            setRecords(records.filter((_, row) => row !== index));
            setIndex(Math.max(0, index - 1));
          }} />
        </>
      )}
    </View>
  );
}

export function ImportSettingsTab({ port, deviceName, deviceVersion, onUpdateSuccess }) {
  const [preset, setPreset] = useState(null);
  const [url, setUrl] = useState('');
  const [supplier, setSupplier] = useState('');
  const [model, setModel] = useState('');
  const [changes, setChanges] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const version = 'v' + String(deviceVersion).match(/\d+\.\d+/)?.[0];
  const catalog = PRESET_CATALOG[version] ?? {};
  async function run(operation) {
    setBusy(true);
    setStatus('');
    try {
      await operation();
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function load(files) {
    if (!files) return;
    setPreset(null);
    setChanges(null);
    const items = Object.entries(files);
    const binaries = items.filter(([name]) => /\.bin$/i.test(name));
    const workbooks = items.filter(([name]) => /\.xlsx$/i.test(name) && /can|j1939/i.test(name));
    if (binaries.length > 1) throw new Error('The archive contains multiple BIN files. Select the required BIN separately.');
    if (!binaries.length && !workbooks.length) throw new Error('The file contains no ECON BIN or J1939 workbooks.');
    const [name, base64] = binaries[0] ?? [];
    const payload = base64 ? parseDesktopPreset(fromBase64(base64), deviceName, deviceVersion) : null;
    const can = await Promise.all(workbooks.map(([, data]) => readCanWorkbook(data)));
    setPreset({ name, payload, can });
    setStatus(`Loaded ${name || 'J1939 workbooks'}.`);
  }

  async function download(address) {
    if (!/^https:\/\/[^\s]+\.zip(?:\?[^\s]*)?$/i.test(address)) throw new Error('Enter an HTTPS ZIP address.');
    const response = await fetch(address);
    if (!response.ok) throw new Error(`Download failed (${response.status}).`);
    const sizeLimit = 12 * 1024 * 1024;
    if (Number(response.headers.get('content-length')) > sizeLimit) throw new Error('The ZIP exceeds 12 MB.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > sizeLimit) throw new Error('The ZIP exceeds 12 MB.');
    await load(await unpackControllerZip(toBase64(bytes)));
  }

  return (
    <View style={styles.section}>
      <Button title="Open desktop BIN or ZIP" disabled={busy} onPress={() => run(async () => load(await pickControllerFiles()))} />
      {!!Object.keys(catalog).length && <>
        <Text style={styles.text}>Supplier</Text>
        <Picker accessibilityLabel="Supplier" enabled={!busy} selectedValue={supplier}
          onValueChange={(value) => { setSupplier(value); setModel(''); }}>
          <Picker.Item label="Select supplier" value="" />
          {Object.keys(catalog).map((value) => <Picker.Item key={value} label={value} value={value} />)}
        </Picker>
        <Text style={styles.text}>Engine model</Text>
        <Picker accessibilityLabel="Engine model" enabled={!busy && !!supplier} selectedValue={model}
          onValueChange={setModel}>
          <Picker.Item label="Select engine model" value="" />
          {(catalog[supplier] ?? []).map((value) => <Picker.Item key={value} label={value.slice(0, -4)} value={value} />)}
        </Picker>
        <Button title="Download selected preset" disabled={busy || !model} onPress={() => run(() => {
          const path = [version, supplier, model].map(encodeURIComponent).join('/');
          return download(`https://mrmprocom.com/device/ECON-MAN-IND/${path}`);
        })} />
      </>}
      <Text style={styles.text}>Preset ZIP address</Text>
      <TextInput accessibilityLabel="Preset ZIP address" editable={!busy} keyboardType="url"
        autoCapitalize="none" autoCorrect={false} value={url} onChangeText={setUrl} style={styles.input} />
      <Button title="Download ZIP preset" disabled={busy || !url.trim()} onPress={() => run(() => download(url.trim()))} />
      <Button title="Save device settings as BIN" disabled={busy} onPress={() => run(async () =>
        saveBinary('ECON settings.bin', desktopPresetBytes(await readSettingsPayload(port), deviceName, deviceVersion)))} />
      <Button title="Save device settings as Excel" disabled={busy} onPress={() => run(async () => {
        const payload = await readSettingsPayload(port);
        await saveWorkbook('ECON settings', { Settings: settingsReport(payload) });
      })} />
      <Button title="Compare preset with controller" disabled={busy || !preset?.payload} onPress={() => run(async () => {
        const differences = compareSettings(await readSettingsPayload(port), preset.payload);
        setChanges(differences);
        setStatus(differences.length ? `${differences.length} setting(s) differ.` : 'Settings match.');
      })} />
      <Button title="Save comparison as Excel" disabled={busy || !changes?.length}
        onPress={() => run(() => saveWorkbook('ECON settings comparison', { Comparison: changes }))} />
      <Button title="Apply preset to controller" disabled={busy || !preset} onPress={() => confirmWrite('Apply preset', () =>
        run(async () => {
          if (preset.payload) {
            await readSettingsPayload(port).then((current) => compareSettings(current, preset.payload));
          }
          for (const configuration of preset.can) await writeCan(port, configuration.kind, configuration.records);
          if (preset.payload) await writeSettingsPayload(port, preset.payload);
          setStatus('Preset acknowledged.');
          if (preset.payload) await onUpdateSuccess?.();
        }))} />
      {!!status && <Text style={styles.text} accessibilityLiveRegion="polite">{status}</Text>}
      {changes?.map((change, index) => (
        <Text key={index} style={styles.text}>{change.Setting}: {change.Device} → {change.File}</Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  text: { color: "#111827" },
  section: { padding: 12, gap: 10 },
  heading: { fontWeight: '700', color: '#254695', fontSize: 18 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 6, padding: 8, color: '#111827', backgroundColor: '#fff' },
});
