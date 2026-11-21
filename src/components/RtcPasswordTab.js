import React, {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from "react-native";

import { sendCommandAndGetResponse, hexResponseToHexArray } from "../services/usbService";
import { DeviceFieldsTab } from "./ControllerDataTabs";

import COLORS from "../constants/colors";

// =============================================================================
// UI
// =============================================================================

const NAVY = "#254695";

// =============================================================================
// TARGET USB DEVICE
// =============================================================================
//
// STM32 CDC ACM
//
// VID = 0x0483
// PID = 0x5740
//
// =============================================================================

const CMD_SET_RTC = 0x94;
const CMD_READ_RTC = 0x95;
const CMD_SET_PASSWORD = 0x9b;

// C# accepts 0x91 as alternate response command.
const CMD_GENERIC_ACK = 0x91;

// Status byte
const STATUS_FINAL = 0x40;
const STATUS_ERROR = 0x80;

// =============================================================================
// RECEIVE TIMING
// =============================================================================
//
// Your other USB implementation already uses an idle aggregation concept.
//
// For these small RTC/password commands:
// - overall response timeout = 4 sec
// - 300 ms idle after receiving data
//
// =============================================================================

const RX_TIMEOUT_MS = 4000;
const RX_IDLE_TIMEOUT_MS = 300;

// =============================================================================
// BYTE HELPERS
// =============================================================================

function normalizeByte(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(
        `Invalid byte: ${String(value)}`,
      );
    }

    return value & 0xff;
  }

  if (typeof value === "string") {
    const text = value.trim();

    if (!text) {
      throw new Error(
        "Empty byte received.",
      );
    }

    let parsed;

    if (/^0x/i.test(text)) {
      parsed = Number.parseInt(
        text.substring(2),
        16,
      );
    } else {
      parsed = Number.parseInt(
        text,
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
    `Unsupported byte: ${String(value)}`,
  );
}

function normalizeByteArray(data) {
  if (!Array.isArray(data)) {
    return [];
  }

  return data.map(normalizeByte);
}

// =============================================================================
// HEX STRING
// =============================================================================
//
// UsbSerial.send() expects:
//
// "00950000"
//
// NOT:
//
// [0x00, 0x95, 0x00, 0x00]
//
// =============================================================================



// =============================================================================
// RECEIVED DATA -> BYTE ARRAY
// =============================================================================
//
// Library normally provides event.data.
//
// Make this flexible enough to accept:
//
// "009500403A0C16001E0100"
//
// "00 95 00 40 3A..."
//
// ["0x00", "0x95", ...]
//
// Uint8Array
//
// =============================================================================


// =============================================================================
// FIND CONTROLLER RESPONSE INSIDE RX BUFFER
// =============================================================================
//
// This is important in your situation.
//
// You showed that TabData sometimes contains:
//
// 00 93 ...
//
// even when you are interested in RTC.
//
// Therefore DO NOT assume:
//
// rxBuffer[1] === expected command.
//
// Search for:
//
// 00 95 ...
//
// or for writes:
//
// 00 94 ...
// 00 9B ...
//
// C# CommunicationBus also accepts 0x91 response.
//
// =============================================================================

function findExpectedResponse(
  rxBuffer,
  expectedCommand,
) {
  if (
    !Array.isArray(rxBuffer) ||
    rxBuffer.length < 4
  ) {
    return null;
  }

  for (
    let index = 0;
    index <=
    rxBuffer.length - 4;
    index += 1
  ) {
    const deviceId =
      rxBuffer[index];

    const command =
      rxBuffer[index + 1];

    const page =
      rxBuffer[index + 2];

    const status =
      rxBuffer[index + 3];

    // Controller ID used in C# is 0.
    if (deviceId !== 0x00) {
      continue;
    }

    const commandMatches =
      command ===
        expectedCommand ||
      command ===
        CMD_GENERIC_ACK;

    if (!commandMatches) {
      continue;
    }

    // ---------------------------------------------------------------
    // Error response
    // ---------------------------------------------------------------

    if (status === STATUS_ERROR) {
      return {
        found: true,
        error: true,
        command,
        page,
        status,
        bytes:
          rxBuffer.slice(
            index,
            index + 4,
          ),
      };
    }

    // ---------------------------------------------------------------
    // READ RTC requires complete 11-byte response:
    //
    // 00 95 00 40
    // SS MM HH 00
    // DD MM YY
    // ---------------------------------------------------------------

    if (
      expectedCommand ===
        CMD_READ_RTC &&
      command === CMD_READ_RTC
    ) {
      if (
        rxBuffer.length -
          index <
        11
      ) {
        return null;
      }

      return {
        found: true,
        error: false,
        command,
        page,
        status,
        bytes:
          rxBuffer.slice(
            index,
            index + 11,
          ),
      };
    }

    // ---------------------------------------------------------------
    // RTC write / Password write
    //
    // C# only requires a response >3 bytes and checks:
    //
    // response[1] == request[1]
    //
    // OR:
    //
    // response[1] == 0x91
    //
    // plus:
    //
    // response[3] != 0x80
    // ---------------------------------------------------------------

    return {
      found: true,
      error: false,
      command,
      page,
      status,
      bytes:
        rxBuffer.slice(index),
    };
  }

  return null;
}

// =============================================================================
// RTC DECODER
// =============================================================================
//
// C# ParaClass:
//
// Time = 4 bytes
// Date = 4 bytes
//
// Convert_Hex_to_value:
//
// TIME:
//
// recive[i+2] + ":" +
// recive[i+1] + ":" +
// recive[i+0]
//
// DATE:
//
// recive[i+0] + "-" +
// recive[i+1] + "-" +
// recive[i+2]
//
// Therefore payload:
//
// SS MM HH 00 DD MM YY
//
// =============================================================================

function decodeRtcResponse(rawData) {
  const bytes =
    normalizeByteArray(rawData);

  if (bytes.length < 11) {
    throw new Error(
      `RTC response incomplete. ` +
        `Expected 11 bytes, received ${bytes.length}.`,
    );
  }

  if (
    bytes[1] !==
    CMD_READ_RTC
  ) {
    throw new Error(
      `Expected RTC response 0x95, received 0x${bytes[
        1
      ]
        .toString(16)
        .padStart(2, "0")
        .toUpperCase()}.`,
    );
  }

  if (
    bytes[3] ===
    STATUS_ERROR
  ) {
    throw new Error(
      "Controller returned RTC error.",
    );
  }

  // ---------------------------------------------------------------------------
  // TIME
  // ---------------------------------------------------------------------------

  const second =
    bytes[4];

  const minute =
    bytes[5];

  const hour =
    bytes[6];

  // bytes[7] = reserved

  // ---------------------------------------------------------------------------
  // DATE
  // ---------------------------------------------------------------------------

  const day =
    bytes[8];

  const month =
    bytes[9];

  const year =
    bytes[10];

  if (
    second > 59 ||
    minute > 59 ||
    hour > 23
  ) {
    throw new Error(
      `Invalid RTC time: ` +
        `${hour}:${minute}:${second}`,
    );
  }

  if (
    day < 1 ||
    day > 31 ||
    month < 1 ||
    month > 12
  ) {
    throw new Error(
      `Invalid RTC date: ` +
        `${day}-${month}-${year}`,
    );
  }

  return {
    day,
    month,
    year,

    hour,
    minute,
    second,

    date:
      `${String(day).padStart(
        2,
        "0",
      )}-` +
      `${String(month).padStart(
        2,
        "0",
      )}-` +
      `${String(year).padStart(
        2,
        "0",
      )}`,

    time:
      `${String(hour).padStart(
        2,
        "0",
      )}:` +
      `${String(minute).padStart(
        2,
        "0",
      )}:` +
      `${String(second).padStart(
        2,
        "0",
      )}`,
  };
}

// =============================================================================
// DATE VALIDATION
// =============================================================================
//
// C# UI uses:
//
// dd-MM-yy
//
// RTC_Update accepts:
// '-' or '/'
//
// =============================================================================

function parseRtcDate(value) {
  const text =
    String(value || "").trim();

  const match =
    text.match(
      /^(\d{2})[-/](\d{2})[-/](\d{2})$/,
    );

  if (!match) {
    throw new Error(
      "Date must be DD-MM-YY.",
    );
  }

  const day =
    Number(match[1]);

  const month =
    Number(match[2]);

  const year =
    Number(match[3]);

  if (
    month < 1 ||
    month > 12
  ) {
    throw new Error(
      "Month must be between 01 and 12.",
    );
  }

  if (
    day < 1 ||
    day > 31
  ) {
    throw new Error(
      "Day must be between 01 and 31.",
    );
  }

  // ---------------------------------------------------------------------------
  // Validate actual calendar day
  // ---------------------------------------------------------------------------

  const fullYear =
    2000 + year;

  const date =
    new Date(
      Date.UTC(
        fullYear,
        month - 1,
        day,
      ),
    );

  if (
    date.getUTCFullYear() !==
      fullYear ||
    date.getUTCMonth() !==
      month - 1 ||
    date.getUTCDate() !==
      day
  ) {
    throw new Error(
      "Invalid calendar date.",
    );
  }

  return {
    day,
    month,
    year,
  };
}

// =============================================================================
// TIME VALIDATION
// =============================================================================

function parseRtcTime(value) {
  const text =
    String(value || "").trim();

  const match =
    text.match(
      /^(\d{2}):(\d{2}):(\d{2})$/,
    );

  if (!match) {
    throw new Error(
      "Time must be HH:MM:SS.",
    );
  }

  const hour =
    Number(match[1]);

  const minute =
    Number(match[2]);

  const second =
    Number(match[3]);

  if (
    hour < 0 ||
    hour > 23
  ) {
    throw new Error(
      "Hour must be between 00 and 23.",
    );
  }

  if (
    minute < 0 ||
    minute > 59
  ) {
    throw new Error(
      "Minute must be between 00 and 59.",
    );
  }

  if (
    second < 0 ||
    second > 59
  ) {
    throw new Error(
      "Second must be between 00 and 59.",
    );
  }

  return {
    hour,
    minute,
    second,
  };
}

// =============================================================================
// BUILD RTC WRITE COMMAND
// =============================================================================
//
// Exact C# RTC_Update:
//
// String[] datee =
//     Date.Split('-', '/');
//
// String[] timee =
//     Time.Split(':');
//
// for (j = 2; j >= 0; j--)
//     val.Add(timee[j]);
//
// val.Add(0);
//
// foreach(date)
//     val.Add(date);
//
// Therefore:
//
// UI:
//
// DD-MM-YY
// HH:MM:SS
//
// TX:
//
// 00 94 00 40
// SS MM HH 00
// DD MM YY
//
// =============================================================================

function buildSetRtcCommand(
  rtcDate,
  rtcTime,
) {
  const {
    day,
    month,
    year,
  } =
    parseRtcDate(
      rtcDate,
    );

  const {
    hour,
    minute,
    second,
  } =
    parseRtcTime(
      rtcTime,
    );

  return [
    // Header
    0x00,
    CMD_SET_RTC,
    0x00,
    STATUS_FINAL,

    // Time
    second,
    minute,
    hour,
    0x00,

    // Date
    day,
    month,
    year,
  ];
}

// =============================================================================
// BUILD PASSWORD COMMAND
// =============================================================================
//
// C#:
//
// Password.Pass = 2 bytes
//
// _Password.Pass.Presentlong =
//     Convert.ToInt32(text);
//
// Arrayadd():
//
// byte 0 = password & 0xFF
// byte 1 = password >> 8
//
// Therefore:
//
// 00 9B 00 40 LOW HIGH
//
// =============================================================================

function buildPasswordCommand(
  passwordText,
) {
  const text =
    String(
      passwordText || "",
    ).trim();

  if (!/^\d+$/.test(text)) {
    throw new Error(
      "Password must contain numbers only.",
    );
  }

  const password =
    Number(text);

  // Protocol storage is two bytes.
  if (
    !Number.isInteger(password) ||
    password < 0 ||
    password > 65535
  ) {
    throw new Error(
      "Password must be between 0 and 65535.",
    );
  }

  const low =
    password & 0xff;

  const high =
    (password >> 8) &
    0xff;

  return [
    0x00,
    CMD_SET_PASSWORD,
    0x00,
    STATUS_FINAL,

    low,
    high,
  ];
}

// =============================================================================
// PHONE DATE/TIME
// =============================================================================
//
// Same format as:
//
// DateTime.Now.ToString("dd-MM-yy")
// DateTime.Now.ToString("HH:mm:ss")
//
// =============================================================================

function getPhoneDateTime() {
  const now =
    new Date();

  const day =
    String(
      now.getDate(),
    ).padStart(
      2,
      "0",
    );

  const month =
    String(
      now.getMonth() + 1,
    ).padStart(
      2,
      "0",
    );

  const year =
    String(
      now.getFullYear() %
        100,
    ).padStart(
      2,
      "0",
    );

  const hour =
    String(
      now.getHours(),
    ).padStart(
      2,
      "0",
    );

  const minute =
    String(
      now.getMinutes(),
    ).padStart(
      2,
      "0",
    );

  const second =
    String(
      now.getSeconds(),
    ).padStart(
      2,
      "0",
    );

  return {
    date:
      `${day}-${month}-${year}`,

    time:
      `${hour}:${minute}:${second}`,
  };
}

// =============================================================================
// OPEN STM32
// =============================================================================

async function usbTransaction(port, commandBytes, expectedCommand) {
  const response = await sendCommandAndGetResponse(
    port, Uint8Array.from(commandBytes), RX_TIMEOUT_MS, RX_IDLE_TIMEOUT_MS,
  );
  const bytes = hexResponseToHexArray(response).map(Number);
  const frame = findExpectedResponse(bytes, expectedCommand);
  if (!frame) throw new Error("Unexpected or incomplete controller response.");
  if (frame.error) throw new Error("The controller rejected the request.");
  if (expectedCommand === CMD_READ_RTC && frame.command !== expectedCommand) {
    throw new Error("The controller did not return its clock.");
  }
  return frame.bytes;
}

export default function RtcPasswordTab({
  TabData,
  port,
  showControllerSerial,
}) {
  // ===========================================================================
  // RTC STATE
  // ===========================================================================

  const [
    rtcDate,
    setRtcDate,
  ] =
    useState("");

  const [
    rtcTime,
    setRtcTime,
  ] =
    useState("");

  // ===========================================================================
  // PASSWORD
  // ===========================================================================

  const [
    newPassword,
    setNewPassword,
  ] =
    useState("");

  const [
    confirmPassword,
    setConfirmPassword,
  ] =
    useState("");

  const [
    showNewPassword,
    setShowNewPassword,
  ] =
    useState(false);

  const [
    showConfirmPassword,
    setShowConfirmPassword,
  ] =
    useState(false);

  // ===========================================================================
  // STATUS
  // ===========================================================================

  const [
    message,
    setMessage,
  ] =
    useState("");

  const [
    messageType,
    setMessageType,
  ] =
    useState("success");

  const [
    isReadingRtc,
    setIsReadingRtc,
  ] =
    useState(false);

  const [
    isSettingRtc,
    setIsSettingRtc,
  ] =
    useState(false);

  const [
    isUpdatingPassword,
    setIsUpdatingPassword,
  ] =
    useState(false);

  // Prevent two commands from this tab being sent simultaneously.
  const commandBusyRef =
    useRef(false);

  // ===========================================================================
  // OPTIONAL TabData DECODING
  // ===========================================================================
  //
  // Your current TabData starts:
  //
  // 00 93 ...
  //
  // That belongs to dashboard.
  //
  // Ignore it.
  //
  // Only use TabData here if it contains a proper 0x95 response.
  // ===========================================================================

  useEffect(() => {
    if (
      !Array.isArray(
        TabData,
      ) ||
      TabData.length < 4
    ) {
      return;
    }

    try {
      const bytes =
        normalizeByteArray(
          TabData,
        );

      // ---------------------------------------------------------------
      // Search for an actual RTC frame.
      //
      // Do NOT assume TabData[1] is RTC.
      // ---------------------------------------------------------------

      const result =
        findExpectedResponse(
          bytes,
          CMD_READ_RTC,
        );

      if (
        !result?.found ||
        result.error ||
        result.command !==
          CMD_READ_RTC ||
        result.bytes.length <
          11
      ) {
        // 0x93 etc.
        return;
      }

      const rtc =
        decodeRtcResponse(
          result.bytes,
        );

      setRtcDate(
        rtc.date,
      );

      setRtcTime(
        rtc.time,
      );
    } catch (error) {
      // Do not show user errors for unrelated TabData.
    }
  }, [TabData]);

  // ===========================================================================
  // READ RTC
  // ===========================================================================

  const handleReadRtc =
    async () => {
      if (
        commandBusyRef.current
      ) {
        return;
      }

      commandBusyRef.current =
        true;

      setIsReadingRtc(
        true,
      );

      setMessage("");

      try {
        // -------------------------------------------------------------
        // EXACT C# RTC_import() COMMAND
        // -------------------------------------------------------------

        const command = [
          0x00,
          CMD_READ_RTC,
          0x00,
          0x00,
        ];

        // TX:
        //
        // 00 95 00 00

        const response =
          await usbTransaction(
            port,
            command,
            CMD_READ_RTC,
          );

        const rtc =
          decodeRtcResponse(
            response,
          );

        setRtcDate(
          rtc.date,
        );

        setRtcTime(
          rtc.time,
        );

        setMessageType(
          "success",
        );

        setMessage(
          "RTC read successfully.",
        );
      } catch (error) {
        console.error(
          "Read RTC Error:",
          error,
        );

        setMessageType(
          "error",
        );

        setMessage(
          error instanceof
          Error
            ? error.message
            : "Unable to read RTC.",
        );
      } finally {
        setIsReadingRtc(
          false,
        );

        commandBusyRef.current =
          false;
      }
    };

  // ===========================================================================
  // USE PHONE DATE/TIME
  // ===========================================================================

  const handleUsePhoneTime =
    () => {
      const phone =
        getPhoneDateTime();

      setRtcDate(
        phone.date,
      );

      setRtcTime(
        phone.time,
      );

      setMessageType(
        "success",
      );

      setMessage(
        "Phone date/time copied. Press Set RTC to write it to the controller.",
      );
    };

  // ===========================================================================
  // SET RTC
  // ===========================================================================

  const handleSetRtc =
    async () => {
      if (
        commandBusyRef.current
      ) {
        return;
      }

      setMessage("");

      try {
        // -------------------------------------------------------------
        // BUILD EXACT C# RTC_Update PACKET
        // -------------------------------------------------------------

        const command =
          buildSetRtcCommand(
            rtcDate,
            rtcTime,
          );

        commandBusyRef.current =
          true;

        setIsSettingRtc(
          true,
        );

        // -------------------------------------------------------------
        // SEND AND WAIT ACK
        // -------------------------------------------------------------

        await usbTransaction(
            port,
            command,
            CMD_SET_RTC,
          );

        // usbTransaction already checks:
        //
        // command == 0x94
        //
        // OR
        //
        // command == 0x91
        //
        // and status != 0x80.

        setMessageType(
          "success",
        );

        setMessage(
          "RTC successfully updated.",
        );
      } catch (error) {
        console.error(
          "Set RTC Error:",
          error,
        );

        setMessageType(
          "error",
        );

        setMessage(
          error instanceof
          Error
            ? error.message
            : "Unable to update RTC.",
        );
      } finally {
        setIsSettingRtc(
          false,
        );

        commandBusyRef.current =
          false;
      }
    };

  // ===========================================================================
  // UPDATE PASSWORD
  // ===========================================================================

  const handlePasswordUpdate =
    async () => {
      if (
        commandBusyRef.current
      ) {
        return;
      }

      setMessage("");

      try {
        // -------------------------------------------------------------
        // UI VALIDATION
        // -------------------------------------------------------------

        if (
          !newPassword.trim()
        ) {
          throw new Error(
            "Please enter new password.",
          );
        }

        if (
          !confirmPassword.trim()
        ) {
          throw new Error(
            "Please confirm new password.",
          );
        }

        if (
          newPassword !==
          confirmPassword
        ) {
          throw new Error(
            "New password and confirm password do not match.",
          );
        }

        // -------------------------------------------------------------
        // BUILD C# password_Update PACKET
        // -------------------------------------------------------------

        const command =
          buildPasswordCommand(
            newPassword,
          );

        commandBusyRef.current =
          true;

        setIsUpdatingPassword(
          true,
        );

        // -------------------------------------------------------------
        // SEND + WAIT ACK
        // -------------------------------------------------------------

        await usbTransaction(
            port,
            command,
            CMD_SET_PASSWORD,
          );

        setNewPassword("");
        setConfirmPassword("");

        setMessageType(
          "success",
        );

        setMessage(
          "Password successfully updated.",
        );
      } catch (error) {
        console.error(
          "Password Update Error:",
          error,
        );

        setMessageType(
          "error",
        );

        setMessage(
          error instanceof
          Error
            ? error.message
            : "Unable to update password.",
        );
      } finally {
        setIsUpdatingPassword(
          false,
        );

        commandBusyRef.current =
          false;
      }
    };

  // ===========================================================================
  // UI
  // ===========================================================================

  return (
    <View
      style={
        styles.container
      }
    >
      <Text
        style={
          styles.pageTitle
        }
      >
        RTC / Password
      </Text>

      {/* ===============================================================
          MESSAGE
          =============================================================== */}

      {!!message && (
        <View
          style={[
            styles.messageBox,

            messageType ===
            "error"
              ? styles.messageError
              : styles.messageSuccess,
          ]}
        >
          <Text
            style={[
              styles.messageText,

              messageType ===
              "error"
                ? styles.messageErrorText
                : styles.messageSuccessText,
            ]}
          >
            {message}
          </Text>
        </View>
      )}

      <View
        style={
          styles.settingsPanel
        }
      >
        {/* =============================================================
            RTC
            ============================================================= */}

        <View
          style={
            styles.sectionCard
          }
        >
          <View
            style={
              styles.sectionHeader
            }
          >
            <Text
              style={
                styles.sectionHeaderText
              }
            >
              RTC Settings
            </Text>
          </View>

          <Text
            style={
              styles.description
            }
          >
            Read or update the controller date and time.
          </Text>

          {/* DATE / TIME */}

          <View
            style={
              styles.row
            }
          >
            <RtcInput
              label="Date"
              value={
                rtcDate
              }
              onChangeText={
                setRtcDate
              }
              placeholder="DD-MM-YY"
              maxLength={8}
            />

            <RtcInput
              label="Time"
              value={
                rtcTime
              }
              onChangeText={
                setRtcTime
              }
              placeholder="HH:MM:SS"
              maxLength={8}
            />
          </View>

          {/* FORMAT */}

          <View
            style={
              styles.formatBox
            }
          >
            <Text
              style={
                styles.formatTitle
              }
            >
              Format
            </Text>

            <Text
              style={
                styles.formatText
              }
            >
              Date: DD-MM-YY
            </Text>

            <Text
              style={
                styles.formatText
              }
            >
              Time: HH:MM:SS
            </Text>
          </View>

          {/* PHONE TIME */}

          <TouchableOpacity
            style={
              styles.phoneTimeButton
            }
            onPress={
              handleUsePhoneTime
            }
            activeOpacity={
              0.8
            }
          >
            <Text
              style={
                styles.phoneTimeButtonText
              }
            >
              Use Phone Date / Time
            </Text>
          </TouchableOpacity>

          {/* READ / SET */}

          <View
            style={
              styles.buttonRow
            }
          >
            <TouchableOpacity
              style={[
                styles.actionButton,
                styles.secondaryButton,

                isReadingRtc &&
                  styles.disabledButton,
              ]}
              onPress={
                handleReadRtc
              }
              disabled={
                isReadingRtc ||
                isSettingRtc ||
                isUpdatingPassword
              }
              activeOpacity={
                0.8
              }
            >
              <Text
                style={
                  styles.secondaryButtonText
                }
              >
                {isReadingRtc
                  ? "Reading..."
                  : "Read RTC"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.actionButton,
                styles.primaryButton,

                isSettingRtc &&
                  styles.disabledButton,
              ]}
              onPress={
                handleSetRtc
              }
              disabled={
                isReadingRtc ||
                isSettingRtc ||
                isUpdatingPassword
              }
              activeOpacity={
                0.8
              }
            >
              <Text
                style={
                  styles.primaryButtonText
                }
              >
                {isSettingRtc
                  ? "Updating..."
                  : "Set RTC"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* =============================================================
            PASSWORD
            ============================================================= */}

        <View
          style={
            styles.sectionCard
          }
        >
          <View
            style={
              styles.sectionHeader
            }
          >
            <Text
              style={
                styles.sectionHeaderText
              }
            >
              Password Settings
            </Text>
          </View>

          <Text
            style={
              styles.description
            }
          >
            Enter the new numeric controller password.
          </Text>

          {/* NEW PASSWORD */}

          <PasswordInput
            label="New Password"
            value={
              newPassword
            }
            onChangeText={
              setNewPassword
            }
            visible={
              showNewPassword
            }
            onToggleVisibility={() =>
              setShowNewPassword(
                (previous) =>
                  !previous,
              )
            }
            placeholder="Enter new password"
          />

          {/* CONFIRM */}

          <PasswordInput
            label="Confirm New Password"
            value={
              confirmPassword
            }
            onChangeText={
              setConfirmPassword
            }
            visible={
              showConfirmPassword
            }
            onToggleVisibility={() =>
              setShowConfirmPassword(
                (previous) =>
                  !previous,
              )
            }
            placeholder="Re-enter new password"
          />

          {/* UPDATE */}

          <TouchableOpacity
            style={[
              styles.passwordButton,

              isUpdatingPassword &&
                styles.disabledButton,
            ]}
            onPress={
              handlePasswordUpdate
            }
            disabled={
              isReadingRtc ||
              isSettingRtc ||
              isUpdatingPassword
            }
            activeOpacity={
              0.8
            }
          >
            <Text
              style={
                styles.primaryButtonText
              }
            >
              {isUpdatingPassword
                ? "Updating..."
                : "Update Password"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
      {showControllerSerial && <DeviceFieldsTab port={port} serialOnly />}
    </View>
  );
}

// =============================================================================
// RTC INPUT
// =============================================================================

function RtcInput({
  label,
  value,
  onChangeText,
  placeholder,
  maxLength,
}) {
  return (
    <View
      style={
        styles.fieldContainer
      }
    >
      <Text
        style={
          styles.fieldLabel
        }
      >
        {label}
      </Text>

      <TextInput
        style={
          styles.textInput
        }
        value={
          value
        }
        onChangeText={
          onChangeText
        }
        placeholder={
          placeholder
        }
        placeholderTextColor="#9AA8C1"
        maxLength={
          maxLength
        }
        autoCorrect={
          false
        }
        autoCapitalize="none"
      />
    </View>
  );
}

// =============================================================================
// PASSWORD INPUT
// =============================================================================

function PasswordInput({
  label,
  value,
  onChangeText,
  visible,
  onToggleVisibility,
  placeholder,
}) {
  return (
    <View
      style={
        styles.passwordFieldContainer
      }
    >
      <Text
        style={
          styles.fieldLabel
        }
      >
        {label}
      </Text>

      <View
        style={
          styles.passwordInputContainer
        }
      >
        <TextInput
          style={
            styles.passwordTextInput
          }
          value={
            value
          }
          onChangeText={
            (text) => {
              const numericOnly =
                text.replace(
                  /[^0-9]/g,
                  "",
                );

              onChangeText(
                numericOnly,
              );
            }
          }
          placeholder={
            placeholder
          }
          placeholderTextColor="#9AA8C1"
          secureTextEntry={
            !visible
          }
          keyboardType="number-pad"
          autoCorrect={
            false
          }
          autoCapitalize="none"
          maxLength={5}
        />

        <TouchableOpacity
          style={
            styles.showButton
          }
          onPress={
            onToggleVisibility
          }
          activeOpacity={
            0.7
          }
        >
          <Text
            style={
              styles.showButtonText
            }
          >
            {visible
              ? "Hide"
              : "Show"}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles =
  StyleSheet.create({
    container: {
      paddingBottom: 24,
    },

    pageTitle: {
      fontSize: 22,
      fontWeight: "900",
      color:
        COLORS.primary,
      marginBottom: 14,
    },

    // =========================================================================
    // PANEL
    // =========================================================================

    settingsPanel: {
      backgroundColor:
        "#FFE8B8",

      borderRadius: 14,

      padding: 12,

      borderWidth: 1,

      borderColor:
        COLORS.border,

      marginBottom: 14,

      gap: 12,
    },

    sectionCard: {
      backgroundColor:
        "#FFF4D7",

      borderRadius: 12,

      padding: 12,
    },

    sectionHeader: {
      backgroundColor:
        NAVY,

      paddingVertical: 8,

      paddingHorizontal:
        10,

      borderRadius: 8,

      marginBottom: 10,
    },

    sectionHeaderText: {
      color: "#FFFFFF",

      fontSize: 16,

      fontWeight: "900",

      textAlign:
        "center",

      letterSpacing: 0.4,
    },

    description: {
      color:
        "#556580",

      fontSize: 12,

      lineHeight: 18,

      marginBottom: 14,
    },

    // =========================================================================
    // RTC
    // =========================================================================

    row: {
      flexDirection:
        "row",

      gap: 10,

      marginBottom: 12,
    },

    fieldContainer: {
      flex: 1,
    },

    fieldLabel: {
      fontSize: 12,

      fontWeight:
        "700",

      color:
        COLORS.text,

      marginBottom: 5,
    },

    textInput: {
      height: 44,

      backgroundColor:
        "#FFFFFF",

      borderWidth: 1,

      borderColor:
        COLORS.border,

      borderRadius: 8,

      paddingHorizontal:
        11,

      fontSize: 14,

      fontWeight:
        "700",

      color: NAVY,
    },

    // =========================================================================
    // FORMAT
    // =========================================================================

    formatBox: {
      backgroundColor:
        "#FFFFFF",

      borderWidth: 1,

      borderColor:
        "#E6D2A1",

      borderRadius: 8,

      padding: 10,

      marginBottom: 10,
    },

    formatTitle: {
      color: NAVY,

      fontSize: 12,

      fontWeight:
        "800",

      marginBottom: 4,
    },

    formatText: {
      color:
        "#697994",

      fontSize: 11,

      lineHeight: 17,
    },

    // =========================================================================
    // PHONE TIME
    // =========================================================================

    phoneTimeButton: {
      backgroundColor:
        "#EEF2FA",

      borderWidth: 1,

      borderColor:
        NAVY,

      borderRadius: 8,

      alignItems:
        "center",

      justifyContent:
        "center",

      paddingVertical: 9,

      marginBottom: 10,
    },

    phoneTimeButtonText: {
      color: NAVY,

      fontSize: 13,

      fontWeight:
        "800",
    },

    // =========================================================================
    // BUTTONS
    // =========================================================================

    buttonRow: {
      flexDirection:
        "row",

      gap: 10,
    },

    actionButton: {
      flex: 1,

      minHeight: 44,

      alignItems:
        "center",

      justifyContent:
        "center",

      borderRadius: 9,

      paddingHorizontal:
        10,

      paddingVertical:
        11,
    },

    primaryButton: {
      backgroundColor:
        NAVY,

      elevation: 2,
    },

    secondaryButton: {
      backgroundColor:
        "#FFFFFF",

      borderWidth: 1.5,

      borderColor:
        NAVY,
    },

    primaryButtonText: {
      color:
        "#FFFFFF",

      fontSize: 14,

      fontWeight:
        "800",
    },

    secondaryButtonText: {
      color: NAVY,

      fontSize: 14,

      fontWeight:
        "800",
    },

    disabledButton: {
      opacity: 0.5,
    },

    // =========================================================================
    // PASSWORD
    // =========================================================================

    passwordFieldContainer: {
      marginBottom: 12,
    },

    passwordInputContainer: {
      flexDirection:
        "row",

      alignItems:
        "center",

      backgroundColor:
        "#FFFFFF",

      borderWidth: 1,

      borderColor:
        COLORS.border,

      borderRadius: 8,

      overflow:
        "hidden",
    },

    passwordTextInput: {
      flex: 1,

      minHeight: 44,

      paddingHorizontal:
        11,

      fontSize: 14,

      color: NAVY,

      fontWeight:
        "700",
    },

    showButton: {
      minHeight: 44,

      paddingHorizontal:
        14,

      alignItems:
        "center",

      justifyContent:
        "center",

      borderLeftWidth:
        1,

      borderLeftColor:
        COLORS.border,

      backgroundColor:
        "#F4F7FB",
    },

    showButtonText: {
      color: NAVY,

      fontSize: 12,

      fontWeight:
        "800",
    },

    passwordButton: {
      backgroundColor:
        NAVY,

      minHeight: 44,

      alignItems:
        "center",

      justifyContent:
        "center",

      borderRadius: 9,

      marginTop: 3,

      elevation: 2,
    },

    // =========================================================================
    // MESSAGE
    // =========================================================================

    messageBox: {
      borderRadius: 8,

      borderWidth: 1,

      paddingVertical: 9,

      paddingHorizontal:
        11,

      marginBottom: 14,
    },

    messageSuccess: {
      backgroundColor:
        "#E8F5E9",

      borderColor:
        "#4CAF50",
    },

    messageError: {
      backgroundColor:
        "#FDECEC",

      borderColor:
        "#E53935",
    },

    messageText: {
      fontSize: 12,

      fontWeight:
        "700",
    },

    messageSuccessText: {
      color:
        "#2E7D32",
    },

    messageErrorText: {
      color:
        "#C62828",
    },
  });
