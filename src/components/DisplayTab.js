import React, { useEffect, useMemo, useRef } from "react";
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import COLORS from "../constants/colors";

// =============================================================================
// 0x93 USB RESPONSE FORMAT
// =============================================================================
//
// The controller returns four frames:
//
// Frame 0:
// [0x00, 0x93, 0x00, 0x00] + 56 payload bytes
//
// Frame 1:
// [0x00, 0x93, 0x01, 0x00] + 56 payload bytes
//
// Frame 2:
// [0x00, 0x93, 0x02, 0x00] + 56 payload bytes
//
// Frame 3:
// [0x00, 0x93, 0x03, 0x40] + 48 payload bytes
//
// Every frame starts with:
//
// byte 0 = device ID
// byte 1 = command, always 0x93
// byte 2 = page number
// byte 3 = status
//
// Status:
// 0x00 = another frame follows
// 0x40 = final frame
// 0x80 = device error
//
// After removing each four-byte frame header:
//
// 56 + 56 + 56 + 48 = 216 payload bytes
//
// All four-byte parameters are signed little-endian Int32 values.
//
// Example:
//
// Raw bytes:
// 01 02 03 04
//
// Integer:
// 0x04030201 = 67305985
//
// For current, divisor = 1000:
//
// 67305985 / 1000 = 67305.985 A
// =============================================================================

const DISPLAY_COMMAND = 0x93;

const FRAME_HEADER_LENGTH = 4;
const NORMAL_FRAME_LENGTH = 60;
const EXPECTED_FRAME_COUNT = 4;
const EXPECTED_PAYLOAD_LENGTH = 216;

const FRAME_STATUS_MORE = 0x00;
const FRAME_STATUS_FINAL = 0x40;
const FRAME_STATUS_ERROR = 0x80;

// Recording time in the desktop application starts from 01-01-2000.
const DISPLAY_EPOCH_MS = Date.UTC(2000, 0, 1, 0, 0, 0);

// =============================================================================
// PARAMETER MAP
// =============================================================================
//
// All offsets below refer to the combined 216-byte payload.
//
// They do not refer to the original raw TabData array because TabData contains
// a four-byte header before every frame.
//
// Change protocol offsets and divisors only in this object if firmware changes.
// =============================================================================

const DISPLAY_FIELDS = Object.freeze({
  faultBytes: {
    offset: 0,
    size: 8,
  },

  // Line-to-line voltage
  voltageLineRY: {
    offset: 8,
    divisor: 10,
  },
  voltageLineYB: {
    offset: 12,
    divisor: 10,
  },
  voltageLineBR: {
    offset: 16,
    divisor: 10,
  },

  // Per-phase active power
  activePowerR: {
    offset: 20,
    divisor: 1000,
  },
  activePowerY: {
    offset: 24,
    divisor: 1000,
  },
  activePowerB: {
    offset: 28,
    divisor: 1000,
  },

  // Per-phase apparent power
  apparentPowerR: {
    offset: 32,
    divisor: 1000,
  },
  apparentPowerY: {
    offset: 36,
    divisor: 1000,
  },
  apparentPowerB: {
    offset: 40,
    divisor: 1000,
  },

  // Per-phase reactive power
  reactivePowerR: {
    offset: 44,
    divisor: 1000,
  },
  reactivePowerY: {
    offset: 48,
    divisor: 1000,
  },
  reactivePowerB: {
    offset: 52,
    divisor: 1000,
  },

  totalReactivePower: {
    offset: 56,
    divisor: 1000,
  },

  totalPowerFactor: {
    offset: 60,
    divisor: 100,
  },

  frequency: {
    offset: 64,
    divisor: 10,
  },

  pressure: {
    offset: 68,
    divisor: 10,
  },

  // The C# program uses this field to determine whether the fuel sensor is open.
  // The actual displayed fuel percentage is read from offset 156.
  fuelSensorCheck: {
    offset: 72,
    divisor: 10,
  },

  serviceDueHours: {
    offset: 76,
    divisor: 10,
  },

  fanCurrent: {
    offset: 80,
    divisor: 10,
  },

  generatorKvah: {
    offset: 84,
    divisor: 10,
  },

  recordingTimeSeconds: {
    offset: 88,
    divisor: 1,
  },

  // Phase-to-neutral voltage
  voltagePhaseR: {
    offset: 92,
    divisor: 10,
  },
  voltagePhaseY: {
    offset: 96,
    divisor: 10,
  },
  voltagePhaseB: {
    offset: 100,
    divisor: 10,
  },

  // Current
  currentR: {
    offset: 104,
    divisor: 1000,
  },
  currentY: {
    offset: 108,
    divisor: 1000,
  },
  currentB: {
    offset: 112,
    divisor: 1000,
  },
  currentN: {
    offset: 116,
    divisor: 1000,
  },

  // Per-phase power factor
  powerFactorR: {
    offset: 120,
    divisor: 100,
  },
  powerFactorY: {
    offset: 124,
    divisor: 100,
  },
  powerFactorB: {
    offset: 128,
    divisor: 100,
  },

  totalActivePower: {
    offset: 132,
    divisor: 1000,
  },

  totalApparentPower: {
    offset: 136,
    divisor: 1000,
  },

  operationMode: {
    offset: 140,
    divisor: 1,
  },

  batteryVoltage: {
    offset: 144,
    divisor: 10,
  },

  rpm: {
    offset: 148,
    divisor: 1,
  },

  temperature: {
    offset: 152,
    divisor: 1,
  },

  fuelPercentage: {
    offset: 156,
    divisor: 100,
  },

  fuelLiters: {
    offset: 160,
    divisor: 100,
  },

  llopPsi: {
    offset: 164,
    divisor: 100,
  },

  generatorPeakKw: {
    offset: 168,
    divisor: 1000,
  },

  generatorRunSeconds: {
    offset: 172,
    divisor: 1,
  },

  generatorKwh: {
    offset: 176,
    divisor: 10,
  },

  temperatureRunSeconds: {
    offset: 180,
    divisor: 1,
  },

  manualRunSeconds: {
    offset: 184,
    divisor: 1,
  },

  remoteRunSeconds: {
    offset: 188,
    divisor: 1,
  },
});

// =============================================================================
// FAULT BIT MAP
// =============================================================================
//
// byteOffset is relative to payload offset 0.
//
// Example:
//
// payload[0] = 0x80
//
// 0x80 = bit 7 active
//
// Therefore "Under Volt" is active.
// =============================================================================

const FAULT_DEFINITIONS = Object.freeze([
  { name: "Fuel Sensor Trip", byteOffset: 0, bit: 0 },
  { name: "LLOP Sensor Trip", byteOffset: 0, bit: 2 },
  { name: "HWT Sensor Trip", byteOffset: 0, bit: 4 },
  { name: "Over Volt", byteOffset: 0, bit: 6 },
  { name: "Under Volt", byteOffset: 0, bit: 7 },

  { name: "Emergency", byteOffset: 1, bit: 0 },
  { name: "Gen Overload", byteOffset: 1, bit: 1 },
  { name: "Gen Over Speed/Freq.", byteOffset: 1, bit: 2 },
  { name: "Gen Under Speed/Freq.", byteOffset: 1, bit: 3 },
  { name: "RWL Trip", byteOffset: 1, bit: 4 },
  { name: "Chg Alt/V belt", byteOffset: 1, bit: 5 },
  { name: "Fail to Start", byteOffset: 1, bit: 6 },
  { name: "Fail to Stop", byteOffset: 1, bit: 7 },

  { name: "Current Unbalance", byteOffset: 2, bit: 0 },
  { name: "VBelt", byteOffset: 2, bit: 1 },
  { name: "EXT 1", byteOffset: 2, bit: 2 },
  { name: "EXT 2", byteOffset: 2, bit: 3 },
  { name: "Canopy Temp Sensor", byteOffset: 2, bit: 4 },
  { name: "Fire", byteOffset: 2, bit: 5 },
  { name: "Oil Temp", byteOffset: 2, bit: 6 },
  { name: "Oil Level", byteOffset: 2, bit: 7 },

  { name: "Fan Current", byteOffset: 3, bit: 0 },
  { name: "Canopy Temp Switch", byteOffset: 3, bit: 1 },
  { name: "Fault Gen High Load", byteOffset: 3, bit: 2 },
  { name: "Fault Fuel Open", byteOffset: 3, bit: 3 },
  { name: "Fault LLOP Open", byteOffset: 3, bit: 4 },
  { name: "Fault HWT Open", byteOffset: 3, bit: 5 },
  { name: "Fault Rev Power", byteOffset: 3, bit: 6 },
  { name: "EGR Fault", byteOffset: 3, bit: 7 },

  { name: "NCD Fault", byteOffset: 4, bit: 0 },
  { name: "CAN Open", byteOffset: 4, bit: 1 },
  { name: "J1939 ECU", byteOffset: 4, bit: 2 },

  // Canopy Door Open is located in warning/fault byte 5 bit 0.
  { name: "Canopy Door Open", byteOffset: 5, bit: 0 },

  // No confirmed active-bit mapping was available for this label in the
  // inspected desktop project, so it remains inactive.
  { name: "Engine Running", supported: false },

  { name: "Fuel Switch Trip", byteOffset: 0, bit: 1 },
  { name: "LLOP Switch Trip", byteOffset: 0, bit: 3 },
  { name: "HWT Switch Trip", byteOffset: 0, bit: 5 },
]);

// =============================================================================
// WARNING BIT MAP
// =============================================================================

const WARNING_DEFINITIONS = Object.freeze([
  { name: "Fuel Open Warning", byteOffset: 5, bit: 1 },
  { name: "LLOP Open Warning", byteOffset: 5, bit: 2 },
  { name: "HWT Open Warning", byteOffset: 5, bit: 3 },
  { name: "Fuel Warning", byteOffset: 5, bit: 4 },
  { name: "Service Due Warning", byteOffset: 5, bit: 5 },
  { name: "Battery Under Voltage Warning", byteOffset: 5, bit: 6 },
  { name: "Battery Over Voltage Warning", byteOffset: 5, bit: 7 },

  { name: "EGR Warning", byteOffset: 6, bit: 0 },
  { name: "EGR ECU Unhealthy", byteOffset: 6, bit: 1 },
  { name: "EGR ECU Temp Open Warning", byteOffset: 6, bit: 2 },
  { name: "EGR ECU Temp Sens Warning", byteOffset: 6, bit: 3 },
  { name: "EGR ECU Valve Open Warning", byteOffset: 6, bit: 4 },
  { name: "EGR ECU Valve Sens Warning", byteOffset: 6, bit: 5 },
  { name: "EGR ECU Valve Lift Warning", byteOffset: 6, bit: 6 },
  { name: "EGR ECU Valve Close Warning", byteOffset: 6, bit: 7 },

  { name: "NCD Warning", byteOffset: 7, bit: 0 },
  { name: "J1939 ECU Warning", byteOffset: 7, bit: 1 },
]);

// =============================================================================
// EMPTY UI VALUES
// =============================================================================

const EMPTY_DISPLAY_VALUES = Object.freeze({
  curR: "--",
  curY: "--",
  curB: "--",
  curN: "--",

  llRY: "--",
  llYB: "--",
  llBR: "--",

  vR: "--",
  vY: "--",
  vB: "--",
  vTot: "--",

  apTot: "--",
  appTot: "--",
  rqTot: "--",
  pf: "--",

  rpm: "--",
  temp: "--",
  fuel: "--",
  pressure: "--",
  batV: "--",
  fanA: "--",
  hz: "--",
  fuelL: "--",

  opMode: "--",
  recTime: "--",

  genKWH: "--",
  genKVAH: "--",

  genRunHr: "--",
  svcHr: "--",
  manHr: "--",
  remHr: "--",
  tmpHr: "--",
});

// =============================================================================
// BYTE CONVERSION HELPERS
// =============================================================================

/**
 * Converts one TabData item into a numeric byte.
 *
 * Supported inputs:
 *
 * "0x93"
 * "93"       decimal string
 * 147        numeric byte
 */
function normalizeByte(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid numeric byte: ${String(value)}`);
    }

    return value & 0xff;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (trimmed.length === 0) {
      throw new Error("Received an empty byte string.");
    }

    const isHexadecimal = /^0x/i.test(trimmed);

    const parsed = isHexadecimal
      ? Number.parseInt(trimmed.substring(2), 16)
      : Number.parseInt(trimmed, 10);

    if (!Number.isFinite(parsed)) {
      throw new Error(`Invalid byte value: ${value}`);
    }

    return parsed & 0xff;
  }

  throw new Error(`Unsupported byte value: ${String(value)}`);
}

function normalizeByteArray(tabData) {
  if (!Array.isArray(tabData)) {
    throw new Error("TabData must be an array.");
  }

  return tabData.map(normalizeByte);
}

// =============================================================================
// FRAME EXTRACTION
// =============================================================================

/**
 * Validates all 0x93 frames, removes their four-byte headers and combines their
 * data sections into one 216-byte payload.
 */
function extractDisplayPayload(tabData) {
  const rawBytes = normalizeByteArray(tabData);

  if (rawBytes.length === 0) {
    throw new Error("No display parameter data was received.");
  }

  if (rawBytes.length < FRAME_HEADER_LENGTH) {
    throw new Error("The 0x93 response is too short.");
  }

  const frames = [];

  let rawOffset = 0;

  while (rawOffset < rawBytes.length) {
    if (rawOffset + FRAME_HEADER_LENGTH > rawBytes.length) {
      throw new Error(
        `Incomplete frame header starting at raw byte ${rawOffset}.`,
      );
    }

    const deviceId = rawBytes[rawOffset];
    const command = rawBytes[rawOffset + 1];
    const pageNumber = rawBytes[rawOffset + 2];
    const status = rawBytes[rawOffset + 3];

    if (command !== DISPLAY_COMMAND) {
      const actualCommand = command.toString(16).padStart(2, "0");

      throw new Error(
        `Unexpected command 0x${actualCommand} at raw byte ${rawOffset}. ` +
          "Expected command 0x93.",
      );
    }

    if (status === FRAME_STATUS_ERROR) {
      throw new Error(
        `The controller returned an error on page ${pageNumber}.`,
      );
    }

    if (
      status !== FRAME_STATUS_MORE &&
      status !== FRAME_STATUS_FINAL
    ) {
      const actualStatus = status.toString(16).padStart(2, "0");

      throw new Error(
        `Unexpected frame status 0x${actualStatus} on page ${pageNumber}.`,
      );
    }

    const isFinalFrame = status === FRAME_STATUS_FINAL;

    let frameEnd;

    if (isFinalFrame) {
      // The final frame uses all remaining bytes.
      frameEnd = rawBytes.length;
    } else {
      frameEnd = rawOffset + NORMAL_FRAME_LENGTH;

      if (frameEnd > rawBytes.length) {
        throw new Error(`Page ${pageNumber} is incomplete.`);
      }
    }

    const framePayload = rawBytes.slice(
      rawOffset + FRAME_HEADER_LENGTH,
      frameEnd,
    );

    frames.push({
      deviceId,
      command,
      pageNumber,
      status,
      payload: framePayload,
    });

    rawOffset = frameEnd;

    if (isFinalFrame) {
      break;
    }
  }

  if (frames.length !== EXPECTED_FRAME_COUNT) {
    throw new Error(
      `Received ${frames.length} frame(s). ` +
        `Expected ${EXPECTED_FRAME_COUNT} frames.`,
    );
  }

  frames.forEach((frame, index) => {
    if (frame.pageNumber !== index) {
      throw new Error(
        `Invalid page sequence. Received page ${frame.pageNumber}, ` +
          `but expected page ${index}.`,
      );
    }
  });

  const lastFrame = frames[frames.length - 1];

  if (lastFrame.status !== FRAME_STATUS_FINAL) {
    throw new Error(
      "The final 0x93 frame with status 0x40 was not received.",
    );
  }

  const payload = frames.flatMap((frame) => frame.payload);

  if (payload.length < EXPECTED_PAYLOAD_LENGTH) {
    throw new Error(
      `Incomplete parameter payload. Received ${payload.length} bytes, ` +
        `but expected ${EXPECTED_PAYLOAD_LENGTH} bytes.`,
    );
  }

  // Firmware may append bytes in future. Only use the documented 216 bytes.
  return payload.slice(0, EXPECTED_PAYLOAD_LENGTH);
}

// =============================================================================
// VALUE DECODING
// =============================================================================

/**
 * Reads a signed 32-bit little-endian value.
 *
 * Example:
 *
 * payload[offset + 0] = 0x01
 * payload[offset + 1] = 0x02
 * payload[offset + 2] = 0x03
 * payload[offset + 3] = 0x04
 *
 * Result:
 * 0x04030201 = 67305985
 */
function readInt32LE(payload, offset) {
  if (!Array.isArray(payload)) {
    throw new Error("Payload must be an array.");
  }

  if (offset < 0 || offset + 4 > payload.length) {
    throw new Error(
      `Cannot read a four-byte value from payload offset ${offset}.`,
    );
  }

  // JavaScript bitwise operations return a signed 32-bit number.
  return (
    payload[offset] |
    (payload[offset + 1] << 8) |
    (payload[offset + 2] << 16) |
    (payload[offset + 3] << 24)
  );
}

function readScaledField(payload, field) {
  const rawValue = readInt32LE(payload, field.offset);

  return rawValue / field.divisor;
}

function isBitSet(payload, byteOffset, bitPosition) {
  if (byteOffset < 0 || byteOffset >= payload.length) {
    return false;
  }

  return ((payload[byteOffset] >> bitPosition) & 0x01) === 1;
}

// =============================================================================
// FORMATTING
// =============================================================================

function formatNumber(value, maximumFractionDigits = 3) {
  if (!Number.isFinite(value)) {
    return "--";
  }

  return value.toLocaleString("en-US", {
    useGrouping: false,
    minimumFractionDigits: 0,
    maximumFractionDigits,
  });
}

/**
 * Converts seconds to the same run-hour format used by the desktop application.
 *
 * Example:
 *
 * 3661 seconds -> 00001:01:01
 */
function formatRunTime(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return "--";
  }

  const wholeSeconds = Math.trunc(totalSeconds);

  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const seconds = wholeSeconds % 60;

  return (
    `${String(hours).padStart(5, "0")}:` +
    `${String(minutes).padStart(2, "0")}:` +
    `${String(seconds).padStart(2, "0")}`
  );
}

/**
 * Converts controller seconds from 01-01-2000 into:
 *
 * DD-MM-YYYY HH:mm:ss
 */
function formatRecordingTime(secondsFrom2000) {
  if (!Number.isFinite(secondsFrom2000) || secondsFrom2000 < 0) {
    return "--";
  }

  const date = new Date(
    DISPLAY_EPOCH_MS + Math.trunc(secondsFrom2000) * 1000,
  );

  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();

  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");

  return `${day}-${month}-${year} ${hours}:${minutes}:${seconds}`;
}

function formatOperationMode(mode) {
  switch (mode) {
    case 0:
      return "Manual";

    case 1:
      return "Remote";

    default:
      return `Unknown (${mode})`;
  }
}

// =============================================================================
// STATUS DECODING
// =============================================================================

function buildStatusItems(payload, definitions) {
  return definitions.map((definition) => {
    if (definition.supported === false) {
      return {
        name: definition.name,
        active: false,
      };
    }

    return {
      name: definition.name,
      active: isBitSet(
        payload,
        definition.byteOffset,
        definition.bit,
      ),
    };
  });
}

// =============================================================================
// COMPLETE 0x93 DECODER
// =============================================================================

export function decodeDisplayResponse(tabData) {
  const payload = extractDisplayPayload(tabData);

  const pressure = readScaledField(
    payload,
    DISPLAY_FIELDS.pressure,
  );

  const fuelSensorCheck = readScaledField(
    payload,
    DISPLAY_FIELDS.fuelSensorCheck,
  );

  const temperature = readScaledField(
    payload,
    DISPLAY_FIELDS.temperature,
  );

  const fuelPercentage = readScaledField(
    payload,
    DISPLAY_FIELDS.fuelPercentage,
  );

  const fuelLiters = readScaledField(
    payload,
    DISPLAY_FIELDS.fuelLiters,
  );

  const operationMode = readScaledField(
    payload,
    DISPLAY_FIELDS.operationMode,
  );

  const values = {
    // -------------------------------------------------------------------------
    // Current
    // -------------------------------------------------------------------------
    curR: formatNumber(
      readScaledField(payload, DISPLAY_FIELDS.currentR),
      3,
    ),

    curY: formatNumber(
      readScaledField(payload, DISPLAY_FIELDS.currentY),
      3,
    ),

    curB: formatNumber(
      readScaledField(payload, DISPLAY_FIELDS.currentB),
      3,
    ),

    curN: formatNumber(
      readScaledField(payload, DISPLAY_FIELDS.currentN),
      3,
    ),

    // -------------------------------------------------------------------------
    // Line-to-line voltage
    // -------------------------------------------------------------------------
    llRY: formatNumber(
      readScaledField(payload, DISPLAY_FIELDS.voltageLineRY),
      1,
    ),

    llYB: formatNumber(
      readScaledField(payload, DISPLAY_FIELDS.voltageLineYB),
      1,
    ),

    llBR: formatNumber(
      readScaledField(payload, DISPLAY_FIELDS.voltageLineBR),
      1,
    ),

    // -------------------------------------------------------------------------
    // Phase voltage
    // -------------------------------------------------------------------------
    vR: formatNumber(
      readScaledField(payload, DISPLAY_FIELDS.voltagePhaseR),
      1,
    ),

    vY: formatNumber(
      readScaledField(payload, DISPLAY_FIELDS.voltagePhaseY),
      1,
    ),

    vB: formatNumber(
      readScaledField(payload, DISPLAY_FIELDS.voltagePhaseB),
      1,
    ),

    // The protocol has no separate "total voltage" parameter.
    // Do not calculate an artificial total by adding or averaging the phases.
    vTot: "--",

    // -------------------------------------------------------------------------
    // Total power
    // -------------------------------------------------------------------------
    apTot: formatNumber(
      readScaledField(payload, DISPLAY_FIELDS.totalActivePower),
      3,
    ),

    appTot: formatNumber(
      readScaledField(payload, DISPLAY_FIELDS.totalApparentPower),
      3,
    ),

    rqTot: formatNumber(
      readScaledField(payload, DISPLAY_FIELDS.totalReactivePower),
      3,
    ),

    pf: formatNumber(
      readScaledField(payload, DISPLAY_FIELDS.totalPowerFactor),
      2,
    ),

    // -------------------------------------------------------------------------
    // Engine
    // -------------------------------------------------------------------------
    phasePower: ['R', 'Y', 'B'].map((phase) => ({
      phase,
      active: readScaledField(payload, DISPLAY_FIELDS['activePower' + phase]),
      apparent: readScaledField(payload, DISPLAY_FIELDS['apparentPower' + phase]),
      reactive: readScaledField(payload, DISPLAY_FIELDS['reactivePower' + phase]),
      factor: readScaledField(payload, DISPLAY_FIELDS['powerFactor' + phase]),
    })),
    rpm: formatNumber(
      readScaledField(payload, DISPLAY_FIELDS.rpm),
      0,
    ),

    // Negative temperature means open sensor.
    temp:
      temperature < 0
        ? "Open Sensor"
        : formatNumber(temperature, 1),

    // Offset 72 checks whether the fuel sensor is open.
    // Offset 156 gives the displayed fuel percentage.
    fuel:
      fuelSensorCheck < 0
        ? "Open Sensor"
        : formatNumber(fuelPercentage, 2),

    // In the C# application, 8.5 kg/cm² represents an open pressure sensor.
    pressure:
      pressure === 8.5
        ? "Open Sensor"
        : formatNumber(pressure, 1),

    batV: formatNumber(
      readScaledField(payload, DISPLAY_FIELDS.batteryVoltage),
      1,
    ),

    fanA: formatNumber(
      readScaledField(payload, DISPLAY_FIELDS.fanCurrent),
      1,
    ),

    hz: formatNumber(
      readScaledField(payload, DISPLAY_FIELDS.frequency),
      1,
    ),

    fuelL:
      fuelLiters < 0
        ? "Open Sensor"
        : formatNumber(fuelLiters, 2),

    // -------------------------------------------------------------------------
    // Energy and operating mode
    // -------------------------------------------------------------------------
    genKWH: formatNumber(
      readScaledField(payload, DISPLAY_FIELDS.generatorKwh),
      1,
    ),

    genKVAH: formatNumber(
      readScaledField(payload, DISPLAY_FIELDS.generatorKvah),
      1,
    ),

    opMode: formatOperationMode(operationMode),

    recTime: formatRecordingTime(
      readScaledField(
        payload,
        DISPLAY_FIELDS.recordingTimeSeconds,
      ),
    ),

    // -------------------------------------------------------------------------
    // Run hours
    // -------------------------------------------------------------------------
    genRunHr: formatRunTime(
      readScaledField(
        payload,
        DISPLAY_FIELDS.generatorRunSeconds,
      ),
    ),

    svcHr: formatNumber(
      readScaledField(payload, DISPLAY_FIELDS.serviceDueHours),
      1,
    ),

    manHr: formatRunTime(
      readScaledField(
        payload,
        DISPLAY_FIELDS.manualRunSeconds,
      ),
    ),

    remHr: formatRunTime(
      readScaledField(
        payload,
        DISPLAY_FIELDS.remoteRunSeconds,
      ),
    ),

    tmpHr: formatRunTime(
      readScaledField(
        payload,
        DISPLAY_FIELDS.temperatureRunSeconds,
      ),
    ),
  };

  return {
    payload,
    values,

    faultItems: buildStatusItems(
      payload,
      FAULT_DEFINITIONS,
    ),

    warningItems: buildStatusItems(
      payload,
      WARNING_DEFINITIONS,
    ),

    error: null,
  };
}

function createEmptyDecodedData(error = null) {
  return {
    payload: [],

    values: EMPTY_DISPLAY_VALUES,

    faultItems: FAULT_DEFINITIONS.map((definition) => ({
      name: definition.name,
      active: false,
    })),

    warningItems: WARNING_DEFINITIONS.map((definition) => ({
      name: definition.name,
      active: false,
    })),

    error,
  };
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function DisplayTab({
  TabData = [],
  getDisplayParameters,
}) {
  /**
   * Decode again only when TabData changes.
   *
   * useMemo prevents all frame parsing and byte conversion from running during
   * unrelated component re-renders.
   */
  const decoded = useMemo(() => {
    if (!Array.isArray(TabData) || TabData.length === 0) {
      return createEmptyDecodedData();
    }

    try {
      return decodeDisplayResponse(TabData);
    } catch (error) {
      console.error(
        "Unable to decode 0x93 display parameter response:",
        error,
      );

      return createEmptyDecodedData(
        error instanceof Error
          ? error.message
          : "Unknown display data error.",
      );
    }
  }, [TabData]);

  const D = decoded.values;
  const faultItems = decoded.faultItems;
  const warningItems = decoded.warningItems;

  

  const handleRefreshData = () => {
    if (typeof getDisplayParameters === "function") {
      getDisplayParameters();
    }
  };

  return (
    <View style={styles.card}>
      {/* Title and refresh button */}
      <View style={styles.titleRow}>
        <Text style={styles.pageTitle}>
          Display / Instant Parameter
        </Text>

        <TouchableOpacity
          style={styles.refreshBtn}
          activeOpacity={0.8}
          onPress={handleRefreshData}
        >
          <Text style={styles.refreshBtnText}>
            Refresh
          </Text>
        </TouchableOpacity>
      </View>

      {/* Show protocol or incomplete-data errors */}
      {!!decoded.error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>
            {decoded.error}
          </Text>
        </View>
      )}

      <View style={styles.settingsPanel}>
        {/* Current */}
        <SubCard title="Current">
          <Row2>
            <ValueField
              label="R Phase"
              value={D.curR}
              unit="A"
            />

            <ValueField
              label="Y Phase"
              value={D.curY}
              unit="A"
            />
          </Row2>

          <Row2>
            <ValueField
              label="B Phase"
              value={D.curB}
              unit="A"
            />

            <ValueField
              label="N Phase"
              value={D.curN}
              unit="A"
            />
          </Row2>
        </SubCard>

        {/* Voltage line-to-line */}
        <SubCard title="Voltage L-L">
          <Row2>
            <ValueField
              label="R-Y"
              value={D.llRY}
              unit="V"
            />

            <ValueField
              label="Y-B"
              value={D.llYB}
              unit="V"
            />
          </Row2>

          <Row2>
            <ValueField
              label="B-R"
              value={D.llBR}
              unit="V"
            />

            <View style={styles.emptyColumn} />
          </Row2>
        </SubCard>

        {/* Phase voltage */}
        <SubCard title="Voltage Phase">
          <Row2>
            <ValueField
              label="R Phase"
              value={D.vR}
              unit="V"
            />

            <ValueField
              label="Y Phase"
              value={D.vY}
              unit="V"
            />
          </Row2>

          <Row2>
            <ValueField
              label="B Phase"
              value={D.vB}
              unit="V"
            />

            <ValueField
              label="Total"
              value={D.vTot}
              unit="V"
            />
          </Row2>
        </SubCard>

        {/* Power */}
        <SubCard title="Power">
          <Row2>
            <ValueField
              label="Active Power"
              value={D.apTot}
              unit="KW"
            />

            <ValueField
              label="Apparent Power"
              value={D.appTot}
              unit="KVA"
            />
          </Row2>

          <Row2>
            <ValueField
              label="Reactive Power"
              value={D.rqTot}
              unit="KVAR"
            />

            <ValueField
              label="Power Factor"
              value={D.pf}
            />
          </Row2>
        </SubCard>

        {D.phasePower?.map(({ phase, active, apparent, reactive, factor }) => (
          <SubCard key={phase} title={phase + " Phase Power"}>
            <Row2>
              <ValueField label="Active Power" value={formatNumber(active)} unit="kW" />
              <ValueField label="Apparent Power" value={formatNumber(apparent)} unit="kVA" />
            </Row2>
            <Row2>
              <ValueField label="Reactive Power" value={formatNumber(reactive)} unit="kvar" />
              <ValueField label="Power Factor" value={formatNumber(factor, 2)} />
            </Row2>
          </SubCard>
        ))}

        {/* Engine */}
        <SubCard title="Engine">
          <Row2>
            <ValueField
              label="RPM"
              value={D.rpm}
            />

            <ValueField
              label="Temperature"
              value={D.temp}
              unit="°C"
            />
          </Row2>

          <Row2>
            <ValueField
              label="Fuel"
              value={D.fuel}
              unit="%"
            />

            <ValueField
              label="Pressure"
              value={D.pressure}
              unit="Kg/cm²"
            />
          </Row2>

          <Row2>
            <ValueField
              label="Battery Voltage"
              value={D.batV}
              unit="V"
            />

            <ValueField
              label="Fan Current"
              value={D.fanA}
              unit="A"
            />
          </Row2>

          <Row2>
            <ValueField
              label="Frequency"
              value={D.hz}
              unit="Hz"
            />

            <ValueField
              label="Fuel in Liter"
              value={D.fuelL}
              unit="L"
            />
          </Row2>

          <Row2>
            <ValueField
              label="Gen KWH"
              value={D.genKWH}
            />

            <ValueField
              label="Gen KVAH"
              value={D.genKVAH}
            />
          </Row2>

          <Row2>
            <ValueField
              label="Operation Mode"
              value={D.opMode}
            />

            <ValueField
              label="Recording Time"
              value={D.recTime}
            />
          </Row2>
        </SubCard>

        {/* Run hours */}
        <SubCard title="Run Hours" last>
          <Row2>
            <ValueField
              label="Generator Run Hour"
              value={D.genRunHr}
              unit="Hr"
            />

            <ValueField
              label="Service Due Hour"
              value={D.svcHr}
              unit="Hr"
            />
          </Row2>

          <Row2>
            <ValueField
              label="Manual Mode Run Hr"
              value={D.manHr}
              unit="Hr"
            />

            <ValueField
              label="Remote Mode Run Hr"
              value={D.remHr}
              unit="Hr"
            />
          </Row2>

          <Row2>
            <ValueField
              label="Temper Run Hour"
              value={D.tmpHr}
              unit="Hr"
            />

            <View style={styles.emptyColumn} />
          </Row2>
        </SubCard>
      </View>

      <StatusPanel
        title="Faults"
        items={faultItems}
      />

      <StatusPanel
        title="Warning"
        items={warningItems}
      />
    </View>
  );
}

// =============================================================================
// REUSABLE UI COMPONENTS
// =============================================================================

function SecHeader({ title }) {
  return (
    <View style={styles.secHeader}>
      <Text style={styles.secHeaderText}>
        {title}
      </Text>
    </View>
  );
}

function SubCard({
  title,
  children,
  last = false,
}) {
  return (
    <View
      style={[
        styles.formSection,
        !last && styles.formSectionGap,
      ]}
    >
      <SecHeader title={title} />
      {children}
    </View>
  );
}

function Row2({ children }) {
  return (
    <View style={styles.row2}>
      {children}
    </View>
  );
}

function ValueField({
  label,
  value,
  unit,
}) {
  return (
    <View style={styles.valueField}>
      <Text style={styles.fieldLabel}>
        {label}
      </Text>

      <View style={styles.inputLine}>
        <View style={styles.valueBox}>
          <Text
            style={styles.valueNum}
            numberOfLines={1}
          >
            {value ?? "--"}
          </Text>
        </View>

        {!!unit && (
          <Text style={styles.valueUnit}>
            {unit}
          </Text>
        )}
      </View>
    </View>
  );
}

function StatusPanel({
  title,
  items,
}) {
  const blink = useRef(
    new Animated.Value(1),
  ).current;

  const hasActiveItem = items.some(
    (item) => item.active,
  );

  useEffect(() => {
    if (!hasActiveItem) {
      blink.setValue(1);
      return undefined;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(blink, {
          toValue: 0.15,
          duration: 650,
          useNativeDriver: true,
        }),

        Animated.timing(blink, {
          toValue: 1,
          duration: 650,
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();

    return () => {
      animation.stop();
    };
  }, [blink, hasActiveItem]);

  return (
    <View style={styles.statusPanel}>
      <Text style={styles.statusPanelTitle}>
        {title}
      </Text>

      <View style={styles.statusGrid}>
        {items.map((item) => {
          if (item.active) {
            return (
              <Animated.View
                key={item.name}
                style={[
                  styles.statusItem,
                  styles.statusItemActive,
                  {
                    opacity: blink,
                  },
                ]}
              >
                <Text style={styles.statusItemText}>
                  {item.name}
                </Text>
              </Animated.View>
            );
          }

          return (
            <View
              key={item.name}
              style={[
                styles.statusItem,
                styles.statusItemInactive,
              ]}
            >
              <Text
                style={[
                  styles.statusItemText,
                  styles.statusItemTextInactive,
                ]}
              >
                {item.name}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    elevation: 2,
    marginBottom: 20,
  },

  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 14,
  },

  pageTitle: {
    flex: 1,
    fontSize: 22,
    fontWeight: "900",
    color: COLORS.primary,
  },

  refreshBtn: {
    backgroundColor: COLORS.primary,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    elevation: 2,
  },

  refreshBtnText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: "800",
  },

  errorBox: {
    backgroundColor: "#FDECEC",
    borderWidth: 1,
    borderColor: "#C62828",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 12,
  },

  errorText: {
    color: "#9B1C1C",
    fontSize: 12,
    fontWeight: "700",
  },

  settingsPanel: {
    backgroundColor: "#FFE8B8",
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 14,
    gap: 10,
  },

  formSection: {
    backgroundColor: "#FFF4D7",
    borderRadius: 12,
    padding: 10,
  },

  formSectionGap: {},

  secHeader: {
    backgroundColor: COLORS.primary,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginBottom: 10,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
  },

  secHeaderText: {
    fontSize: 15,
    fontWeight: "900",
    color: COLORS.white,
    letterSpacing: 0.5,
    textAlign: "center",
  },

  row2: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },

  emptyColumn: {
    flex: 1,
  },

  valueField: {
    flex: 1,
  },

  fieldLabel: {
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 5,
    color: COLORS.text,
  },

  inputLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  valueBox: {
    flex: 1,
    height: 40,
    backgroundColor: COLORS.white,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
  },

  valueNum: {
    color: COLORS.primary,
    fontWeight: "900",
    fontSize: 14,
  },

  valueUnit: {
    minWidth: 35,
    fontWeight: "700",
    color: COLORS.text,
  },

  statusPanel: {
    backgroundColor: COLORS.white,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 12,
  },

  statusPanelTitle: {
    backgroundColor: COLORS.primary,
    color: COLORS.white,
    fontSize: 18,
    fontWeight: "900",
    fontStyle: "italic",
    textAlign: "center",
    paddingVertical: 7,
    borderRadius: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  statusGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
  },

  statusItem: {
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 8,
    minWidth: "30%",
    flexGrow: 1,
  },

  statusItemActive: {
    backgroundColor: COLORS.primary,
  },

  statusItemInactive: {
    backgroundColor: "#FFF4D7",
    borderWidth: 1,
    borderColor: "#F0C060",
  },

  statusItemText: {
    color: COLORS.white,
    fontSize: 11,
    fontWeight: "800",
    textAlign: "center",
  },

  statusItemTextInactive: {
    color: COLORS.text,
  },
});
