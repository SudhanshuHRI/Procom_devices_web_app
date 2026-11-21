import { unzipSync, zipSync } from 'fflate';
import { fromBase64, toBase64 } from './controllerFiles';

const sizeLimit = 12 * 1024 * 1024;

function checkZipSize(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  const earliest = Math.max(0, end - 65535);
  while (end >= earliest) {
    if (view.getUint32(end, true) === 0x06054b50 &&
        end + 22 + view.getUint16(end + 20, true) === bytes.length) break;
    end--;
  }
  if (end < earliest) throw new Error('Invalid ZIP archive.');
  const entries = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  let total = 0;
  for (let entry = 0; entry < entries; entry++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error('Invalid ZIP directory.');
    }
    total += view.getUint32(offset + 24, true);
    if (total > sizeLimit) throw new Error('The unpacked archive exceeds 12 MB.');
    offset += 46 + view.getUint16(offset + 28, true) +
      view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
}

export const browserFiles = {
  pick() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.addEventListener('cancel', () => resolve(null), { once: true });
      input.addEventListener('change', async () => {
        try {
          const file = input.files[0];
          if (!file) return resolve(null);
          if (file.size > sizeLimit) throw new Error('The selected file exceeds 12 MB.');
          resolve({ name: file.name, base64: toBase64(new Uint8Array(await file.arrayBuffer())) });
        } catch (error) {
          reject(error);
        }
      }, { once: true });
      input.click();
    });
  },

  async unpack(base64) {
    const bytes = fromBase64(base64);
    checkZipSize(bytes);
    return Object.fromEntries(Object.entries(unzipSync(bytes))
      .filter(([name]) => !name.endsWith('/'))
      .map(([name, data]) => [name, toBase64(data)]));
  },

  async pack(files) {
    const encoder = new TextEncoder();
    const entries = Object.fromEntries(Object.entries(files).map(([name, data]) => [name, encoder.encode(data)]));
    return toBase64(zipSync(entries));
  },

  async save(name, mime, base64) {
    const url = URL.createObjectURL(new Blob([fromBase64(base64)], { type: mime }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  },
};
