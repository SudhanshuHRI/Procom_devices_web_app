import { Alert } from '../services/browserAlert';
import { historyReport } from "../services/historyReport";
import { Button } from "react-native";
import { saveWorkbook } from "../services/controllerFiles";
import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from "react-native";

import COLORS from "../constants/colors";

// =============================================================================
// UI CONSTANTS
// =============================================================================

const NAVY = "#254695";

// Number of history rows displayed initially.
// Each press of "Load More" displays another 25 rows.
const HISTORY_PAGE_SIZE = 25;

// =============================================================================
// USB HISTORY COMMANDS
// =============================================================================
//
// 0x96 = Fault History
// 0x97 = Event History
//
// Normal frame:
//
// 00 96 PAGE 00 + 56 data bytes
// 00 97 PAGE 00 + 56 data bytes
//
// Final frame:
//
// 00 96 PAGE 40 + remaining data
// 00 97 PAGE 40 + remaining data
//
// Header:
// Byte 0 = Device ID
// Byte 1 = Function code
// Byte 2 = Page number
// Byte 3 = Status
//
// Status:
// 0x00 = more frames follow
// 0x40 = last frame
// 0x80 = device error
//
// After removing every 4-byte USB header, history records are:
//
// ┌──────────┬────────┬────────────────────────────────────────┐
// │ Offset   │ Length │ Description                            │
// ├──────────┼────────┼────────────────────────────────────────┤
// │ 0        │ 4      │ Recording time, UInt32 little endian  │
// │ 4        │ 2      │ Event/Fault type, UInt16 little endian│
// │ 6        │ 2      │ Extra information                     │
// └──────────┴────────┴────────────────────────────────────────┘
//
// Therefore:
//
// 8 bytes = 1 history record
// =============================================================================

const COMMAND_FAULT_HISTORY = 0x96;
const COMMAND_EVENT_HISTORY = 0x97;

const FRAME_LENGTH = 60;
const FRAME_HEADER_LENGTH = 4;
const HISTORY_RECORD_LENGTH = 8;

const STATUS_MORE = 0x00;
const STATUS_FINAL = 0x40;
const STATUS_ERROR = 0x80;

// =============================================================================
// HISTORY TIME BASE
// =============================================================================
//
// C# project uses:
//
// 01-Jan-2000 00:00:00 + received seconds
//
// Example:
//
// received:
// 7B 2B 27 00
//
// little endian:
// 0x00272B7B
//
// add that many seconds to 01-Jan-2000.
// =============================================================================

const HISTORY_EPOCH_MS = Date.UTC(
  2000,
  0,
  1,
  0,
  0,
  0,
);

// =============================================================================
// EVENT TYPE MAP
// =============================================================================
//
// Event history command = 0x97
//
// Based on the C# Event.EventTypeVal() mapping.
// =============================================================================

const EVENT_TYPE_MAP = Object.freeze({
  1: "RTC Updated",
  2: "Password Modified",
  3: "Parameter Modified by operator",
  4: "Service HR Reset",
  5: "Parameter Modified by Supervisor",
  6: "Product Information Modified",
});

// =============================================================================
// FAULT TYPE MAP
// =============================================================================
//
// Fault history command = 0x96
//
// Based on the C# Fault.FaultTypeVal() mapping.
// =============================================================================

const FAULT_TYPE_MAP = Object.freeze({
  1: "FUEL Sensor Trip",
  2: "FUEL Switch Trip",
  3: "LLOP Sensor Trip",
  4: "LLOP Switch Trip",
  5: "HWT Sensor Trip",
  6: "HWT Switch Trip",
  7: "Over Volt",
  8: "Under Volt",
  9: "Emergency",
  10: "GEN Over Load",
  11: "GEN Over Speed/Freq",
  12: "GEN Under Speed/Freq",
  13: "RWL Trip",
  14: "VBelt/Charging Alternator Trip",
  15: "Start Failed",
  16: "Stop Failed",
  17: "Current Unbalance",
  18: "V Belt",
  19: "External 1",
  20: "External 2",
  21: "Canopy Temp. Sensor",
  22: "Fire",
  23: "Oil Temp",
  24: "Oil Level",
  25: "Fan Current",
  26: "Canopy Temp. Switch",
  27: "Gen High Load",
  28: "Fuel Open",
  29: "LLOP Open",
  30: "HWT Open",
  31: "Reverse Power",
  32: "EGR Fault",
  33: "NCD Fault",
  34: "CAN Open",
  35: "J1939 ECU",
});

// =============================================================================
// BYTE CONVERSION
// =============================================================================

/**
 * Converts a TabData byte into a normal JavaScript number.
 *
 * Supports:
 *
 * "0x96"
 * "0xFF"
 * 150
 * 255
 */
function normalizeByte(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(
        `Invalid numeric byte: ${String(value)}`,
      );
    }

    return value & 0xff;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (trimmed.length === 0) {
      throw new Error(
        "Empty byte string received.",
      );
    }

    let parsed;

    if (/^0x/i.test(trimmed)) {
      parsed = Number.parseInt(
        trimmed.substring(2),
        16,
      );
    } else {
      parsed = Number.parseInt(
        trimmed,
        10,
      );
    }

    if (!Number.isFinite(parsed)) {
      throw new Error(
        `Invalid byte: ${value}`,
      );
    }

    return parsed & 0xff;
  }

  throw new Error(
    `Unsupported byte value: ${String(value)}`,
  );
}

function normalizeByteArray(data) {
  if (!Array.isArray(data)) {
    return [];
  }

  return data.map(normalizeByte);
}

// =============================================================================
// LITTLE-ENDIAN FUNCTIONS
// =============================================================================

/**
 * Reads unsigned 16-bit little-endian.
 *
 * Example:
 *
 * 10 00
 *
 * becomes:
 *
 * 0x0010 = 16
 */
function readUInt16LE(bytes, offset) {
  if (offset + 2 > bytes.length) {
    throw new Error(
      `Cannot read UInt16 at offset ${offset}`,
    );
  }

  return (
    bytes[offset] +
    bytes[offset + 1] * 256
  );
}

/**
 * Reads unsigned 32-bit little-endian.
 *
 * Example:
 *
 * 7B 2B 27 00
 *
 * becomes:
 *
 * 0x00272B7B
 */
function readUInt32LE(bytes, offset) {
  if (offset + 4 > bytes.length) {
    throw new Error(
      `Cannot read UInt32 at offset ${offset}`,
    );
  }

  return (
    bytes[offset] +
    bytes[offset + 1] * 256 +
    bytes[offset + 2] * 65536 +
    bytes[offset + 3] * 16777216
  );
}

// =============================================================================
// REMOVE USB FRAME HEADERS
// =============================================================================

/**
 * Converts:
 *
 * 00 96 00 00 [56 bytes]
 * 00 96 01 00 [56 bytes]
 * 00 96 02 00 [56 bytes]
 * ...
 * 00 96 XX 40 [remaining bytes]
 *
 * into:
 *
 * [continuous history payload]
 *
 * Same operation is used for 0x97.
 */
function extractHistoryPayload(
  rawData,
  expectedCommand,
) {
  const bytes =
    normalizeByteArray(rawData);

  if (bytes.length === 0) {
    return {
      payload: [],
      frameCount: 0,
    };
  }

  if (
    bytes.length <
    FRAME_HEADER_LENGTH
  ) {
    throw new Error(
      "History response is incomplete.",
    );
  }

  const frames = [];

  let cursor = 0;
  let expectedPage = 0;

  while (cursor < bytes.length) {
    // -------------------------------------------------------------------------
    // Make sure header exists
    // -------------------------------------------------------------------------

    if (
      cursor +
        FRAME_HEADER_LENGTH >
      bytes.length
    ) {
      throw new Error(
        `Incomplete frame header at byte ${cursor}.`,
      );
    }

    const deviceId =
      bytes[cursor];

    const command =
      bytes[cursor + 1];

    const page =
      bytes[cursor + 2];

    const status =
      bytes[cursor + 3];

    // -------------------------------------------------------------------------
    // Validate command
    // -------------------------------------------------------------------------

    if (
      command !==
      expectedCommand
    ) {
      throw new Error(
        `Unexpected command 0x${command
          .toString(16)
          .padStart(2, "0")
          .toUpperCase()}. ` +
          `Expected 0x${expectedCommand
            .toString(16)
            .padStart(2, "0")
            .toUpperCase()}.`,
      );
    }

    // -------------------------------------------------------------------------
    // Device error
    // -------------------------------------------------------------------------

    if (
      status ===
      STATUS_ERROR
    ) {
      throw new Error(
        `Controller returned error on page ${page}.`,
      );
    }

    // -------------------------------------------------------------------------
    // Validate status
    // -------------------------------------------------------------------------

    if (
      status !== STATUS_MORE &&
      status !== STATUS_FINAL
    ) {
      throw new Error(
        `Unexpected status 0x${status
          .toString(16)
          .padStart(2, "0")
          .toUpperCase()} on page ${page}.`,
      );
    }

    // -------------------------------------------------------------------------
    // Validate page sequence
    //
    // Page is one byte, so after 255 it would wrap.
    // -------------------------------------------------------------------------

    if (
      page !==
      (expectedPage & 0xff)
    ) {
      throw new Error(
        `History page sequence error. ` +
          `Expected ${expectedPage & 0xff}, ` +
          `received ${page}.`,
      );
    }

    const isFinalFrame =
      status === STATUS_FINAL;

    let frameEnd;

    if (isFinalFrame) {
      // Final frame may be shorter than 60 bytes.
      frameEnd =
        bytes.length;
    } else {
      frameEnd =
        cursor +
        FRAME_LENGTH;

      if (
        frameEnd >
        bytes.length
      ) {
        throw new Error(
          `History page ${page} is incomplete.`,
        );
      }
    }

    // -------------------------------------------------------------------------
    // Remove 4-byte header
    // -------------------------------------------------------------------------

    const framePayload =
      bytes.slice(
        cursor +
          FRAME_HEADER_LENGTH,
        frameEnd,
      );

    frames.push({
      deviceId,
      command,
      page,
      status,
      payload:
        framePayload,
    });

    cursor = frameEnd;

    expectedPage += 1;

    if (isFinalFrame) {
      break;
    }
  }

  // ---------------------------------------------------------------------------
  // Verify final frame
  // ---------------------------------------------------------------------------

  const lastFrame =
    frames[
      frames.length - 1
    ];

  if (
    !lastFrame ||
    lastFrame.status !==
      STATUS_FINAL
  ) {
    throw new Error(
      "Final history frame with status 0x40 was not received.",
    );
  }

  // ---------------------------------------------------------------------------
  // Join all payload sections
  // ---------------------------------------------------------------------------

  const payload =
    frames.flatMap(
      (frame) =>
        frame.payload,
    );

  return {
    payload,
    frameCount:
      frames.length,
  };
}

// =============================================================================
// DATE/TIME FORMAT
// =============================================================================

function formatHistoryDateTime(
  secondsFrom2000,
) {
  if (
    !Number.isFinite(
      secondsFrom2000,
    ) ||
    secondsFrom2000 > 0x7fffffff || secondsFrom2000 < 0
  ) {
    return "--";
  }

  const date =
    new Date(
      HISTORY_EPOCH_MS +
        secondsFrom2000 *
          1000,
    );

  const day =
    String(
      date.getUTCDate(),
    ).padStart(2, "0");

  const month =
    String(
      date.getUTCMonth() +
        1,
    ).padStart(2, "0");

  const year =
    date.getUTCFullYear();

  const hour =
    String(
      date.getUTCHours(),
    ).padStart(2, "0");

  const minute =
    String(
      date.getUTCMinutes(),
    ).padStart(2, "0");

  const second =
    String(
      date.getUTCSeconds(),
    ).padStart(2, "0");

  return (
    `${day}-${month}-${year} ` +
    `${hour}:${minute}:${second}`
  );
}

// =============================================================================
// GENERIC HISTORY RECORD DECODER
// =============================================================================

/**
 * Both 0x96 and 0x97 use:
 *
 * 8 bytes per record
 *
 * byte 0-3:
 * recording time
 *
 * byte 4-5:
 * type
 *
 * byte 6-7:
 * additional value/status
 */
function parseHistoryRecords(
  rawData,
  command,
  typeMap,
  nameProperty,
) {
  const {
    payload,
    frameCount,
  } =
    extractHistoryPayload(
      rawData,
      command,
    );

  if (
    payload.length === 0
  ) {
    return {
      records: [],
      frameCount,
      payloadLength: 0,
      totalRawRecords: 0,
      ignoredBytes: 0,
    };
  }

  // ---------------------------------------------------------------------------
  // C# effectively processes complete 8-byte records.
  // ---------------------------------------------------------------------------

  const totalRawRecords =
    Math.floor(
      payload.length /
        HISTORY_RECORD_LENGTH,
    );

  const ignoredBytes =
    payload.length %
    HISTORY_RECORD_LENGTH;

  const records = [];

  for (
    let index = 0;
    index <
    totalRawRecords;
    index += 1
  ) {
    const offset =
      index *
      HISTORY_RECORD_LENGTH;

    // -------------------------------------------------------------------------
    // Bytes 0-3 = Recording Time
    // -------------------------------------------------------------------------

    const timestampSeconds =
      readUInt32LE(
        payload,
        offset,
      );

    // -------------------------------------------------------------------------
    // Bytes 4-5 = History Type
    // -------------------------------------------------------------------------

    const type =
      readUInt16LE(
        payload,
        offset + 4,
      );

    // -------------------------------------------------------------------------
    // Bytes 6-7 = Extra Field
    // -------------------------------------------------------------------------

    const extra =
      readUInt16LE(
        payload,
        offset + 6,
      );

    // -------------------------------------------------------------------------
    // Convert type number to its C# name
    // -------------------------------------------------------------------------

    const description =
      typeMap[type];

    // -------------------------------------------------------------------------
    // C# skips unsupported/unknown records because PresentString is empty.
    // -------------------------------------------------------------------------

    if (!description) {
      continue;
    }

    const row = {
      sno:
        records.length +
        1,

      time:
        formatHistoryDateTime(
          timestampSeconds,
        ),

      // Keep raw information for debugging/future changes.
      rawType: type,
      extra,
      timestampSeconds,
      payloadOffset:
        offset,
    };

    // Event:
    // row.event = "RTC Updated"
    //
    // Fault:
    // row.fault = "Under Volt"
    row[nameProperty] =
      description;

    records.push(row);
  }

  return {
    records,
    frameCount,
    payloadLength:
      payload.length,
    totalRawRecords,
    ignoredBytes,
  };
}

// =============================================================================
// EVENT DECODER
// =============================================================================

export function decodeEventHistory(
  rawData,
) {
  return parseHistoryRecords(
    rawData,
    COMMAND_EVENT_HISTORY,
    EVENT_TYPE_MAP,
    "event",
  );
}

// =============================================================================
// FAULT DECODER
// =============================================================================

export function decodeFaultHistory(
  rawData,
) {
  return parseHistoryRecords(
    rawData,
    COMMAND_FAULT_HISTORY,
    FAULT_TYPE_MAP,
    "fault",
  );
}

// =============================================================================
// GET HISTORY ARRAYS FROM TabData
// =============================================================================
//
// Current TabData:
//
// {
//   "Event History": [...],
//   "fault History": [...]
// }
//
// Alternative names are also supported.
// =============================================================================

function getEventHistoryBytes(
  TabData,
) {
  if (!TabData) {
    return [];
  }

  return (
    TabData[
      "Event History"
    ] ||
    TabData[
      "event History"
    ] ||
    TabData.eventHistory ||
    TabData.event ||
    []
  );
}

function getFaultHistoryBytes(
  TabData,
) {
  if (!TabData) {
    return [];
  }

  return (
    TabData[
      "fault History"
    ] ||
    TabData[
      "Fault History"
    ] ||
    TabData.faultHistory ||
    TabData.fault ||
    []
  );
}

// =============================================================================
// COMPONENT
// =============================================================================

export default function EventFaultHistoryTab({
  TabData,
}) {
  // Event tab selected by default.
  const [
    activeSection,
    setActiveSection,
  ] = useState("event");

  // Number of currently visible rows.
  const [
    visibleCount,
    setVisibleCount,
  ] = useState(
    HISTORY_PAGE_SIZE,
  );

  // ===========================================================================
  // EVENT HISTORY
  // ===========================================================================

  const eventResult =
    useMemo(() => {
      const rawData =
        getEventHistoryBytes(
          TabData,
        );

      if (
        !Array.isArray(
          rawData,
        ) ||
        rawData.length === 0
      ) {
        return {
          data: [],
          error: null,
          frameCount: 0,
          payloadLength: 0,
          totalRawRecords: 0,
        };
      }

      try {
        const result =
          decodeEventHistory(
            rawData,
          );

        // console.log(
        //   "Decoded Event History:",
        //   result.records,
        // );

        // console.log(
        //   "Event Frames:",
        //   result.frameCount,
        // );

        // console.log(
        //   "Event Payload Length:",
        //   result.payloadLength,
        // );

        // console.log(
        //   "Event Raw Records:",
        //   result.totalRawRecords,
        // );

        return {
          data:
            result.records,

          error: null,

          frameCount:
            result.frameCount,

          payloadLength:
            result.payloadLength,

          totalRawRecords:
            result.totalRawRecords,
        };
      } catch (error) {
        console.error(
          "Event History Decode Error:",
          error,
        );

        return {
          data: [],

          error:
            error instanceof
            Error
              ? error.message
              : "Unable to decode event history.",

          frameCount: 0,
          payloadLength: 0,
          totalRawRecords: 0,
        };
      }
    }, [TabData]);

  // ===========================================================================
  // FAULT HISTORY
  // ===========================================================================

  const faultResult =
    useMemo(() => {
      const rawData =
        getFaultHistoryBytes(
          TabData,
        );

      if (
        !Array.isArray(
          rawData,
        ) ||
        rawData.length === 0
      ) {
        return {
          data: [],
          error: null,
          frameCount: 0,
          payloadLength: 0,
          totalRawRecords: 0,
        };
      }

      try {
        const result =
          decodeFaultHistory(
            rawData,
          );

        // console.log(
        //   "Decoded Fault History:",
        //   result.records,
        // );

        // console.log(
        //   "Fault Frames:",
        //   result.frameCount,
        // );

        // console.log(
        //   "Fault Payload Length:",
        //   result.payloadLength,
        // );

        // console.log(
        //   "Fault Raw Records:",
        //   result.totalRawRecords,
        // );

        return {
          data:
            result.records,

          error: null,

          frameCount:
            result.frameCount,

          payloadLength:
            result.payloadLength,

          totalRawRecords:
            result.totalRawRecords,
        };
      } catch (error) {
        console.error(
          "Fault History Decode Error:",
          error,
        );

        return {
          data: [],

          error:
            error instanceof
            Error
              ? error.message
              : "Unable to decode fault history.",

          frameCount: 0,
          payloadLength: 0,
          totalRawRecords: 0,
        };
      }
    }, [TabData]);

  // ===========================================================================
  // RESET DISPLAYED ROWS WHEN TAB CHANGES
  // ===========================================================================

  useEffect(() => {
    setVisibleCount(
      HISTORY_PAGE_SIZE,
    );
  }, [activeSection]);

  // Reset pagination when new history arrives too.
  useEffect(() => {
    setVisibleCount(
      HISTORY_PAGE_SIZE,
    );
  }, [TabData]);

  // ===========================================================================
  // CURRENT TAB DATA
  // ===========================================================================

  const isEvent =
    activeSection ===
    "event";

  const data =
    isEvent
      ? eventResult.data
      : faultResult.data;

  const label =
    isEvent
      ? "Event"
      : "Fault";

  const currentError =
    isEvent
      ? eventResult.error
      : faultResult.error;

  // ===========================================================================
  // DYNAMIC COUNTS
  // ===========================================================================

  const eventTotal =
    eventResult.data.length;

  const faultTotal =
    faultResult.data.length;

  // ===========================================================================
  // ONLY DISPLAY FIRST N ROWS
  // ===========================================================================

  const visibleData =
    useMemo(() => {
      return data.slice(
        0,
        visibleCount,
      );
    }, [
      data,
      visibleCount,
    ]);

  const hasMore =
    visibleCount <
    data.length;

  // ===========================================================================
  // LOAD MORE
  // ===========================================================================

  const handleLoadMore =
    () => {
      setVisibleCount(
        (previous) =>
          Math.min(
            previous +
              HISTORY_PAGE_SIZE,
            data.length,
          ),
      );
    };

  // ===========================================================================
  // EVENT TAB
  // ===========================================================================

  const handleEventPress =
    () => {
      setActiveSection(
        "event",
      );
    };

  // ===========================================================================
  // FAULT TAB
  // ===========================================================================

  const handleFaultPress =
    () => {
      setActiveSection(
        "fault",
      );
    };

  // console.log(
  //   "Event/Fault TabData:",
  //   TabData,
  // );

  // console.log(
  //   "Event Count:",
  //   eventTotal,
  // );

  // console.log(
  //   "Fault Count:",
  //   faultTotal,
  // );

  // ===========================================================================
  // UI
  // ===========================================================================

  return (
    <View
      style={
        styles.container
      }
    >
      <Button title="Save Excel history" disabled={!eventResult.data.length && !faultResult.data.length} onPress={() =>
        saveWorkbook("Event and Fault History", { "Event History": historyReport(eventResult.data, "event", "Event"), "Fault History": historyReport(faultResult.data, "fault", "Fault") }).catch((error) => Alert.alert("Export failed", error.message))} />
      {/* ===================================================================
          EVENT / FAULT TOGGLE
          =================================================================== */}

      <View
        style={
          styles.toggleBar
        }
      >
        {/* EVENT HISTORY */}

        <TouchableOpacity
          style={[
            styles.toggleBtn,

            isEvent &&
              styles.toggleBtnActive,
          ]}
          onPress={
            handleEventPress
          }
          activeOpacity={0.8}
        >
          <Text
            style={[
              styles.toggleText,

              isEvent &&
                styles.toggleTextActive,
            ]}
          >
            Event History
          </Text>

          <View
            style={[
              styles.countPill,
              styles.eventCountPill,
            ]}
          >
            <Text
              style={
                styles.countPillText
              }
            >
              {eventTotal}
            </Text>
          </View>
        </TouchableOpacity>

        {/* FAULT HISTORY */}

        <TouchableOpacity
          style={[
            styles.toggleBtn,

            !isEvent &&
              styles.toggleBtnActive,
          ]}
          onPress={
            handleFaultPress
          }
          activeOpacity={0.8}
        >
          <Text
            style={[
              styles.toggleText,

              !isEvent &&
                styles.toggleTextActive,
            ]}
          >
            Fault History
          </Text>

          <View
            style={[
              styles.countPill,
              styles.faultCountPill,
            ]}
          >
            <Text
              style={
                styles.countPillText
              }
            >
              {faultTotal}
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* ===================================================================
          ERROR
          =================================================================== */}

      {!!currentError && (
        <View
          style={
            styles.errorBox
          }
        >
          <Text
            style={
              styles.errorText
            }
          >
            {currentError}
          </Text>
        </View>
      )}

      {/* ===================================================================
          TABLE
          =================================================================== */}

      <View
        style={
          styles.tableWrapper
        }
      >
        {/* ================================================================
            TABLE HEADER
            ================================================================ */}

        <View
          style={
            styles.tableHeader
          }
        >
          <Text
            style={[
              styles.thCell,
              styles.colSno,
            ]}
          >
            Sno
          </Text>

          <Text
            style={[
              styles.thCell,
              styles.colName,
            ]}
          >
            {label}
          </Text>

          <Text
            style={[
              styles.thCell,
              styles.colTime,
            ]}
          >
            Recording Time
          </Text>
        </View>

        {/* ================================================================
            TABLE ROWS

            IMPORTANT:
            No FlatList is used.

            This component can safely remain inside your parent's ScrollView.
            ================================================================ */}

        {visibleData.length >
        0 ? (
          <>
            {visibleData.map(
              (
                row,
                index,
              ) => (
                <View
                  key={`${activeSection}-${row.sno}-${row.payloadOffset}`}
                  style={[
                    styles.tableRow,

                    index % 2 ===
                      1 &&
                      styles.tableRowAlt,
                  ]}
                >
                  {/* SERIAL NUMBER */}

                  <Text
                    style={[
                      styles.tdCell,
                      styles.colSno,
                      styles.tdSno,
                    ]}
                  >
                    {row.sno}
                  </Text>

                  {/* EVENT / FAULT */}

                  <Text
                    style={[
                      styles.tdCell,
                      styles.colName,
                    ]}
                    numberOfLines={
                      2
                    }
                  >
                    {isEvent
                      ? row.event
                      : row.fault}
                  </Text>

                  {/* RECORDING TIME */}

                  <Text
                    style={[
                      styles.tdCell,
                      styles.colTime,
                      styles.tdTime,
                    ]}
                  >
                    {row.time}
                  </Text>
                </View>
              ),
            )}

            {/* ============================================================
                LOAD MORE
                ============================================================ */}

            {hasMore && (
              <TouchableOpacity
                style={
                  styles.loadMoreButton
                }
                onPress={
                  handleLoadMore
                }
                activeOpacity={
                  0.8
                }
              >
                <Text
                  style={
                    styles.loadMoreText
                  }
                >
                  Load More
                </Text>
              </TouchableOpacity>
            )}

            {/* ============================================================
                SHOWING X OF Y
                ============================================================ */}

            <View
              style={
                styles.resultCountContainer
              }
            >
              <Text
                style={
                  styles.resultCountText
                }
              >
                Showing{" "}
                {Math.min(
                  visibleCount,
                  data.length,
                )}{" "}
                of{" "}
                {data.length}
              </Text>
            </View>
          </>
        ) : (
          // ===============================================================
          // EMPTY STATE
          // ===============================================================

          <View
            style={
              styles.emptyContainer
            }
          >
            <Text
              style={
                styles.emptyText
              }
            >
              {currentError
                ? "Unable to display history."
                : `No ${label.toLowerCase()} history found.`}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles =
  StyleSheet.create({
    // =========================================================================
    // MAIN CONTAINER
    // =========================================================================

    container: {
      paddingBottom: 24,
    },

    // =========================================================================
    // TOGGLE
    // =========================================================================

    toggleBar: {
      flexDirection:
        "row",

      backgroundColor:
        "#DDE4F0",

      borderRadius: 8,

      padding: 4,

      marginBottom: 14,
    },

    toggleBtn: {
      flex: 1,

      flexDirection:
        "row",

      alignItems:
        "center",

      justifyContent:
        "center",

      paddingVertical:
        10,

      paddingHorizontal:
        8,

      borderRadius: 6,

      columnGap: 7,
    },

    toggleBtnActive: {
      backgroundColor:
        NAVY,

      shadowColor:
        "#000",

      shadowOffset: {
        width: 0,
        height: 2,
      },

      shadowOpacity:
        0.18,

      shadowRadius: 4,

      elevation: 4,
    },

    toggleText: {
      fontSize: 16,

      fontWeight:
        "600",

      color:
        "#6B7C9E",
    },

    toggleTextActive: {
      color:
        "#FFFFFF",
    },

    countPill: {
      paddingHorizontal:
        7,

      paddingVertical: 2,

      borderRadius: 12,

      minWidth: 30,

      alignItems:
        "center",
    },

    eventCountPill: {
      backgroundColor:
        "#4CAF50",
    },

    faultCountPill: {
      backgroundColor:
        "#E53935",
    },

    countPillText: {
      color:
        "#FFFFFF",

      fontSize: 13,

      fontWeight:
        "700",
    },

    // =========================================================================
    // ERROR
    // =========================================================================

    errorBox: {
      backgroundColor:
        "#FDECEC",

      borderWidth: 1,

      borderColor:
        "#E53935",

      borderRadius: 8,

      padding: 10,

      marginBottom: 14,
    },

    errorText: {
      color:
        "#C62828",

      fontSize: 13,

      fontWeight:
        "600",
    },

    // =========================================================================
    // TABLE
    // =========================================================================

    tableWrapper: {
      borderRadius: 8,

      overflow:
        "hidden",

      borderWidth: 1,

      borderColor:
        "#C8D4E8",

      marginBottom: 14,
    },

    tableHeader: {
      flexDirection:
        "row",

      alignItems:
        "center",

      backgroundColor:
        NAVY,

      paddingVertical:
        10,

      paddingHorizontal:
        8,
    },

    thCell: {
      color:
        "#FFFFFF",

      fontSize: 15,

      fontWeight:
        "700",

      textAlign:
        "center",
    },

    // =========================================================================
    // ROW
    // =========================================================================

    tableRow: {
      flexDirection:
        "row",

      alignItems:
        "center",

      backgroundColor:
        "#FFFFFF",

      paddingVertical:
        11,

      paddingHorizontal:
        8,

      borderBottomWidth:
        1,

      borderBottomColor:
        "#EAF0F8",

      minHeight: 48,
    },

    tableRowAlt: {
      backgroundColor:
        "#F3F7FB",
    },

    tdCell: {
      fontSize: 15,

      color:
        "#1A2A4A",
    },

    // =========================================================================
    // COLUMNS
    // =========================================================================

    colSno: {
      width: 42,

      textAlign:
        "center",
    },

    colName: {
      flex: 1,

      paddingHorizontal:
        8,
    },

    colTime: {
      width: 165,

      textAlign:
        "right",
    },

    tdSno: {
      color:
        "#7888A8",

      fontWeight:
        "700",
    },

    tdTime: {
      color:
        "#4A6080",

      fontSize: 13,
    },

    // =========================================================================
    // LOAD MORE
    // =========================================================================

    loadMoreButton: {
      backgroundColor:
        NAVY,

      marginHorizontal:
        12,

      marginTop: 14,

      marginBottom: 5,

      paddingVertical:
        11,

      borderRadius: 8,

      alignItems:
        "center",

      justifyContent:
        "center",
    },

    loadMoreText: {
      color:
        "#FFFFFF",

      fontSize: 14,

      fontWeight:
        "700",
    },

    // =========================================================================
    // RESULT COUNT
    // =========================================================================

    resultCountContainer: {
      alignItems:
        "center",

      paddingTop: 8,

      paddingBottom: 12,
    },

    resultCountText: {
      color:
        "#7888A8",

      fontSize: 12,

      fontWeight:
        "600",
    },

    // =========================================================================
    // EMPTY
    // =========================================================================

    emptyContainer: {
      paddingVertical:
        30,

      paddingHorizontal:
        15,

      alignItems:
        "center",

      justifyContent:
        "center",

      backgroundColor:
        "#FFFFFF",
    },

    emptyText: {
      color:
        "#7888A8",

      fontSize: 14,

      fontWeight:
        "600",

      textAlign:
        "center",
    },
  });