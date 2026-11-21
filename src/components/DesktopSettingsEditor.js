import { Alert } from '../services/browserAlert';
import React, { useState } from 'react';
import { Button, StyleSheet, Text, TextInput, View } from 'react-native';
import Picker from './ReadablePicker';
import { saveBinary, saveWorkbook } from '../services/controllerFiles';
import {
  applySettingEdits, desktopPresetBytes, DISABLED_SETTINGS, editableSettings, readSettingsPayload,
  settingsReport, updateSettingsFields,
} from '../services/settingsPreset';

const GROUPS = [
  [1, 'System Parameter A'], [2, 'System Parameter B'], [3, 'Generator Setting'],
  [5, 'Protection Setting'], [6, 'Annunciation & RS-485 Communication'],
];

export default function DesktopSettingsEditor({ port, deviceName, deviceVersion, onBack, onUpdateSuccess }) {
  const [payload, setPayload] = useState(null);
  const [edits, setEdits] = useState({});
  const [group, setGroup] = useState(1);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const fields = payload ? editableSettings(payload) : [];
  const get = (key) => edits[key] ?? fields.find((field) => field.id === key)?.value;
  const relayModes = ['CONFIG_RELAY1', 'CONFIG_RELAY2', 'CONFIG_RELAY3'].map((key) => Number(get(key)));

  function change(key, value) {
    const updates = { [key]: value };
    if (key === 'SYS_COMPANY' && value === 1) {
      Object.assign(updates, { LLOP_SENSOR_TYPE: 5, FUEL_SENSOR_TYPE: 4, HWT_SENSOR_TYPE: 5 });
    }
    if (key.startsWith('CONFIG_RELAY')) {
      const index = Number(key.slice(-1)) - 1;
      const modes = relayModes.map((mode, position) => position === index ? value : mode);
      Object.assign(updates, {
        CHOKE_PRE_TIME: modes.includes(1) ? 2 : 65535,
        CHOKE_POST_TIME: modes.includes(1) ? 2 : 65535,
        PUMP_PRE_START_TIME: modes.includes(2) ? 2 : 0,
        GEN_KVA_WARNING_PICKUP: 8,
        GEN_KVA_WARNING_DROP: 8,
        GEN_KVA_WARNING_DEALY: 5,
      });
    }
    setEdits((previous) => ({ ...previous, ...updates }));
  }

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

  function update() {
    return run(async () => {
      const updated = await updateSettingsFields(port, edits);
      setPayload(updated);
      setEdits({});
      setStatus('Settings acknowledged.');
      await onUpdateSuccess?.();
    });
  }

  return (
    <View style={styles.section}>
      <Button title="Back to Edit Setting" disabled={busy} onPress={onBack} />
      <Button title="Read desktop parameters" disabled={busy} onPress={() => run(async () => {
        const data = await readSettingsPayload(port);
        editableSettings(data);
        setPayload(data);
        setEdits({});
      })} />
      <Button title="Update settings" disabled={busy || !Object.keys(edits).length}
        onPress={() => Alert.alert('Update settings', 'Write the edited settings to the connected controller?', [
          { text: 'Cancel', style: 'cancel' }, { text: 'Update', onPress: update },
        ])} />
      <Button title="Save settings as BIN" disabled={busy || !payload} onPress={() => run(async () => {
        const values = applySettingEdits(payload, edits);
        await saveBinary('ECON settings.bin', desktopPresetBytes(values, deviceName, deviceVersion));
      })} />
      <Button title="Save settings as Excel" disabled={busy || !payload} onPress={() => run(async () => {
        const values = applySettingEdits(payload, edits);
        await saveWorkbook('ECON settings', { Settings: settingsReport(values) });
      })} />
      {!!status && <Text style={styles.text} accessibilityLiveRegion="polite">{status}</Text>}
      {payload && <>
        <Picker accessibilityLabel="Settings group" selectedValue={group} enabled={!busy} onValueChange={setGroup}>
          {GROUPS.map(([value, label]) => <Picker.Item key={value} label={label} value={value} />)}
        </Picker>
        {fields.filter((field) => field.group === group).map((field) => {
          const sensor = /^(LLOP|FUEL|HWT)_[RV]\d+$/.exec(field.id)?.[1];
          if (sensor && Number(get(sensor + '_SENSOR_TYPE')) !== 0) return null;
          const disabled = busy || (field.id === 'J1939_ECU_ADDRESS' && Number(get('J1939_GCU_ADDRESS')) === 65535) ||
            (field.id.startsWith('CHOKE_') && !relayModes.includes(1)) ||
            (field.id === 'PUMP_PRE_START_TIME' && !relayModes.includes(2)) ||
            (field.id.startsWith('GEN_KVA_WARNING') && !relayModes.includes(3)) ||
            (/^NCD_(WARN|FAULT|HEAL)_HRS$/.test(field.id) && Number(get('NCD_STRATEGY')) === 0);
          const label = field.label || field.id;
          const display = field.id === 'J1939_ECU_ADDRESS' && Number(get('J1939_GCU_ADDRESS')) === 65535 ? 0 : get(field.id);
          const canDisable = DISABLED_SETTINGS.has(field.id);
          const off = canDisable && Math.round(Number(display) * field.divisor) === 65535;
          const tmtlChoices = Number(get('SYS_COMPANY')) === 1
            ? { LLOP_SENSOR_TYPE: [5, 12], HWT_SENSOR_TYPE: [5, 6, 7, 13] }[field.id] : null;
          return (
            <View key={field.id}>
              <Text style={styles.text}>{label}{field.unit ? ` (${field.unit})` : ''}</Text>
              {field.choices.length ? (
                <Picker accessibilityLabel={label} enabled={!disabled} selectedValue={display}
                  onValueChange={(value) => change(field.id, value)}>
                  {(!field.choices[display] || (tmtlChoices && !tmtlChoices.includes(display))) &&
                    <Picker.Item label={field.choices[display] ?? String(display)} value={display} enabled={false} />}
                  {field.choices.map((choice, value) =>
                    (!tmtlChoices || tmtlChoices.includes(value)) &&
                    <Picker.Item key={value} label={choice} value={value} />)}
                </Picker>
              ) : (
                <TextInput accessibilityLabel={label} style={[styles.input, (disabled || off) && styles.inactiveInput]} editable={!disabled && !off}
                  keyboardType="decimal-pad" value={off ? 'Disabled' : String(display ?? '')}
                  onChangeText={(value) => change(field.id, value)} />
              )}
              {canDisable && <Button title={off ? 'Enable' : 'Disable'} disabled={!!disabled}
                onPress={() => change(field.id, (off ? field.min : 65535) / field.divisor)} />}
            </View>
          );
        })}
      </>}
    </View>
  );
}

const styles = StyleSheet.create({
  text: { color: "#111827" },
  inactiveInput: { backgroundColor: '#eef2f7', color: '#475569' },
  section: { padding: 12, gap: 10 },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 6, padding: 8, color: '#111827', backgroundColor: '#fff' },
});
