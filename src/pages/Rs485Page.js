import { Alert } from '../services/browserAlert';
import React, { useEffect, useRef, useState } from 'react';
import { Button, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Picker from '../components/ReadablePicker';
import { COILS, HOLDING_FIELDS, listAdapters, openAdapter, queryModbus, readModbusDisplay } from '../services/modbus';
import { saveWorkbook } from '../services/controllerFiles';
import { setupUsbReceiver } from '../services/usbService';

export default function Rs485Page({ onBack }) {
  const [adapters, setAdapters] = useState([]);
  const [device, setDevice] = useState(null);
  const [baud, setBaud] = useState(19200);
  const [parity, setParity] = useState('None');
  const [stopBits, setStopBits] = useState(1);
  const [unit, setUnit] = useState('1');
  const [connected, setConnected] = useState(false);
  const [monitoringUnit, setMonitoringUnit] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [measurements, setMeasurements] = useState([]);
  const [holdings, setHoldings] = useState({});
  const [coils, setCoils] = useState(null);
  const connection = useRef(null);

  async function close() {
    const current = connection.current;
    connection.current = null;
    current?.subscription.remove();
    await current?.port.close();
  }
  useEffect(() => () => { close().catch(() => {}); }, []);

  useEffect(() => {
    if (monitoringUnit == null) return;
    let active = true;
    let timer;
    async function refresh() {
      setBusy(true);
      try {
        const records = await readModbusDisplay(connection.current?.port, monitoringUnit);
        if (active) {
          setMeasurements(records);
          timer = setTimeout(refresh, 1000);
        }
      } catch (error) {
        if (active) {
          setStatus(error.message);
          setMonitoringUnit(null);
        }
      } finally {
        setBusy(false);
      }
    }
    refresh();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [monitoringUnit]);

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

  function target() {
    const value = Number(unit);
    if (!/^\d+$/.test(unit) || value < 1 || value > 247) throw new Error('Modbus device ID must be 1–247.');
    return value;
  }
  const port = () => connection.current?.port;
  const locked = busy || monitoringUnit != null;
  const confirm = (label, work) => Alert.alert(label, 'Send this command to the connected generator controller?', [
    { text: 'Cancel', style: 'cancel' }, { text: 'Send', onPress: () => run(work) },
  ]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.section}>
        <Button title="Back" disabled={locked} onPress={onBack} />
        <Text style={styles.title}>RS-485 / Modbus</Text>
        <Button title="Find USB serial adapters" disabled={busy || connected} onPress={() => run(async () => {
          const available = await listAdapters();
          setAdapters(available);
          setDevice(available[0]?.deviceId ?? null);
          if (!available.length) setStatus('Connect a USB-to-RS-485 adapter and select its serial port.');
        })} />
        {!!adapters.length && <Picker accessibilityLabel="USB adapter" enabled={!busy && !connected} selectedValue={device}
          onValueChange={setDevice}>
          {adapters.map((item) => <Picker.Item key={item.deviceId} value={item.deviceId}
            label={item.label} />)}
        </Picker>}
        <Text style={styles.text}>Baud rate</Text>
        <Picker accessibilityLabel="Baud rate" enabled={!busy && !connected} selectedValue={baud} onValueChange={setBaud}>
          {[4800, 9600, 19200, 38400, 57600, 115200].map((value) => <Picker.Item key={value} label={String(value)} value={value} />)}
        </Picker>
        <Text style={styles.text}>Parity</Text>
        <Picker accessibilityLabel="Parity" enabled={!busy && !connected} selectedValue={parity} onValueChange={setParity}>
          {['None', 'Odd', 'Even'].map((value) => <Picker.Item key={value} label={value} value={value} />)}
        </Picker>
        <Text style={styles.text}>Stop bits</Text>
        <Picker accessibilityLabel="Stop bits" enabled={!busy && !connected} selectedValue={stopBits} onValueChange={setStopBits}>
          {[1, 2].map((value) => <Picker.Item key={value} label={String(value)} value={value} />)}
        </Picker>
        <Text style={styles.text}>Device ID</Text>
        <TextInput accessibilityLabel="Device ID" style={styles.input} value={unit} onChangeText={setUnit}
          keyboardType="numeric" maxLength={3} editable={!locked} />
        <Button title={connected ? 'Disconnect' : 'Connect adapter'} disabled={locked || (!connected && device == null)}
          onPress={() => run(async () => {
            if (connected) {
              try { await close(); } finally { setConnected(false); }
              return;
            }
            const adapter = await openAdapter(device, baud, parity, stopBits);
            connection.current = { port: adapter, subscription: setupUsbReceiver(adapter, (error) => {
              setMonitoringUnit(null);
              setConnected(false);
              setStatus(error.message);
              close().catch(() => {});
            }) };
            setConnected(true);
          })} />
        {!!status && <Text style={styles.text} accessibilityLiveRegion="polite">{status}</Text>}
        {connected && <>
          <Button title={monitoringUnit == null ? 'Start monitoring' : 'Stop monitoring'}
            disabled={monitoringUnit == null && busy}
            onPress={() => {
              if (monitoringUnit != null) {
                setMonitoringUnit(null);
                return;
              }
              try {
                setStatus('');
                setMonitoringUnit(target());
              } catch (error) {
                setStatus(error.message);
              }
            }} />
          <Button title="Read display" disabled={locked} onPress={() => run(async () =>
            setMeasurements(await readModbusDisplay(port(), target())))} />
          <Button title="Save display as Excel" disabled={locked || !measurements.length} onPress={() => run(() =>
            saveWorkbook('ECON RS-485 dashboard', { Display: measurements }))} />
          <Button title="Read current command status" disabled={locked} onPress={() => run(async () => {
            const id = target();
            setCoils((await queryModbus(port(), id, 1, 0, 7))[0]);
            const bytes = await queryModbus(port(), id, 3, 0, 8);
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            setHoldings(Object.fromEntries(HOLDING_FIELDS.map(([, index]) => [index, String(view.getUint16(index * 2))])));
          })} />
          {COILS.map((name, index) => <Button key={name} disabled={locked}
            title={coils == null ? name : `${name} (${coils & (1 << index) ? 'on' : 'off'})`}
            onPress={() => confirm(name, async () => {
              await queryModbus(port(), target(), 5, index, 0xff00);
              setStatus('Command acknowledged.');
            })} />)}
          {HOLDING_FIELDS.map(([name, index, min, max]) => <View key={name}>
            <Text style={styles.text}>{name}</Text>
            <TextInput accessibilityLabel={name} style={styles.input} editable={!locked}
              keyboardType="numeric" value={holdings[index] ?? ''}
              onChangeText={(value) => setHoldings((fields) => ({ ...fields, [index]: value }))} />
            <Button title={`Update ${name}`} disabled={locked} onPress={() => confirm(name, async () => {
              const value = Number(holdings[index]);
              if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Enter a value from ${min} to ${max}.`);
              await queryModbus(port(), target(), 6, index, value);
              setStatus('Update acknowledged.');
            })} />
          </View>)}
          {measurements.map(({ Parameter, Value, Unit }, index) =>
            <Text key={index} style={styles.text}>{Parameter}: {Value} {Unit}</Text>)}
        </>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  text: { color: "#111827" },
  safe: { flex: 1, backgroundColor: '#F4F6FA' },
  section: { padding: 16, gap: 10 },
  title: { color: '#254695', fontWeight: '700', fontSize: 22 },
  input: { padding: 8, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 6, color: '#111827', backgroundColor: '#fff' },
});
