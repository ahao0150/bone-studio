/**
 * Defaults used by the official sparse-JSON step (`object.compress`) plus the
 * object/array type mapping needed to apply it.
 *
 * Measured from the shipped format classes with an analysis harness
 * (`samples.cjs` → `defaults.json`): the table is format
 * metadata (field defaults), the compression rule is re-implemented here.
 * See 格式规范 / §4.1.
 */
export type JsonRecord = { [key: string]: unknown };

const TRANSFORM = { x: 0, y: 0, skX: 0, skY: 0, scX: 1, scY: 1, pX: 0, pY: 0 };
const COLOR = { aM: 100, rM: 100, gM: 100, bM: 100, aO: 0, rO: 0, gO: 0, bO: 0 };

export const DEFAULTS: Record<string, JsonRecord> = {
  Transform: { ...TRANSFORM },
  Point: { x: 0.5, y: 0.5 },
  Rectangle: { x: 0, y: 0, width: 0, height: 0 },
  ColorTransform: { ...COLOR },
  UserData: { extra: null, ints: [], floats: [], strings: [] },
  Canvas: { extra: null, hasBackground: false, color: -1, x: 0, y: 0, width: 0, height: 0 },
  Action: { extra: null, ints: [], floats: [], strings: [], type: 0, name: '', bone: '', slot: '' },
  DragonBones: {
    extra: null, frameRate: 0, name: '', stage: '', version: '', compatibleVersion: '',
    armature: [], offset: [], tag: [], textureAtlas: [], userData: null,
  },
  Armature: {
    extra: null, type: 'armature', frameRate: 0, name: '', aabb: { x: 0, y: 0, width: 0, height: 0 },
    bone: [], slot: [], ik: [], path: [], skin: [], animation: [], defaultActions: [], actions: [],
    canvas: null, userData: null,
  },
  Bone: {
    extra: null, type: 'bone', inheritTranslation: true, inheritRotation: true, inheritScale: true,
    inheritReflection: true, length: 0, name: '', parent: '', transform: { ...TRANSFORM }, userData: null,
  },
  Slot: {
    extra: null, blendMode: 'normal', displayIndex: 0, name: '', parent: '', color: { ...COLOR },
    actions: [], userData: null,
  },
  Surface: {
    // `new Surface(true)` clears the type, so a real surface bone always keeps `"surface"`
    extra: null, type: '', inheritTranslation: true, inheritRotation: true, inheritScale: true,
    inheritReflection: true, length: 0, name: '', parent: '', offset: -1, segmentX: 0, segmentY: 0,
    vertices: [], transform: { ...TRANSFORM }, userData: null,
  },
  TypeTimeline: { extra: null, scale: 1, offset: 0, name: '', type: 0 },
  IKConstraint: { extra: null, bendPositive: true, chain: 0, weight: 1, name: '', bone: '', target: '' },
  Skin: { extra: null, name: 'default', slot: [], userData: null },
  SkinSlot: { extra: null, name: '', display: [], actions: [] },
  ImageDisplay: {
    extra: null, type: 'image', name: '', transform: { ...TRANSFORM }, path: '', pivot: { x: 0.5, y: 0.5 },
  },
  MeshDisplay: {
    extra: null, type: 'image', name: '', transform: { ...TRANSFORM },
    offset: -1, width: 0, height: 0, path: '', vertices: [], uvs: [], triangles: [], weights: [],
    slotPose: [], bonePose: [], glueWeights: [], glueMeshes: [], edges: [], userEdges: [],
  },
  AnimationBinary: {
    extra: null, duration: 0, playTimes: 1, scale: 1, fadeInTime: 0, name: '', action: -1, zOrder: -1,
    offset: [], bone: {}, surface: {}, slot: {}, constraint: {}, timeline: [],
  },
};

/** Fields the official writer clears after moving mesh geometry into the arrays. */
export const CLEARED_MESH_FIELDS = [
  'width', 'height', 'vertices', 'uvs', 'triangles', 'weights', 'slotPose', 'bonePose', 'edges', 'userEdges',
  // BoneStudio extensions produced by the dbbin reader: never exported
  'bindOffsets', 'weightBones',
] as const;

function childType(key: string, parentType: string | null): string | null {
  switch (parentType) {
    case 'DragonBones':
      return key === 'userData' ? 'UserData' : null;
    case 'Armature':
      if (key === 'aabb') return 'Rectangle';
      if (key === 'canvas') return 'Canvas';
      return null;
    case 'Bone':
    case 'Surface':
    case 'ImageDisplay':
    case 'MeshDisplay':
      return key === 'transform' ? 'Transform' : null;
    case 'ImageDisplay:pivot':
      return 'Point';
    case 'Slot':
      return key === 'color' ? 'ColorTransform' : null;
    default:
      return null;
  }
}

function arrayElementType(key: string, parentType: string | null): string | null {
  switch (parentType) {
    case 'DragonBones':
      return key === 'armature' ? 'Armature' : null;
    case 'Armature':
      if (key === 'bone') return 'Bone';
      if (key === 'slot') return 'Slot';
      if (key === 'ik') return 'IKConstraint';
      if (key === 'skin') return 'Skin';
      if (key === 'animation') return 'AnimationBinary';
      if (key === 'defaultActions' || key === 'actions') return 'Action';
      return null;
    case 'Skin':
      return key === 'slot' ? 'SkinSlot' : null;
    case 'SkinSlot':
      return key === 'display' ? 'ImageDisplay|MeshDisplay' : null;
    case 'Slot':
      return key === 'actions' ? 'Action' : null;
    case 'AnimationBinary':
      return key === 'timeline' ? 'TypeTimeline' : null;
    default:
      return null;
  }
}

function itemType(spec: string | null, item: unknown): string | null {
  if (!spec) return null;
  const type = (item as { type?: unknown } | null)?.type;
  const name = typeof type === 'string' ? type.toLowerCase() : '';
  if (spec === 'Bone') return name === 'surface' || type === 1 ? 'Surface' : 'Bone';
  if (!spec.includes('|')) return spec;
  return name === 'mesh' ? 'MeshDisplay' : 'ImageDisplay';
}

/**
 * Re-implementation of the official `object.compress`:
 * drop `_`-prefixed internals, drop scalars equal to the type default, recurse,
 * and drop children that are entirely default. Returns true when the node is
 * "all defaults" so the parent may drop the key.
 */
export function compressInPlace(node: unknown, typeName: string | null = null): boolean {
  if (node === null || typeof node !== 'object') return false;
  if (Array.isArray(node)) {
    // `typeName` here is the element type spec handed down by the parent key
    for (const item of node) {
      if (item !== null && typeof item === 'object') {
        compressInPlace(item, typeName ? itemType(typeName, item) : null);
      }
    }
    return node.length === 0;
  }
  const record = node as JsonRecord;
  const defaults = typeName ? DEFAULTS[typeName] ?? null : null;
  let kept = 0;
  for (const key of Object.keys(record)) {
    if (key.startsWith('_')) {
      delete record[key];
      continue;
    }
    const value = record[key];
    if (value === undefined) {
      delete record[key];
      continue;
    }
    const valueType = typeof value;
    if (defaults && (value === null || valueType === 'boolean' || valueType === 'number' || valueType === 'string')) {
      const fallback = defaults[key];
      const sameNumber = valueType === 'number' && typeof fallback === 'number'
        && (value === fallback || (Number.isNaN(value as number) && Number.isNaN(fallback)));
      if (value === fallback || sameNumber) {
        delete record[key];
        continue;
      }
    } else if (value !== null && valueType === 'object') {
      const child = Array.isArray(value) ? arrayElementType(key, typeName) : childType(key, typeName);
      if (compressInPlace(value, child)) {
        // an empty array survives when the class flags it as intentional (`_key`)
        const flagged = Array.isArray(value) && Boolean(record[`_${key}`]);
        if (!flagged) delete record[key];
        continue;
      }
    }
    kept++;
  }
  return kept === 0;
}


/**
 * Rebuild the tree in the official class field order (the writer's JSON key
 * order comes from the class constructors, not from the input file).
 */
export function canonicalizeJson(node: unknown, typeName: string | null = null): unknown {
  if (node === null || typeof node !== 'object') return node;
  if (Array.isArray(node)) {
    return node.map((item) => (item !== null && typeof item === 'object'
      ? canonicalizeJson(item, typeName ? itemType(typeName, item) : null)
      : item));
  }
  const record = node as JsonRecord;
  const order = typeName ? Object.keys(DEFAULTS[typeName] ?? {}) : [];
  const out: JsonRecord = {};
  for (const key of order) {
    if (key in record) {
      out[key] = canonicalizeJson(record[key], Array.isArray(record[key]) ? arrayElementType(key, typeName) : childType(key, typeName));
    }
  }
  for (const key of Object.keys(record)) {
    if (key in out) continue;
    out[key] = canonicalizeJson(record[key], Array.isArray(record[key]) ? arrayElementType(key, typeName) : childType(key, typeName));
  }
  return out;
}

