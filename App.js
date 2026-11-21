import React, { useRef, useState } from "react";
import { Alert } from "./src/services/browserAlert";

import HomePage from "./src/pages/HomePage";
import DevicePage from "./src/pages/DevicePage";
import PulseLoader from "./src/components/PulseLoader";

import {
  cancelUsbRequests,
  decodeDeviceText,
  openUsbPort,
  sendCommandAndGetResponse,
  setupUsbReceiver,
} from "./src/services/usbService";

export default function App() {
  const [port, setPort] = useState(null);
  const [currentPage, setCurrentPage] = useState("home");
  const [deviceName, setDeviceName] = useState("");
  const [deviceVersion, setDeviceVersion] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [loaderText, setLoaderText] = useState("");

  const rxSubRef = useRef(null);
  const portRef = useRef(null);
  const connectingRef = useRef(false);

  async function disconnect() {
    const current = portRef.current;
    portRef.current = null;
    cancelUsbRequests(current);
    rxSubRef.current?.remove?.();
    rxSubRef.current = null;
    await current?.close()?.catch(() => {});
    setPort(null);
    setDeviceName("");
    setDeviceVersion("");
    setCurrentPage("home");
  }

  async function finishSettingsUpdate() {
    await disconnect();
    Alert.alert("Settings acknowledged", "Reconnect the controller and tap Connect Device to read back the settings.");
  }

  const connectDevice = async () => {
    if (connectingRef.current) return;
    connectingRef.current = true;
    try {
      setLoaderText("Connecting device...");
      setIsConnecting(true);

      const usbResult = await openUsbPort();

      if (!usbResult) {
        return;
      }

      const { usbPort } = usbResult;

      rxSubRef.current?.remove?.();

      rxSubRef.current = setupUsbReceiver(usbPort, (error) => {
        if (portRef.current !== usbPort || connectingRef.current) return;
        disconnect().then(() => Alert.alert("USB connection lost", error.message));
      });

      portRef.current = usbPort;
      setPort(usbPort);

      setLoaderText("Reading device name...");

      const nameResponse = await sendCommandAndGetResponse(
        usbPort,
        new Uint8Array([0x00, 0x16, 0x00, 0x00]),
      );

      let detectedDeviceName = decodeDeviceText(nameResponse);

      if (detectedDeviceName === "DGC-2024Din Star") {
        detectedDeviceName = "DGC-2024";
      }

      setLoaderText("Reading device version...");

      const versionResponse = await sendCommandAndGetResponse(
        usbPort,
        new Uint8Array([0x00, 0x17, 0x00, 0x00]),
      );

      const detectedDeviceVersion = decodeDeviceText(versionResponse);

      setDeviceName(detectedDeviceName);
      setDeviceVersion(detectedDeviceVersion);

      const normalizedDeviceName = detectedDeviceName
        .toUpperCase()
        .replace(/\s+/g, "-")
        .trim();

      setIsConnecting(false);

      Alert.alert(
        "Success",
        `Device connected successfully.\n\nDevice: ${detectedDeviceName}\nVersion: ${detectedDeviceVersion}`,
      );

      if (
        normalizedDeviceName.includes("ECON-MAN-IND") ||
        normalizedDeviceName.includes("ECON-MAN-INDUS")
      ) {
        setCurrentPage("econ-man-indus");
      } else if (
        normalizedDeviceName.includes("DGC") ||
        normalizedDeviceName.includes("DGC-2024")
      ) {
        setCurrentPage("dgc");
      } else {
        await disconnect();
        Alert.alert(
          "Unknown Device",
          `Unsupported device detected:\n\n${detectedDeviceName}`,
        );
      }
    } catch (error) {
      await disconnect();
      setIsConnecting(false);

      Alert.alert(
        "Connection Failed",
        `Device could not be connected.\n\n${error.message}`,
      );
    } finally {
      connectingRef.current = false;
      setIsConnecting(false);
    }
  };

  if (currentPage === "econ-man-indus" || currentPage === "dgc") {
    return (
      <>
        <DevicePage
          title={currentPage === "dgc" ? "DGC" : "ECON-MAN-INDUS"}
          deviceName={deviceName}
          deviceVersion={deviceVersion}
          onBack={disconnect}
          port={port}
          onUpdateSuccess={finishSettingsUpdate}
        />
      </>
    );
  }

  return (
    <>
      <HomePage onConnectDevice={connectDevice} />

      {isConnecting && <PulseLoader text={loaderText} />}
    </>
  );
}
