import { browserFiles } from './browserFiles';

const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const namespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relationships = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const files = () => browserFiles;

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function fromBase64(value) {
  const output = [];
  for (let i = 0; i < value.length; i += 4) {
    const a = alphabet.indexOf(value[i]);
    const b = alphabet.indexOf(value[i + 1]);
    const c = alphabet.indexOf(value[i + 2]);
    const d = alphabet.indexOf(value[i + 3]);
    output.push((a << 2) | (b >> 4));
    if (c >= 0) output.push(((b & 15) << 4) | (c >> 2));
    if (d >= 0) output.push(((c & 3) << 6) | d);
  }
  return Uint8Array.from(output);
}

export function toBase64(bytes) {
  let output = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b = 0, c = 0] = bytes.subarray(i, i + 3);
    output += alphabet[a >> 2] + alphabet[((a & 3) << 4) | (b >> 4)] +
      (i + 1 < bytes.length ? alphabet[((b & 15) << 2) | (c >> 6)] : '=') +
      (i + 2 < bytes.length ? alphabet[c & 63] : '=');
  }
  return output;
}

export const decodeText = (bytes) => decodeURIComponent(
  Array.from(bytes, (byte) => '%' + byte.toString(16).padStart(2, '0')).join(''),
);
export const encodeText = (value) => Uint8Array.from(
  encodeURIComponent(value).match(/%[0-9A-F]{2}|./g) ?? [],
  (character) => character.length === 3 ? parseInt(character.slice(1), 16) : character.charCodeAt(0),
);

export async function pickControllerFiles() {
  const selected = await files().pick();
  if (!selected) return null;
  if (/\.zip$/i.test(selected.name)) return files().unpack(selected.base64);
  return { [selected.name]: selected.base64 };
}

export function unpackControllerZip(base64) {
  return files().unpack(base64);
}

export function saveBinary(name, bytes) {
  return files().save(name, 'application/octet-stream', toBase64(bytes));
}

const xml = (value) => String(value ?? '').replace(/[<>&"']/g, (match) => ({
  '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
})[match]).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');

function columnLabel(index) {
  let label = '';
  for (let position = index + 1; position > 0; position = Math.floor((position - 1) / 26)) {
    label = String.fromCharCode(65 + (position - 1) % 26) + label;
  }
  return label;
}

export async function saveWorkbook(name, sheets) {
  const document = {};
  const entries = Object.entries(sheets);
  const relation = (id, type, target) => `<Relationship Id="${id}" Type="${relationships}/${type}" Target="${target}"/>`;
  const relations = (items) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.join('')}</Relationships>`;
  const type = (file, content) => `<Override PartName="/${file}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.${content}+xml"/>`;
  document['[Content_Types].xml'] = `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${type('xl/workbook.xml', 'sheet.main')}${entries.map((_, index) => type(`xl/worksheets/sheet${index + 1}.xml`, 'worksheet')).join('')}</Types>`;
  document['_rels/.rels'] = relations([relation('rId1', 'officeDocument', 'xl/workbook.xml')]);
  document['xl/_rels/workbook.xml.rels'] = relations(entries.map((_, index) =>
    relation(`rId${index + 1}`, 'worksheet', `worksheets/sheet${index + 1}.xml`)));
  document['xl/workbook.xml'] = `<workbook xmlns="${namespace}" xmlns:r="${relationships}"><sheets>${entries.map(([label], index) =>
    `<sheet name="${xml(label.slice(0, 31))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`;

  entries.forEach(([, records], index) => {
    const headers = [...new Set(records.flatMap(Object.keys))];
    const values = [headers, ...records.map((record) => headers.map((key) => record[key]))];
    const rows = values.map((row, y) => `<row r="${y + 1}">${row.map((value, x) => {
      const coordinate = columnLabel(x) + (y + 1);
      return typeof value === 'number' && Number.isFinite(value)
        ? `<c r="${coordinate}"><v>${value}</v></c>`
        : `<c r="${coordinate}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
    }).join('')}</row>`).join('');
    document[`xl/worksheets/sheet${index + 1}.xml`] = `<worksheet xmlns="${namespace}"><sheetData>${rows}</sheetData></worksheet>`;
  });
  return files().save(`${name}.xlsx`, MIME, await files().pack(document));
}

const unxml = (value) => value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) =>
  entity.startsWith('#') ? String.fromCodePoint(entity[1] === 'x'
    ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)))
    : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[entity]);
const textRuns = (value) => Array.from(value.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g),
  (match) => unxml(match[1])).join('');

export async function readWorkbookRows(base64) {
  const archive = await files().unpack(base64);
  const read = (key) => archive[key] ? decodeText(fromBase64(archive[key])) : '';
  const shared = Array.from(read('xl/sharedStrings.xml').matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g),
    (match) => textRuns(match[1]));
  const sheet = read('xl/worksheets/sheet1.xml');
  if (!sheet) throw new Error('The workbook has no first worksheet.');
  return Array.from(sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g), ([, content]) => {
    const cells = [];
    for (const [, properties, value] of content.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const column = /\br="([A-Z]+)\d+"/.exec(properties)?.[1];
      if (!column || !value) continue;
      const index = [...column].reduce((number, char) => number * 26 + char.charCodeAt(0) - 64, 0) - 1;
      const type = /\bt="([^"]+)"/.exec(properties)?.[1];
      const raw = /<v>([\s\S]*?)<\/v>/.exec(value)?.[1] ?? '';
      cells[index] = type === 's' ? shared[Number(raw)] : type === 'inlineStr' ? textRuns(value) : unxml(raw);
    }
    return cells;
  });
}
