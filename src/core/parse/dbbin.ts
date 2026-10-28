/**
 * DragonBones binary container (`*_ske.dbbin`) reader.
 *
 * Layout verified against an artifact produced by the shipped official tool
 * (`tools/convertTo.js -t binary`); see 格式规范 and §9.
 */
export type BinaryArrayKind = 'int16' | 'uint16' | 'float32';

export interface BinaryArraySection {
  name: string;
  kind: BinaryArrayKind;
  byteOffset: number;
  byteLength: number;
  elementCount: number;
}

export interface DbbinMeta {
  /** the 4-byte field at offset 4 (`00 00 00 02` → major binary version 2) */
  binaryVersion: number;
  /** length stored at offset 8: embedded JSON plus its 0x20 padding */
  jsonLength: number;
  jsonStart: number;
  arraysStart: number;
  /** the 14-entry offset table carried inside the JSON */
  offsets: number[];
  arrays: BinaryArraySection[];
}

export interface DbbinDocument {
  /** sparse DragonBones JSON (defaults omitted), same shape as `*_ske.json` */
  json: unknown;
  meta: DbbinMeta;
}

const MAGIC = 'DBDT';
const JSON_START = 12;
const BYTES_PER_ELEMENT: Record<BinaryArrayKind, number> = { int16: 2, uint16: 2, float32: 4 };

const SECTIONS: Array<[string, BinaryArrayKind]> = [
  ['intArray', 'int16'],
  ['floatArray', 'float32'],
  ['frameIntArray', 'int16'],
  ['frameFloatArray', 'float32'],
  ['frameArray', 'int16'],
  ['timelineArray', 'uint16'],
  ['colorArray', 'int16'],
];

export function isDbbin(bytes: Uint8Array): boolean {
  return bytes.length > JSON_START
    && String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === MAGIC;
}

export function parseDbbin(input: ArrayBuffer | Uint8Array): DbbinDocument {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!isDbbin(bytes)) throw new Error('dbbin: 缺少 "DBDT" 魔数');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const binaryVersion = ((bytes[4] << 24) | (bytes[5] << 16) | (bytes[6] << 8) | bytes[7]) >>> 0;
  const jsonLength = view.getUint32(8, true);
  if (JSON_START + jsonLength > bytes.length) {
    throw new Error(`dbbin: 内嵌 JSON 长度越界（${jsonLength} > ${bytes.length - JSON_START}）`);
  }
  const text = new TextDecoder('utf-8').decode(bytes.subarray(JSON_START, JSON_START + jsonLength))
    .replace(/ +$/, '');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`dbbin: 内嵌 JSON 解析失败（${(error as Error).message}）`);
  }
  const offsets = Array.isArray((json as { offset?: number[] }).offset)
    ? ((json as { offset: number[] }).offset).slice()
    : [];
  const arraysStart = JSON_START + jsonLength;
  const arrays: BinaryArraySection[] = SECTIONS.map(([name, kind], index) => {
    const byteOffset = offsets[index * 2] ?? 0;
    const byteLength = offsets[index * 2 + 1] ?? 0;
    return { name, kind, byteOffset, byteLength, elementCount: byteLength / BYTES_PER_ELEMENT[kind] };
  });
  return { json, meta: { binaryVersion, jsonLength, jsonStart: JSON_START, arraysStart, offsets, arrays } };
}

/** Decode one section into a typed array (used by tests and the future writer). */
export function readBinarySection(
  bytes: Uint8Array,
  meta: DbbinMeta,
  name: string,
): Int16Array | Uint16Array | Float32Array | null {
  const section = meta.arrays.find((entry) => entry.name === name);
  if (!section || section.byteLength === 0) return null;
  const start = meta.arraysStart + section.byteOffset;
  const end = start + section.byteLength;
  if (end > bytes.length) throw new Error(`dbbin: 段 ${name} 越界`);
  // `bytes` may be a Node Buffer (a view with a byteOffset), so copy the section
  // into a fresh, byteOffset-0 buffer before creating the typed array view.
  const copy = new Uint8Array(bytes.subarray(start, end));
  if (section.kind === 'float32') return new Float32Array(copy.buffer, 0, section.elementCount);
  if (section.kind === 'uint16') return new Uint16Array(copy.buffer, 0, section.elementCount);
  return new Int16Array(copy.buffer, 0, section.elementCount);
}

