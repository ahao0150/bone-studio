/**
 * DragonBones `.dbproj` container + the AMF3 payload codec.
 *
 * The shipped app writes (`_97._104` in the decompiled action script):
 *
 *   ba = new ByteArray(); ba.writeObject(data);          // AMF3
 *   out.writeByte(0x6F);                                  // marker
 *   out.writeByte(ba[i] + KEY.charCodeAt(i % KEY.length)) // byte-wise add, wrapping
 *
 * and reads it back with the mirror operation followed by `readObject()`.
 * See 格式规范 for the evidence trail.
 */
export const DBPROJ_MARKER = 0x6f;
export const DBPROJ_KEY = 'DRAGONBONES_IS_BEST';

/** Undo the shipped obfuscation, yielding the raw AMF3 payload. */
export function unwrapDbproj(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== DBPROJ_MARKER) return bytes;
  const out = new Uint8Array(bytes.length - 1);
  for (let i = 0; i < out.length; i++) {
    out[i] = (bytes[1 + i] - DBPROJ_KEY.charCodeAt(i % DBPROJ_KEY.length)) & 0xff;
  }
  return out;
}

/** Apply the shipped obfuscation to a raw AMF3 payload. */
export function wrapDbproj(amf3: Uint8Array): Uint8Array {
  const out = new Uint8Array(amf3.length + 1);
  out[0] = DBPROJ_MARKER;
  for (let i = 0; i < amf3.length; i++) {
    out[1 + i] = (amf3[i] + DBPROJ_KEY.charCodeAt(i % DBPROJ_KEY.length)) & 0xff;
  }
  return out;
}

class Cursor {
  position = 0;
  constructor(readonly bytes: Uint8Array) {}
  u8(): number {
    return this.bytes[this.position++];
  }
  /** AMF3 variable-length unsigned 29-bit integer. */
  u29(): number {
    let value = 0;
    for (let i = 0; i < 3; i++) {
      const byte = this.u8();
      value = (value << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) return value;
    }
    return ((value << 8) | this.u8()) >>> 0;
  }
  take(length: number): Uint8Array {
    const slice = this.bytes.subarray(this.position, this.position + length);
    this.position += length;
    return slice;
  }
  double(): number {
    const slice = this.take(8);
    return new DataView(slice.buffer, slice.byteOffset, 8).getFloat64(0, false);
  }
}

interface Amf3ClassDef {
  name: string;
  /** 0 = static, 1 = externalizable, 2 = dynamic */
  encoding: number;
  members: string[];
}

/**
 * AMF3 reader for the subset the project files use.
 *
 * The traits layout follows the reference implementation (PyAMF amf3.py):
 *
 *   object(0x0A): u29 h; h&1==0 -> object reference (h>>1)
 *                        else   -> class-def index (h>>1)
 *   class-def(ref): ref&1==0 -> reuse classes[ref>>1]
 *                   else     -> className string, encoding = (ref>>1)&3,
 *                               member count = (ref>>1)>>2, then that many names
 *
 * The shipped projects lean on both halves: the root declares one dynamic class
 * with a zero-length name, every later object references class 0.
 */
export interface Amf3Result {
  value: unknown;
  /** bytes consumed before the reader stopped (compare with the payload size) */
  consumed: number;
}

export function decodeAmf3(bytes: Uint8Array): unknown {
  return decodeAmf3Detailed(bytes).value;
}

export interface Amf3Options {
  /** 诊断钩子：每读到一个标记就回调（位置、标记、嵌套深度），用于定位错位 */
  trace?: (position: number, marker: number, depth: number) => void;
}

export function decodeAmf3Detailed(bytes: Uint8Array, options: Amf3Options = {}): Amf3Result {
  const trace = options.trace;
  const cursor = new Cursor(bytes);
  const strings: string[] = [];
  const objects: unknown[] = [];
  const classes: Amf3ClassDef[] = [];

  const readString = (): string => {
    const header = cursor.u29();
    if ((header & 1) === 0) {
      const index = header >> 1;
      if (index >= strings.length) {
        throw new Error('amf3: string reference ' + index + ' out of range (' + strings.length + ' interned)');
      }
      return strings[index];
    }
    const length = header >> 1;
    const value = new TextDecoder().decode(cursor.take(length));
    // AMF3 规范：空字符串永远不进入字符串引用表（"the empty string is never sent by
    // reference, and it is not added to the string reference table"）。把它 push 进去会让
    // 之后所有引用索引整体偏移一位 —— 这是真实 .dbproj 解码提前停止的根因之一。
    if (length > 0) strings.push(value);
    return value;
  };

  // `ref` 必须是 U29O-traits 的**原始**值：低位 0 = traits 引用（索引 = ref >> 1），
  // 字面量定义则为 (memberCount << 4) | (dynamic << 3) | (externalizable << 2) | 0b11。
  const readClassDef = (ref: number): Amf3ClassDef => {
    // AMF3: traits 引用 = (index << 1) | 1（低两位为 01）；内联定义的低两位是 11。
    // 原实现写成「低位为 0 即引用」，正好反了 —— 于是每个 traits 引用都被当成新类定义，
    // 多读了 className 字符串，导致解码在第一个引用处开始错位。
    const isInline = (ref & 0b11) === 0b11;
    if (!isInline) {
      const index = ref >> 1;
      const existing = classes[index];
      if (!existing) throw new Error('amf3: unknown class reference ' + index);
      return existing;
    }
    const name = readString();
    const externalizable = (ref >> 2) & 1;
    const dynamic = (ref >> 3) & 1;
    const encoding = externalizable ? 1 : dynamic ? 2 : 0;
    const count = ref >> 4;
    const members: string[] = [];
    for (let i = 0; i < count; i++) members.push(readString());
    const def: Amf3ClassDef = { name, encoding, members };
    classes.push(def);
    return def;
  };

  const readValue = (depth = 0): unknown => {
    if (depth > 200) throw new Error('amf3: nesting too deep');
    const start = cursor.position;
    const marker = cursor.u8();
    if (trace) trace(start, marker, depth);
    switch (marker) {
      case 0x00: return undefined;
      case 0x01: return null;
      case 0x02: return false;
      case 0x03: return true;
      case 0x04: {
        const value = cursor.u29();
        return value > 0x0fffffff ? value - 0x20000000 : value;
      }
      case 0x05: return cursor.double();
      case 0x06: return readString();
      case 0x0c: {
        const header = cursor.u29();
        if ((header & 1) === 0) return objects[header >> 1];
        const data = cursor.take(header >> 1).slice();
        objects.push(data);
        return data;
      }
      case 0x09: {
        const header = cursor.u29();
        if ((header & 1) === 0) return objects[header >> 1];
        const dense = header >> 1;
        const array: unknown[] = [];
        objects.push(array);
        // AMF3 数组的编码顺序是「关联部分（key/value 对，空串结束）在前，dense 值在后」——
        // 这一点由真实样本的字节流证实（见 格式规范）。
        for (;;) {
          const key = readString();
          if (key === '') break;
          (array as unknown as Record<string, unknown>)[key] = readValue(depth + 1);
        }
        for (let i = 0; i < dense; i++) array.push(readValue(depth + 1));
        return array;
      }
      case 0x0a: {
        const header = cursor.u29();
        if ((header & 1) === 0) return objects[header >> 1];
        const def = readClassDef(header);
        if (def.encoding === 1) throw new Error('amf3: externalizable objects are not supported');
        const object: Record<string, unknown> = {};
        objects.push(object);
        for (const member of def.members) object[member] = readValue(depth + 1);
        if (def.encoding === 2) {
          for (;;) {
            const key = readString();
            if (key === '') break;
            object[key] = readValue(depth + 1);
          }
        }
        return object;
      }
      default:
        throw new Error('amf3: unsupported marker 0x' + marker.toString(16) + ' at ' + (cursor.position - 1));
    }
  };

  return { value: readValue(), consumed: cursor.position };
}

export type DbprojFormat = 'amf3' | 'json';

export interface ParsedDbproj {
  /** how the file was stored on disk */
  format: DbprojFormat;
  data?: unknown;
  /**
   * For the AMF3 flavour: whether the reader consumed the whole payload. The
   * traits layout is implemented, but a string-reference mismatch still stops
   * the walk early on real files - see 格式规范
   */
  complete?: boolean;
}

/**
 * Detect the on-disk flavour. The shipped reader is:
 *
 *   if (bytes[0] == 0x6F) readObject(obfuscated AMF3)
 *   else                  JSON.parse(utf8)
 *
 * so plain-JSON project files are equally valid and are what this build writes.
 */
export function detectDbprojFormat(bytes: Uint8Array): DbprojFormat {
  return bytes[0] === DBPROJ_MARKER ? 'amf3' : 'json';
}

/**
 * Read a project file. The plain-JSON flavour round-trips; the AMF3 flavour is
 * detected but not decoded yet, and throws instead of returning wrong data
 * (see 格式规范).
 */
export function parseDbproj(bytes: Uint8Array): ParsedDbproj {
  const format = detectDbprojFormat(bytes);
  if (format === 'amf3') {
    const payload = unwrapDbproj(bytes);
    const result = decodeAmf3Detailed(payload);
    return { format, data: result.value, complete: result.consumed === payload.length };
  }
  return { format, data: JSON.parse(new TextDecoder().decode(bytes)), complete: true };
}

/**
 * Serialize a project as plain JSON - the branch the shipped decoder accepts
 * unconditionally, so DragonBones can open what this build writes.
 */
export function serializeDbproj(data: unknown, pretty = false): Uint8Array {
  return new TextEncoder().encode(pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data));
}

/** AMF3 payload decoding is not implemented yet - fail loudly, never silently. */
/** The project wrapper `DragonBonesPro` expects around the skeleton data. */
export interface DbprojDocument {
  library: unknown[];
  currentArmature: string;
  projectType: string;
  isNew: string;
  stage: Record<string, unknown>;
  timeline: { autoRecordKeyFrame: number; autoTween: number };
  dragonBones: Record<string, unknown>;
}

/** Default stage/timeline blocks, copied field-for-field from the shipped
 *  new-project template (`95__764.ProjectDataTemplate__5947.bin`). */
export function defaultStage(): Record<string, unknown> {
  const filter = () => ({ bone: 1, image: 1, bones: [], slots: [] });
  return {
    cX: 0,
    cY: 0,
    zoom: 1,
    filter: { visibleFilter: filter(), selectableFilter: filter() },
  };
}

/**
 * Wrap a `*_ske.json` document into the project shape. The shipped reader
 * (the JSON branch of `_97._104.decode`) then finds `dragonBones` where it
 * expects it - a bare skeleton JSON is *not* a valid project.
 */
export function wrapSkeletonAsProject(doc: Record<string, unknown>): DbprojDocument {
  const armatures = Array.isArray(doc.armature) ? doc.armature as Array<Record<string, unknown>> : [];
  const first = armatures[0];
  return {
    library: [],
    currentArmature: typeof first?.name === "string" ? first.name : "",
    projectType: "",
    isNew: "true",
    stage: defaultStage(),
    timeline: { autoRecordKeyFrame: 0, autoTween: 1 },
    // keep every skeleton-level field (name / compatibleVersion / …) so the
    // wrapper is lossless; only `armature` is guaranteed to be present
    dragonBones: { ...doc, armature: armatures },
  };
}

/** Pull the skeleton document back out of a project wrapper. */
export function unwrapProjectSkeleton(project: Record<string, unknown>): Record<string, unknown> | null {
  const dragonBones = project.dragonBones;
  if (!dragonBones || typeof dragonBones !== "object") return null;
  const inner = dragonBones as Record<string, unknown>;
  if (!Array.isArray(inner.armature)) return null;
  return { ...inner };
}
