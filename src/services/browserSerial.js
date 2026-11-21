export const CONTROLLER_ID = { usbVendorId: 0x0483, usbProductId: 0x5740 };

function serialApi() {
  if (!navigator.serial) {
    throw new Error('Web Serial is unavailable. Open this app in desktop Chrome on localhost or HTTPS.');
  }
  return navigator.serial;
}

export async function requestPort(filter) {
  try {
    return await serialApi().requestPort(filter ? { filters: [filter] } : undefined);
  } catch (error) {
    if (error.name === 'NotFoundError') return null;
    throw error;
  }
}

const adapterIds = new WeakMap();
const adapters = new Map();
let nextAdapterId = 1;

export async function listSerialAdapters() {
  const selected = await requestPort();
  const ports = await serialApi().getPorts();
  if (selected && !ports.includes(selected)) ports.push(selected);
  adapters.clear();
  const records = [];
  for (const port of ports) {
    const { usbVendorId, usbProductId } = port.getInfo();
    if (usbVendorId === CONTROLLER_ID.usbVendorId && usbProductId === CONTROLLER_ID.usbProductId) continue;
    if (!adapterIds.has(port)) adapterIds.set(port, nextAdapterId++);
    const deviceId = adapterIds.get(port);
    adapters.set(deviceId, port);
    const label = usbVendorId == null
      ? `Serial port (ID ${deviceId})`
      : `USB ${usbVendorId.toString(16)}:${usbProductId.toString(16)} (ID ${deviceId})`;
    records.push({ deviceId, label });
  }
  return records;
}

export function openSerialAdapter(deviceId, baudRate, parity, stopBits) {
  const port = adapters.get(deviceId);
  if (!port) throw new Error('Select a serial adapter first.');
  return openBrowserPort(port, { baudRate, parity: parity.toLowerCase(), stopBits });
}

export async function openBrowserPort(port, options) {
  await port.open({ dataBits: 8, parity: 'none', stopBits: 1, ...options });
  const reader = port.readable.getReader();
  const listeners = new Set();
  const disconnectListeners = new Set();
  let closing;
  let lost = false;

  function notifyDisconnect(error) {
    if (closing || lost) return;
    lost = true;
    for (const listener of disconnectListeners) listener(error);
  }

  const onDisconnect = () => notifyDisconnect(new Error('The serial device was disconnected.'));
  port.addEventListener('disconnect', onDisconnect);

  async function receive() {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value?.length) continue;
        const data = Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
        for (const listener of listeners) listener({ data });
      }
      onDisconnect();
    } catch (error) {
      notifyDisconnect(error);
    } finally {
      reader.releaseLock();
    }
  }

  function subscribe(set, callback) {
    set.add(callback);
    return { remove: () => set.delete(callback) };
  }

  const reading = receive();
  let writing;
  return {
    onReceived: (callback) => subscribe(listeners, callback),
    onDisconnect: (callback) => subscribe(disconnectListeners, callback),
    async send(hex) {
      if (closing || lost || !port.writable) throw new Error('The serial connection is closed.');
      const writer = port.writable.getWriter();
      try {
        const bytes = Uint8Array.from(hex.match(/.{2}/g), (byte) => parseInt(byte, 16));
        writing = writer.write(bytes);
        await writing;
      } finally {
        writer.releaseLock();
        writing = undefined;
      }
    },
    close() {
      closing ??= Promise.resolve().then(async () => {
        port.removeEventListener('disconnect', onDisconnect);
        listeners.clear();
        disconnectListeners.clear();
        await reader.cancel().catch(() => {});
        await reading;
        await writing?.catch(() => {});
        await port.close();
      });
      return closing;
    },
  };
}
