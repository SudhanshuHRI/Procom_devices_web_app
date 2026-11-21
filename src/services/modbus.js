import { listSerialAdapters, openSerialAdapter } from './browserSerial';
import { MODBUS_INPUTS } from '../constants/modbusInputs';
import { hexResponseToHexArray, sendCommandAndGetResponse } from './usbService';

export const HOLDING_FIELDS = [
  ['DG under voltage', 0, 100, 200], ['DG over voltage', 1, 150, 300],
  ['DG crank time', 2, 1, 5], ['DG crank gap time', 5, 1, 99],
  ['DG overload trip', 7, 1, 15],
];
export const COILS = ['Stop generator', 'Start generator', 'Remote mode', 'Manual mode'];

export const listAdapters = listSerialAdapters;
export const openAdapter = openSerialAdapter;

export function modbusCrc(bytes) {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xa001 : 0);
  }
  return crc;
}

export async function queryModbus(port, unit, command, address, value) {
  const request = Uint8Array.of(unit, command, address >> 8, address & 255, value >> 8, value & 255);
  const crc = modbusCrc(request);
  const reply = Uint8Array.from(hexResponseToHexArray(await sendCommandAndGetResponse(
    port, Uint8Array.of(...request, crc & 255, crc >> 8), 2000, 120,
  )), Number);
  if (reply.length < 5 || reply[0] !== unit || modbusCrc(reply) !== 0) throw new Error('Invalid Modbus reply.');
  if (reply[1] === (command | 0x80)) throw new Error(`Controller returned Modbus exception ${reply[2]}.`);
  if (reply[1] !== command) throw new Error('Unexpected Modbus response.');
  if (command >= 5) {
    if (reply.length !== 8 || request.some((byte, index) => byte !== reply[index])) {
      throw new Error('The controller did not echo the request.');
    }
    return;
  }
  const expectedBytes = command < 3 ? Math.ceil(value / 8) : value * 2;
  if (reply.length !== expectedBytes + 5 || reply[2] !== expectedBytes) throw new Error('Incomplete Modbus response.');
  return reply.subarray(3, -2);
}

export async function readModbusDisplay(port, unit) {
  const queries = [[4, 0, 120], [4, 120, 46], [2, 0, 58]];
  const records = [];
  for (const [index, query] of queries.entries()) {
    const bytes = await queryModbus(port, unit, ...query);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (const [label, offset, width, divisor, unitLabel, bit] of MODBUS_INPUTS[index]) {
      const value = bit !== null ? ((bytes[offset] >> (7 - bit)) & 1 ? 'On' : 'Off')
        : (width === 4 ? view.getInt32(offset) : width === 2 ? view.getUint16(offset) : bytes[offset]) / divisor;
      records.push({ Parameter: label, Value: value, Unit: unitLabel });
    }
  }
  return records;
}
