import { decodeText, encodeText, readWorkbookRows } from './controllerFiles';
import { readFrames, writePayload } from './econProtocol';
import { withExclusiveUsb } from './usbService';

const actions = [
  'Warning', 'Fault quick shutdown', 'Fault slow shutdown', 'CPCB4 low inducement audio',
  'CPCB4 severe inducement audio', 'ANN J1939 output 1', 'ANN J1939 output 2',
  'ANN J1939 output 3', 'ANN J1939 output 4',
];
const descriptions = [
  ['Description 1', 11], ['Description 2', 11],
];
const parameters = [
  ['PGN', 4], ['Starting bit index', 1], ['Length in bits', 1],
  ['Offset', 4, 1000], ['Scaling factor', 4, 100000],
  ['Minimum', 4, 1000], ['Maximum', 4, 1000],
  ['Units', 4], ...descriptions,
];
const faults = [['SPN', 4], ['FMI', 1], ...actions.map((action) => [action, 0]), ...descriptions];
const definitions = {
  parameters: { schema: parameters, read: 0x30, write: 0x31, size: 52 },
  faults: { schema: faults, read: 0x32, write: 0x33, size: 40 },
};

export const canFields = (kind) => definitions[kind].schema.map(([name]) => name);
const isString = (name) => name === 'Units' || name.startsWith('Description');
const isEnabled = (value) => /^(yes|true|1)$/i.test(String(value).trim());

export function encodeCanRecord(kind, record) {
  const { schema, size } = definitions[kind];
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  for (const [name, width, scale] of schema) {
    if (!width) continue;
    const value = record[name];
    if (isString(name)) {
      const text = encodeText(String(value ?? ''));
      if (text.length > width - 1) throw new Error(`${name} exceeds ${width - 1} bytes.`);
      bytes.set(text, offset);
    } else {
      const numeric = Number(value);
      if (value === '' || value == null || !Number.isFinite(numeric)) throw new Error(`Invalid ${name}.`);
      if (scale) {
        if (!Number.isFinite(Math.fround(numeric * scale))) throw new Error(`Invalid ${name}.`);
        view.setFloat32(offset, numeric * scale, true);
      } else {
        if (!Number.isInteger(numeric) || numeric < 0 || numeric >= 2 ** (width * 8)) {
          throw new Error(`Invalid ${name}.`);
        }
        if (width === 1) view.setUint8(offset, numeric);
        else view.setUint32(offset, numeric, true);
      }
    }
    offset += width;
    if (kind === 'faults' && name === 'FMI') {
      const flags = actions.reduce((bits, action, index) => bits | (isEnabled(record[action]) ? 1 << index : 0), 0);
      view.setUint32(offset, flags, true);
      offset += 4;
    }
  }
  return bytes;
}

export function decodeCanRecord(kind, bytes) {
  if (bytes.length !== definitions[kind].size) throw new Error('Incomplete J1939 record.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  let flags = 0;
  const record = {};
  for (const [name, width, scale] of definitions[kind].schema) {
    if (!width) {
      record[name] = (flags & (1 << actions.indexOf(name))) ? 'Yes' : 'No';
      continue;
    }
    if (isString(name)) record[name] = decodeText(bytes.subarray(offset, offset + width)).replace(/\0.*$/s, '');
    else if (scale) record[name] = Number((view.getFloat32(offset, true) / scale).toFixed(scale === 1000 ? 3 : 5));
    else record[name] = width === 1 ? view.getUint8(offset) : view.getUint32(offset, true);
    offset += width;
    if (kind === 'faults' && name === 'FMI') {
      flags = view.getUint32(offset, true);
      offset += 4;
    }
  }
  return record;
}

export async function readCan(port, kind) {
  const { read, size } = definitions[kind];
  return (await readFrames(port, read, size + 4)).filter((record) => record.length)
    .map((record) => decodeCanRecord(kind, record));
}

export async function writeCan(port, kind, records) {
  if (!records.length || records.length > 256) throw new Error('Select 1 to 256 enabled J1939 records.');
  const { write, size } = definitions[kind];
  const encoded = records.map((record) => encodeCanRecord(kind, record));
  await withExclusiveUsb(port, async (exclusive) => {
    const current = await readCan(exclusive, kind);
    if (encoded.length > current.length) {
      throw new Error(`This controller has ${current.length} J1939 ${kind} slots.`);
    }
    for (let page = 0; page < current.length; page++) {
      // The desktop writer acknowledges each CAN row separately.
      await writePayload(exclusive, write, encoded[page] ?? new Uint8Array(size), page);
    }
  });
}

export async function readCanWorkbook(base64) {
  const [header, ...rows] = await readWorkbookRows(base64);
  const kind = header?.[1]?.trim().toUpperCase() === 'PGN' ? 'parameters'
    : header?.[1]?.trim().toUpperCase() === 'SPN' ? 'faults' : null;
  if (!kind) throw new Error('Select an ECON J1939 parameter or diagnostic workbook.');
  const hasSlotNumbers = header?.[0]?.trim().toUpperCase() === 'ENABLED';
  const records = rows.filter((row) => hasSlotNumbers ? row[1] != null : isEnabled(row[0])).map((row) =>
    Object.fromEntries(canFields(kind).map((field, index) =>
      [field, index === 0 && !isEnabled(row[0]) ? 0 : row[index + 1] ?? ''])));
  return { kind, records: records.map((record) => decodeCanRecord(kind, encodeCanRecord(kind, record))) };
}
