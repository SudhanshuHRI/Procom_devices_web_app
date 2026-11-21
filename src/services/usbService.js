import { openBrowserPort, requestPort, CONTROLLER_ID } from './browserSerial';

export const bytesToHexString = bytes => {
  return Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
};

export const hexStringToBytes = hexString => {
  const cleanHex = String(hexString).replace(/[^a-fA-F0-9]/g, '');
  const bytes = [];

  for (let i = 0; i < cleanHex.length; i += 2) {
    const hexByte = cleanHex.slice(i, i + 2);

    if (hexByte.length === 2) {
      bytes.push(parseInt(hexByte, 16));
    }
  }

  return bytes;
};

export const decodeDeviceText = responseHex => {
  const bytes = hexStringToBytes(responseHex);
  const printableBytes = bytes.filter(byte => byte >= 0x20 && byte <= 0x7e);

  const decoded = printableBytes
    .map(byte => String.fromCharCode(byte))
    .join('');

  return decoded.replace(/^@/, '').replace(/\0/g, '').trim();
};

export const openUsbPort = async () => {
  const port = await requestPort(CONTROLLER_ID);
  if (!port) return null;
  return { usbPort: await openBrowserPort(port, { baudRate: 115200 }) };
};

export const pendingResponseRef = {
  current: null,
};
const exclusivePorts = new WeakMap();
const exclusiveOwners = new WeakMap();
const closedPorts = new WeakSet();
const transportListeners = new WeakMap();
export const hasExclusiveUsbOperation = (port) => exclusivePorts.has(port);

export function cancelUsbRequests(port) {
  const pending = pendingResponseRef.current;
  if (!pending || (pending.port !== port && pending.port !== exclusivePorts.get(port))) return;
  clearTimeout(pending.overallTimeoutId);
  clearTimeout(pending.idleTimeoutId);
  pendingResponseRef.current = null;
  pending.reject(new Error('The controller was disconnected.'));
}

export async function withExclusiveUsb(port, operation) {
  if (!port) throw new Error('Port not connected');
  if (exclusivePorts.has(port) || pendingResponseRef.current) {
    throw new Error('The controller is busy. Wait for the current request to finish.');
  }
  const exclusive = { send: (data) => port.send(data) };
  exclusivePorts.set(port, exclusive);
  exclusiveOwners.set(exclusive, port);
  try {
    return await operation(exclusive);
  } finally {
    exclusivePorts.delete(port);
    exclusiveOwners.delete(exclusive);
  }
}

export const setupUsbReceiver = (usbPort, onTransportLost) => {
  if (onTransportLost) transportListeners.set(usbPort, onTransportLost);
  const disconnectSubscription = usbPort.onDisconnect?.((error) => {
    closedPorts.add(usbPort);
    cancelUsbRequests(usbPort);
    onTransportLost?.(error);
  });
  const subscription = usbPort.onReceived((event) => {
    const receivedHex = String(event.data);

    const pending = pendingResponseRef.current;

    if (pending && (pending.port === usbPort || pending.port === exclusivePorts.get(usbPort))) {
      pending.frames.push(receivedHex);

      clearTimeout(pending.idleTimeoutId);

      pending.idleTimeoutId = setTimeout(() => {
        if (pendingResponseRef.current !== pending) return;
        clearTimeout(pending.overallTimeoutId);

        pendingResponseRef.current = null;

        pending.resolve(pending.frames.join("\n"));
      }, pending.idleMs);
    }
  });
  return {
    remove() {
      transportListeners.delete(usbPort);
      disconnectSubscription?.remove();
      subscription.remove();
    },
  };
};

export const sendCommandAndGetResponse = async (
  usbPort,
  command,
  overallTimeoutMs = 5000,
  idleMs = 300,
) => {
  if (!usbPort) {
    throw new Error("Port not connected");
  }

  if (exclusivePorts.has(usbPort)) {
    throw new Error("The controller is busy with another operation.");
  }

  if (pendingResponseRef.current) {
    throw new Error("Another command is already waiting for response");
  }

  const owner = exclusiveOwners.get(usbPort) ?? usbPort;
  if (closedPorts.has(owner)) {
    throw new Error('The USB connection is closed. Reconnect the controller before trying again.');
  }
  if (!(command instanceof Uint8Array) || command.length < 4) {
    throw new Error('Invalid USB command frame.');
  }
  const commandHex = bytesToHexString(command);

  return new Promise((resolve, reject) => {
    const pending = {
      port: usbPort,
      frames: [],
      resolve,
      reject,
      overallTimeoutId: null,
      idleTimeoutId: null,
      idleMs,
    };
    pendingResponseRef.current = pending;
    pending.overallTimeoutId = setTimeout(() => {
      if (pendingResponseRef.current !== pending) return;
      clearTimeout(pending.idleTimeoutId);
      pendingResponseRef.current = null;
      if (pending.frames.length) resolve(pending.frames.join("\n"));
      else reject(new Error("Response timeout"));
    }, overallTimeoutMs);
    Promise.resolve().then(() => {
      if (pendingResponseRef.current === pending) return usbPort.send(commandHex);
    }).catch((cause) => {
      if (pendingResponseRef.current !== pending) return;
      clearTimeout(pending.overallTimeoutId);
      clearTimeout(pending.idleTimeoutId);
      pendingResponseRef.current = null;
      const error = new Error(
        'The browser could not send data over USB. Reconnect the controller before trying again.',
        { cause },
      );
      closedPorts.add(owner);
      reject(error);
      transportListeners.get(owner)?.(error);
    });
  });
};

export const hexResponseToHexArray = (response) => {
  return String(response)
    .replace(/\n/g, "")
    .match(/.{1,2}/g)
    ?.map((byte) => `0x${byte.toUpperCase()}`) || [];
};
