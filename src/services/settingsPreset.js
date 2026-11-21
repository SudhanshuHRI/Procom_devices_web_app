import { PRESET_FIELDS } from '../constants/presetFields';
import { SETTINGS_CONTROLS } from '../constants/settingsControls';
import { decodeText, encodeText } from './controllerFiles';
import { readPayload, writePayload } from './econProtocol';
import { withExclusiveUsb } from './usbService';

const payloadLength = PRESET_FIELDS.length * 2;
const model = (name) => String(name).toUpperCase().replace(/[^A-Z0-9]+/g, '');
const version = (name) => String(name).match(/\d+\.\d+/)?.[0];
const viewOf = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
function roundSetting(value) {
  const lower = Math.floor(value);
  return value - lower === 0.5 ? lower + Math.abs(lower % 2) : Math.round(value);
}
export const DISABLED_SETTINGS = new Set([
  'J1939_GCU_ADDRESS', 'FUEL_TANK_CAPA', 'GEN_HIGH_KW', 'GEN_REV_POWER_KW',
  'FAN_CUR_HIGH', 'FAN_CUR_LOW', 'GEN_OVER_FREQ', 'GEN_UNDER_FREQ', 'GEN_CUR_UNBALANCE',
  'CHOKE_PRE_TIME', 'CHOKE_POST_TIME', 'HWT_HIGH_TEMP', 'HWT_TIME_DELAY',
  'CHARGING_DELAY', 'BATT_UNDER_VOL', 'BATT_OVER_VOL', 'ROOM_OVER_TEMP', 'ROOM_TEMP_DELAY',
]);

export function parseDesktopPreset(bytes, deviceName, deviceVersion) {
  let offset = 0;
  function readString() {
    let length = 0;
    let count = 0;
    let byte;
    do {
      if (offset >= bytes.length || count === 4) throw new Error('Invalid desktop settings file.');
      byte = bytes[offset++];
      length += (byte & 127) * 128 ** count++;
    } while (byte & 128);
    if (offset + length > bytes.length) throw new Error('Truncated desktop settings file.');
    const value = decodeText(bytes.subarray(offset, offset + length));
    offset += length;
    return value;
  }

  const product = readString();
  const firmware = readString();
  if (!model(product).startsWith('ECONMANIND') || !model(deviceName).startsWith('ECONMANIND') ||
      !version(firmware) || version(firmware) !== version(deviceVersion)) {
    throw new Error(`Preset ${product} ${firmware} is incompatible with ${deviceName} ${deviceVersion}.`);
  }
  const values = PRESET_FIELDS.map(() => {
    const text = readString().trim();
    const value = Number(text.replace(',', '.'));
    if (!text || !Number.isFinite(value)) throw new Error('Invalid numeric setting in the preset.');
    return value;
  });
  if (offset !== bytes.length) throw new Error('Unsupported preset layout.');
  const payload = new Uint8Array(payloadLength);
  const view = viewOf(payload);
  PRESET_FIELDS.forEach(([id, label, divisor, index, userDefined], fieldIndex) => {
    const value = values[index];
    const raw = value === userDefined ? 65535 : roundSetting(value * divisor);
    if (raw < -32768 || raw > 65535) throw new Error(`Invalid setting: ${label || id}.`);
    view.setUint16(fieldIndex * 2, raw & 65535, true);
  });
  return payload;
}

function settingValues(payload) {
  if (payload.length !== payloadLength) throw new Error('The controller uses a different settings layout.');
  const view = viewOf(payload);
  return PRESET_FIELDS.map(([id, label, divisor, index, userDefined], fieldIndex) => {
    const raw = view.getUint16(fieldIndex * 2, true);
    const signed = SETTINGS_CONTROLS[id][2] < 0 && raw > 32767 ? raw - 65536 : raw;
    const value = raw === 65535 && userDefined !== undefined ? userDefined : signed / divisor;
    return { id, label, index, raw, value };
  });
}

export function editableSettings(payload) {
  return settingValues(payload).map((field, position) => {
    const [group, unit, min, max, choices] = SETTINGS_CONTROLS[field.id];
    return { ...field, group, unit, min, max, choices, position, divisor: PRESET_FIELDS[position][2] };
  });
}

export function applySettingEdits(payload, edits) {
  const result = payload.slice();
  const view = viewOf(result);
  for (const field of editableSettings(payload)) {
    if (!(field.id in edits)) continue;
    const text = String(edits[field.id]).trim();
    const value = Number(text.replace(',', '.'));
    const scaled = value * field.divisor;
    const raw = roundSetting(scaled);
    const [, , , , disabledChoice] = PRESET_FIELDS[field.position];
    const setOff = raw === 65535 && DISABLED_SETTINGS.has(field.id);
    if (!text || !Number.isFinite(value) || raw > 65535 || raw < -32768 || (!setOff && (
      field.choices.length > 0 ? !Number.isInteger(value) || value < 0 || value >= field.choices.length
        : scaled < field.min || scaled > (field.max || 65535)
    ))) {
      throw new Error(`Invalid value for ${field.label || field.id}.`);
    }
    view.setUint16(field.position * 2, value === disabledChoice ? 65535 : raw & 65535, true);
  }
  if (String(edits.J1939_GCU_ADDRESS).trim() === '65535') {
    view.setUint16(PRESET_FIELDS.findIndex(([id]) => id === 'J1939_ECU_ADDRESS') * 2, 0, true);
  }
  return result;
}

export function compareSettings(current, preset) {
  const previous = settingValues(current);
  return settingValues(preset).flatMap(({ id, label, raw, value }, index) =>
    raw === previous[index].raw ? [] : [{ Setting: label || id, Device: previous[index].value, File: value }]);
}

export function settingsReport(payload) {
  return settingValues(payload).map(({ id, label, value }) => ({ Setting: label || id, Value: value }));
}

export function desktopPresetBytes(payload, product, firmware) {
  const values = settingValues(payload).sort((left, right) => left.index - right.index);
  const bytes = [];
  for (const value of [product, firmware, ...values.map(({ value }) => String(value))]) {
    const text = encodeText(String(value));
    let length = text.length;
    while (length >= 128) {
      bytes.push((length & 127) | 128);
      length >>>= 7;
    }
    bytes.push(length, ...text);
  }
  return Uint8Array.from(bytes);
}

export const readSettingsPayload = (port) => readPayload(port, 0x92);

async function writeSettingsFrames(port, bytes) {
  settingValues(bytes);
  for (let offset = 0; offset < bytes.length; offset += 56) {
    const started = Date.now();
    const final = offset + 56 >= bytes.length;
    await writePayload(port, 0x90, bytes.subarray(offset, offset + 56), offset / 56, final);
    // The desktop settings writer allows 500 ms to receive each page response.
    const remaining = 500 - (Date.now() - started);
    if (!final && remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}

export function writeSettingsPayload(port, bytes) {
  return withExclusiveUsb(port, (exclusive) => writeSettingsFrames(exclusive, bytes));
}

export function updateSettingsFields(port, edits) {
  return withExclusiveUsb(port, async (exclusive) => {
    const current = await readSettingsPayload(exclusive);
    const updated = applySettingEdits(current, edits);
    await writeSettingsFrames(exclusive, updated);
    return updated;
  });
}
