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

// Do not render hundreds/thousands of rows at once because this component
// may already be inside a parent ScrollView.
const HISTORY_PAGE_SIZE = 25;

// =============================================================================
// START / STOP HISTORY PROTOCOL
// =============================================================================
//
// Command:
//
//   00 98 00 00
//
// Response:
//
//   Frame 0:
//   00 98 00 00 + 56 data bytes
//
//   Frame 1:
//   00 98 01 00 + 56 data bytes
//
//   Frame 2:
//   00 98 02 00 + 56 data bytes
//
//   ...
//
//   Final frame:
//   00 98 XX 40 + remaining data
//
// Frame header:
//
//   Byte 0 = Device ID
//   Byte 1 = Command = 0x98
//   Byte 2 = Page number
//   Byte 3 = Status
//
// Status:
//
//   0x00 = More frames follow
//   0x40 = Final frame
//   0x80 = Device error
//
// -----------------------------------------------------------------------------
// AFTER REMOVING EACH 4-BYTE FRAME HEADER
// -----------------------------------------------------------------------------
//
// C# StartNStop_import() processes the continuous payload in blocks of 8 bytes:
//
//   Byte 0 ┐
//   Byte 1 │
//   Byte 2 │ Recording Time - UInt32 Little Endian
//   Byte 3 ┘
//
//   Byte 4 ┐
//   Byte 5 ┘ Start/Stop Type - UInt16 Little Endian
//
//   Byte 6 ┐
//   Byte 7 ┘ Extra - UInt16 Little Endian
//
// C# TypeVal():
//
//   1 = "DG Start"
//   2 = "DG Stop"
//
// Unknown types are not displayed.
//
// =============================================================================

const START_STOP_COMMAND = 0x98;

const FRAME_HEADER_LENGTH = 4;
const NORMAL_FRAME_LENGTH = 60;

const STATUS_MORE = 0x00;
const STATUS_FINAL = 0x40;
const STATUS_ERROR = 0x80;

const HISTORY_RECORD_LENGTH = 8;

// =============================================================================
// START / STOP TYPE MAP
// =============================================================================
//
// Exact C# mapping:
//
// if (val == 1) ev = "DG Start";
// if (val == 2) ev = "DG Stop";
//
// =============================================================================

const START_STOP_TYPE_MAP = Object.freeze({
  1: "DG Start",
  2: "DG Stop",
});

// =============================================================================
// RECORDING TIME
// =============================================================================
//
// C# converts the first 4 bytes into seconds and then does:
//
//   01-01-2000 00:00:00 + seconds
//
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
// BYTE HELPERS
// =============================================================================

/**
 * TabData currently contains strings such as:
 *
 * [
 *   "0x00",
 *   "0x98",
 *   "0x00",
 *   "0x00",
 *   ...
 * ]
 *
 * Convert each item to a normal numeric byte.
 *
 * This also accepts numeric input so this component continues to work if
 * another developer later changes the serial layer to return numbers.
 */
function normalizeByte(value) {
  // ---------------------------------------------------------------------------
  // Already a number
  // ---------------------------------------------------------------------------

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(
        `Invalid numeric byte: ${String(value)}`,
      );
    }

    return value & 0xff;
  }

  // ---------------------------------------------------------------------------
  // String
  // ---------------------------------------------------------------------------

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (trimmed.length === 0) {
      throw new Error(
        "Empty byte string received.",
      );
    }

    let parsedValue;

    // Example: "0x98"
    if (/^0x/i.test(trimmed)) {
      parsedValue = Number.parseInt(
        trimmed.substring(2),
        16,
      );
    } else {
      // Also support decimal string such as "152"
      parsedValue = Number.parseInt(
        trimmed,
        10,
      );
    }

    if (!Number.isFinite(parsedValue)) {
      throw new Error(
        `Invalid byte value: ${value}`,
      );
    }

    return parsedValue & 0xff;
  }

  throw new Error(
    `Unsupported byte value: ${String(value)}`,
  );
}

/**
 * Converts the complete incoming data array into numeric bytes.
 */
function normalizeByteArray(data) {
  if (!Array.isArray(data)) {
    return [];
  }

  return data.map(normalizeByte);
}

// =============================================================================
// LITTLE-ENDIAN READ FUNCTIONS
// =============================================================================

/**
 * Read UInt16 Little Endian.
 *
 * Example:
 *
 * 02 00
 *
 * Calculation:
 *
 * 0x02 + (0x00 × 256)
 *
 * = 2
 */
function readUInt16LE(bytes, offset) {
  if (
    offset < 0 ||
    offset + 2 > bytes.length
  ) {
    throw new Error(
      `Cannot read UInt16 at offset ${offset}.`,
    );
  }

  return (
    bytes[offset] +
    bytes[offset + 1] * 256
  );
}

/**
 * Read UInt32 Little Endian.
 *
 * Example:
 *
 * 90 69 27 00
 *
 * becomes:
 *
 * 0x00276990
 */
function readUInt32LE(bytes, offset) {
  if (
    offset < 0 ||
    offset + 4 > bytes.length
  ) {
    throw new Error(
      `Cannot read UInt32 at offset ${offset}.`,
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
// GET RAW 0x98 DATA FROM TabData
// =============================================================================

/**
 * Your current TabData is directly an array:
 *
 * [
 *   "0x00",
 *   "0x98",
 *   ...
 * ]
 *
 * This function also supports an object in case the parent structure changes
 * in the future:
 *
 * {
 *   "Start Stop History": [...]
 * }
 */
function getStartStopHistoryBytes(TabData) {
  // Current format
  if (Array.isArray(TabData)) {
    return TabData;
  }

  if (!TabData) {
    return [];
  }

  // Optional future-compatible formats
  return (
    TabData["Start Stop History"] ||
    TabData["Start/Stop History"] ||
    TabData["Start & Stop History"] ||
    TabData["start stop History"] ||
    TabData.startStopHistory ||
    TabData.startStop ||
    []
  );
}

// =============================================================================
// REMOVE 0x98 FRAME HEADERS
// =============================================================================

/**
 * Input:
 *
 * 00 98 00 00 [56 data]
 * 00 98 01 00 [56 data]
 * 00 98 02 00 [56 data]
 * ...
 * 00 98 XX 40 [final data]
 *
 * Output:
 *
 * One continuous array containing only history-record bytes.
 *
 * IMPORTANT:
 *
 * We remove ALL frame headers first and THEN divide the payload into 8-byte
 * records. This is important because record boundaries must be based on the
 * continuous payload, not React Native's receive chunks.
 */
function extractStartStopPayload(rawData) {
  const bytes =
    normalizeByteArray(rawData);

  // ---------------------------------------------------------------------------
  // Empty response
  // ---------------------------------------------------------------------------

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
      "Start/Stop history response is incomplete.",
    );
  }

  const frames = [];

  let cursor = 0;
  let expectedPage = 0;

  while (cursor < bytes.length) {
    // -------------------------------------------------------------------------
    // Check frame header exists
    // -------------------------------------------------------------------------

    if (
      cursor +
        FRAME_HEADER_LENGTH >
      bytes.length
    ) {
      throw new Error(
        `Incomplete 0x98 frame header at raw offset ${cursor}.`,
      );
    }

    // -------------------------------------------------------------------------
    // Header
    // -------------------------------------------------------------------------

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
      START_STOP_COMMAND
    ) {
      throw new Error(
        `Invalid command at raw offset ${cursor}. ` +
          `Received 0x${command
            .toString(16)
            .padStart(2, "0")
            .toUpperCase()}, expected 0x98.`,
      );
    }

    // -------------------------------------------------------------------------
    // Controller error
    // -------------------------------------------------------------------------

    if (
      status ===
      STATUS_ERROR
    ) {
      throw new Error(
        `Controller returned an error on Start/Stop page ${page}.`,
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
        `Invalid Start/Stop status 0x${status
          .toString(16)
          .padStart(2, "0")
          .toUpperCase()} on page ${page}.`,
      );
    }

    // -------------------------------------------------------------------------
    // Validate page sequence
    //
    // Page number is one byte.
    // "& 0xff" also handles page wrap after 255 if the controller ever returns
    // the full 4000-entry history.
    // -------------------------------------------------------------------------

    const expectedPageByte =
      expectedPage & 0xff;

    if (
      page !==
      expectedPageByte
    ) {
      throw new Error(
        `Start/Stop page sequence error. ` +
          `Expected page ${expectedPageByte}, received ${page}.`,
      );
    }

    const isFinalFrame =
      status === STATUS_FINAL;

    let frameEnd;

    // -------------------------------------------------------------------------
    // Determine end of this frame
    // -------------------------------------------------------------------------

    if (isFinalFrame) {
      // Final frame can be shorter than 60 bytes.
      // In your supplied response it happens to be a complete 60-byte frame.
      frameEnd =
        bytes.length;
    } else {
      frameEnd =
        cursor +
        NORMAL_FRAME_LENGTH;

      if (
        frameEnd >
        bytes.length
      ) {
        throw new Error(
          `Start/Stop page ${page} is incomplete.`,
        );
      }
    }

    // -------------------------------------------------------------------------
    // Remove 4-byte frame header
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

    // -------------------------------------------------------------------------
    // Move to next frame
    // -------------------------------------------------------------------------

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
      "Final Start/Stop frame with status 0x40 was not received.",
    );
  }

  // ---------------------------------------------------------------------------
  // Join payload from all pages
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
// FORMAT RECORDING TIME
// =============================================================================

/**
 * Convert controller seconds into:
 *
 * DD-MM-YYYY HH:mm:ss
 *
 * C#:
 *
 * DateTime ts =
 *   01-01-2000 00:00:00;
 *
 * result =
 *   ts.AddSeconds(value);
 */
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
        Math.trunc(
          secondsFrom2000,
        ) *
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
// DECODE START / STOP HISTORY
// =============================================================================

/**
 * One Start/Stop record = 8 bytes.
 *
 * Example from your response:
 *
 * 90 69 27 00 | 02 00 | 00 00
 * ───────────   ─────   ─────
 * Time           Type    Extra
 *
 * Type = 2
 *
 * C# mapping:
 *
 * 2 = DG Stop
 */
export function decodeStartStopHistory(
  rawData,
) {
  const {
    payload,
    frameCount,
  } =
    extractStartStopPayload(
      rawData,
    );

  if (
    payload.length === 0
  ) {
    return {
      records: [],
      frameCount,
      payloadLength: 0,
      rawRecordCount: 0,
      ignoredBytes: 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Exactly the same concept as:
  //
  // int loopno = val.Length / 8;
  //
  // in C#.
  // ---------------------------------------------------------------------------

  const rawRecordCount =
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
    rawRecordCount;
    index += 1
  ) {
    const offset =
      index *
      HISTORY_RECORD_LENGTH;

    // -------------------------------------------------------------------------
    // Bytes 0-3 = Date / Time
    // -------------------------------------------------------------------------

    const timestampSeconds =
      readUInt32LE(
        payload,
        offset,
      );

    // -------------------------------------------------------------------------
    // Bytes 4-5 = Type
    // -------------------------------------------------------------------------

    const type =
      readUInt16LE(
        payload,
        offset + 4,
      );

    // -------------------------------------------------------------------------
    // Bytes 6-7 = Extra
    // -------------------------------------------------------------------------

    const extra =
      readUInt16LE(
        payload,
        offset + 6,
      );

    // -------------------------------------------------------------------------
    // Convert type exactly like C# TypeVal()
    // -------------------------------------------------------------------------

    const description =
      START_STOP_TYPE_MAP[
        type
      ];

    // -------------------------------------------------------------------------
    // C# behavior:
    //
    // if (_disp.Type.PresentString != "")
    // {
    //     _disp.Sno = sno++;
    //     _list.Add(_disp);
    // }
    //
    // Unknown types are therefore skipped.
    // -------------------------------------------------------------------------

    if (!description) {
      continue;
    }

    records.push({
      // Display serial number
      sno:
        records.length +
        1,

      // DG Start / DG Stop
      event:
        description,

      // Recording time
      time:
        formatHistoryDateTime(
          timestampSeconds,
        ),

      // -----------------------------------------------------------------------
      // Debug / future-use values.
      // These are not shown in the UI.
      // -----------------------------------------------------------------------

      rawType:
        type,

      extra,

      timestampSeconds,

      payloadOffset:
        offset,
    });
  }

  return {
    records,
    frameCount,
    payloadLength:
      payload.length,
    rawRecordCount,
    ignoredBytes,
  };
}

// =============================================================================
// COMPONENT
// =============================================================================

export default function StartStopHistoryTab({
  TabData,
}) {
  // ---------------------------------------------------------------------------
  // Number of rows currently displayed
  // ---------------------------------------------------------------------------

  const [
    visibleCount,
    setVisibleCount,
  ] = useState(
    HISTORY_PAGE_SIZE,
  );

  // ===========================================================================
  // DECODE TabData
  // ===========================================================================

  const historyResult =
    useMemo(() => {
      const rawData =
        getStartStopHistoryBytes(
          TabData,
        );

      // -----------------------------------------------------------------------
      // No data yet
      // -----------------------------------------------------------------------

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
          rawRecordCount: 0,
          ignoredBytes: 0,
        };
      }

      // -----------------------------------------------------------------------
      // Decode
      // -----------------------------------------------------------------------

      try {
        const result =
          decodeStartStopHistory(
            rawData,
          );

        // console.log(
        //   "Decoded Start/Stop History:",
        //   result.records,
        // );

        // console.log(
        //   "Start/Stop Frame Count:",
        //   result.frameCount,
        // );

        // console.log(
        //   "Start/Stop Payload Length:",
        //   result.payloadLength,
        // );

        // console.log(
        //   "Start/Stop Raw Record Count:",
        //   result.rawRecordCount,
        // );

        // console.log(
        //   "Start/Stop Valid Record Count:",
        //   result.records.length,
        // );

        if (
          result.ignoredBytes >
          0
        ) {
          console.warn(
            "Incomplete Start/Stop bytes ignored:",
            result.ignoredBytes,
          );
        }

        return {
          data:
            result.records,

          error: null,

          frameCount:
            result.frameCount,

          payloadLength:
            result.payloadLength,

          rawRecordCount:
            result.rawRecordCount,

          ignoredBytes:
            result.ignoredBytes,
        };
      } catch (error) {
        console.error(
          "Start/Stop History Decode Error:",
          error,
        );

        return {
          data: [],

          error:
            error instanceof
            Error
              ? error.message
              : "Unable to decode Start/Stop history.",

          frameCount: 0,
          payloadLength: 0,
          rawRecordCount: 0,
          ignoredBytes: 0,
        };
      }
    }, [TabData]);

  // ===========================================================================
  // RESET PAGINATION WHEN NEW HISTORY ARRIVES
  // ===========================================================================

  useEffect(() => {
    setVisibleCount(
      HISTORY_PAGE_SIZE,
    );
  }, [TabData]);

  // ===========================================================================
  // COMPLETE DATA
  // ===========================================================================

  const data =
    historyResult.data;

  const totalHistory =
    data.length;

  // ===========================================================================
  // VISIBLE DATA
  //
  // We intentionally DO NOT use FlatList because this component may already
  // be inside your main screen's vertical ScrollView.
  //
  // This avoids:
  //
  // "VirtualizedLists should never be nested inside plain ScrollViews..."
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
    totalHistory;

  // ===========================================================================
  // LOAD MORE
  // ===========================================================================

  const handleLoadMore =
    () => {
      setVisibleCount(
        (previousCount) =>
          Math.min(
            previousCount +
              HISTORY_PAGE_SIZE,
            totalHistory,
          ),
      );
    };

  // ===========================================================================
  // DEBUG
  // ===========================================================================

//   console.log(
//     "Start / Stop History TabData:",
//     TabData,
//   );

  // ===========================================================================
  // UI
  // ===========================================================================

  return (
    <View
      style={
        styles.container
      }
    >
      <Button title="Save Excel history" disabled={!historyResult.data.length} onPress={() =>
        saveWorkbook("Start Stop History", { "Start Stop History": historyReport(historyResult.data, "event", "Start or stop") }).catch((error) => Alert.alert("Export failed", error.message))} />
      {/* =====================================================================
          START / STOP HISTORY TITLE
          ===================================================================== */}

      <View
        style={
          styles.titleBar
        }
      >
        <Text
          style={
            styles.titleText
          }
        >
          Start / Stop History
        </Text>

        <View
          style={
            styles.countPill
          }
        >
          <Text
            style={
              styles.countPillText
            }
          >
            {totalHistory}
          </Text>
        </View>
      </View>

      {/* =====================================================================
          DECODING ERROR
          ===================================================================== */}

      {!!historyResult.error && (
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
            {historyResult.error}
          </Text>
        </View>
      )}

      {/* =====================================================================
          TABLE
          ===================================================================== */}

      <View
        style={
          styles.tableWrapper
        }
      >
        {/* =================================================================
            TABLE HEADER
            ================================================================= */}

        <View
          style={
            styles.tableHeader
          }
        >
          {/* Sno */}

          <Text
            style={[
              styles.thCell,
              styles.colSno,
            ]}
          >
            Sno
          </Text>

          {/* Start / Stop */}

          <Text
            style={[
              styles.thCell,
              styles.colEvent,
            ]}
          >
            Start / Stop
          </Text>

          {/* Recording Time */}

          <Text
            style={[
              styles.thCell,
              styles.colTime,
            ]}
          >
            Recording Time
          </Text>
        </View>

        {/* =================================================================
            DATA ROWS
            ================================================================= */}

        {visibleData.length >
        0 ? (
          <>
            {visibleData.map(
              (
                row,
                index,
              ) => (
                <View
                  key={`${row.sno}-${row.payloadOffset}`}
                  style={[
                    styles.tableRow,

                    index % 2 ===
                      1 &&
                      styles.tableRowAlt,
                  ]}
                >
                  {/* -------------------------------------------------------
                      SERIAL NUMBER
                      ------------------------------------------------------- */}

                  <Text
                    style={[
                      styles.tdCell,
                      styles.colSno,
                      styles.tdSno,
                    ]}
                  >
                    {row.sno}
                  </Text>

                  {/* -------------------------------------------------------
                      DG START / DG STOP
                      ------------------------------------------------------- */}

                  <Text
                    style={[
                      styles.tdCell,
                      styles.colEvent,

                      row.rawType ===
                        1
                        ? styles.startText
                        : styles.stopText,
                    ]}
                  >
                    {row.event}
                  </Text>

                  {/* -------------------------------------------------------
                      RECORDING TIME
                      ------------------------------------------------------- */}

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

            {/* =============================================================
                LOAD MORE
                ============================================================= */}

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

            {/* =============================================================
                RESULT COUNT
                ============================================================= */}

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
                  totalHistory,
                )}{" "}
                of{" "}
                {totalHistory}
              </Text>
            </View>
          </>
        ) : (
          // =================================================================
          // EMPTY
          // =================================================================

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
              {historyResult.error
                ? "Unable to display Start / Stop history."
                : "No Start / Stop history found."}
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
    // CONTAINER
    // =========================================================================

    container: {
      paddingBottom: 24,
    },

    // =========================================================================
    // TITLE
    // =========================================================================

    titleBar: {
      flexDirection:
        "row",

      alignItems:
        "center",

      justifyContent:
        "center",

      backgroundColor:
        NAVY,

      borderRadius: 8,

      paddingVertical:
        11,

      paddingHorizontal:
        12,

      marginBottom: 14,
    },

    titleText: {
      flex: 1,

      color:
        "#FFFFFF",

      fontSize: 17,

      fontWeight:
        "700",

      textAlign:
        "center",
    },

    // =========================================================================
    // COUNT
    // =========================================================================

    countPill: {
      backgroundColor:
        "#4CAF50",

      paddingHorizontal:
        9,

      paddingVertical: 3,

      borderRadius: 15,

      minWidth: 35,

      alignItems:
        "center",
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

      backgroundColor:
        "#FFFFFF",
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
    // ROWS
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

    colEvent: {
      flex: 1,

      paddingHorizontal:
        8,

      textAlign:
        "center",
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
    // START / STOP COLORS
    // =========================================================================

    startText: {
      color:
        "#2E7D32",

      fontWeight:
        "700",
    },

    stopText: {
      color:
        "#C62828",

      fontWeight:
        "700",
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
    // SHOWING X OF Y
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