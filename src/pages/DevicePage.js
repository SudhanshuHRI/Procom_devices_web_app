import { Alert } from '../services/browserAlert';
import React, { useState, useEffect, useRef } from "react";
import { Button, SafeAreaView, ScrollView, StyleSheet, Text } from "react-native";
import COLORS from "../constants/colors";

import DeviceHeader from "../components/DeviceHeader";
import TabsBar from "../components/TabsBar";
import CommonTab from "../components/CommonTab";
import DisplayTab, { decodeDisplayResponse } from "../components/DisplayTab";
import { AboutTab, DeviceFieldsTab, StoredHistoryTab } from "../components/ControllerDataTabs";
import { CanTab, ImportSettingsTab } from "../components/ConfigurationTabs";
import EditSettingsTab from "../components/EditSettingsTab";
import PulseLoader from "../components/PulseLoader";
import EventFaultHistoryTab, { decodeEventHistory, decodeFaultHistory } from "../components/EventFaultHistoryTab.js";
import StartStopHistoryTab, { decodeStartStopHistory } from "../components/StartStopHistoryTab.js";
import RtcPasswordTab from "../components/RtcPasswordTab.js";
import {
  sendCommandAndGetResponse,
  hexResponseToHexArray,
  hasExclusiveUsbOperation,
} from "../services/usbService";
import { saveWorkbook } from "../services/controllerFiles";
import { readSettingsPayload, settingsReport } from "../services/settingsPreset";
import { decodeStoredHistory, readPayload } from "../services/econProtocol";
import { historyReport } from "../services/historyReport";

export default function DevicePage({
  title,
  deviceName,
  deviceVersion,
  onBack,
  port,
  onUpdateSuccess,
}) {
  const [activeTab, setActiveTab] = useState("Display");
  const isEcon = title !== "DGC";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tabResult, setTabResult] = useState(null);
  const [monitoring, setMonitoring] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [dashboardCount, setDashboardCount] = useState(0);
  const dashboard = useRef([]);
  const currentRequest = useRef(0);
  const reading = useRef(false);

  const readCommand = async (command) =>
    hexResponseToHexArray(await sendCommandAndGetResponse(
      port, Uint8Array.of(0, command, 0, 0), 30000, 750,
    ));

  async function readTab(tab, background = false) {
    if (reading.current) return;
    const request = ++currentRequest.current;
    reading.current = true;
    if (!background) setLoading(true);
    setError('');
    try {
      let data;
      if (tab === "Display") data = await readCommand(0x93);
      if (tab === "Edit Setting" && !isEcon) {
        const bytes = await readCommand(0x92);
        data = Array.from({ length: Math.ceil(bytes.length / 60) },
          (_, index) => bytes.slice(index * 60, (index + 1) * 60));
      }
      if (tab === "Event & Fault History") {
        const fault = await readCommand(0x96);
        if (request !== currentRequest.current) return;
        data = { "fault History": fault, "Event History": await readCommand(0x97) };
      }
      if (tab === "Start & Stop History") data = await readCommand(0x98);
      if (tab === "R.T.C. & Password") data = await readCommand(0x95);
      if (request === currentRequest.current) setTabResult({ tab, data });
    } catch (failure) {
      if (request === currentRequest.current) setError(failure.message);
    } finally {
      if (request === currentRequest.current) {
        reading.current = false;
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    if (["Display", "Event & Fault History", "Start & Stop History", "R.T.C. & Password"].includes(activeTab) ||
        (activeTab === "Edit Setting" && !isEcon)) {
      readTab(activeTab);
    }
    return () => {
      currentRequest.current++;
      reading.current = false;
    };
  }, [activeTab, port, isEcon]);

  useEffect(() => {
    if (!monitoring || activeTab !== "Display") return;
    const interval = setInterval(() => readTab("Display", true), 1500);
    return () => clearInterval(interval);
  }, [monitoring, activeTab, port]);

  const TabData = tabResult?.tab === activeTab ? tabResult.data : [];
  const getDisplayParameters = () => readTab("Display");

  useEffect(() => {
    if (!monitoring || activeTab !== "Display" || tabResult?.tab !== "Display") return;
    try {
      const decoded = decodeDisplayResponse(tabResult.data);
      const { phasePower, ...values } = decoded.values;
      dashboard.current.push({
        ...values,
        ...Object.fromEntries(phasePower.flatMap(({ phase, active, apparent, reactive, factor }) => [
          [phase + ' Active Power (kW)', active], [phase + ' Apparent Power (kVA)', apparent],
          [phase + ' Reactive Power (kvar)', reactive], [phase + ' Power Factor', factor],
        ])),
        Faults: decoded.faultItems.filter((item) => item.active).map((item) => item.name).join(", "),
        Warnings: decoded.warningItems.filter((item) => item.active).map((item) => item.name).join(", "),
      });
      setDashboardCount(dashboard.current.length);
      if (dashboard.current.length >= 10000) setMonitoring(false);
    } catch (failure) {
      setError(failure.message);
    }
  }, [tabResult]);

  async function generateReport() {
    setReporting(true);
    setError('');
    try {
      const settings = settingsReport(await readSettingsPayload(port));
      const event = decodeEventHistory(await readCommand(0x97)).records;
      const fault = decodeFaultHistory(await readCommand(0x96)).records;
      const startStop = decodeStartStopHistory(await readCommand(0x98)).records;
      const instant = decodeStoredHistory(await readPayload(port, 0x9c), false);
      const energy = decodeStoredHistory(await readPayload(port, 0x9d), true);
      const rtc = await readPayload(port, 0x95);
      const format = (bytes, joiner) => bytes.map((value) => String(value).padStart(2, '0')).join(joiner);
      await saveWorkbook("ECON combined report", {
        Controller: [{ Model: deviceName, Firmware: deviceVersion,
          Date: format(Array.from(rtc.subarray(4, 7)), '-'),
          Time: format([rtc[2], rtc[1], rtc[0]], ':') }],
        Settings: settings,
        Events: historyReport(event, 'event', 'Event'),
        Faults: historyReport(fault, 'fault', 'Fault'),
        "Start Stop": historyReport(startStop, 'event', 'Start or stop'),
        "Instant History": instant,
        "Energy Store": energy,
      });
    } catch (failure) {
      setError(failure.message);
    } finally {
      setReporting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      {(loading || reporting) && <PulseLoader text={reporting ? "Generating combined report..." : "Reading data from device..."} />}
      <DeviceHeader
        title={title}
        onBack={() => {
          if (reporting || hasExclusiveUsbOperation(port)) {
            Alert.alert("Controller busy", "Wait for the current operation to finish.");
            return;
          }
          onBack();
        }}
        deviceVersion={deviceVersion}
      />


      <TabsBar activeTab={activeTab} onChangeTab={(tab) => {
        if (reporting || tab === activeTab || hasExclusiveUsbOperation(port)) return;
        setLoading(false);
        setError('');
        setMonitoring(false);
        setActiveTab(tab);
      }} />

      <ScrollView style={styles.content}>
        {!!error && <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text>}
        {activeTab === "Display" && <>
          <Button title={monitoring ? "Stop monitoring" : "Start monitoring"}
            disabled={reporting} onPress={() => setMonitoring(!monitoring)} />
          <Button title={`Save dashboard Excel (${dashboardCount})`}
            disabled={monitoring || reporting || !dashboardCount} onPress={() =>
              saveWorkbook("ECON dashboard", { Dashboard: dashboard.current }).catch((failure) => setError(failure.message))} />
          {isEcon && <Button title="Generate all reports" disabled={loading || monitoring || reporting}
            onPress={generateReport} />}
        </>}
        {error && activeTab !== "Display" && activeTab !== "R.T.C. & Password" &&
          <Button title="Retry read" onPress={() => readTab(activeTab)} />}
        {activeTab === "Display" ? (
          <DisplayTab
            TabData={TabData}
            getDisplayParameters={getDisplayParameters}
          />
        ) : activeTab === "Edit Setting" ? (
          <EditSettingsTab
            deviceName={deviceName}
            deviceVersion={deviceVersion}
            TabData={TabData}
            port={port}
            onUpdateSuccess={onUpdateSuccess}
            isEcon={isEcon}
            onOpenSettingsFiles={() => setActiveTab("Import Setting")}
          />
        ) : activeTab === "Event & Fault History" ? (
          <EventFaultHistoryTab TabData={TabData} />
        ) : activeTab === "Start & Stop History" ? (
          <StartStopHistoryTab TabData={TabData} />
        ) : activeTab === "R.T.C. & Password" ? (
          <RtcPasswordTab TabData={TabData} port={port} showControllerSerial={isEcon} />
        ) : !isEcon ? (
          <CommonTab activeTab={activeTab} />
        ) : activeTab === "Instant History" || activeTab === "Energy Store" ? (
          <StoredHistoryTab key={activeTab} title={activeTab} port={port} />
        ) : activeTab === "Device Information" ? (
          <DeviceFieldsTab port={port} />
        ) : activeTab === "CAN" ? (
          <CanTab port={port} />
        ) : activeTab === "Import Setting" ? (
          <ImportSettingsTab port={port} deviceName={deviceName} deviceVersion={deviceVersion}
            onUpdateSuccess={onUpdateSuccess} />
        ) : (
          <AboutTab deviceName={deviceName} deviceVersion={deviceVersion} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  error: { color: COLORS.text },
  safe: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  content: {
    flex: 1,
    padding: 12,
    backgroundColor: COLORS.background,
  },
});
