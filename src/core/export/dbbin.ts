/**
 * DragonBones binary export (`*_ske.dbbin`) — clean-room writer.
 *
 * Layout, array semantics and the sparse-JSON step are taken from the measured
 * specification in 格式规范 / §4.1 (verified against an artifact
 * produced by the shipped official tool). Only the types this editor can author
 * are emitted; unsupported timeline families throw instead of writing bad data.
 */
import { IDENTITY, apply, invert, type Mat2D } from '../runtime/math';
import { authoringToOrder } from '../runtime/animation';
import { CLEARED_MESH_FIELDS, canonicalizeJson, compressInPlace } from './dbbinSchema';
import type {
  DbAnimationData, DbBoneFrame, DbBoneTimeline, DbColorTransform, DbDisplayData, DbSkeletonData,
  DbActionFrame, DbFfdFrame, DbFfdTimeline, DbIkFrame, DbIkTimeline,
  DbSlotColorFrame, DbSlotDisplayFrame, DbSlotTimeline, DbZOrderFrame, DbZOrderTimeline,
  DbBoneData, DbSurfaceFrame, DbSurfaceTimeline,
} from '../types';

const PI_D = Math.PI * 2;
const DEG_RAD = Math.PI / 180;

const TIMELINE_TYPE = {
  Action: 0, ZOrder: 1, BoneAll: 10, BoneTranslate: 11, BoneRotate: 12, BoneScale: 13,
  SlotDisplay: 20, SlotColor: 21, MeshDeform: 22, IKConstraint: 30, Surface: 50,
} as const;
const TWEEN_TYPE = { None: 0, Line: 1, Curve: 2, QuadIn: 3, QuadOut: 4, QuadInOut: 5 } as const;

export class DbbinExportError extends Error {}

/** `geom.normalizeDegree` semantics (maps into (-180, 180] with the official quirk). */
function normalizeDegree(value: number): number {
  let out = (value + 180) % 360;
  out += out > 0 ? -180 : 180;
  return out;
}

/** Official curve sampling (`samplingEasingCurve`), re-implemented. */
function sampleEasingCurve(curve: number[], samples: number[], omitted: boolean): void {
  const count = curve.length;
  let stepIndex = -2;
  for (let i = 0; i < samples.length; i++) {
    const t = omitted ? (i + 1) / (samples.length + 1) : i / (samples.length - 1);
    if (!omitted && i === 0) {
      samples[0] = curve[1];
      continue;
    }
    if (!omitted && i === samples.length - 1) {
      samples[i] = curve[count - 1];
      continue;
    }
    while ((stepIndex + 6 < count ? curve[stepIndex + 6] : 1) < t) stepIndex += 6;
    const inCurve = omitted ? stepIndex >= 0 && stepIndex + 6 < count : true;
    const x1 = inCurve ? curve[stepIndex] : 0;
    const y1 = inCurve ? curve[stepIndex + 1] : 0;
    const x2 = curve[stepIndex + 2];
    const y2 = curve[stepIndex + 3];
    const x3 = curve[stepIndex + 4];
    const y3 = curve[stepIndex + 5];
    const x4 = inCurve ? curve[stepIndex + 6] : 1;
    const y4 = inCurve ? curve[stepIndex + 7] : 1;
    let lower = 0;
    let higher = 1;
    let point = 0;
    while (higher - lower > 0.0001) {
      const percentage = (higher + lower) / 2;
      const l = 1 - percentage;
      const powA = l * l;
      const powB = percentage * percentage;
      const x = l * powA * x1 + 3 * percentage * powA * x2 + 3 * l * powB * x3 + percentage * powB * x4;
      const y = l * powA * y1 + 3 * percentage * powA * y2 + 3 * l * powB * y3 + percentage * powB * y4;
      point = y;
      if (t - x > 0) lower = percentage;
      else higher = percentage;
    }
    samples[i] = point;
  }
}

interface Arrays {
  int: number[];
  float: number[];
  frameInt: number[];
  frameFloat: number[];
  frame: number[];
  timeline: number[];
  color: number[];
}

interface MeshInfo {
  /** intArray offset of the mesh descriptor */
  offset: number;
  /** deform values per frame (2 per vertex, or one per vertex/bone pair) */
  valueCount: number;
}

interface AnimationBinary {
  duration: number;
  playTimes: number;
  scale: number;
  fadeInTime: number;
  name: string;
  action: number;
  zOrder: number;
  offset: number[];
  bone: Record<string, number[]>;
  surface: Record<string, number[]>;
  /** `{ offset, name, type }` records (`TypeTimeline`), e.g. surface deform */
  timeline?: Array<{ offset: number; name: string; type: number }>;
  slot: Record<string, number[]>;
  constraint: Record<string, number[]>;
}

export interface DbbinExportStats {
  /** `type: "surface"` bones whose vertex grid moved into intArray / floatArray */
  surfaces: number;
  meshes: number;
  weightedMeshes: number;
  animations: number;
  timelines: number;
  frames: number;
  bytes: number;
}


/* ------------------------------------------------------------------ meshes */

function createColor(value: Record<string, number>, int: number[]): number {
  const offset = int.length;
  int.length += 8;
  int[offset + 0] = value.aM ?? 100;
  int[offset + 1] = value.rM ?? 100;
  int[offset + 2] = value.gM ?? 100;
  int[offset + 3] = value.bM ?? 100;
  int[offset + 4] = value.aO ?? 0;
  int[offset + 5] = value.rO ?? 0;
  int[offset + 6] = value.gO ?? 0;
  int[offset + 7] = value.bO ?? 0;
  return offset;
}

/** `createMesh`: geometry + optional baked weight bind offsets. */
function createMesh(display: DbDisplayData, arrays: Arrays, stats: DbbinExportStats): MeshInfo {
  const vertices = display.vertices ?? [];
  const uvs = display.uvs ?? [];
  const triangles = display.triangles ?? [];
  const weights = display.weights ?? [];
  const bonePose = display.bonePose ?? [];
  const slotPose = display.slotPose ?? [];
  const vertexCount = Math.floor(vertices.length / 2);
  const triangleCount = Math.floor(triangles.length / 3);
  const offset = arrays.int.length;
  const vertexOffset = arrays.float.length;
  const uvOffset = vertexOffset + vertexCount * 2;
  arrays.int.length += 1 + 1 + 1 + 1 + triangleCount * 3;
  arrays.int[offset + 0] = vertexCount;
  arrays.int[offset + 1] = triangleCount;
  arrays.int[offset + 2] = vertexOffset;
  for (let i = 0; i < triangleCount * 3; i++) arrays.int[offset + 4 + i] = triangles[i];
  arrays.float.length += vertexCount * 2 + vertexCount * 2;
  for (let i = 0; i < vertexCount * 2; i++) {
    arrays.float[vertexOffset + i] = vertices[i];
    arrays.float[uvOffset + i] = uvs[i] ?? 0;
  }
  stats.meshes++;

  if (weights.length > 0) {
    // two authoring forms: JSON (`bonePose` matrices) and binary-decoded (`bindOffsets`)
    const bindOffsets = display.bindOffsets ?? [];
    const hasBakedBinds = bindOffsets.length > 0;
    const boneList = (() => {
      // `boneList` 是二进制里的骨骼索引表（顶点权重存的是它在表里的下标），必须**恰好**覆盖
      // `weights` 真正引用到的骨骼：多写 0 引用的骨骼会污染数据，少写则下面
      // `boneList.indexOf(...) < 0` 处直接抛 `DbbinExportError`。
      // 顺序沿用登记表（dbbin 形态的 `weightBones`，或 JSON 形态的 `bonePose`），最后兜底补漏。
      const referenced = new Set<number>();
      let at = 0;
      for (let v = 0; v < vertexCount; v++) {
        const count = weights[at++] ?? 0;
        for (let k = 0; k < count; k++) {
          const index = weights[at];
          at += 2;
          if (typeof index === 'number') referenced.add(index);
        }
      }
      const preferred = hasBakedBinds && display.weightBones && display.weightBones.length > 0
        ? [...display.weightBones]
        : (() => {
          const list: number[] = [];
          for (let i = 0; i < bonePose.length; i += 7) list.push(bonePose[i]);
          return list;
        })();
      const list: number[] = [];
      for (const index of preferred) {
        if (referenced.has(index) && !list.includes(index)) list.push(index);
      }
      for (const index of referenced) if (!list.includes(index)) list.push(index);
      return list;
    })();
    const boneCount = boneList.length;
    const weightCount = Math.floor((weights.length - vertexCount) / 2);
    const weightOffset = arrays.int.length;
    const floatOffset = arrays.float.length;
    arrays.int.length += 2 + boneCount + vertexCount + weightCount;
    arrays.int[weightOffset + 0] = boneCount;
    arrays.int[weightOffset + 1] = floatOffset;
    for (let i = 0; i < boneCount; i++) arrays.int[weightOffset + 2 + i] = boneList[i];
    arrays.float.length += weightCount * 3;
    let cursor = 0;
    let intCursor = weightOffset + 2 + boneCount;
    let floatCursor = floatOffset;
    let bindCursor = 0;
    for (let v = 0; v < vertexCount; v++) {
      const boneTotal = weights[cursor++];
      arrays.int[intCursor++] = boneTotal;
      if (hasBakedBinds) bindCursor++;  // bindOffsets carries its own per-vertex count
      for (let k = 0; k < boneTotal; k++) {
        const boneIndex = weights[cursor++];
        const boneWeight = weights[cursor++];
        const listIndex = boneList.indexOf(boneIndex);
        if (listIndex < 0) throw new DbbinExportError(`mesh weights reference bone ${boneIndex} missing from the weight bone list`);
        arrays.int[intCursor++] = listIndex;
        let x: number;
        let y: number;
        if (hasBakedBinds) {
          x = bindOffsets[bindCursor++];
          y = bindOffsets[bindCursor++];
        } else {
          const poseOffset = findBonePoseOffset(bonePose, boneIndex);
          const bind: Mat2D = [
            bonePose[poseOffset + 1], bonePose[poseOffset + 2], bonePose[poseOffset + 3],
            bonePose[poseOffset + 4], bonePose[poseOffset + 5], bonePose[poseOffset + 6],
          ];
          const slotBind: Mat2D = slotPose.length >= 6
            ? [slotPose[0], slotPose[1], slotPose[2], slotPose[3], slotPose[4], slotPose[5]]
            : [...IDENTITY];
          const [sx, sy] = apply(slotBind, vertices[v * 2], vertices[v * 2 + 1]);
          [x, y] = apply(invert(bind), sx, sy);
        }
        arrays.float[floatCursor++] = boneWeight;
        arrays.float[floatCursor++] = x;
        arrays.float[floatCursor++] = y;
      }
    }
    arrays.int[offset + 3] = weightOffset;
    stats.weightedMeshes++;
  } else {
    arrays.int[offset + 3] = -1;
  }
  const weightsTotal = (() => {
    if (weights.length === 0) return vertexCount * 2;
    let total = 0;
    let cursor = 0;
    for (let v = 0; v < vertexCount; v++) {
      const bones = weights[cursor++];
      total += bones;
      cursor += bones * 2;
    }
    return total;
  })();
  return { offset, valueCount: weightsTotal };
}

function findBonePoseOffset(bonePose: number[], boneIndex: number): number {
  for (let i = 0; i < bonePose.length; i += 7) {
    if (bonePose[i] === boneIndex) return i;
  }
  throw new DbbinExportError(`mesh weights reference bone ${boneIndex} without a bonePose entry`);
}

/* ---------------------------------------------------------------- timelines */

interface TweenFrameLike {
  duration?: number;
  tweenEasing?: number | null;
  curve?: number[];
  /** decoded binary curve table + raw tween metadata (keeps round trips exact) */
  curveSamples?: number[];
  tweenType?: number;
  tweenRaw?: number;
}

/** `createFrame` + `createTweenFrame`. */
function createTweenFrame(
  frame: TweenFrameLike,
  frameStart: number,
  arrays: Arrays,
  baseFrameOffset: number,
): number {
  const frameOffset = arrays.frame.length;
  arrays.frame.push(frameStart);
  const duration = typeof frame.duration === 'number' ? frame.duration : 1;
  const curve = frame.curve ?? [];
  const rawType = typeof frame.tweenType === 'number' ? frame.tweenType : null;
  if (duration > 0) {
    if (frame.curveSamples && frame.curveSamples.length > 0) {
      // decoded binary curve: the sample table and its signed count are preserved
      const count = frame.tweenRaw ?? frame.curveSamples.length;
      arrays.frame.length += 2 + frame.curveSamples.length;
      arrays.frame[frameOffset + 1] = TWEEN_TYPE.Curve;
      arrays.frame[frameOffset + 2] = count;
      for (let i = 0; i < frame.curveSamples.length; i++) {
        arrays.frame[frameOffset + 3 + i] = Math.round(frame.curveSamples[i] * 10000);
      }
    } else if (rawType === TWEEN_TYPE.None || rawType === TWEEN_TYPE.Line) {
      arrays.frame.length += 1;
      arrays.frame[frameOffset + 1] = rawType;
    } else if (rawType === TWEEN_TYPE.QuadIn || rawType === TWEEN_TYPE.QuadOut || rawType === TWEEN_TYPE.QuadInOut) {
      const easing = typeof frame.tweenEasing === 'number' && !Number.isNaN(frame.tweenEasing) ? frame.tweenEasing : 0;
      const raw = frame.tweenRaw ?? (rawType === TWEEN_TYPE.QuadIn
        ? Math.round(-easing * 100)
        : rawType === TWEEN_TYPE.QuadOut ? Math.round(easing * 100) : Math.round(easing * 100 - 100));
      arrays.frame.length += 2;
      arrays.frame[frameOffset + 1] = rawType;
      arrays.frame[frameOffset + 2] = raw;
    } else if (curve.length > 0) {
      const omitted = curve.length % 3 === 1;
      const sampleCount = duration + (omitted ? 1 : 3);
      const samples = new Array<number>(sampleCount);
      sampleEasingCurve(curve, samples, omitted);
      arrays.frame.length += 1 + 1 + samples.length;
      arrays.frame[frameOffset + 1] = TWEEN_TYPE.Curve;
      arrays.frame[frameOffset + 2] = omitted ? sampleCount : -sampleCount;
      for (let i = 0; i < sampleCount; i++) {
        arrays.frame[frameOffset + 3 + i] = Math.round(samples[i] * 10000);
      }
    } else {
      // official branch order: isNaN(easing) first, so `undefined` becomes stepped
      const easing = frame.tweenEasing as number | null | undefined;
      if (easing === undefined || Number.isNaN(easing)) {
        arrays.frame.length += 1;
        arrays.frame[frameOffset + 1] = TWEEN_TYPE.None;
      } else if (easing === 0) {
        arrays.frame.length += 1;
        arrays.frame[frameOffset + 1] = TWEEN_TYPE.Line;
      } else if (easing === null) {
        arrays.frame.length += 2;
        arrays.frame[frameOffset + 1] = TWEEN_TYPE.QuadOut;
        arrays.frame[frameOffset + 2] = 0;
      } else if (easing < 0) {
        arrays.frame.length += 2;
        arrays.frame[frameOffset + 1] = TWEEN_TYPE.QuadIn;
        arrays.frame[frameOffset + 2] = Math.round(-easing * 100);
      } else if (easing <= 1) {
        arrays.frame.length += 2;
        arrays.frame[frameOffset + 1] = TWEEN_TYPE.QuadOut;
        arrays.frame[frameOffset + 2] = Math.round(easing * 100);
      } else {
        arrays.frame.length += 2;
        arrays.frame[frameOffset + 1] = TWEEN_TYPE.QuadInOut;
        arrays.frame[frameOffset + 2] = Math.round(easing * 100 - 100);
      }
    }
  } else {
    arrays.frame.length += 1;
    arrays.frame[frameOffset + 1] = TWEEN_TYPE.None;
  }
  void baseFrameOffset;
  return frameOffset;
}

/**
 * `createTimeline`: five uint16 header slots (scale, offset, keyFrameCount,
 * frameValueCount, frameValueOffset) followed by one uint16 frame offset per key.
 */
function createTimeline(
  owner: unknown,
  frames: TweenFrameLike[],
  addIntOffset: boolean,
  addFloatOffset: boolean,
  frameValueCount: number,
  animationOffset: number[],
  arrays: Arrays,
  createFrame: (frame: TweenFrameLike, frameStart: number) => number,
): number {
  const offset = arrays.timeline.length;
  arrays.timeline.length += 5;
const holder = (owner ?? {}) as { scale?: unknown; offset?: unknown };
  const timelineScale = typeof holder.scale === 'number' ? holder.scale : 1;
  const timelineOffset = typeof holder.offset === 'number' ? holder.offset : 0;
  arrays.timeline[offset + 0] = Math.round(timelineScale * 100);
  arrays.timeline[offset + 1] = Math.round(timelineOffset * 100);
  arrays.timeline[offset + 3] = frameValueCount;
  if (addIntOffset) arrays.timeline[offset + 4] = arrays.frameInt.length - animationOffset[0];
  else if (addFloatOffset) arrays.timeline[offset + 4] = arrays.frameFloat.length - animationOffset[1];
  else arrays.timeline[offset + 4] = 0;
  let frameStart = 0;
  let keyFrameCount = 0;
  for (const frame of frames) {
    const frameOffset = createFrame(frame, frameStart);
    frameStart += typeof frame.duration === 'number' ? frame.duration : 1;
    if (frameOffset >= 0) {
      arrays.timeline.push(frameOffset - animationOffset[2]);
      keyFrameCount++;
    }
  }
  arrays.timeline[offset + 2] = keyFrameCount;
  return offset;
}

/** `createBoneTimeline`: full frames (10) then translate (11) / rotate (12) / scale (13). */
function createBoneTimeline(
  timeline: DbBoneTimeline,
  animationOffset: number[],
  arrays: Arrays,
  stats: DbbinExportStats,
): number[] {
  const out: number[] = [];
  const full = timeline.frame ?? [];
  if (full.length > 0) {
    out.push(TIMELINE_TYPE.BoneAll);
    let clockwise = 0;
    let previous = 0;
    out.push(createTimeline(timeline, full, false, true, 6, animationOffset, arrays, (frame, frameStart) => {
      const item = frame as DbBoneFrame;
      const offset = createTweenFrame(frame, frameStart, arrays, animationOffset[2]);
      const transform = item.transform ?? {};
      let rotate = transform.skY ?? 0;
      if (frameStart !== 0) {
        if (clockwise === 0) {
          rotate = previous + normalizeDegree(rotate - previous);
        } else {
          if (clockwise > 0 ? rotate >= previous : rotate <= previous) clockwise += clockwise > 0 ? -1 : 1;
          // accumulate whole turns: +360° per clockwise step (measured against the official writer)
          rotate = rotate + 360 * clockwise;
        }
      }
      clockwise = (item as { tweenRotate?: number }).tweenRotate ?? 0;
      previous = rotate;
      arrays.frameFloat.push(transform.x ?? 0);
      arrays.frameFloat.push(transform.y ?? 0);
      arrays.frameFloat.push(rotate * DEG_RAD);
      arrays.frameFloat.push(normalizeDegree((transform.skX ?? 0) - (transform.skY ?? 0)) * DEG_RAD);
      arrays.frameFloat.push(transform.scX ?? 1);
      arrays.frameFloat.push(transform.scY ?? 1);
      stats.frames++;
      return offset;
    }));
    stats.timelines++;
  }
  const translate = timeline.translateFrame ?? [];
  if (translate.length > 0) {
    out.push(TIMELINE_TYPE.BoneTranslate);
    out.push(createTimeline(timeline, translate, false, true, 2, animationOffset, arrays, (frame, frameStart) => {
      const offset = createTweenFrame(frame, frameStart, arrays, animationOffset[2]);
      arrays.frameFloat.push((frame as { x?: number }).x ?? 0);
      arrays.frameFloat.push((frame as { y?: number }).y ?? 0);
      stats.frames++;
      return offset;
    }));
    stats.timelines++;
  }
  const rotate = timeline.rotateFrame ?? [];
  if (rotate.length > 0) {
    out.push(TIMELINE_TYPE.BoneRotate);
    let clockwise = 0;
    let previous = 0;
    const alreadyExpanded = timeline.rotateExpanded === true;
    out.push(createTimeline(timeline, rotate, false, true, 2, animationOffset, arrays, (frame, frameStart) => {
      const item = frame as { rotate?: number; skew?: number; clockwise?: number };
      const offset = createTweenFrame(frame, frameStart, arrays, animationOffset[2]);
      let value = item.rotate ?? 0;
      if (!alreadyExpanded && frameStart !== 0) {
        if (clockwise === 0) {
          value = previous + normalizeDegree(value - previous);
        } else {
          if (clockwise > 0 ? value >= previous : value <= previous) clockwise += clockwise > 0 ? -1 : 1;
          // accumulate whole turns: +360° per clockwise step (measured against the official writer)
          value = value + 360 * clockwise;
        }
      }
      if (!alreadyExpanded) {
        clockwise = item.clockwise ?? 0;
        previous = value;
      }
      arrays.frameFloat.push(value * DEG_RAD);
      arrays.frameFloat.push(normalizeDegree(item.skew ?? 0) * DEG_RAD);
      stats.frames++;
      return offset;
    }));
    stats.timelines++;
  }
  const scale = timeline.scaleFrame ?? [];
  if (scale.length > 0) {
    out.push(TIMELINE_TYPE.BoneScale);
    out.push(createTimeline(timeline, scale, false, true, 2, animationOffset, arrays, (frame, frameStart) => {
      const offset = createTweenFrame(frame, frameStart, arrays, animationOffset[2]);
      arrays.frameFloat.push((frame as { x?: number }).x ?? 1);
      arrays.frameFloat.push((frame as { y?: number }).y ?? 1);
      stats.frames++;
      return offset;
    }));
    stats.timelines++;
  }
  return out;
}



/* ---------------------------------------------------------------- surfaces */

/**
 * A `type: "surface"` bone owns a deformable vertex grid of
 * `(segmentX + 1) * (segmentY + 1)` vertices (`Surface.vertexCount` in the
 * official format classes).
 */
function isSurfaceBone(bone: { type?: unknown }): boolean {
  const type = bone?.type;
  return type === 'surface' || type === 'Surface' || type === 1;
}

/** Official `Surface.vertexCount` getter. */
function surfaceVertexCount(bone: DbBoneData): number {
  const segmentX = typeof bone.segmentX === 'number' ? bone.segmentX : 0;
  const segmentY = typeof bone.segmentY === 'number' ? bone.segmentY : 0;
  return (segmentX + 1) * (segmentY + 1);
}

/**
 * Official `createVertices`: four int slots — vertex count, triangle count (0
 * for a grid), float offset, weight offset (-1) — followed by the vertex floats.
 */
function createSurfaceGeometry(bone: DbBoneData, arrays: Arrays, stats: DbbinExportStats): number {
  const vertices = bone.vertices ?? [];
  const offset = arrays.int.length;
  const vertexOffset = arrays.float.length;
  arrays.int.length += 4;
  arrays.int[offset + 0] = surfaceVertexCount(bone);
  arrays.int[offset + 1] = 0;
  arrays.int[offset + 2] = vertexOffset;
  arrays.int[offset + 3] = -1;
  arrays.float.length += vertices.length;
  for (let i = 0; i < vertices.length; i++) arrays.float[vertexOffset + i] = vertices[i];
  stats.surfaces++;
  return offset;
}

/**
 * Official `formatDeform`: round to 2 decimals, then trim the leading/trailing
 * zeros of an authoring deform window and return the trimmed start index.
 */
export function formatDeform(values: number[]): number {
  for (let i = 0; i < values.length; i++) values[i] = Number(values[i].toFixed(2));
  let begin = 0;
  while (values[begin] === 0) {
    begin++;
    if (begin === values.length - 1) break;
  }
  let end = values.length - 1;
  while (end > begin && values[end] === 0) end--;
  let index = 0;
  for (let i = begin; i < end + 1; i++) values[index++] = values[i];
  values.length = end - begin + 1;
  return begin;
}

/** A surface key frame is authored either as a full `value` axis or as a decoded window. */
function surfaceFrameValues(frame: DbSurfaceFrame, count: number): { begin: number; values: number[] } {
  const window = Array.isArray(frame.value)
    ? (() => {
      const values = frame.value.slice();
      return { begin: (frame.offset ?? 0) + formatDeform(values), values };
    })()
    : { begin: frame.offset ?? 0, values: (frame.vertices ?? []).slice() };
  const axis = new Array<number>(count).fill(0);
  for (let i = 0; i < window.values.length && window.begin + i < count; i++) {
    axis[window.begin + i] = window.values[i];
  }
  return { begin: window.begin, values: axis };
}

/**
 * Official `createSurfaceTimeline`: the deform axis is trimmed exactly like a
 * mesh deform (one shared constant head/tail block in `frameFloatArray` plus the
 * animated window per key), but the frame-int descriptor points at the surface
 * geometry record measured by `createSurfaceGeometry`.
 */
function createSurfaceTimeline(
  timeline: DbSurfaceTimeline,
  armature: { bone?: DbBoneData[] },
  animationOffset: number[],
  arrays: Arrays,
  stats: DbbinExportStats,
): number {
  const bone = (armature.bone ?? []).find((entry) => entry.name === timeline.name);
  const frames = timeline.frame ?? [];
  if (!bone || !isSurfaceBone(bone) || frames.length === 0) return -1;
  const vertexCount = (bone.vertices?.length ?? 0) / 2;
  const count = vertexCount * 2;
  if (count <= 0) return -1;

  const values = frames.map((frame) => surfaceFrameValues(frame, count).values);
  const first = values[0];
  let begin = 0;
  let end = count - 1;
  let completedBegin = false;
  let completedEnd = false;
  while (!completedBegin || !completedEnd) {
    if (!completedBegin) {
      for (const list of values) {
        if (list[begin] !== first[begin]) { completedBegin = true; break; }
      }
      if (begin === count - 1) completedBegin = true;
      else if (!completedBegin) begin++;
    }
    if (completedBegin && !completedEnd) {
      for (const list of values) {
        if (list[end] !== first[end]) { completedEnd = true; break; }
      }
      if (end === begin) completedEnd = true;
      else if (!completedEnd) end--;
    }
  }
  const valueCount = end - begin + 1;
  const descriptorOffset = arrays.frameInt.length;
  arrays.frameInt.length += 5;
  arrays.frameInt[descriptorOffset + 0] = bone.offset ?? -1;
  arrays.frameInt[descriptorOffset + 1] = count;
  arrays.frameInt[descriptorOffset + 2] = valueCount;
  arrays.frameInt[descriptorOffset + 3] = begin;
  arrays.frameInt[descriptorOffset + 4] = arrays.frameFloat.length - animationOffset[1];
  for (let i = 0; i < begin; i++) arrays.frameFloat.push(first[i]);
  for (let i = end + 1; i < count; i++) arrays.frameFloat.push(first[i]);

  let frameIndex = 0;
  // `createTimeline` writes `Math.round(owner.offset * 100)` into the header's
  // `TimelineOffset` slot. For a **decoded** document our reader stores that slot's
  // own value back as `offset` (the timeline's position inside `timelineArray`), so
  // forwarding the object verbatim re-writes e.g. 53 as 5300 — the official writer
  // puts the *authoring* `value.offset` there, which is 0 for surfaces. Measured:
  // that single field made the shipped runtime read the wrong header and drop the
  // whole deform (tx stayed 40 instead of 46.25).
  const surfaceOwner = { scale: (timeline as { scale?: number }).scale, offset: 0 };
  const timelineOffset = createTimeline(
    surfaceOwner, frames, false, true, valueCount, animationOffset, arrays, (frame, frameStart) => {
      const offset = createTweenFrame(frame, frameStart, arrays, animationOffset[2]);
      const axis = values[frameIndex++] ?? first;
      for (let i = 0; i < valueCount; i++) arrays.frameFloat.push(axis[begin + i]);
      stats.frames++;
      return offset;
    },
  );
  // the writer repurposes the frameValueCount slot as the descriptor offset
  arrays.timeline[timelineOffset + 3] = descriptorOffset - animationOffset[0];
  stats.timelines++;
  return timelineOffset;
}

/* -------------------------------------------------------------------- main */

/**
 * Encode a DragonBones document into `*_ske.dbbin`.
 *
 * Unsupported timeline families throw `DbbinExportError` instead of silently
 * writing data the official runtime cannot play.
 */
export function encodeDbbin(input: unknown): Uint8Array {
  const doc = JSON.parse(JSON.stringify(input)) as DbSkeletonData & { frameRate?: number };
  if (!Array.isArray(doc.armature) || doc.armature.length === 0) {
    throw new DbbinExportError('dbbin: 骨架缺少 armature 数组');
  }
  const arrays: Arrays = { int: [], float: [], frameInt: [], frameFloat: [], frame: [], timeline: [], color: [] };
  const colorCache = new Map<string, number>();
  const meshInfo = new Map<string, MeshInfo>();
  const stats: DbbinExportStats = {
    surfaces: 0, meshes: 0, weightedMeshes: 0, animations: 0, timelines: 0, frames: 0, bytes: 0,
  };

  for (const armature of doc.armature) {
    // 5.5 normalisation: legacy `defaultActions` entries become Play actions
    const legacy = (armature as { defaultActions?: unknown[] }).defaultActions;
    if (Array.isArray(legacy)) {
      (armature as { defaultActions?: unknown[] }).defaultActions = legacy.map((action) => {
        if (action && typeof action === 'object' && 'gotoAndPlay' in (action as Record<string, unknown>)) {
          return {
            extra: null, ints: [], floats: [], strings: [],
            type: 0, name: String((action as { gotoAndPlay?: unknown }).gotoAndPlay ?? ''), bone: '', slot: '',
          };
        }
        return action;
      });
    }

    // surface bones -> intArray / floatArray (official order: bones, then skin displays)
    for (const bone of armature.bone ?? []) {
      if (!isSurfaceBone(bone)) continue;
      bone.offset = createSurfaceGeometry(bone, arrays, stats);
    }

    // meshes -> intArray / floatArray
    for (const skin of armature.skin ?? []) {
      for (const slot of skin.slot ?? []) {
        for (const display of slot.display ?? []) {
          const isMesh = display.type === 'mesh' || display.type === 2
            || (display.vertices?.length ?? 0) > 0;
          if (!isMesh) continue;
          const rawType = display.type as unknown;
          if (rawType === 'path' || rawType === 4 || (display as { closed?: unknown }).closed !== undefined) {
            throw new DbbinExportError('dbbin: 路径/包围盒顶点导出尚未实现');
          }
          const info = createMesh(display, arrays, stats);
          display.offset = info.offset;
          if (display.name) meshInfo.set(display.name, info);
          // An FFD / slot-deform timeline is named after the **slot** it deforms, while
          // `meshInfo` used to be keyed by the display name only — so any mesh display
          // whose name differs from its slot (or that has no name) made
          // `createMeshDeformTimeline` bail out and drop the whole deform: no `frameInt`
          // descriptor, 2 missing `timeline` headers, and the official runtime then
          // walked the shared timeline array wrongly (bones drifted by 203).
          if (!meshInfo.has(slot.name)) meshInfo.set(slot.name, info);
          for (const field of CLEARED_MESH_FIELDS) {
            if (field === 'width' || field === 'height') {
              (display as Record<string, unknown>)[field] = 0;
              continue;
            }
            (display as Record<string, unknown>)[field] = [];
          }
          // the official writer flags intentionally-empty arrays so they survive
          (display as Record<string, unknown>)._userEdges = true;
        }
      }
    }

    // actions are collected across every animation, in writer order
    const actionTable: unknown[] = [];
    for (const animation of armature.animation ?? []) {
      for (const frame of (animation as { frame?: DbActionFrame[] }).frame ?? []) {
        for (const action of frame.actions ?? []) actionTable.push(action);
      }
    }
    if (actionTable.length > 0) (armature as { actions?: unknown[] }).actions = actionTable;
    let actionCursor = 0;

    // animations -> AnimationBinary records
    const binaries: AnimationBinary[] = [];
    for (const animation of armature.animation ?? []) {
      const source = animation as DbAnimationData;
      // authoring input may carry the surface timeline in the binary `timeline` array
      // (`{ type: 50, name, frame }`), the decoded/memory form uses `surface`
      const rawTimelines = Array.isArray((animation as { timeline?: unknown[] }).timeline)
        ? ((animation as { timeline?: unknown[] }).timeline as unknown[])
        : [];
      const authoredSurface: DbSurfaceTimeline[] = [];
      const otherTimelines: unknown[] = [];
      for (const entry of rawTimelines) {
        const record = entry as { type?: unknown; frame?: unknown } | null;
        if (record && record.type === TIMELINE_TYPE.Surface && Array.isArray(record.frame)) {
          authoredSurface.push(entry as DbSurfaceTimeline);
        } else {
          otherTimelines.push(entry);
        }
      }
      const surfaceTimelines = [...(source.surface ?? []), ...authoredSurface];
      if (otherTimelines.length > 0) (animation as { timeline?: unknown[] }).timeline = otherTimelines;
      else delete (animation as { timeline?: unknown }).timeline;


      const binary: AnimationBinary = {
        // class defaults: Animation.duration = 1, playTimes = 1
        duration: typeof source.duration === 'number' ? source.duration : 1,
        playTimes: typeof source.playTimes === 'number' ? source.playTimes : 1,
        scale: 1,
        fadeInTime: 0,
        name: source.name ?? '',
        action: -1,
        zOrder: -1,
        offset: [arrays.frameInt.length, arrays.frameFloat.length, arrays.frame.length],
        bone: {},
        surface: {},
        slot: {},
        constraint: {},
      };
      // `action` comes first, then `zOrder` (spec §15 / §16).
      if ((source.frame?.length ?? 0) > 0) {
        binary.action = createActionTimeline(
          source, source.frame ?? [], binary.offset, arrays, stats, () => actionCursor++,
        );
      }
      // `zOrder` is a single timeline offset that follows `action` (spec §15).
      if (source.zOrder) {
        binary.zOrder = createZOrderTimeline(
          source.zOrder, (armature.slot ?? []).length, binary.offset, arrays, stats,
        );
      }
      for (const timeline of source.bone ?? []) {
        binary.bone[timeline.name] = createBoneTimeline(timeline, binary.offset, arrays, stats);
      }
      for (const timeline of source.slot ?? []) {
        binary.slot[timeline.name] = createSlotTimeline(timeline, binary.offset, arrays, stats, colorCache);
      }
      for (const timeline of source.ffd ?? []) {
        if (!binary.slot[timeline.slot]) binary.slot[timeline.slot] = [];
        const refs = createMeshDeformTimeline(timeline, meshInfo, binary.offset, arrays, stats);
        if (refs.length > 0) binary.slot[timeline.slot].push(...refs);
      }
      // the official writer emits `ffd` before `ik` (toBinary.js）
      for (const timeline of source.ik ?? []) {
        binary.constraint[timeline.name] = createIkTimeline(timeline, binary.offset, arrays, stats);
      }
      // `TypeTimeline` records (surface deform) come last, after every legacy family
      const typeRefs: Array<{ offset: number; name: string; type: number }> = [];
      for (const timeline of surfaceTimelines) {
        const timelineOffset = createSurfaceTimeline(timeline, armature, binary.offset, arrays, stats);
        if (timelineOffset < 0) continue;
        typeRefs.push({ offset: timelineOffset, name: timeline.name, type: TIMELINE_TYPE.Surface });
      }
      if (typeRefs.length > 0) binary.timeline = [...(binary.timeline ?? []), ...typeRefs];
      // the authoring-only `surface` array never reaches the binary JSON
      delete (animation as { surface?: unknown }).surface;
      binaries.push(binary);
      stats.animations++;
    }
    // `clearToBinary`: the vertex grid lives in floatArray from here on
    for (const bone of armature.bone ?? []) {
      if (isSurfaceBone(bone)) bone.vertices = [];
    }
    (armature as { animation?: unknown }).animation = binaries;
  }

  // 4-byte alignment for the 2-byte sections (element-count parity)
  const align = (list: number[]) => { if (list.length % 2 !== 0) list.push(0); };
  align(arrays.int);
  align(arrays.frameInt);
  align(arrays.frame);
  align(arrays.timeline);
  align(arrays.color);

  const offsets: number[] = new Array(14).fill(0);
  offsets[0] = 0;
  offsets[1] = arrays.int.length * 2;
  offsets[2] = offsets[0] + offsets[1];
  offsets[3] = arrays.float.length * 4;
  offsets[4] = offsets[2] + offsets[3];
  offsets[5] = arrays.frameInt.length * 2;
  offsets[6] = offsets[4] + offsets[5];
  offsets[7] = arrays.frameFloat.length * 4;
  offsets[8] = offsets[6] + offsets[7];
  offsets[9] = arrays.frame.length * 2;
  offsets[10] = offsets[8] + offsets[9];
  offsets[11] = arrays.timeline.length * 2;
  offsets[12] = offsets[10] + offsets[11];
  offsets[13] = arrays.color.length * 2;

  const output = doc as unknown as Record<string, unknown>;
  output.offset = offsets;
  const canonical = canonicalizeJson(output, 'DragonBones') as Record<string, unknown>;
  compressInPlace(canonical, 'DragonBones');

  const json = new TextEncoder().encode(JSON.stringify(canonical));
  const padding = (4 - ((12 + json.length) % 4)) % 4;
  const jsonLength = json.length + padding;
  const arraysLength = offsets[12] + offsets[13];
  const bytes = new Uint8Array(12 + jsonLength + arraysLength);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0x44; bytes[1] = 0x42; bytes[2] = 0x44; bytes[3] = 0x54; // "DBDT"
  // container version: 2 is what the shipped 5.6.3 toolchain writes, 3 the upstream
  // writer uses once the `timeline` (TypeTimeline) array is in play — the published
  // runtime does not read this field, but keeping the pair faithful keeps oracle diffs clean.
  const usesTypeTimelines = doc.armature.some((armature) => (armature.animation ?? [])
    .some((animation) => (Array.isArray((animation as { timeline?: unknown[] }).timeline)
      ? ((animation as { timeline?: unknown[] }).timeline as unknown[]).length : 0) > 0));
  bytes[4] = 0; bytes[5] = 0; bytes[6] = 0; bytes[7] = usesTypeTimelines ? 3 : 2;
  view.setUint32(8, jsonLength, true);
  bytes.set(json, 12);
  for (let i = 0; i < padding; i++) bytes[12 + json.length + i] = 0x20;

  let cursor = 12 + jsonLength;
  const writeSection = (values: number[], kind: 'int16' | 'uint16' | 'float32', byteOffset: number) => {
    let at = cursor + byteOffset;
    for (const value of values) {
      if (kind === 'float32') { view.setFloat32(at, value, true); at += 4; }
      else if (kind === 'uint16') { view.setUint16(at, value, true); at += 2; }
      else { view.setInt16(at, value, true); at += 2; }
    }
  };
  writeSection(arrays.int, 'int16', offsets[0]);
  writeSection(arrays.float, 'float32', offsets[2]);
  writeSection(arrays.frameInt, 'int16', offsets[4]);
  writeSection(arrays.frameFloat, 'float32', offsets[6]);
  writeSection(arrays.frame, 'int16', offsets[8]);
  writeSection(arrays.timeline, 'uint16', offsets[10]);
  writeSection(arrays.color, 'int16', offsets[12]);
  void cursor;

  stats.bytes = bytes.length;
  return bytes;
}

export function dbbinExportStats(bytes: Uint8Array, input: unknown): DbbinExportStats {
  const stats: DbbinExportStats = {
    surfaces: 0, meshes: 0, weightedMeshes: 0, animations: 0, timelines: 0, frames: 0, bytes: bytes.length,
  };
  const doc = input as DbSkeletonData;
  for (const armature of doc.armature ?? []) {
    for (const bone of armature.bone ?? []) {
      if (isSurfaceBone(bone)) stats.surfaces++;
    }
    for (const skin of armature.skin ?? []) {
      for (const slot of skin.slot ?? []) {
        for (const display of slot.display ?? []) {
          if (display.type === 'mesh' || display.type === 2) {
            stats.meshes++;
            if ((display.weights?.length ?? 0) > 0) stats.weightedMeshes++;
          }
        }
      }
    }
    for (const animation of armature.animation ?? []) {
      stats.animations++;
      for (const timeline of animation.bone ?? []) {
        stats.timelines += [timeline.frame, timeline.translateFrame, timeline.rotateFrame, timeline.scaleFrame]
          .filter((frames) => (frames?.length ?? 0) > 0).length;
      }
    }
  }
  return stats;
}












/* ------------------------------------------------------------ slot timelines */

/** `geom.ColorTransform.toString()` semantics (used for colour-table dedupe). */
function colorKey(color: DbColorTransform | undefined): string {
  const value = {
    aM: color?.aM ?? 100, rM: color?.rM ?? 100, gM: color?.gM ?? 100, bM: color?.bM ?? 100,
    aO: color?.aO ?? 0, rO: color?.rO ?? 0, gO: color?.gO ?? 0, bO: color?.bO ?? 0,
  };
  return `${value.aM}_${value.rM}_${value.gM}_${value.bM}_${value.aO}_${value.rO}_${value.gO}_${value.bO}`;
}

/**
 * The authoring JSON keeps display switching and colour on **one** `frame[]` list
 * (`DbSlotFrame`), while the binary — and the vendor's own parser, which splits the same
 * list into a `SlotDisplay(20)` and a `SlotColor(21)` component timeline
 * (`_parseSlotTimeline`, dragonBones57.js:12933-12941) — keeps them apart.
 *
 * Without this split the display track was dropped entirely: a serial-frame project exported
 * to `*_ske.dbbin` played as a single still, both in the official runtime and in ours
 * (spec §103). A frame without `displayIndex` means display **0**, matching
 * `_parseSlotDisplayFrame` (`_getNumber(rawData, DISPLAY_INDEX, 0)`, line 13207).
 */
function splitSlotFrames(timeline: DbSlotTimeline): { display: DbSlotDisplayFrame[]; color: DbSlotColorFrame[] } {
  if ((timeline.displayFrame?.length ?? 0) > 0 || (timeline.colorFrame?.length ?? 0) > 0) {
    return { display: timeline.displayFrame ?? [], color: timeline.colorFrame ?? [] };
  }
  const frames = timeline.frame ?? [];
  return {
    display: frames.map((frame) => ({ ...frame, value: frame.displayIndex ?? 0 })),
    // only the frames that actually carry a colour become part of the colour track
    color: frames.filter((frame) => frame.color).map((frame) => ({ ...frame, value: frame.color })),
  };
}

/**
 * `createSlotTimeline`: display frames are stepped pairs (position, displayIndex);
 * colour frames reuse a shared colour table stored in intArray.
 */
function createSlotTimeline(
  timeline: DbSlotTimeline,
  animationOffset: number[],
  arrays: Arrays,
  stats: DbbinExportStats,
  colorCache: Map<string, number>,
): number[] {
  const out: number[] = [];
  const split = splitSlotFrames(timeline);
  const display = split.display;
  const color = split.color;
  if (display.length > 0) {
    out.push(TIMELINE_TYPE.SlotDisplay);
    out.push(createTimeline(timeline, display, false, false, 0, animationOffset, arrays, (frame, frameStart) => {
      const offset = arrays.frame.length;
      arrays.frame.push(frameStart);
      arrays.frame.push((frame as DbSlotDisplayFrame).value ?? 0);
      stats.frames++;
      return offset;
    }));
    stats.timelines++;
  }
  if (color.length > 0) {
    out.push(TIMELINE_TYPE.SlotColor);
    out.push(createTimeline(timeline, color, true, false, 1, animationOffset, arrays, (frame, frameStart) => {
      const offset = createTweenFrame(frame, frameStart, arrays, animationOffset[2]);
      const item = frame as DbSlotColorFrame;
      const value = item.value ?? item.color;
      const key = colorKey(value);
      let colorOffset = colorCache.get(key);
      if (colorOffset === undefined) {
        colorOffset = createColor((value ?? {}) as Record<string, number>, arrays.int);
        colorCache.set(key, colorOffset);
      }
      arrays.frameInt.push(colorOffset);
      stats.frames++;
      return offset;
    }));
    stats.timelines++;
  }
  return out;
}










/* ------------------------------------------------------------------- action */

/**
 * `Action(0)` timeline: frame record = `[position, actionCount, ...indices]`
 * where each index points into `armature.actions`. Mirrors
 * `toBinary.js#createActionFrame`.
 */
function createActionTimeline(
  owner: unknown,
  frames: DbActionFrame[],
  animationOffset: number[],
  arrays: Arrays,
  stats: DbbinExportStats,
  nextActionIndex: () => number,
): number {
  return createTimeline(owner, frames as never, false, false, 0, animationOffset, arrays, (frame, frameStart) => {
    const item = frame as DbActionFrame;
    const offset = arrays.frame.length;
    arrays.frame.push(frameStart);
    const actions = item.actions ?? [];
    arrays.frame.push(actions.length);
    for (let i = 0; i < actions.length; i++) arrays.frame.push(nextActionIndex());
    // the shipped writer reserves `1 + 1 + actionCount` on top of the position
    // word, so every action frame carries one unused trailing word (spec §16)
    arrays.frame.push(0);
    stats.frames++;
    return offset;
  });
}

/* ------------------------------------------------------------------ z-order */

/** `ZOrder(1)` timeline; frame record = `[position, count, ...order]`. */
function createZOrderTimeline(
  timeline: DbZOrderTimeline,
  slotCount: number,
  animationOffset: number[],
  arrays: Arrays,
  stats: DbbinExportStats,
): number {
  const frames = timeline.frame ?? [];
  return createTimeline(timeline, frames, false, false, 0, animationOffset, arrays, (frame, frameStart) => {
    const item = frame as DbZOrderFrame;
    const offset = arrays.frame.length;
    arrays.frame.push(frameStart);
    const order = item.order ?? authoringToOrder(item.zOrder, slotCount);
    if (!order || order.length === 0) {
      arrays.frame.push(0);
    } else {
      arrays.frame.push(slotCount);
      for (const value of order) arrays.frame.push(value);
    }
    stats.frames++;
    return offset;
  });
}

/* ------------------------------------------------------------- ik constraint */

/**
 * `IKConstraint(30)` timeline. `addIntOffset = true`, `frameValueCount = 2`;
 * each keyframe pushes `[bendPositive ? 1 : 0, round(weight * 100)]`.
 * Mirrors `tools/action/toBinary.js#createIKConstraintTimeline`; the class
 * defaults (`bendPositive = true`, `weight = 1`) fill missing fields.
 */
function createIkTimeline(
  timeline: DbIkTimeline,
  animationOffset: number[],
  arrays: Arrays,
  stats: DbbinExportStats,
): number[] {
  const frames = timeline.frame ?? [];
  if (frames.length === 0) return [];
  const out: number[] = [];
  out.push(TIMELINE_TYPE.IKConstraint);
  out.push(createTimeline(timeline, frames, true, false, 2, animationOffset, arrays, (frame, frameStart) => {
    const item = frame as DbIkFrame;
    const offset = createTweenFrame(frame, frameStart, arrays, animationOffset[2]);
    arrays.frameInt.push(item.bendPositive === false ? 0 : 1);
    arrays.frameInt.push(Math.round((item.weight ?? 1) * 100));
    stats.frames++;
    return offset;
  }));
  stats.timelines++;
  return out;
}

/* --------------------------------------------------------------- ffd (deform) */

/** Locate the mesh display an FFD timeline deforms. */
function findMeshDisplay(
  armature: { skin?: Array<{ name?: string; slot?: Array<{ name: string; display?: DbDisplayData[] }> }> },
  skinName: string | undefined,
  slotName: string,
  meshName: string | undefined,
): DbDisplayData | null {
  const skins = armature.skin ?? [];
  const skin = (skinName ? skins.find((entry) => entry.name === skinName) : undefined) ?? skins[0];
  if (!skin) return null;
  const slot = (skin.slot ?? []).find((entry) => entry.name === slotName);
  if (!slot) return null;
  const displays = slot.display ?? [];
  return displays.find((display) => display.name === meshName)
    ?? displays.find((display) => (display.type === 'mesh' || display.type === 2))
    ?? null;
}

/** Number of deform values per frame: 2 per vertex, or one per (vertex,bone) pair. */
function meshValueCount(display: DbDisplayData): number {
  const vertexCount = Math.floor((display.vertices?.length ?? 0) / 2);
  const weights = display.weights ?? [];
  if (weights.length === 0) return vertexCount * 2;
  let count = 0;
  let cursor = 0;
  for (let v = 0; v < vertexCount; v++) {
    const bones = weights[cursor++];
    count += bones;
    cursor += bones * 2;
  }
  return count;
}

function frameDeformValues(frame: DbFfdFrame, count: number): number[] {
  const list = new Array<number>(count).fill(0);
  const window = frame.vertices ?? [];
  const offset = frame.offset ?? 0;
  for (let i = 0; i < window.length && offset + i < count; i++) list[offset + i] = window[i];
  return list;
}

/**
 * `createMeshDeformTimeline`: trims the constant head/tail of the deform value
 * axis into a single shared block, then stores only the animated window per key.
 */
function createMeshDeformTimeline(
  timeline: DbFfdTimeline,
  meshInfo: Map<string, MeshInfo>,
  animationOffset: number[],
  arrays: Arrays,
  stats: DbbinExportStats,
): number[] {
  const info = timeline.name ? meshInfo.get(timeline.name) : undefined;
  const frames = timeline.frame ?? [];
  if (!info || frames.length === 0) return [];
  const count = info.valueCount;
  const values = frames.map((frame) => frameDeformValues(frame, count));
  const first = values[0];
  let begin = 0;
  let end = count - 1;
  if (count > 0) {
    let completedBegin = false;
    let completedEnd = false;
    while (!completedBegin || !completedEnd) {
      if (!completedBegin) {
        for (const list of values) {
          if (list[begin] !== first[begin]) { completedBegin = true; break; }
        }
        if (begin === count - 1) completedBegin = true;
        else if (!completedBegin) begin++;
      }
      if (completedBegin && !completedEnd) {
        for (const list of values) {
          if (list[end] !== first[end]) { completedEnd = true; break; }
        }
        if (end === begin) completedEnd = true;
        else if (!completedEnd) end--;
      }
    }
  }
  const valueCount = end - begin + 1;
  const descriptorOffset = arrays.frameInt.length;
  arrays.frameInt.length += 5;
  arrays.frameInt[descriptorOffset + 0] = info.offset;
  arrays.frameInt[descriptorOffset + 1] = count;
  arrays.frameInt[descriptorOffset + 2] = valueCount;
  arrays.frameInt[descriptorOffset + 3] = begin;
  arrays.frameInt[descriptorOffset + 4] = arrays.frameFloat.length - animationOffset[1];
  for (let i = 0; i < begin; i++) arrays.frameFloat.push(first[i]);
  for (let i = end + 1; i < count; i++) arrays.frameFloat.push(first[i]);

  let frameIndex = 0;
  // same hazard as the surface path: a decoded timeline carries the header position
  // in `offset`, so forwarding it writes `position x 100` into the header's
  // `TimelineOffset` slot and the official runtime then reads the wrong header.
  const ffdOwner = { scale: (timeline as { scale?: number }).scale, offset: 0 };
  const timelineOffset = createTimeline(ffdOwner, frames, false, true, valueCount, animationOffset, arrays, (frame, frameStart) => {
    const offset = createTweenFrame(frame, frameStart, arrays, animationOffset[2]);
    const list = values[frameIndex++] ?? first;
    for (let i = 0; i < valueCount; i++) arrays.frameFloat.push(list[begin + i]);
    stats.frames++;
    return offset;
  });
  // the official writer repurposes the frameValueCount slot as the descriptor offset
  arrays.timeline[timelineOffset + 3] = descriptorOffset - animationOffset[0];
  stats.timelines++;
  return [TIMELINE_TYPE.MeshDeform, timelineOffset];
}






