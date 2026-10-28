/**
 * Decode a DragonBones binary export (`*_ske.dbbin`) into the same document
 * shape `parseSkeletonData` consumes.
 *
 * The binary keeps a sparse JSON (defaults removed) plus typed arrays that hold
 * mesh geometry and animation timelines. This module re-inflates the parts the
 * runtime needs; see 格式规范 for the layout evidence.
 */
import { parseDbbin, readBinarySection, type DbbinDocument, type DbbinMeta } from './dbbin';
import type {
  DbBoneScaleFrame, DbBoneTimeline, DbBoneTranslateFrame, DbBoneRotateFrame, DbColorTransform,
  DbActionFrame, DbDisplayData, DbFfdFrame, DbFfdTimeline, DbIkFrame, DbIkTimeline, DbZOrderFrame, DbZOrderTimeline,
  DbSlotColorFrame, DbSlotDisplayFrame, DbSlotTimeline, DbTransform, DbSurfaceTimeline,
} from '../types';

const RAD2DEG = 180 / Math.PI;
const TWEEN = { None: 0, Line: 1, Curve: 2, QuadIn: 3, QuadOut: 4, QuadInOut: 5 } as const;
const TIMELINE = {
  Action: 0, ZOrder: 1, BoneAll: 10, BoneTranslate: 11, BoneRotate: 12, BoneScale: 13,
  SlotDisplay: 20, SlotColor: 21, MeshDeform: 22, IKConstraint: 30, Surface: 50,
} as const;

export interface DbbinDecodeStats {
  /** `type: "surface"` vertex grids rebuilt from intArray / floatArray */
  surfaces: number;
  meshes: number;
  weightedMeshes: number;
  timelines: number;
  frames: number;
  /** timeline families that are recognised but not decoded yet */
  pending: string[];
}

export interface DbbinDecodeResult {
  json: unknown;
  meta: DbbinMeta;
  stats: DbbinDecodeStats;
  /**
   * Raw container arrays, exposed for byte-level reconciliation against the
   * official writer (`tools/closure-oracle.ts` uses them to locate layout gaps
   * that never show up in the decoded authoring form).
   */
  arrays: {
    timeline: Uint16Array | null;
    frameInt: Int16Array | null;
    frame: Int16Array | null;
    frameFloat: Float32Array | null;
    int: Int16Array | null;
    float: Float32Array | null;
  };
}

interface RawAnimation {
  name?: string;
  duration?: number;
  offset?: number[];
  bone?: Record<string, number[]> | DbBoneTimeline[];
  slot?: Record<string, number[]>;
  ffd?: Record<string, number[]>;
  /** IK constraint timelines, keyed by constraint name */
  constraint?: Record<string, number[]>;
  /** `Action(0)` timeline offset */
  action?: number;
  frame?: unknown;
  zOrder?: unknown;
  /** `TypeTimeline` refs (`{ offset, name, type }`), e.g. surface deform */
  timeline?: Array<{ offset?: number; name?: string; type?: number }>;
  /** authoring side of `timeline`; filled in by the decoder */
  surface?: unknown;
}

export function decodeDbbin(input: ArrayBuffer | Uint8Array): DbbinDecodeResult {
  const container: DbbinDocument = parseDbbin(input);
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const intArray = readBinarySection(bytes, container.meta, 'intArray') as Int16Array | null;
  const floatArray = readBinarySection(bytes, container.meta, 'floatArray') as Float32Array | null;
  const frameFloatArray = readBinarySection(bytes, container.meta, 'frameFloatArray') as Float32Array | null;
  const frameIntArray = readBinarySection(bytes, container.meta, 'frameIntArray') as Int16Array | null;
  const frameArray = readBinarySection(bytes, container.meta, 'frameArray') as Int16Array | null;
  const timelineArray = readBinarySection(bytes, container.meta, 'timelineArray') as Uint16Array | null;

  const stats: DbbinDecodeStats = {
    surfaces: 0, meshes: 0, weightedMeshes: 0, timelines: 0, frames: 0, pending: [],
  };
  const json = container.json as {
    armature?: Array<{
      bone?: Array<{ name: string; transform?: DbTransform; type?: unknown; offset?: number; vertices?: number[] }>;
      skin?: Array<{ slot?: Array<{ display?: DbDisplayData[] }> }>;
      animation?: RawAnimation[];
      /** action table referenced by `Action(0)` frames */
      actions?: unknown[];
    }>;
  };

  for (const armature of json.armature ?? []) {
    // ---- surface vertex grids -------------------------------------------
    if (intArray && floatArray) {
      for (const bone of armature.bone ?? []) {
        if (typeof bone.offset === 'number') {
          decodeSurfaceGeometry(bone, bone.offset, intArray, floatArray, stats);
        }
      }
    }
    // ---- mesh geometry -------------------------------------------------
    if (intArray && floatArray) {
      for (const skin of armature.skin ?? []) {
        for (const slot of skin.slot ?? []) {
          for (const display of slot.display ?? []) {
            if ((display.type === 'mesh' || display.type === 2) && typeof display.offset === 'number') {
              decodeMesh(display, display.offset, intArray, floatArray, stats);
            }
          }
        }
      }
    }
    // ---- animations ----------------------------------------------------
    for (const animation of armature.animation ?? []) {
      if (animation.bone && !Array.isArray(animation.bone)) {
        animation.bone = decodeBoneTimelines(
          animation as RawAnimation,
          armature.bone ?? [],
          timelineArray,
          frameArray,
          frameFloatArray,
          stats,
        );
      }
      const rawSlotMap = animation.slot && !Array.isArray(animation.slot) ? animation.slot : null;
      if (rawSlotMap) {
        (animation as { slot?: unknown }).slot = decodeSlotTimelines(
          animation,
          timelineArray,
          frameArray,
          frameIntArray,
          intArray,
          stats,
        );
        const ffd = decodeMeshDeformTimelines(
          rawSlotMap,
          animation,
          timelineArray,
          frameArray,
          frameIntArray,
          frameFloatArray,
          stats,
        );
        if (ffd.length > 0) (animation as { ffd?: DbFfdTimeline[] }).ffd = ffd;
      }
      const surface = decodeSurfaceTimelines(
        animation, timelineArray, frameArray, frameIntArray, frameFloatArray, stats,
      );
      if (surface.length > 0) (animation as { surface?: DbSurfaceTimeline[] }).surface = surface;
      const ik = decodeIkTimelines(animation, timelineArray, frameArray, frameIntArray, stats);
      if (ik.length > 0) (animation as { ik?: DbIkTimeline[] }).ik = ik;
      const zOrder = decodeZOrderTimeline(animation, timelineArray, frameArray, stats);
      if (zOrder) (animation as { zOrder?: DbZOrderTimeline }).zOrder = zOrder;
      const actionFrames = decodeActionTimeline(
        animation, armature.actions ?? [], timelineArray, frameArray, stats,
      );
      if (actionFrames) (animation as { frame?: DbActionFrame[] }).frame = actionFrames;
    }
  }
  return {
    json,
    meta: container.meta,
    stats,
    arrays: { timeline: timelineArray, frameInt: frameIntArray, frame: frameArray, frameFloat: frameFloatArray, int: intArray, float: floatArray },
  };
}

/**
 * Rebuild a `type: "surface"` bone's vertex grid from its geometry record:
 * `[vertexCount, 0, floatOffset, -1]` followed by `vertexCount * 2` floats.
 */
function decodeSurfaceGeometry(
  bone: { type?: unknown; offset?: number; vertices?: number[] },
  offset: number,
  intArray: Int16Array,
  floatArray: Float32Array,
  stats: DbbinDecodeStats,
): void {
  const vertexCount = intArray[offset];
  const floatOffset = intArray[offset + 2];
  const vertices: number[] = [];
  for (let i = 0; i < vertexCount * 2; i++) vertices.push(floatArray[floatOffset + i] ?? 0);
  bone.vertices = vertices;
  delete bone.offset;
  stats.surfaces++;
}

/**
 * `TimelineType.Surface(50)` records live in the animation's `timeline` array.
 * Their frame-int descriptor shares the mesh-deform layout, so the deform axis is
 * rebuilt the same way as `ffd` (shared constant head/tail block + key windows).
 */
function decodeSurfaceTimelines(
  animation: RawAnimation,
  timelineArray: Uint16Array | null,
  frameArray: Int16Array | null,
  frameIntArray: Int16Array | null,
  frameFloatArray: Float32Array | null,
  stats: DbbinDecodeStats,
): DbSurfaceTimeline[] {
  const out: DbSurfaceTimeline[] = [];
  const refs = animation.timeline;
  if (!refs || !timelineArray || !frameArray || !frameIntArray || !frameFloatArray) return out;
  const duration = animation.duration ?? 0;
  const frameBase = animation.offset?.[2] ?? 0;
  const frameIntBase = animation.offset?.[0] ?? 0;
  const frameFloatBase = animation.offset?.[1] ?? 0;
  const keep: Array<{ offset?: number; name?: string; type?: number }> = [];

  for (const entry of refs) {
    if (!entry || entry.type !== TIMELINE.Surface) {
      keep.push(entry);
      continue;
    }
    // the official sparse-JSON step drops `offset: 0`, so a missing offset means 0
    const off = entry.offset ?? 0;
    const descriptorOffset = timelineArray[off + 3] + frameIntBase;
    const deformCount = frameIntArray[descriptorOffset + 1];
    const valueCount = frameIntArray[descriptorOffset + 2];
    const begin = frameIntArray[descriptorOffset + 3];
    const deformFloatOffset = frameIntArray[descriptorOffset + 4] + frameFloatBase;
    const axisHead: number[] = [];
    for (let k = 0; k < begin; k++) axisHead.push(frameFloatArray[deformFloatOffset + k]);
    const axisTail: number[] = [];
    for (let k = begin + valueCount; k < deformCount; k++) {
      axisTail.push(frameFloatArray[deformFloatOffset + k - valueCount]);
    }
    const constantCount = Math.max(0, deformCount - valueCount);
    const keyCount = timelineArray[off + 2];
    const entries: Array<{
      position: number;
      vertices: number[];
      ease: ReturnType<typeof readEasing>;
    }> = [];
    for (let k = 0; k < keyCount; k++) {
      const idx = frameBase + timelineArray[off + 5 + k];
      const values: number[] = [];
      const valueBase = deformFloatOffset + constantCount + k * valueCount;
      for (let j = 0; j < valueCount; j++) values.push(frameFloatArray[valueBase + j]);
      entries.push({
        position: frameArray[idx],
        vertices: values,
        ease: readEasing(frameArray[idx + 1], frameArray, idx),
      });
    }
    entries.sort((a, b) => a.position - b.position);
    out.push({
      name: entry.name ?? '',
      offset: off,
      axisHead,
      axisTail,
      frame: entries.map((item, index) => {
        const next = index + 1 < entries.length ? entries[index + 1].position : duration;
        return {
          duration: Math.max(0, next - item.position),
          tweenEasing: item.ease.tweenEasing,
          curveSamples: item.ease.curveSamples,
          tweenType: item.ease.tweenType,
          tweenRaw: item.ease.tweenRaw,
          offset: begin,
          vertices: item.vertices,
        };
      }),
    });
    stats.timelines++;
  }

  if (keep.length > 0) animation.timeline = keep;
  else delete animation.timeline;
  return out;
}

function decodeMesh(
  display: DbDisplayData,
  offset: number,
  intArray: Int16Array,
  floatArray: Float32Array,
  stats: DbbinDecodeStats,
): void {
  const vertexCount = intArray[offset + 0];
  const triangleCount = intArray[offset + 1];
  const floatOffset = intArray[offset + 2];
  const weightOffset = intArray[offset + 3];
  const vertices: number[] = [];
  const uvs: number[] = [];
  for (let i = 0; i < vertexCount * 2; i++) vertices.push(floatArray[floatOffset + i]);
  for (let i = 0; i < vertexCount * 2; i++) uvs.push(floatArray[floatOffset + vertexCount * 2 + i]);
  const triangles: number[] = [];
  for (let i = 0; i < triangleCount * 3; i++) triangles.push(intArray[offset + 4 + i]);
  display.vertices = vertices;
  display.uvs = uvs;
  display.triangles = triangles;
  stats.meshes++;

  if (weightOffset >= 0) {
    const boneCount = intArray[weightOffset + 0];
    const weightFloatOffset = intArray[weightOffset + 1];
    const bones: number[] = [];
    for (let i = 0; i < boneCount; i++) bones.push(intArray[weightOffset + 2 + i]);
    let cursor = weightOffset + 2 + boneCount;
    let floatCursor = weightFloatOffset;
    const weights: number[] = [];
    const bindOffsets: number[] = [];
    for (let v = 0; v < vertexCount; v++) {
      const count = intArray[cursor++];
      weights.push(count);
      bindOffsets.push(count);
      for (let k = 0; k < count; k++) {
        const boneSlot = intArray[cursor++];
        const weight = floatArray[floatCursor++];
        const x = floatArray[floatCursor++];
        const y = floatArray[floatCursor++];
        weights.push(bones[boneSlot], weight);
        bindOffsets.push(x, y);
      }
    }
    display.weights = weights;
    display.bindOffsets = bindOffsets;
    display.weightBones = bones;
    stats.weightedMeshes++;
  }
}

function decodeBoneTimelines(
  animation: RawAnimation,
  bones: Array<{ name: string; transform?: DbTransform }>,
  timelineArray: Uint16Array | null,
  frameArray: Int16Array | null,
  frameFloatArray: Float32Array | null,
  stats: DbbinDecodeStats,
): DbBoneTimeline[] {
  const map = animation.bone as Record<string, number[]>;
  const out: DbBoneTimeline[] = [];
  const duration = animation.duration ?? 0;
  const frameBase = animation.offset?.[2] ?? 0;
  const frameFloatBase = animation.offset?.[1] ?? 0;
  if (!timelineArray || !frameArray || !frameFloatArray) return out;

  for (const [name, ref] of Object.entries(map)) {
    const translate: DbBoneTranslateFrame[] = [];
    const rotate: DbBoneRotateFrame[] = [];
    const scale: DbBoneScaleFrame[] = [];
    for (let i = 0; i + 1 < ref.length; i += 2) {
      const type = ref[i];
      const timelineOffset = ref[i + 1];
      if (type !== TIMELINE.BoneAll && type !== TIMELINE.BoneTranslate
        && type !== TIMELINE.BoneRotate && type !== TIMELINE.BoneScale) {
        stats.pending.push(`bone timeline type ${type}`);
        continue;
      }
      const keyFrameCount = timelineArray[timelineOffset + 2];
      const frameValueCount = timelineArray[timelineOffset + 3];
      const frameValueOffset = timelineArray[timelineOffset + 4];
      const entries: Array<{ position: number; values: number[]; easing: ReturnType<typeof readEasing> }> = [];
      for (let k = 0; k < keyFrameCount; k++) {
        const frameOffset = timelineArray[timelineOffset + 5 + k];
        const frameIndex = frameBase + frameOffset;
        const valueBase = frameFloatBase + frameValueOffset + k * frameValueCount;
        const values: number[] = [];
        for (let j = 0; j < frameValueCount; j++) values.push(frameFloatArray[valueBase + j]);
        entries.push({
          position: frameArray[frameIndex + 0],
          values,
          easing: readEasing(frameArray[frameIndex + 1], frameArray, frameIndex),
        });
        stats.frames++;
      }
      entries.sort((a, b) => a.position - b.position);
      entries.forEach((entry, index) => {
        const next = index + 1 < entries.length ? entries[index + 1].position : duration;
        const common = {
          duration: Math.max(0, next - entry.position),
          tweenEasing: entry.easing.tweenEasing,
          curveSamples: entry.easing.curveSamples,
        };
        if (type === TIMELINE.BoneAll || type === TIMELINE.BoneTranslate) {
          translate.push({ ...common, x: entry.values[0], y: entry.values[1] });
        }
        if (type === TIMELINE.BoneAll || type === TIMELINE.BoneRotate) {
          const rotateRad = entry.values[type === TIMELINE.BoneAll ? 2 : 0];
          const skewRad = entry.values[type === TIMELINE.BoneAll ? 3 : 1];
          rotate.push({ ...common, ...entry.easing, rotate: rotateRad * RAD2DEG, skew: skewRad * RAD2DEG });
        }
        if (type === TIMELINE.BoneAll || type === TIMELINE.BoneScale) {
          const base = type === TIMELINE.BoneAll ? 4 : 0;
          scale.push({ ...common, ...entry.easing, x: entry.values[base], y: entry.values[base + 1] });
        }
      });
      stats.timelines++;
    }
    if (translate.length === 0 && rotate.length === 0 && scale.length === 0) continue;
    out.push({
      name,
      translateFrame: translate.length > 0 ? translate : undefined,
      rotateFrame: rotate.length > 0 ? rotate : undefined,
      scaleFrame: scale.length > 0 ? scale : undefined,
      // binary rotations already include the `clockwise` turns (spec §14)
      rotateExpanded: rotate.length > 0 ? true : undefined,
    });
  }
  void bones;
  return out;
}

function readTransform(type: number, values: Float32Array, base: number): DbTransform {
  switch (type) {
    case TIMELINE.BoneAll: {
      const rotate = values[base + 2];
      const skew = values[base + 3];
      return {
        x: values[base],
        y: values[base + 1],
        skY: rotate * RAD2DEG,
        skX: (rotate + skew) * RAD2DEG,
        scX: values[base + 4],
        scY: values[base + 5],
      };
    }
    case TIMELINE.BoneTranslate:
      return { x: values[base], y: values[base + 1] };
    case TIMELINE.BoneRotate: {
      const rotate = values[base];
      const skew = values[base + 1];
      return { skY: rotate * RAD2DEG, skX: (rotate + skew) * RAD2DEG };
    }
    case TIMELINE.BoneScale:
      return { scX: values[base], scY: values[base + 1] };
    default:
      return {};
  }
}

function readEasing(
  tweenType: number,
  frameArray: Int16Array,
  frameIndex: number,
): { tweenEasing: number; curveSamples?: number[]; tweenType?: number; tweenRaw?: number } {
  if (tweenType === TWEEN.None) return { tweenEasing: Number.NaN, tweenType };
  if (tweenType === TWEEN.Line) return { tweenEasing: 0, tweenType };
  if (tweenType === TWEEN.Curve) {
    const raw = frameArray[frameIndex + 2];
    const count = Math.abs(raw);
    const samples: number[] = [];
    for (let i = 0; i < count; i++) samples.push(frameArray[frameIndex + 3 + i] / 10000);
    return { tweenEasing: 0, curveSamples: samples, tweenType, tweenRaw: raw };
  }
  const raw = frameArray[frameIndex + 2];
  const value = raw / 100;
  if (tweenType === TWEEN.QuadIn) return { tweenEasing: -value, tweenType, tweenRaw: raw };
  if (tweenType === TWEEN.QuadOut) return { tweenEasing: value, tweenType, tweenRaw: raw };
  return { tweenEasing: 1 + value, tweenType, tweenRaw: raw };
}








/**
 * `animation.slot[name]` is a flat `[type, timelineOffset, ...]` list:
 * 20 = SlotDisplay (record = position + displayIndex), 21 = SlotColor
 * (tween frame + one int offset into the colour table). Others stay pending.
 */
function decodeSlotTimelines(
  animation: RawAnimation,
  timelineArray: Uint16Array | null,
  frameArray: Int16Array | null,
  frameIntArray: Int16Array | null,
  intArray: Int16Array | null,
  stats: DbbinDecodeStats,
): DbSlotTimeline[] {
  const map = animation.slot as Record<string, number[]>;
  const out: DbSlotTimeline[] = [];
  if (!timelineArray || !frameArray) return out;
  const duration = animation.duration ?? 0;
  const frameBase = animation.offset?.[2] ?? 0;
  const frameIntBase = animation.offset?.[0] ?? 0;

  for (const [name, ref] of Object.entries(map)) {
    const displayFrame: DbSlotDisplayFrame[] = [];
    const colorFrame: DbSlotColorFrame[] = [];
    for (let i = 0; i + 1 < ref.length; i += 2) {
      const type = ref[i];
      const off = ref[i + 1];
      const keyCount = timelineArray[off + 2];
      const frameValueCount = timelineArray[off + 3];
      const frameValueOffset = timelineArray[off + 4];
      if (type === TIMELINE.MeshDeform) continue; // decoded by decodeMeshDeformTimelines
      if (type !== TIMELINE.SlotDisplay && type !== TIMELINE.SlotColor) {
        stats.pending.push(`slot timeline type ${type}`);
        continue;
      }
      const entries: Array<{ position: number; tweenType: number; ease: ReturnType<typeof readEasing>; value: number }> = [];
      for (let k = 0; k < keyCount; k++) {
        const idx = frameBase + timelineArray[off + 5 + k];
        const position = frameArray[idx];
        if (type === TIMELINE.SlotDisplay) {
          entries.push({ position, tweenType: TWEEN.None, ease: { tweenEasing: Number.NaN }, value: frameArray[idx + 1] });
        } else {
          const colorOffset = frameIntArray
            ? frameIntArray[frameIntBase + frameValueOffset + k * frameValueCount]
            : 0;
          entries.push({
            position,
            tweenType: frameArray[idx + 1],
            ease: readEasing(frameArray[idx + 1], frameArray, idx),
            value: colorOffset,
          });
        }
      }
      entries.sort((a, b) => a.position - b.position);
      entries.forEach((entry, index) => {
        const next = index + 1 < entries.length ? entries[index + 1].position : duration;
        const common = {
          duration: Math.max(0, next - entry.position),
          tweenEasing: entry.ease.tweenEasing,
          curveSamples: entry.ease.curveSamples,
          tweenType: entry.ease.tweenType,
          tweenRaw: entry.ease.tweenRaw,
        };
        if (type === TIMELINE.SlotDisplay) {
          displayFrame.push({ ...common, tweenEasing: Number.NaN, value: entry.value });
        } else {
          colorFrame.push({ ...common, value: readColorAt(intArray, entry.value) });
        }
      });
      stats.timelines++;
    }
    if (displayFrame.length === 0 && colorFrame.length === 0) continue;
    out.push({
      name,
      displayFrame: displayFrame.length > 0 ? displayFrame : undefined,
      colorFrame: colorFrame.length > 0 ? colorFrame : undefined,
    });
  }
  return out;
}

function readColorAt(intArray: Int16Array | null, offset: number): DbColorTransform | undefined {
  if (!intArray || offset < 0 || offset + 7 >= intArray.length) return undefined;
  return {
    aM: intArray[offset + 0],
    rM: intArray[offset + 1],
    gM: intArray[offset + 2],
    bM: intArray[offset + 3],
    aO: intArray[offset + 4],
    rO: intArray[offset + 5],
    gO: intArray[offset + 6],
    bO: intArray[offset + 7],
  };
}






/**
 * MeshDeform (FFD) timelines live in the same `animation.slot` map as slot
 * timelines (type 22). The descriptor sits in frameIntArray and points at the
 * mesh descriptor; deform values are stored as one shared constant block plus
 * `valueCount` floats per keyframe.
 */
function decodeMeshDeformTimelines(
  map: Record<string, number[]>,
  animation: RawAnimation,
  timelineArray: Uint16Array | null,
  frameArray: Int16Array | null,
  frameIntArray: Int16Array | null,
  frameFloatArray: Float32Array | null,
  stats: DbbinDecodeStats,
): DbFfdTimeline[] {
  const out: DbFfdTimeline[] = [];
  if (!timelineArray || !frameArray || !frameIntArray || !frameFloatArray) return out;
  const duration = animation.duration ?? 0;
  const frameBase = animation.offset?.[2] ?? 0;
  const frameIntBase = animation.offset?.[0] ?? 0;
  const frameFloatBase = animation.offset?.[1] ?? 0;

  for (const [slotName, ref] of Object.entries(map)) {
    for (let i = 0; i + 1 < ref.length; i += 2) {
      const type = ref[i];
      const off = ref[i + 1];
      if (type !== TIMELINE.MeshDeform) continue;
      const descriptorOffset = timelineArray[off + 3] + frameIntBase;
      const deformCount = frameIntArray[descriptorOffset + 1];
      const valueCount = frameIntArray[descriptorOffset + 2];
      const begin = frameIntArray[descriptorOffset + 3];
      const deformFloatOffset = frameIntArray[descriptorOffset + 4] + frameFloatBase;
      // the writer stores the constant head `[0, begin)` then the constant tail
      // `[begin + valueCount, deformCount)` as one shared block
      const axisHead: number[] = [];
      for (let k = 0; k < begin; k++) axisHead.push(frameFloatArray[deformFloatOffset + k]);
      const axisTail: number[] = [];
      for (let k = begin + valueCount; k < deformCount; k++) {
        axisTail.push(frameFloatArray[deformFloatOffset + k - valueCount]);
      }

      // per-key windows follow the shared constant block
      const constantCount = Math.max(0, deformCount - valueCount);
      const keyCount = timelineArray[off + 2];
      const entries: Array<{ position: number; vertices: number[]; ease: ReturnType<typeof readEasing> }> = [];
      for (let k = 0; k < keyCount; k++) {
        const idx = frameBase + timelineArray[off + 5 + k];
        const values: number[] = [];
        const valueBase = deformFloatOffset + constantCount + k * valueCount;
        for (let j = 0; j < valueCount; j++) values.push(frameFloatArray[valueBase + j]);
        entries.push({
          position: frameArray[idx],
          vertices: values,
          ease: readEasing(frameArray[idx + 1], frameArray, idx),
        });
      }
      entries.sort((a, b) => a.position - b.position);
      const frames: DbFfdFrame[] = entries.map((entry, index) => {
        const next = index + 1 < entries.length ? entries[index + 1].position : duration;
        return {
          duration: Math.max(0, next - entry.position),
          tweenEasing: entry.ease.tweenEasing,
          curveSamples: entry.ease.curveSamples,
          tweenType: entry.ease.tweenType,
          tweenRaw: entry.ease.tweenRaw,
          offset: begin,
          vertices: entry.vertices,
        };
      });
      out.push({ slot: slotName, name: slotName, frame: frames, axisHead, axisTail });
      stats.timelines++;
    }
  }
  return out;
}

/**
 * `IKConstraint(30)` timelines live in the animation's own `constraint` map
 * (keyed by constraint name), not in the slot map. Every keyframe stores
 * `[bendPositive ? 1 : 0, round(weight * 100)]` in `frameIntArray`.
 */
function decodeIkTimelines(
  animation: RawAnimation,
  timelineArray: Uint16Array | null,
  frameArray: Int16Array | null,
  frameIntArray: Int16Array | null,
  stats: DbbinDecodeStats,
): DbIkTimeline[] {
  const map = animation.constraint as Record<string, number[]> | undefined;
  const out: DbIkTimeline[] = [];
  if (!map || !timelineArray || !frameArray || !frameIntArray) return out;
  const duration = animation.duration ?? 0;
  const frameBase = animation.offset?.[2] ?? 0;
  const frameIntBase = animation.offset?.[0] ?? 0;

  for (const [name, ref] of Object.entries(map)) {
    for (let i = 0; i + 1 < ref.length; i += 2) {
      const type = ref[i];
      const timelineOffset = ref[i + 1];
      if (type !== TIMELINE.IKConstraint) {
        stats.pending.push(`constraint timeline type ${type}`);
        continue;
      }
      const keyFrameCount = timelineArray[timelineOffset + 2];
      const frameValueCount = timelineArray[timelineOffset + 3];
      const frameValueOffset = timelineArray[timelineOffset + 4];
      const entries: Array<{ position: number; bendPositive: boolean; weight: number; easing: ReturnType<typeof readEasing> }> = [];
      for (let k = 0; k < keyFrameCount; k++) {
        const frameOffset = timelineArray[timelineOffset + 5 + k];
        const frameIndex = frameBase + frameOffset;
        const valueBase = frameIntBase + frameValueOffset + k * frameValueCount;
        entries.push({
          position: frameArray[frameIndex],
          bendPositive: frameIntArray[valueBase] !== 0,
          weight: frameIntArray[valueBase + 1] / 100,
          easing: readEasing(frameArray[frameIndex + 1], frameArray, frameIndex),
        });
      }
      entries.sort((a, b) => a.position - b.position);
      const frames: DbIkFrame[] = entries.map((entry, index) => {
        const next = index + 1 < entries.length ? entries[index + 1].position : duration;
        return {
          duration: Math.max(0, next - entry.position),
          tweenEasing: entry.easing.tweenEasing,
          curveSamples: entry.easing.curveSamples,
          bendPositive: entry.bendPositive,
          weight: entry.weight,
        };
      });
      const scale = timelineArray[timelineOffset] / 100;
      const offset = timelineArray[timelineOffset + 1] / 100;
      out.push({
        name,
        scale: scale === 1 ? undefined : scale,
        offset: offset === 0 ? undefined : offset,
        frame: frames,
      });
      stats.timelines++;
    }
  }
  return out;
}

/**
 * `ZOrder(1)` timeline: `animation.zOrder` holds a single timeline offset and
 * every keyframe record is `[position, count, ...order]`, where `order` is the
 * slot permutation for that keyframe (see `createZOrderFrame`).
 */
function decodeZOrderTimeline(
  animation: RawAnimation,
  timelineArray: Uint16Array | null,
  frameArray: Int16Array | null,
  stats: DbbinDecodeStats,
): DbZOrderTimeline | null {
  const timelineOffset = animation.zOrder;
  if (typeof timelineOffset !== 'number' || timelineOffset < 0 || !timelineArray || !frameArray) return null;
  const keyFrameCount = timelineArray[timelineOffset + 2];
  const frameBase = animation.offset?.[2] ?? 0;
  const duration = animation.duration ?? 0;
  const entries: Array<{ position: number; order: number[] }> = [];
  for (let k = 0; k < keyFrameCount; k++) {
    const frameIndex = frameBase + timelineArray[timelineOffset + 5 + k];
    const count = frameArray[frameIndex + 1];
    const order: number[] = [];
    for (let i = 0; i < count; i++) order.push(frameArray[frameIndex + 2 + i]);
    entries.push({ position: frameArray[frameIndex], order });
  }
  entries.sort((a, b) => a.position - b.position);
  const frames: DbZOrderFrame[] = entries.map((entry, index) => {
    const next = index + 1 < entries.length ? entries[index + 1].position : duration;
    return { duration: Math.max(0, next - entry.position), order: entry.order };
  });
  stats.timelines++;
  return { frame: frames };
}

/**
 * `Action(0)` timeline. `animation.action` holds the timeline offset and every
 * keyframe record is `[position, actionCount, ...actionIndices]`; the shipped
 * writer also reserves one unused trailing word per frame. The indices point
 * into `armature.actions`.
 */
function decodeActionTimeline(
  animation: RawAnimation,
  actions: unknown[],
  timelineArray: Uint16Array | null,
  frameArray: Int16Array | null,
  stats: DbbinDecodeStats,
): DbActionFrame[] | null {
  const timelineOffset = animation.action;
  if (typeof timelineOffset !== 'number' || timelineOffset < 0 || !timelineArray || !frameArray) return null;
  const keyFrameCount = timelineArray[timelineOffset + 2];
  const frameBase = animation.offset?.[2] ?? 0;
  const duration = animation.duration ?? 0;
  const entries: Array<{ position: number; actions: unknown[] }> = [];
  for (let k = 0; k < keyFrameCount; k++) {
    const frameIndex = frameBase + timelineArray[timelineOffset + 5 + k];
    const count = frameArray[frameIndex + 1];
    const list: unknown[] = [];
    for (let i = 0; i < count; i++) list.push(actions[frameArray[frameIndex + 2 + i]] ?? {});
    entries.push({ position: frameArray[frameIndex], actions: list });
  }
  entries.sort((a, b) => a.position - b.position);
  stats.timelines++;
  return entries.map((entry, index) => {
    const next = index + 1 < entries.length ? entries[index + 1].position : duration;
    return { duration: Math.max(0, next - entry.position), actions: entry.actions };
  });
}
