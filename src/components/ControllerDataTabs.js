import { Alert } from '../services/browserAlert';
import React, { useState } from 'react';
import { Button, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  decodeDeviceField, decodeStoredHistory, DEVICE_FIELDS, encodeDeviceField,
  readPayload, SERIAL_FIELD, writePayload,
} from '../services/econProtocol';

import { saveWorkbook } from '../services/controllerFiles';
import { withExclusiveUsb } from '../services/usbService';
import appConfig from '../../app.json';

const PAGE_SIZE = 10;

export function StoredHistoryTab({ port, title }) {
  const energy = title === 'Energy Store';
  const [records, setRecords] = useState(null);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  async function read() {
    setBusy(true);
    setStatus('Reading history…');
    try {
      const bytes = await readPayload(port, energy ? 0x9d : 0x9c);
      setRecords(decodeStoredHistory(bytes, energy));
      setPage(0);
      setStatus('');
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.section}>
      <Button title={`Read ${title}`} onPress={read} disabled={busy} />
      <Button title="Save Excel history" disabled={busy || !records?.length}
        onPress={() => saveWorkbook(title, { [title]: records }).catch((error) => setStatus(error.message))} />
      {!!status && <Text style={styles.text} accessibilityLiveRegion="polite">{status}</Text>}
      {records && <Text style={styles.text}>Total records: {records.length}</Text>}
      {records?.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((record, index) => (
        <View key={index} style={styles.record}>
          <Text style={styles.label}>Record {page * PAGE_SIZE + index + 1}</Text>
          {Object.entries(record).map(([label, value]) => (
            <Text key={label} style={styles.text}>{label}: {value}</Text>
          ))}
        </View>
      ))}
      {!!records?.length && (
        <View style={styles.actions}>
          <Button title="Previous" disabled={page === 0 || busy} onPress={() => setPage(page - 1)} />
          <Button title="Next" disabled={(page + 1) * PAGE_SIZE >= records.length || busy}
            onPress={() => setPage(page + 1)} />
        </View>
      )}
    </View>
  );
}

export function DeviceFieldsTab({ port, serialOnly = false }) {
  const fields = serialOnly ? [SERIAL_FIELD] : DEVICE_FIELDS;
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  async function perform(write) {
    setBusy(true);
    setStatus(write ? 'Updating controller…' : 'Reading controller…');
    let currentField;
    let written = 0;
    try {
      if (write) {
        const updates = fields.filter((field) => field.write)
          .map((field) => [field, encodeDeviceField(field, values[field.key])]);
        await withExclusiveUsb(port, async (exclusive) => {
          for (const [field, bytes] of updates) {
            currentField = field.label;
            await writePayload(exclusive, field.write, bytes);
            written++;
          }
        });
      } else {
        const next = {};
        for (const field of fields) {
          currentField = field.label;
          next[field.key] = decodeDeviceField(field, await readPayload(port, field.read));
          setValues({ ...next });
        }
      }
      setStatus(write ? 'Update acknowledged.' : 'Read complete.');
    } catch (error) {
      const field = currentField ? `${currentField}: ` : '';
      const partial = written ? ` ${written} field(s) were already updated.` : '';
      setStatus(field + error.message + partial);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.section}>
      {fields.map((field) => (
        <View key={field.key}>
          <Text style={styles.label}>{field.label}</Text>
          <TextInput
            accessibilityLabel={field.label}
            editable={!!field.write && !busy}
            value={values[field.key] ?? ''}
            maxLength={field.width ?? (field.key === 'rating' ? 10 : undefined)}
            keyboardType={field.key === 'rating' ? 'numeric' : 'default'}
            onChangeText={(value) => setValues((previous) => ({ ...previous, [field.key]: value }))}
            style={styles.input}
          />
        </View>
      ))}
      {!!status && <Text style={styles.text} accessibilityLiveRegion="polite">{status}</Text>}
      <Button title="Read from controller" disabled={busy} onPress={() => perform(false)} />
      <Button title="Update controller" disabled={busy} onPress={() => Alert.alert(
        'Update controller information', 'Write these values to the connected controller?',
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Update', onPress: () => perform(true) }],
      )} />
      <Button title="Clear fields" disabled={busy} onPress={() => { setValues({}); setStatus(''); }} />
    </View>
  );
}

export function AboutTab({ deviceName, deviceVersion }) {
  return (
    <View style={styles.section}>
      <Text style={styles.label}>PROCOM Devices</Text>
      <Text style={styles.text}>MRM Procom Pvt Ltd</Text>
      <Text style={styles.text}>App version: {appConfig.expo.version}</Text>
      <Text style={styles.text}>Controller: {deviceName}</Text>
      <Text style={styles.text}>Firmware: {deviceVersion}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  text: { color: "#111827" },
  section: { padding: 12, gap: 10 },
  record: { padding: 12, gap: 4, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8 },
  label: { fontWeight: '700', color: '#254695' },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 6, padding: 8, color: '#111827', backgroundColor: '#fff' },
  actions: { flexDirection: 'row', justifyContent: 'space-between' },
});
