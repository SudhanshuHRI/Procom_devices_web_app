import { Alert } from '../services/browserAlert';
import { writeSettingsPayload } from "../services/settingsPreset";
import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Picker from "./ReadablePicker";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import COLORS from "../constants/colors";
import PulseLoader from "./PulseLoader";
import DesktopSettingsEditor from "./DesktopSettingsEditor";

const COMMON_TABS = [
  "System Parameter A",
  "System Parameter B",
  "Generator Setting",
  "Protection Setting",
  "Annunciation Setting",
  "RS485 Comm Setting",
];

/* ──────────────────────────────────────────────────────────────────────────
 * DUMMY OPTION SETS
 * Placeholder option lists for SelectRows that are not yet wired to the
 * device protocol. They follow the same { label, value } shape as the
 * completed selects (e.g. Supplier / LLOP Sensor) using hex string values.
 * Replace the values with the real protocol values when available.
 * ────────────────────────────────────────────────────────────────────────── */
const BAUD_OPTIONS = [
  { label: "4800", value: "0x00" },
  { label: "9600", value: "0x01" },
  { label: "19200", value: "0x02" },
  { label: "38400", value: "0x03" },
  { label: "57600", value: "0x04" },
  { label: "115200", value: "0x05" },
];

const PARITY_OPTIONS = [
  { label: "None", value: "0x00" },
  { label: "Even", value: "0x01" },
  { label: "Odd", value: "0x02" },
];

const STOP_BITS_OPTIONS = [
  { label: "1 Stop Bit", value: "0x00" },
  { label: "2 Stop Bits", value: "0x01" },
];

const ON_OFF_OPTIONS = [
  { label: "Off", value: "0x00" },
  { label: "On", value: "0x01" },
];

const POLARITY_OPTIONS = [
  { label: "Normally Open", value: "0x00" },
  { label: "Normally Closed", value: "0x01" },
];

// Annunciation -> output/relay mapping (shared by every "Ann ..." select)
const ANN_OPTIONS = [
  { label: "Disabled", value: "0xFF" },
  { label: "Output 1", value: "0x01" },
  { label: "Output 2", value: "0x02" },
  { label: "Output 3", value: "0x03" },
  { label: "Output 4", value: "0x04" },
];

// Digital input function assignment (D Input 1..8)
const D_INPUT_FN_OPTIONS = [
  { label: "Not Used", value: "0x00" },
  { label: "Remote Start", value: "0x01" },
  { label: "Emergency Stop", value: "0x02" },
  { label: "Low Fuel", value: "0x03" },
  { label: "High Temperature", value: "0x04" },
];

const CONTACT_PIN_OPTIONS = [
  { label: "Not Used", value: "0x00" },
  { label: "Common Alarm", value: "0x01" },
  { label: "DG Running", value: "0x02" },
  { label: "DG Trip", value: "0x03" },
];

const SENSOR_OPEN_OPTIONS = [
  { label: "Enabled", value: "0x00" },
  { label: "Disabled", value: "0x01" },
];

const GEN_RPM_OPTIONS = [
  { label: "From Alternator", value: "0x00" },
  { label: "Magnetic Pickup", value: "0x01" },
];

const CRANK_CUT_OPTIONS = [
  { label: "Frequency", value: "0x00" },
  { label: "Voltage", value: "0x01" },
  { label: "RPM", value: "0x02" },
  { label: "Oil Pressure", value: "0x03" },
];

const NCD_STRATEGY_OPTIONS = [
  { label: "Disabled", value: "0x00" },
  { label: "Strategy 1", value: "0x01" },
  { label: "Strategy 2", value: "0x02" },
];

function hexToDecimal(hexValue) {
  return parseInt(hexValue, 16);
}
const decimalToHex = (value) => {
  const hex = Number(value).toString(16).toUpperCase();
  return `0x${hex.padStart(2, "0")}`;
};

const SensorUserDefinedGrid = memo(function SensorUserDefinedGrid({
  prefix,
  values,
  onChange,
}) {
  return (
    <View style={styles.userDefinedContainer}>
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <View key={n} style={styles.userDefinedRow}>
          {/* R column */}
          <View style={styles.userDefinedItem}>
            <Text style={styles.userDefinedLabel}>
              User {prefix} R{n}
            </Text>
            <View style={styles.inlineRow}>
              <TextInput
                style={styles.smallInput}
                keyboardType="numeric"
                value={values[`userR${n}`] ?? ""}
                onChangeText={(v) => onChange(`userR${n}`, v)}
              />
              <Text style={styles.unitText}>Ω</Text>
            </View>
          </View>

          {/* V column */}
          <View style={styles.userDefinedItem}>
            <Text style={styles.userDefinedLabel}>
              User {prefix} V{n}
            </Text>
            <View style={styles.inlineRow}>
              <TextInput
                style={styles.smallInput}
                keyboardType="numeric"
                value={values[`userV${n}`] ?? ""}
                onChangeText={(v) => onChange(`userV${n}`, v)}
              />
              <Text style={styles.unitText}>bar</Text>
            </View>
          </View>
        </View>
      ))}
    </View>
  );
});

const InputRow = memo(function InputRow({
  label,
  unit,
  checkbox,
  value = "",
  setTabDataState,
}) {
  const [disabled, setDisabled] = useState(false);
  const [values, setValues] = useState("");

  // LAZY: useCallback — stable reference, only recreated when label changes
  const ReadData = useCallback(
    (data) => {
      if (label === "J1939 GCU Address") {
        if (data[0][10] === "0xFF") {
          setDisabled(true);
          return;
        }
        setValues(String(hexToDecimal(data[0][10])));
      } else if (label === "J1939 ECU Address") {
        if (data[0][12] === "0xFF") {
          setDisabled(true);
          return;
        }
        setValues(String(hexToDecimal(data[0][12])));
      } else if (label === "Fuel Tank Capacity") {
        if (data[1][42] === "0xFF") {
          setDisabled(true);
          return;
        }
        const combinedHex =
          data[1][43].replace("0x", "") + data[1][42].replace("0x", "");
        setValues(String(hexToDecimal("0x" + combinedHex)));
      }
    },
    [label],
  );

  useEffect(() => {
    ReadData(value);
  }, [value, ReadData]);

  // LAZY: useCallback — stable reference prevents memo(InputRow) from busting
  const onChange = useCallback(
    (newValue) => {
      const newValueNumb = Number(newValue);

      if (label === "J1939 GCU Address") {
        if (newValue === "0xFF") {
          setTabDataState((prev) => {
            const updated = [...prev];
            updated[0] = [...updated[0]];
            updated[0][10] = "0xFF";
            updated[0][11] = "0xFF";
            return updated;
          });
          setValues("");
          return;
        }
        if (newValueNumb >= 0 && newValueNumb <= 253) {
          setTabDataState((prev) => {
            const updated = [...prev];
            updated[0] = [...updated[0]];
            updated[0][10] = decimalToHex(newValue);
            updated[0][11] = "0x00";
            return updated;
          });
          return;
        }
        alert("Values should be between 0 to 253");
        setValues("0");
        return;
      }

      if (label === "J1939 ECU Address") {
        if (newValue === "0xFF") {
          setTabDataState((prev) => {
            const updated = [...prev];
            updated[0] = [...updated[0]];
            updated[0][12] = "0xFF";
            updated[0][13] = "0xFF";
            return updated;
          });
          setValues("");
          return;
        }
        if (newValueNumb >= 0 && newValueNumb <= 253) {
          setTabDataState((prev) => {
            const updated = [...prev];
            updated[0] = [...updated[0]];
            updated[0][12] = decimalToHex(newValue);
            updated[0][13] = "0x00";
            return updated;
          });
          return;
        }
        alert("Values should be between 0 to 253");
        setValues("");
        return;
      }

      if (label === "Fuel Tank Capacity") {
        if (newValue === "0xFF") {
          setTabDataState((prev) => {
            const updated = [...prev];
            updated[1] = [...updated[1]];
            updated[1][42] = "0xFF";
            updated[1][43] = "0xFF";
            return updated;
          });
          setValues("");
          return;
        }
        if (newValueNumb >= 0 && newValueNumb < 255) {
          setTabDataState((prev) => {
            const updated = [...prev];
            updated[1] = [...updated[1]];
            updated[1][42] = decimalToHex(newValue);
            updated[1][43] = "0x00";
            return updated;
          });
          setValues(newValue);
          return;
        }
        if (newValueNumb >= 256 && newValueNumb <= 999) {
          const lowByte = newValue & 0xff;
          const highByte = (newValue >> 8) & 0xff;
          setTabDataState((prev) => {
            const updated = [...prev];
            updated[1] = [...updated[1]];
            updated[1][42] = decimalToHex(lowByte);
            updated[1][43] = decimalToHex(highByte);
            return updated;
          });
          setValues(newValue);
          return;
        }
        alert("Values should be between 0 to 999");
        setValues("0");
        return;
      }

      // ── DUMMY FALLBACK ──
      // Rows that are not yet wired to a device byte keep their value in
      // local state only, so the field is still typeable / checkbox works.
      // When you wire one up, add a dedicated `if (label === ...)` block above
      // (mirroring the J1939 / Fuel Tank Capacity blocks) and it will take
      // precedence over this fallback.
      if (newValue === "0xFF") {
        setValues("");
        return;
      }
      setValues(newValue);
    },
    [label, setTabDataState],
  );

  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>

      <View style={styles.inputLine}>
        <TextInput
          style={[
            styles.inputBox,
            styles.inputText,
            disabled && styles.inputBoxDisabled,
          ]}
          value={!disabled && values === "255" ? "" : values}
          onChangeText={onChange}
          editable={!disabled}
          placeholder={disabled ? "Disabled" : ""}
          placeholderTextColor="#9CA3AF"
          keyboardType="numeric"
        />

        {!!unit && <Text style={styles.inputUnit}>{unit}</Text>}

        {checkbox && (
          <TouchableOpacity
            style={styles.checkboxRow}
            activeOpacity={0.7}
            onPress={() => {
              setDisabled((prev) => {
                const next = !prev;
                onChange(next ? "0xFF" : "");
                return next;
              });
            }}
          >
            <View style={[styles.checkbox, disabled && styles.checkboxChecked]}>
              {disabled && <Text style={styles.checkboxTick}>✓</Text>}
            </View>
            <Text style={styles.checkboxText}>Disable</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
});

const SelectRow = memo(function SelectRow({
  label,
  options = [],
  data = "",
  setTabDataState,
}) {
  const [value, setValue] = useState("");

  // LAZY: useCallback, dep [label] only — data is passed in via the effect dep
  const ReadData = useCallback(
    (d) => {
      if (label === "Supplier") {
        setValue(d[0][4]);
        return;
      }
      if (label === "System Configration") {
        setValue(d[0][6]);
        return;
      }
      if (label === "Solenoid Type") {
        setValue(d[0][8]);
        return;
      }
      if (label === "LLOP Sensor") {
        setValue(d[0][14]);
        return;
      }
      if (label === "Fuel Sensor") {
        setValue(d[0][56]);
        return;
      }
      if (label === "HWT Sensor") {
        setValue(d[0][58]);
        return;
      }
    },
    [label],
  );

  // LAZY: dep is [data, ReadData] — picker now updates whenever source data
  //       changes (previously [value] caused it to miss external updates)
  useEffect(() => {
    if (data && data[0]) ReadData(data);
  }, [data, ReadData]);

  // LAZY: useCallback keeps reference stable
  const onChange = useCallback(
    (newValue) => {
      setValue(newValue); // immediate picker feedback

      if (!setTabDataState) return;

      if (label === "Supplier") {
        setTabDataState((prev) => {
          const u = [...prev];
          u[0] = [...u[0]];
          u[0][4] = newValue;
          return u;
        });
      } else if (label === "System Configration") {
        setTabDataState((prev) => {
          const u = [...prev];
          u[0] = [...u[0]];
          u[0][6] = newValue;
          return u;
        });
      } else if (label === "Solenoid Type") {
        setTabDataState((prev) => {
          const u = [...prev];
          u[0] = [...u[0]];
          u[0][8] = newValue;
          return u;
        });
      } else if (label === "LLOP Sensor") {
        setTabDataState((prev) => {
          const u = [...prev];
          u[0] = [...u[0]];
          u[0][14] = newValue;
          return u;
        });
      } else if (label === "Fuel Sensor") {
        if (newValue === "0xFF") {
          setTabDataState((prev) => {
            const u = [...prev];
            u[0] = [...u[0]];
            u[0][56] = "0xFF";
            u[0][57] = "0xFF";
            return u;
          });
        } else {
          setTabDataState((prev) => {
            const u = [...prev];
            u[0] = [...u[0]];
            u[0][56] = newValue;
            return u;
          });
        }
      } else if (label === "HWT Sensor") {
        if (newValue === "0xFF") {
          setTabDataState((prev) => {
            const u = [...prev];
            u[0] = [...u[0]];
            u[0][58] = "0xFF";
            u[0][59] = "0xFF";
            return u;
          });
        } else {
          setTabDataState((prev) => {
            const u = [...prev];
            u[0] = [...u[0]];
            u[0][58] = newValue;
            return u;
          });
        }
      }
      // NOTE: dummy selects (those without a branch above) don't pass
      // setTabDataState, so the early `if (!setTabDataState) return;` guard
      // means the picker updates locally only and never touches device bytes.
    },
    [label, setTabDataState],
  );

  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.selectBox}>
        <Picker
          selectedValue={value}
          onValueChange={onChange}
          style={styles.picker}
          itemStyle={{ fontSize: 12 }}
        >
          {options.length === 0 ? (
            <Picker.Item label="Select" value="" />
          ) : (
            options.map((item, index) => (
              <Picker.Item key={index} label={item.label} value={item.value} />
            ))
          )}
        </Picker>
      </View>
    </View>
  );
});

const RS485CommSetting = memo(function RS485CommSetting({
  changeTab,
  tabDataState,
  setTabDataState,
}) {
  return (
    <View style={styles.settingsPanel}>
      <View style={styles.formSection}>
        <InputRow
          label="Device ID"
          value=""
          setTabDataState={setTabDataState}
        />
        <SelectRow label="Baud Rate" options={BAUD_OPTIONS} />
        <SelectRow label="Device Parity" options={PARITY_OPTIONS} />
        <SelectRow label="Stop Bits" options={STOP_BITS_OPTIONS} />
      </View>
    </View>
  );
});

const AnnunciationSetting = memo(function AnnunciationSetting({
  changeTab,
  tabDataState,
  setTabDataState,
}) {
  return (
    <View style={styles.settingsPanel}>
      <View style={styles.formSection}>
        {/* ── Column 1 ── */}
        <SelectRow label="Ann DG ON" options={ANN_OPTIONS} />
        <SelectRow label="Ann DG OFF" options={ANN_OPTIONS} />
        <SelectRow label="Ann DG On Load" options={ANN_OPTIONS} />
        <SelectRow label="Ann Unit OK" options={ANN_OPTIONS} />
        <SelectRow label="Ann Fuel Trip" options={ANN_OPTIONS} />
        <SelectRow label="Ann LLOP Trip" options={ANN_OPTIONS} />
        <SelectRow label="Ann HET Trip" options={ANN_OPTIONS} />
        <SelectRow label="Ann DG VOL" options={ANN_OPTIONS} />
        <SelectRow label="Ann Emergency" options={ANN_OPTIONS} />
        <SelectRow label="Ann DG O/L" options={ANN_OPTIONS} />
        <SelectRow label="Ann DG High Load" options={ANN_OPTIONS} />
        <SelectRow label="Ann DG Freq" options={ANN_OPTIONS} />
        <SelectRow label="Ann RWL Fault" options={ANN_OPTIONS} />
        <SelectRow label="Ann Chg/VBelt" options={ANN_OPTIONS} />
        <SelectRow label="Ann Fail Start" options={ANN_OPTIONS} />

        {/* ── Column 2 ── */}
        <SelectRow label="Ann Fail Stop" options={ANN_OPTIONS} />
        <SelectRow label="Ann Current Unbalance" options={ANN_OPTIONS} />
        <SelectRow label="Ann Fuel Open" options={ANN_OPTIONS} />
        <SelectRow label="Ann LLOP Open" options={ANN_OPTIONS} />
        <SelectRow label="Ann HWT Open" options={ANN_OPTIONS} />
        <SelectRow label="Ann Cannopy Temp" options={ANN_OPTIONS} />
        <SelectRow label="Ann Fire" options={ANN_OPTIONS} />
        <SelectRow label="Ann Oil Temp" options={ANN_OPTIONS} />
        <SelectRow label="Ann Oil Level" options={ANN_OPTIONS} />
        <SelectRow label="Ann Service Due" options={ANN_OPTIONS} />
        <SelectRow label="Ann Batt NOK" options={ANN_OPTIONS} />
        <SelectRow label="Any Common Fault" options={ANN_OPTIONS} />
        <SelectRow label="Fuel Low/Half" options={ANN_OPTIONS} />
        <SelectRow label="C Door Open" options={ANN_OPTIONS} />
        <SelectRow label="Reverse Power" options={ANN_OPTIONS} />

        {/* ── Column 3 ── */}
        <SelectRow label="Ann EGR Warn" options={ANN_OPTIONS} />
        <SelectRow label="Ann NCD Warn" options={ANN_OPTIONS} />
        <SelectRow label="Ann NCD Fault" options={ANN_OPTIONS} />
        <SelectRow label="Ann CPCB4 Audio" options={ANN_OPTIONS} />
        <SelectRow label="Ann J1939 1" options={ANN_OPTIONS} />
        <SelectRow label="Ann J1939 2" options={ANN_OPTIONS} />
        <SelectRow label="Ann J1939 3" options={ANN_OPTIONS} />
        <SelectRow label="Ann J1939 4" options={ANN_OPTIONS} />

        {/* ── RS485 fields ── */}
        <InputRow
          label="Device ID"
          value=""
          setTabDataState={setTabDataState}
        />
        <SelectRow label="Baud Rate" options={BAUD_OPTIONS} />
        <SelectRow label="Device Parity" options={PARITY_OPTIONS} />
        <SelectRow label="Stop Bits" options={STOP_BITS_OPTIONS} />
      </View>
    </View>
  );
});

const ProtectionSetting = memo(function ProtectionSetting({
  changeTab,
  tabDataState,
  setTabDataState,
}) {
  return (
    <View style={styles.settingsPanel}>
      <View style={styles.formSection}>
        {/* ── Column 1 ── */}
        <InputRow
          label="Fuel Warning Level"
          unit="%"
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="Fuel Warning Delay"
          unit="Sec"
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="Fuel Triping Level"
          unit="%"
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="Fuel Triping Delay"
          unit="Sec"
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="LLOP Triping Level"
          unit="Kg/cm2"
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="LLOP Triping Delay"
          unit="Sec"
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="HWT Triping Level"
          unit="°c"
          checkbox
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="HWT Triping Delay"
          unit="Sec"
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="D. Input 1 Delay"
          unit="Sec"
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="D. Input 2 Delay"
          unit="Sec"
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="D. Input 3 Delay"
          unit="Sec"
          value=""
          setTabDataState={setTabDataState}
        />

        {/* ── Column 2 ── */}
        <InputRow
          label="D. Input 4 Delay"
          unit="Sec"
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="D. Input 5 Delay"
          unit="Sec"
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="D. Input 6 Delay"
          unit="Sec"
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="D. Input 7 Delay"
          unit="Sec"
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="D. Input 8 Delay"
          unit="Sec"
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="Charging Alternator"
          unit="Sec"
          checkbox
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="Hooter On Time"
          unit="Sec"
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="Crank On Time"
          unit="Sec"
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="Crank Gap Time"
          unit="Sec"
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="Crank Attempts"
          value=""
          setTabDataState={setTabDataState}
        />

        {/* ── Column 3 ── */}
        <InputRow
          label="Solenoid On Time"
          unit="Sec"
          value=""
          setTabDataState={setTabDataState}
        />
        <SelectRow label="Auto Scroll On/Off" options={ON_OFF_OPTIONS} />
        <InputRow
          label="Scrolling Delay"
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="Battery UV Warning"
          unit="V"
          checkbox
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="Battery OV Warning"
          unit="V"
          checkbox
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="Canopy Over Temp"
          unit="°C"
          checkbox
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="Canopy Temp Delay"
          value=""
          setTabDataState={setTabDataState}
        />
        <SelectRow label="NCD Strategy" options={NCD_STRATEGY_OPTIONS} />
        <InputRow
          label="NCD Warn Hrs"
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="NCD Fault Hrs"
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="NCD Heal Hrs"
          value=""
          setTabDataState={setTabDataState}
        />
      </View>
    </View>
  );
});

const GeneratorSetting = memo(function GeneratorSetting({
  changeTab,
  tabDataState,
  setTabDataState,
}) {
  return (
    <View style={styles.settingsPanel}>
      <View style={styles.formSection}>
        {/* ── Left Column ── */}
        <InputRow
          label="Generator Over Voltage"
          unit="V"
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="Generator Under Voltage"
          unit="V"
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="Generator Voltage Delay"
          unit="Sec"
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="Generator Over Frequency"
          unit="Hz"
          checkbox
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="Generator Under Frequency"
          unit="Hz"
          checkbox
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="Generator Frequency Delay"
          unit="Sec"
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="Current Unbalance"
          unit="%"
          checkbox
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="Current Unbalance Delay"
          unit="Sec"
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="Pick Up Voltage"
          unit="V"
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="Pick Up RPM"
          unit="RPM"
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="First Service Hour"
          unit="Hrs"
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="Later Service Hour"
          unit="Hrs"
          value=""
          setTabDataState={setTabDataState}
        />
        <SelectRow label="Crank Cut Method" options={CRANK_CUT_OPTIONS} />

        {/* ── Right Column ── */}
        <InputRow
          label="Pick Up KVA Warning"
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="Reset KVA Warning"
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="KVA Warning Delay"
          unit="Sec"
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="Choke Pre Time"
          unit="Sec"
          checkbox
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="Choke Post Time"
          unit="Sec"
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="Pump Pre Start"
          unit="Sec"
          checkbox
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="Generator Warm up Delay"
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="Generator Recooling Delay"
          value=""
          setTabDataState={setTabDataState}
        />
      </View>
    </View>
  );
});

const SystemParameterB = memo(function SystemParameterB({
  changeTab,
  tabDataState,
  setTabDataState,
}) {
  return (
    <View style={styles.settingsPanel}>
      <View style={styles.formSection}>
        {/* ── Column 1 ── */}
        <SelectRow label="Sensor Open" options={SENSOR_OPEN_OPTIONS} />
        <InputRow
          label="CT Ratio"
          unit="Ratio"
          value=""
          setTabDataState={setTabDataState}
        />
        <SelectRow label="Generator RPM" options={GEN_RPM_OPTIONS} />
        <SelectRow label="Contact Pin 32" options={CONTACT_PIN_OPTIONS} />
        <SelectRow label="Contact Pin 31" options={CONTACT_PIN_OPTIONS} />
        <SelectRow label="Contact Pin 30" options={CONTACT_PIN_OPTIONS} />
        <InputRow
          label="Over Load KW"
          unit="Kw"
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="Over Current"
          unit="Amps"
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="Over Load Delay"
          unit="Sec"
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="High Load"
          unit="KW"
          checkbox
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="High Load Delay"
          unit="Sec"
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="Rev Power"
          unit="KW"
          checkbox
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="Rev Power Delay"
          unit="Sec"
          value=""
          setTabDataState={setTabDataState}
        />

        {/* ── D Input 1–5 ── */}
        <SelectRow label="D Input 1" options={D_INPUT_FN_OPTIONS} />
        <SelectRow label="D Input Plarity 1" options={POLARITY_OPTIONS} />
        <SelectRow label="D Input 2" options={D_INPUT_FN_OPTIONS} />
        <SelectRow label="D Input Plarity 2" options={POLARITY_OPTIONS} />
        <SelectRow label="D Input 3" options={D_INPUT_FN_OPTIONS} />
        <SelectRow label="D Input Plarity 3" options={POLARITY_OPTIONS} />
        <SelectRow label="D Input 4" options={D_INPUT_FN_OPTIONS} />
        <SelectRow label="D Input Plarity 4" options={POLARITY_OPTIONS} />
        <SelectRow label="D Input 5" options={D_INPUT_FN_OPTIONS} />
        <SelectRow label="D Input Plarity 5" options={POLARITY_OPTIONS} />

        {/* ── D Input 6–8 + Fan ── */}
        <SelectRow label="D Input 6" options={D_INPUT_FN_OPTIONS} />
        <SelectRow label="D Input Plarity 6" options={POLARITY_OPTIONS} />
        <SelectRow label="D Input 7" options={D_INPUT_FN_OPTIONS} />
        <SelectRow label="D Input Plarity 7" options={POLARITY_OPTIONS} />
        <SelectRow label="D Input 8" options={D_INPUT_FN_OPTIONS} />
        <SelectRow label="D Input Plarity 8" options={POLARITY_OPTIONS} />
        <InputRow
          label="Fan High Current"
          checkbox
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="Fan Low Current"
          value=""
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="Fan Current Delay"
          value=""
          setTabDataState={setTabDataState}
        />
      </View>
    </View>
  );
});

const SystemParameterA = memo(function SystemParameterA({
  changeTab,
  tabDataState,
  setTabDataState,
}) {
  const [llopValues, setLlopValues] = useState(() =>
    Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [
        [`userR${i + 1}`, ""],
        [`userV${i + 1}`, ""],
      ]).flat(),
    ),
  );
  const [fuelSensorValues, setFuelSensorValues] = useState(() =>
    Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [
        [`userR${i + 1}`, ""],
        [`userV${i + 1}`, ""],
      ]).flat(),
    ),
  );
  const [hwtValues, setHwtValues] = useState(() =>
    Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [
        [`userR${i + 1}`, ""],
        [`userV${i + 1}`, ""],
      ]).flat(),
    ),
  );

  // LAZY: useMemo — recomputed only when tabDataState reference changes
  const llopSensorType = useMemo(
    () => tabDataState[0][14] === "0x00",
    [tabDataState],
  );
  const fuelSensorType = useMemo(
    () => tabDataState[0][56] === "0x00",
    [tabDataState],
  );
  const hwtSensorType = useMemo(
    () => tabDataState[0][58] === "0x00",
    [tabDataState],
  );

  // LAZY: useCallback — stable refs so SensorUserDefinedGrid memo holds
  const handleUserLLOPSensor = useCallback((key, value) => {
    setLlopValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleUserFuelSensor = useCallback((key, value) => {
    setFuelSensorValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleUserHwtSensor = useCallback((key, value) => {
    setHwtValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  return (
    <View style={styles.settingsPanel}>
      <View style={styles.formSection}>
        <SelectRow
          label="Supplier"
          data={tabDataState}
          setTabDataState={setTabDataState}
          options={[
            { label: "Procom", value: "0x00" },
            { label: "TMTL", value: "0x01" },
            { label: "Mahindra", value: "0x02" },
          ]}
        />

        <SelectRow
          label="System Configration"
          data={tabDataState}
          setTabDataState={setTabDataState}
          options={[
            { label: "Generator 1P", value: "0x00" },
            { label: "Generator 3P", value: "0x01" },
          ]}
        />

        <SelectRow
          label="Solenoid Type"
          data={tabDataState}
          setTabDataState={setTabDataState}
          options={[
            { label: "Pull to Start", value: "0x00" },
            { label: "Pull to Stop", value: "0x01" },
          ]}
        />

        <InputRow
          label="J1939 GCU Address"
          checkbox
          value={tabDataState}
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="J1939 ECU Address"
          checkbox
          value={tabDataState}
          setTabDataState={setTabDataState}
        />
        <InputRow
          label="Fuel Tank Capacity"
          checkbox
          value={tabDataState}
          unit="Ltr"
          setTabDataState={setTabDataState}
        />

        <SelectRow
          label="LLOP Sensor"
          data={tabDataState}
          setTabDataState={setTabDataState}
          options={[
            { label: "User Defined", value: "0x00" },
            { label: "Type A", value: "0x01" },
            { label: "M&M", value: "0x02" },
            { label: "MNEPL", value: "0x03" },
            { label: "VE", value: "0x04" },
            { label: "TMTL", value: "0x05" },
            { label: "HUAFANG", value: "0x06" },
            { label: "TATA", value: "0x07" },
            { label: "GC-VDO", value: "0x08" },
            { label: "GC-MORPHY", value: "0x09" },
            { label: "M&M-2", value: "0x0A" },
            { label: "4-20 MA", value: "0x0B" },
            { label: "Disabled", value: "0x0C" },
          ]}
        />

        {/*
          LAZY: conditional mount
          SensorUserDefinedGrid (20 TextInputs) only enters the tree when
          LLOP Sensor = "User Defined". Zero nodes otherwise.
        */}
        {llopSensorType && (
          <SensorUserDefinedGrid
            prefix="LLOP"
            values={llopValues}
            onChange={handleUserLLOPSensor}
          />
        )}

        <SelectRow
          label="Fuel Sensor"
          data={tabDataState}
          setTabDataState={setTabDataState}
          options={[
            { label: "User Defined", value: "0x00" },
            { label: "Type A", value: "0x01" },
            { label: "SAM 0", value: "0x02" },
            { label: "SAM 1", value: "0x03" },
            { label: "Electronics", value: "0x04" },
            { label: "Linear", value: "0x05" },
            { label: "0-5V", value: "0x06" },
            { label: "0.5-4.5V", value: "0x07" },
            { label: "Disabled", value: "0xFF" },
          ]}
        />

        {/* LAZY: conditional mount — 20 TextInputs only when Fuel = "User Defined" */}
        {fuelSensorType && (
          <SensorUserDefinedGrid
            prefix="Fuel"
            values={fuelSensorValues}
            onChange={handleUserFuelSensor}
          />
        )}

        <SelectRow
          label="HWT Sensor"
          data={tabDataState}
          setTabDataState={setTabDataState}
          options={[
            { label: "User Defined", value: "0x00" },
            { label: "Type A", value: "0x01" },
            { label: "M&M", value: "0x02" },
            { label: "MNEPL", value: "0x03" },
            { label: "VE", value: "0x04" },
            { label: "TMTL Range 1", value: "0x05" },
            { label: "TMTL Range 2", value: "0x06" },
            { label: "TMTL Water", value: "0x07" },
            { label: "HUAFANG", value: "0x08" },
            { label: "TATA", value: "0x09" },
            { label: "GC-VDO", value: "0x0A" },
            { label: "GC-Murphy", value: "0x0B" },
            { label: "M&M 2", value: "0x0C" },
            { label: "Disabled", value: "0xFF" },
          ]}
        />

        {/* LAZY: conditional mount — 20 TextInputs only when HWT = "User Defined" */}
        {hwtSensorType && (
          <SensorUserDefinedGrid
            prefix="HWT"
            values={hwtValues}
            onChange={handleUserHwtSensor}
          />
        )}
      </View>
    </View>
  );
});

const CommonSettingsUI = memo(function CommonSettingsUI({
  onBack,
  TabData,
  port,
  onUpdateSuccess,
}) {
  const [activeCommonTab, setActiveCommonTab] = useState("System Parameter A");
  const [isUpdatingCommon, setIsUpdatingCommon] = useState(false);
  const [tabDataState, setTabDataState] = useState(TabData);

  useEffect(() => {
    // console.log("TabData Page 1:", tabDataState[0]);
    // console.log("TabData Page 2:", tabDataState[1]);
  }, [tabDataState]);

  const scrollRef = useRef(null);

  // LAZY: useCallback — stable reference avoids re-renders of the tab bar
  const changeTab = useCallback((nextTab) => {
    setActiveCommonTab(nextTab);
    setTimeout(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    }, 100);
  }, []);

  // LAZY: useCallback — depends only on tabDataState and port
  const handleUpdate = useCallback(async () => {
    setIsUpdatingCommon(true);
    try {
      const payload = Uint8Array.from(tabDataState.flatMap((frame) => frame.slice(4)), Number);
      await writeSettingsPayload(port, payload);
      await onUpdateSuccess?.();
    } catch (err) {
      // console.log("update error:", err);
      Alert.alert("Update Failed", "Something went wrong. Please try again.");
    } finally {
      setIsUpdatingCommon(false);
    }
  }, [tabDataState, port,onUpdateSuccess]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 80 : 0}
    >
      <ScrollView
        ref={scrollRef}
        style={styles.card}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.pageHeader}>
          <Text style={styles.pageTitle}>Common Settings</Text>

          <View style={styles.headerButtons}>
            <TouchableOpacity
              style={[styles.smallButton, styles.updateBtn]}
              onPress={handleUpdate}
              disabled={isUpdatingCommon}
            >
              <Text style={styles.smallButtonText}>Update</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.smallButton, styles.backBtn]}
              onPress={onBack}
            >
              <Text style={styles.smallButtonText}>Back</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.commonTabWrapper}>
          {COMMON_TABS.map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[
                styles.commonTab,
                activeCommonTab === tab && styles.activeCommonTab,
              ]}
              onPress={() => changeTab(tab)}
            >
              <Text
                style={[
                  styles.commonTabText,
                  activeCommonTab === tab && styles.activeCommonTabText,
                ]}
              >
                {tab}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/*
        Each branch is memo'd — only the active tab re-renders when tabDataState
        changes; inactive tabs are still mounted but bailed-out by React.memo.
      */}
        {activeCommonTab === "System Parameter A" ? (
          <SystemParameterA
            changeTab={changeTab}
            tabDataState={tabDataState}
            setTabDataState={setTabDataState}
          />
        ) : activeCommonTab === "System Parameter B" ? (
          <SystemParameterB
            changeTab={changeTab}
            tabDataState={tabDataState}
            setTabDataState={setTabDataState}
          />
        ) : activeCommonTab === "Generator Setting" ? (
          <GeneratorSetting
            changeTab={changeTab}
            tabDataState={tabDataState}
            setTabDataState={setTabDataState}
          />
        ) : activeCommonTab === "Protection Setting" ? (
          <ProtectionSetting
            changeTab={changeTab}
            tabDataState={tabDataState}
            setTabDataState={setTabDataState}
          />
        ) : activeCommonTab === "Annunciation Setting" ? (
          <AnnunciationSetting
            changeTab={changeTab}
            tabDataState={tabDataState}
            setTabDataState={setTabDataState}
          />
        ) : (
          <RS485CommSetting
            changeTab={changeTab}
            tabDataState={tabDataState}
            setTabDataState={setTabDataState}
          />
        )}
      </ScrollView>
      {isUpdatingCommon && <PulseLoader text="Updating settings..." />}
    </KeyboardAvoidingView>
  );
});

export default function EditSettingsTab({
  deviceName,
  deviceVersion,
  TabData,
  port,
  onUpdateSuccess,
  isEcon,
  onOpenSettingsFiles,
}) {
  const [selectedPage, setSelectedPage] = useState(null);
  // console.log("tabData:", TabData);

  if (selectedPage === "desktop") {
    return <DesktopSettingsEditor port={port} deviceName={deviceName} deviceVersion={deviceVersion}
      onUpdateSuccess={onUpdateSuccess} onBack={() => setSelectedPage(null)} />;
  }

  if (selectedPage === "common") {
    return (
      <CommonSettingsUI
        onBack={() => setSelectedPage(null)}
        TabData={TabData}
        port={port}
        onUpdateSuccess={onUpdateSuccess}
      />
    );
  }

  return (
    <View style={styles.card}>
      {isEcon && <TouchableOpacity style={styles.primaryButton} onPress={() => setSelectedPage("desktop")}>
        <Text style={styles.primaryButtonText}>Edit Controller Parameters</Text>
      </TouchableOpacity>}
      {isEcon && <TouchableOpacity style={styles.primaryButton} onPress={onOpenSettingsFiles}>
        <Text style={styles.primaryButtonText}>Import, Save, or Compare Settings</Text>
      </TouchableOpacity>}

      {!isEcon && <TouchableOpacity
        style={[styles.primaryButton, !TabData?.[0]?.length && styles.disabledButton]}
        disabled={!TabData?.[0]?.length}
        onPress={() => {
          const normalizedVersion = String(deviceVersion || "")
            .toLowerCase()
            .replace(/[^0-9.]/g, "")
            .trim();

          const SUPPORTED_COMMON_VERSIONS = ["3.02", "3.04"];

          if (!SUPPORTED_COMMON_VERSIONS.includes(normalizedVersion)) {
            Alert.alert(
              "Unsupported Version",
              `Common Settings are only supported on v3.02 and v3.04.\n\nDetected version: ${
                deviceVersion || "Unknown"
              }`,
            );
            return;
          }

          setSelectedPage("common");
        }}
      >
        <Text style={styles.primaryButtonText}>Update Common Settings</Text>
      </TouchableOpacity>}
    </View>
  );
}

const styles = StyleSheet.create({
  smallInputDisabled: {
    backgroundColor: "#E5E7EB",
    borderColor: "#D1D5DB",
    color: "#475569",
  },
  pageHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  pageTitle: {
    flex: 1,
    fontSize: 22,
    fontWeight: "900",
    color: COLORS.primary,
  },
  headerButtons: {
    flexDirection: "row",
    alignItems: "center",
  },
  smallButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    marginLeft: 8,
    minWidth: 80,
    alignItems: "center",
  },
  updateBtn: {
    backgroundColor: "#16A34A",
  },
  backBtn: {
    backgroundColor: COLORS.primary,
  },
  smallButtonText: {
    color: "#FFF",
    fontWeight: "800",
    fontSize: 13,
  },
  userDefinedContainer: {
    marginTop: 12,
    backgroundColor: "#FDE7B0",
    padding: 10,
    borderRadius: 10,
  },
  userDefinedRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  userDefinedItem: {
    width: "48%",
  },
  userDefinedLabel: {
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 5,
    color: COLORS.text,
  },
  inlineRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  smallInput: {
    flex: 1,
    height: 36,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 6,
    paddingHorizontal: 8,
  },
  unitText: {
    marginLeft: 6,
    fontWeight: "700",
  },
  inputText: {
    paddingHorizontal: 10,
    fontSize: 13,
    color: COLORS.text,
  },
  inputBoxDisabled: {
    backgroundColor: "#E5E7EB",
    borderColor: "#D1D5DB",
  },
  checkboxChecked: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxTick: {
    color: COLORS.white,
    fontSize: 11,
    fontWeight: "900",
    lineHeight: 13,
  },
  picker: {
    height: 50,
    width: "100%",
    color: COLORS.text,
    fontSize: 12,
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    elevation: 2,
    marginBottom: 20,
  },
  primaryButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
    marginBottom: 14,
  },
  disabledButton: {
    backgroundColor: "#94A3B8",
  },
  primaryButtonText: {
    color: COLORS.white,
    fontSize: 17,
    fontWeight: "900",
  },
  smallBackButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  smallBackButtonText: {
    color: COLORS.white,
    fontWeight: "800",
  },
  commonTabWrapper: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: 14,
    gap: 8,
  },
  commonTab: {
    backgroundColor: COLORS.softCard,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderRadius: 10,
    width: "31%",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
  },
  activeCommonTab: {
    backgroundColor: COLORS.primary,
  },
  commonTabText: {
    color: COLORS.primary,
    fontWeight: "800",
    fontSize: 11,
    textAlign: "center",
  },
  activeCommonTabText: {
    color: COLORS.white,
  },
  settingsPanel: {
    backgroundColor: "#FFE8B8",
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  formSection: {
    backgroundColor: "#FFF4D7",
    borderRadius: 12,
    padding: 10,
  },
  fieldRow: {
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 5,
    color: COLORS.text,
  },
  selectBox: {
    backgroundColor: COLORS.white,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: "hidden",
  },
  inputLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  inputBox: {
    flex: 1,
    height: 40,
    backgroundColor: COLORS.white,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  inputUnit: {
    minWidth: 35,
    fontWeight: "700",
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  checkbox: {
    width: 16,
    height: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.white,
  },
  checkboxText: {
    fontSize: 12,
    fontWeight: "700",
  },
  updateButton: {
    flex: 1,
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 14,
  },
  backButton: {
    flex: 1,
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 14,
  },
  updateButtonText: {
    color: COLORS.white,
    fontWeight: "900",
    fontSize: 15,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 10,
  },
});
