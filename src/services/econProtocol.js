import { hexResponseToHexArray, sendCommandAndGetResponse } from './usbService';

const EPOCH = Date.UTC(2000, 0, 1);
const pad = (number) => String(number).padStart(2, '0');

export async function readFrames(port, command, frameSize = 60) {
  const response = await sendCommandAndGetResponse(
    port, Uint8Array.of(0, command, 0, 0), 30000, 750,
  );
  const bytes = Uint8Array.from(hexResponseToHexArray(response), Number);
  const frames = [];
  for (let offset = 0, page = 0; offset < bytes.length; offset += frameSize, page++) {
    const [id, code, actualPage, status] = bytes.subarray(offset, offset + 4);
    if (status === 0x80) throw new Error('The controller rejected the request.');
    if (id !== 0 || code !== command || actualPage !== (page & 255)) {
      throw new Error('Unexpected controller response.');
    }
    const end = Math.min(bytes.length, offset + frameSize);
    frames.push(bytes.slice(offset + 4, end));
    if (status === 0x40 && end === bytes.length) return frames;
    if (status !== 0 && !(frameSize !== 60 && status === 0x40)) break;
  }
  throw new Error('Incomplete controller response.');
}

export async function readPayload(port, command) {
  const frames = await readFrames(port, command);
  return Uint8Array.from(frames.flatMap((frame) => Array.from(frame)));
}

export async function writePayload(port, command, payload, page = 0, final = true) {
  const frame = Uint8Array.of(0, command, page, final ? 0x40 : 0, ...payload);
  const response = Uint8Array.from(
    hexResponseToHexArray(await sendCommandAndGetResponse(port, frame)), Number,
  );
  const matchesPage = response[1] === command && response[2] === page;
  const completion = response[1] === 0x91 && final;
  if (response.length >= 4 && response[0] === 0 && response[3] === 0x80 &&
      (matchesPage || completion)) {
    throw new Error(`The controller rejected write page ${page}.`);
  }
  if (response.length < 4 || response[0] !== 0 ||
      !(matchesPage || completion) || ![0, 0x40].includes(response[3])) {
    throw new Error(`The controller did not acknowledge write page ${page}.`);
  }
}

const timestamp = (seconds) => {
  if (seconds < 0) return '';
  const [date, time] = new Date(EPOCH + seconds * 1000).toISOString().slice(0, 19).split('T');
  return date.split('-').reverse().join('-') + ' ' + time;
};

const duration = (seconds) => {
  const value = Math.abs(seconds);
  return (seconds < 0 ? '-' : '') +
    [Math.floor(value / 3600), Math.floor(value / 60) % 60, value % 60].map(pad).join(':');
};

const instantFields = [
  ['Recorded at', 1], ['R voltage (V)', 10], ['Y voltage (V)', 10],
  ['B voltage (V)', 10], ['R current (A)', 1000], ['Y current (A)', 1000],
  ['B current (A)', 1000], ['Neutral current (A)', 1000], ['R power factor', 100],
  ['Y power factor', 100], ['B power factor', 100], ['Active power (kW)', 1000],
  ['Apparent power (kVA)', 1000], ['Operation mode', 1], ['Battery voltage (V)', 10],
  ['Engine speed (RPM)', 1], ['Temperature', 1], ['Fuel (%)', 100],
  ['Fuel (L)', 100], ['Oil pressure (PSI)', 100], ['Peak power (kW)', 1000],
  ['Generator run time', 1], ['Active energy (kWh)', 10], ['Tamper run time', 1],
  ['Manual run time', 1], ['Remote run time', 1],
];

export function decodeStoredHistory(bytes, energy) {
  const size = energy ? 32 : 128;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const records = [];
  for (let offset = 0; offset + size <= bytes.length; offset += size) {
    const value = (index) => view.getInt32(offset + index * 4, true);
    if (energy) {
      const seconds = value(3) - value(2);
      const consumed = (value(5) - value(4)) / 10;
      records.push({
        'Start time': timestamp(value(0)),
        'End time': timestamp(value(1)),
        'Start generator run time': duration(value(2)),
        'End generator run time': duration(value(3)),
        'Start energy (kWh)': value(4) / 10,
        'End energy (kWh)': value(5) / 10,
        'Peak power (kW)': value(6) / 1000,
        'Elapsed run time': duration(seconds),
        'Energy used (kWh)': consumed,
        'Average power (kW)': seconds > 1 ? Number((consumed * 3600 / seconds).toFixed(3)) : 0,
      });
      continue;
    }
    records.push(Object.fromEntries(instantFields.map(([label, divisor], index) => {
      const raw = value(index);
      if (index === 0) return [label, timestamp(raw)];
      if (index === 13) return [label, ['Manual', 'Remote'][raw] ?? `Unknown (${raw})`];
      if ([21, 23, 24, 25].includes(index)) return [label, duration(raw)];
      if (index >= 16 && index <= 19 && raw < 0) return [label, 'Open Sensor'];
      return [label, raw / divisor];
    })));
  }
  return records;
}

export const DEVICE_FIELDS = [
  { key: 'rtc', label: 'Controller date and time', read: 0x95 },
  { key: 'name', label: 'Product name', read: 0x16 },
  { key: 'version', label: 'Firmware version', read: 0x17 },
  { key: 'site', label: 'Site ID', read: 0x18, write: 0x43, width: 10 },
  { key: 'generator', label: 'Generator serial number', read: 0x9e, write: 0x9f, width: 20 },
  { key: 'engine', label: 'Engine serial number', read: 0xa0, write: 0xa1, width: 20 },
  { key: 'alternator', label: 'Alternator serial number', read: 0xa2, write: 0xa3, width: 20 },
  { key: 'ecu', label: 'ECU serial number', read: 0xa4, write: 0xa5, width: 20 },
  { key: 'rating', label: 'Product rating (kVA)', read: 0xa6, write: 0xa7 },
  { key: 'date', label: 'Commissioning date (DD-MM-YY)', read: 0xa8, write: 0xa9, width: 8 },
];

export const SERIAL_FIELD = {
  key: 'serial', label: 'Controller serial number', read: 0x19, write: 0x44, width: 20,
};

export function decodeDeviceField(field, bytes) {
  if (field.key === 'rtc') {
    if (bytes.length < 7) throw new Error('Incomplete controller clock.');
    return [...bytes.subarray(4, 7)].map(pad).join('-') + ' ' +
      [bytes[2], bytes[1], bytes[0]].map(pad).join(':');
  }
  if (field.key === 'rating') {
    return String(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(0, true));
  }
  if (field.key === 'date') {
    if (bytes.length < 7) throw new Error('Incomplete commissioning date.');
    return [...bytes.subarray(4, 7)].map(pad).join('-');
  }
  return String.fromCharCode(...bytes).replace(/\0.*$/s, '').trim();
}

export function encodeDeviceField(field, input) {
  const text = (input ?? '').trim();
  if (['site', 'serial', 'rating', 'date'].includes(field.key) && !text) {
    throw new Error(`Enter ${field.label.toLowerCase()}.`);
  }
  if (field.key === 'rating') {
    const value = Number(text);
    if (!/^\d+$/.test(text) || value > 2147483647) throw new Error('Invalid product rating.');
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setInt32(0, value, true);
    return bytes;
  }
  if (field.key === 'date') {
    const [day, month, year] = text.split('-').map(Number);
    const date = new Date(2000 + year, month - 1, day);
    const validDate = /^\d{2}-\d{2}-\d{2}$/.test(text) && date <= new Date() &&
      date.getDate() === day && date.getMonth() === month - 1;
    if (!validDate && text !== '00-01-00') throw new Error('Invalid commissioning date.');
    return Uint8Array.of(0, 0, 0, 0, day, month, year, 0);
  }
  if (text.length > field.width || /[^ -~]/.test(text)) {
    throw new Error(`${field.label} must fit ${field.width} ASCII characters.`);
  }
  const bytes = new Uint8Array(field.width);
  for (let index = 0; index < text.length; index++) bytes[index] = text.charCodeAt(index);
  return bytes;
}
