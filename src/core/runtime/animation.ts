import type {
  DbBoneFrame,
  DbBoneRotateFrame,
  DbAnimationData,
  DbBoneTimeline,
  DbIkFrame,
  DbColorTransform,
  DbFfdTimeline,
  DbSurfaceTimeline,
  DbSlotFrame,
  DbSlotTimeline,
  DbTransform,
  DbZOrderFrame,
} from '../types';
import { DEG2RAD, lerp, lerpAngle, normalizeRadian, RAD2DEG } from './math';

/** Mirrors the DragonBones TweenType enum. */
export const TweenType = {
  None: 0,
  Line: 1,
  Curve: 2,
  QuadIn: 3,
  QuadOut: 4,
  QuadInOut: 5,
} as const;

export interface CurvePoint { x: number; y: number }

/** Cubic bezier evaluation, used by the joined multi-segment curve form. */
export function getCurvePoint(
  x1: number, y1: number, x2: number, y2: number,
  x3: number, y3: number, x4: number, y4: number, t: number,
): CurvePoint {
  const l = 1 - t;
  const powA = l * l;
  const powB = t * t;
  const kA = l * powA;
  const kB = 3 * t * powA;
  const kC = 3 * l * powB;
  const kD = t * powB;
  return {
    x: kA * x1 + kB * x2 + kC * x3 + kD * x4,
    y: kA * y1 + kB * y2 + kC * y3 + kD * y4,
  };
}

/**
 * Official `ObjectDataParser._samplingEasingCurve` (bisection tolerance 1e-4).
 *
 * The runtime never evaluates a bezier per frame: the **parser pre-samples** the
 * curve into `duration + 1` values at `t = (i + 1) / (n + 1)` and the runtime then
 * linearly interpolates that integer-quantised table
 * (`TweenTimelineState._getEasingCurveValue`). Evaluating the bezier analytically
 * instead is off by up to ~1.4e-3 in progress — measured against the shipped runtime,
 * so the table pipeline is what makes an easing curve reproduce exactly.
 *
 * Returns the vendor's `isOmited` flag: `curve.length % 3 === 1` (joined form, which
 * every curve in the official corpus uses) omits the two endpoints because they are
 * implicitly `(0,0)` and `(1,1)`.
 */
export function sampleEasingCurve(curve: number[], samples: number[]): boolean {
  const curveCount = curve.length;
  const joined = curveCount % 3 === 1;
  if (curveCount < 4 || (!joined && curveCount < 8)) {
    for (let i = 0; i < samples.length; i++) samples[i] = (i + 1) / (samples.length + 1);
    return false;
  }
  let stepIndex = joined ? -2 : 0;
  for (let i = 0, l = samples.length; i < l; i++) {
    const t = (i + 1) / (l + 1);
    if (joined) {
      while ((stepIndex + 6 < curveCount ? curve[stepIndex + 6] : 1) < t) stepIndex += 6;
    } else {
      while (stepIndex + 6 < curveCount && curve[stepIndex + 6] < t) stepIndex += 6;
    }
    const inCurve = joined ? stepIndex >= 0 && stepIndex + 6 < curveCount : true;
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
    let point = { x: 0, y: 0 };
    while (higher - lower > 0.0001) {
      const percentage = (higher + lower) / 2;
      point = getCurvePoint(x1, y1, x2, y2, x3, y3, x4, y4, percentage);
      if (t - point.x > 0) lower = percentage;
      else higher = percentage;
    }
    // the vendor stores Math.round(y * 10000) in an Int16Array — keep the same quantisation
    samples[i] = Math.round(point.y * 10000) / 10000;
  }
  return joined;
}

/**
 * Official `TweenTimelineState._getEasingCurveValue` (values already in 0..1).
 * `count > 0` means the endpoints are implicit; `count < 0` means the table carries them.
 */
export function curveEasingValue(progress: number, samples: readonly number[], count: number, offset = 0): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  const omitted = count > 0;
  const segmentCount = Math.abs(count) + 1;
  const valueIndex = Math.floor(progress * segmentCount);
  const fromValue = omitted
    ? (valueIndex === 0 ? 0 : samples[offset + valueIndex - 1] ?? 0)
    : (samples[offset + valueIndex - 1] ?? 0);
  const toValue = omitted
    ? (valueIndex >= segmentCount - 1 ? 1 : samples[offset + valueIndex] ?? 1)
    : (samples[offset + valueIndex] ?? 1);
  return fromValue + (toValue - fromValue) * (progress * segmentCount - valueIndex);
}

/** Pre-sampled tables are cached per frame object (built once, read every tick). */
const curveTables = new WeakMap<object, { samples: number[]; count: number }>();

function curveTable(frame: { duration: number; curve?: number[]; curveSamples?: number[] }): { samples: number[]; count: number } | null {
  if (frame.curveSamples && frame.curveSamples.length > 0) {
    // binary form: the signed sample count is the vendor's `isOmited` flag
    const raw = (frame as { tweenRaw?: number }).tweenRaw;
    const count = typeof raw === 'number' && raw !== 0 ? raw : frame.curveSamples.length;
    return { samples: frame.curveSamples, count };
  }
  if (!frame.curve || frame.curve.length === 0) return null;
  const cached = curveTables.get(frame);
  if (cached) return cached;
  const sampleCount = Math.max(1, Math.floor(frame.duration)) + 1;
  const samples = new Array<number>(sampleCount);
  const omitted = sampleEasingCurve(frame.curve, samples);
  const table = { samples, count: omitted ? sampleCount : -sampleCount };
  curveTables.set(frame, table);
  return table;
}

/**
 * Eased progress for a bezier control-point list, through the runtime's own
 * pre-sampled table. `duration` only matters for JSON frames (it sets the table size).
 */
export function getCurveEasingValue(t: number, curve: number[], duration = 20): number {
  const frame = { duration, curve };
  const table = curveTable(frame)!;
  return curveEasingValue(t, table.samples, table.count);
}

/** Map a JSON `tweenEasing` value onto a TweenType + easing amount. */
export function resolveTween(frame: { tweenEasing?: number | null; curve?: number[] }): {
  type: number;
  easing: number;
} {
  if (frame.curve && frame.curve.length > 0) return { type: TweenType.Curve, easing: 0 };
  const easing = frame.tweenEasing;
  if (easing === null || easing === undefined) return { type: TweenType.Line, easing: 0 };
  if (typeof easing === 'number' && Number.isNaN(easing)) return { type: TweenType.None, easing: 0 };
  if (easing === 0) return { type: TweenType.Line, easing: 0 };
  if (easing < 0) return { type: TweenType.QuadIn, easing: -easing };
  if (easing <= 1) return { type: TweenType.QuadOut, easing };
  return { type: TweenType.QuadInOut, easing: easing - 1 };
}

export function getEasingValue(type: number, progress: number, easing: number): number {
  let value = progress;
  switch (type) {
    case TweenType.QuadIn: value = Math.pow(progress, 2); break;
    case TweenType.QuadOut: value = 1 - Math.pow(1 - progress, 2); break;
    case TweenType.QuadInOut: value = 0.5 * (1 - Math.cos(progress * Math.PI)); break;
    default: break;
  }
  return (value - progress) * easing + progress;
}

/** Progress in [0,1] between two frames, honouring easing/curve and stepped tweens. */
export function frameProgress(
  frame: { duration: number; tweenEasing?: number | null; curve?: number[]; curveSamples?: number[] },
  t: number,
): number {
  // both spellings of a curve go through the vendor's pre-sampled table lookup
  const table = curveTable(frame);
  if (table) return curveEasingValue(t, table.samples, table.count);
  const { type, easing } = resolveTween(frame);
  if (type === TweenType.None) return 0;
  if (type === TweenType.Line && easing === 0) return t;
  return getEasingValue(type, t, easing);
}

export interface FrameLocation<T> {
  frame: T;
  next?: T;
  progress: number;
  index: number;
  position: number;
}

/** Locate the frame covering `position` (frames) using the `duration` timeline form. */
export function locateFrame<T extends { duration: number }>(
  frames: T[] | undefined,
  position: number,
): FrameLocation<T> | null {
  if (!frames || frames.length === 0) return null;
  let start = 0;
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    // the official parser defaults a missing frame `duration` to 1 (`_parseBoneTimeline`)
    const duration = frame.duration ?? 1;
    const end = start + duration;
    if (position < end || i === frames.length - 1) {
      const t = duration > 0 ? Math.min(1, Math.max(0, (position - start) / duration)) : 0;
      const next = i + 1 < frames.length ? frames[i + 1] : undefined;
      const progress = next ? frameProgress(frame, t) : 0;
      return { frame, next, progress, index: i, position: start };
    }
    start = end;
  }
  return null;
}

const DEFAULT_TRANSFORM: Required<DbTransform> = { x: 0, y: 0, skX: 0, skY: 0, scX: 1, scY: 1 };

/** 把 BoneAll 帧的 `transform` 按字段做「沿用上一帧」展开（官方帧语义）。 */
function carryForwardTransforms(frames: DbBoneFrame[]): DbTransform[] {
  const out: DbTransform[] = [];
  let last: DbTransform = {};
  for (const frame of frames) {
    last = { ...last, ...(frame.transform ?? {}) };
    out.push(last);
  }
  return out;
}

export function sampleBoneTransform(
  timeline: DbBoneTimeline | null | undefined,
  position: number,
): DbTransform {
  if (!timeline?.frame || timeline.frame.length === 0) {
    if (timeline?.rotate || timeline?.translate || timeline?.scale) {
      return sampleComponentTimeline(timeline, position);
    }
    return { ...DEFAULT_TRANSFORM };
  }
  const loc = locateFrame<DbBoneFrame>(timeline.frame, position);
  if (!loc) return { ...DEFAULT_TRANSFORM };
  // 官方 BoneAll 帧语义：`transform` 里**没写的字段沿用上一帧**的值（不是回到恒等）。
  // 单通道 K（第 183 轮）只写一个通道的字段，这条是它能正确工作的前提。
  const carried = carryForwardTransforms(timeline.frame);
  const from = { ...DEFAULT_TRANSFORM, ...carried[loc.index] };
  if (!loc.next) return from;
  const to = { ...DEFAULT_TRANSFORM, ...(carried[loc.index + 1] ?? loc.next.transform ?? {}) };
  const k = loc.progress;
  return {
    x: lerp(from.x, to.x, k),
    y: lerp(from.y, to.y, k),
    skX: lerpAngle(from.skX, to.skX, k),
    skY: lerpAngle(from.skY, to.skY, k),
    scX: lerp(from.scX, to.scX, k),
    scY: lerp(from.scY, to.scY, k),
  };
}

/** Spine-style component timelines (rotate/translate/scale keyed by seconds). */
function sampleComponentTimeline(timeline: DbBoneTimeline, position: number): DbTransform {
  const result = { ...DEFAULT_TRANSFORM };
  const find = <T extends { time: number }>(arr: T[] | undefined) => {
    if (!arr || arr.length === 0) return null;
    let i = 0;
    while (i + 1 < arr.length && arr[i + 1].time <= position) i++;
    const from = arr[i];
    const to = arr[i + 1];
    const span = to ? to.time - from.time : 0;
    const t = span > 0 ? Math.min(1, Math.max(0, (position - from.time) / span)) : 0;
    const stepped = (from as { curve?: unknown }).curve === 'stepped';
    return { from, to, t: stepped ? 0 : t };
  };
  const rot = find(timeline.rotate);
  if (rot) {
    result.skY = lerpAngle(rot.from.angle ?? 0, rot.to ? (rot.to.angle ?? 0) : rot.from.angle ?? 0, rot.t);
  }
  const tr = find(timeline.translate);
  if (tr) {
    result.x = lerp(tr.from.x ?? 0, tr.to ? (tr.to.x ?? 0) : tr.from.x ?? 0, tr.t);
    result.y = lerp(tr.from.y ?? 0, tr.to ? (tr.to.y ?? 0) : tr.from.y ?? 0, tr.t);
  }
  const sc = find(timeline.scale);
  if (sc) {
    result.scX = lerp(sc.from.x ?? 1, sc.to ? (sc.to.x ?? 1) : sc.from.x ?? 1, sc.t);
    result.scY = lerp(sc.from.y ?? 1, sc.to ? (sc.to.y ?? 1) : sc.from.y ?? 1, sc.t);
  }
  return result;
}

export interface SlotSample {
  displayIndex: number | null;
  color?: DbColorTransform;
}

export function sampleSlotTimeline(
  timeline: DbSlotTimeline | undefined,
  position: number,
  fallbackDisplayIndex: number,
): SlotSample {
  // 5.x / binary component timelines (display is stepped, colour can tween)
  if (timeline && ((timeline.displayFrame?.length ?? 0) > 0 || (timeline.colorFrame?.length ?? 0) > 0)) {
    const display = timeline.displayFrame?.length ? locateFrame(timeline.displayFrame, position) : null;
    const colorLoc = timeline.colorFrame?.length ? locateFrame(timeline.colorFrame, position) : null;
    let color: DbColorTransform | undefined;
    if (colorLoc) {
      const from = colorLoc.frame.value ?? colorLoc.frame.color;
      const to = colorLoc.next ? colorLoc.next.value ?? colorLoc.next.color : undefined;
      color = from && to ? lerpColor(from, to, colorLoc.progress) : from;
    }
    return {
      // same rule as the 4.x `frame[]` path below: an absent value means display 0
      displayIndex: display?.frame.value ?? 0,
      color,
    };
  }
  if (!timeline?.frame || timeline.frame.length === 0) {
    return { displayIndex: fallbackDisplayIndex };
  }
  const loc = locateFrame<DbSlotFrame>(timeline.frame, position);
  if (!loc) return { displayIndex: fallbackDisplayIndex };
  // The authoring `frame[]` list is the 4.x form of the *same* pair of component timelines the
  // official parser splits it into (`_parseSlotTimeline`, dragonBones57.js:12933-12941):
  // every frame carries an explicit display index, and a frame without one means **0**
  // (`_parseSlotDisplayFrame`, line 13207: `_getNumber(rawData, DISPLAY_INDEX, 0)`), not the
  // slot's bind display. Sample: FramesAnimation frame 0 has no `displayIndex` and the vendor
  // shows display 0 there, while the bind value is 1 (spec §103).
  const displayIndex = loc.frame.displayIndex ?? 0;
  // display changes are stepped: the upcoming frame's value applies once reached
  let resolved = displayIndex;
  if (loc.next && loc.next.displayIndex !== undefined && loc.progress >= 1) {
    resolved = loc.next.displayIndex;
  }
  let color = loc.frame.color;
  if (loc.next?.color && loc.frame.color) {
    color = lerpColor(loc.frame.color, loc.next.color, loc.progress);
  }
  return { displayIndex: resolved, color };
}

const COLOR_KEYS = ['aM', 'rM', 'gM', 'bM', 'aO', 'rO', 'gO', 'bO'] as const;

function colorDefaults(key: typeof COLOR_KEYS[number]): number {
  return key.endsWith('M') ? 100 : 0;
}

export function lerpColor(a: DbColorTransform, b: DbColorTransform, t: number): DbColorTransform {
  const out: DbColorTransform = {};
  for (const key of COLOR_KEYS) {
    const from = a[key] ?? colorDefaults(key);
    const to = b[key] ?? colorDefaults(key);
    if (from !== colorDefaults(key) || to !== colorDefaults(key)) out[key] = lerp(from, to, t);
  }
  return out;
}

export function sampleFfd(
  timeline: DbFfdTimeline | undefined,
  position: number,
  offset: number,
  vertexFloatCount: number,
): Float32Array | null {
  if (!timeline?.frame || timeline.frame.length === 0) return null;
  const loc = locateFrame(timeline.frame, position);
  if (!loc) return null;
  const result = new Float32Array(vertexFloatCount);
  const from = loc.frame.vertices ?? [];
  const to = loc.next?.vertices ?? from;
  for (let i = 0; i < vertexFloatCount; i++) {
    const delta = offset + i;
    const a = from[delta] ?? 0;
    const b = to[delta] ?? a;
    result[i] = lerp(a, b, loc.progress);
  }
  return result;
}




export interface BoneComponentPose {
  x: number;
  y: number;
  /** bind-relative rotation offset in degrees */
  rotation: number;
  /** bind-relative skew offset in degrees */
  skew: number;
  scaleX: number;
  scaleY: number;
}

function sampleFields<T extends { duration: number }>(
  frames: T[] | undefined,
  position: number,
  keys: Array<[string, number]>,
): Record<string, number> | null {
  if (!frames || frames.length === 0) return null;
  const loc = locateFrame(frames, position);
  if (!loc) return null;
  const out: Record<string, number> = {};
  for (const [key, fallback] of keys) {
    const from = (loc.frame as Record<string, number | undefined>)[key] ?? fallback;
    const to = loc.next ? ((loc.next as Record<string, number | undefined>)[key] ?? fallback) : from;
    out[key] = lerp(from, to, loc.progress);
  }
  return out;
}

/**
 * Official parse-time expansion of the `clockwise` turn count
 * (`ObjectDataParser._parseBoneRotateFrame`): every frame after the first is
 * unwrapped onto the shortest path relative to the previous one, then shifted
 * by whole turns. Returns degrees, matching the rest of the component sampler.
 * Evidence: 格式规范
 */
function expandRotations(frames: DbBoneRotateFrame[]): number[] {
  const out: number[] = [];
  let clockwise = 0;
  let previous = 0;
  for (let i = 0; i < frames.length; i++) {
    let rotation = (frames[i].rotate ?? 0) * DEG2RAD;
    if (i !== 0) {
      if (clockwise === 0) {
        rotation = previous + normalizeRadian(rotation - previous);
      } else {
        if (clockwise > 0 ? rotation >= previous : rotation <= previous) clockwise += clockwise > 0 ? -1 : 1;
        rotation += Math.PI * 2 * clockwise;
      }
    }
    clockwise = frames[i].clockwise ?? 0;
    previous = rotation;
    out.push(rotation * RAD2DEG);
  }
  return out;
}

const rotationCache = new WeakMap<DbBoneRotateFrame[], number[]>();

function sampleRotations(
  frames: DbBoneRotateFrame[] | undefined,
  position: number,
  expanded: boolean,
): { rotate: number; skew: number } | null {
  if (!frames || frames.length === 0) return null;
  let values = rotationCache.get(frames);
  if (!values) {
    // `.dbbin` rotations already carry the turns; JSON frames still need them.
    values = expanded ? frames.map((frame) => frame.rotate ?? 0) : expandRotations(frames);
    rotationCache.set(frames, values);
  }
  const loc = locateFrame(frames, position);
  if (!loc) return null;
  const from = values[loc.index];
  const to = loc.next ? values[loc.index + 1] : from;
  const skewFrom = frames[loc.index].skew ?? 0;
  const skewTo = loc.next ? loc.next.skew ?? 0 : skewFrom;
  return { rotate: lerp(from, to, loc.progress), skew: lerp(skewFrom, skewTo, loc.progress) };
}

/**
 * `ZOrder(1)` 授权（JSON）形态 → 运行时顺序。`[slotIndex, zOrderOffset, ...]` 对描述
 * 「哪根槽位挪了几格」，先放显式移动过的，剩下的按原顺序填空位，最后从高到低回填。
 * 与官方 `toBinary.js#createZOrderFrame` / `ObjectDataParser._parseZOrderFrame` 逐行同构
 * （格式规范）；`export/dbbin.ts` 的写出端也走这一份。
 * `order[i]` = 画在第 `i` 个位置上的**原始槽位下标**。
 */
export function authoringToOrder(pairs: number[] | undefined, slotCount: number): number[] | null {
  if (!pairs || pairs.length === 0 || slotCount <= 0) return null;
  const unchanged: number[] = new Array(Math.max(0, slotCount - pairs.length / 2)).fill(0);
  const zOrders: number[] = new Array(slotCount).fill(-1);
  let originalIndex = 0;
  let unchangedIndex = 0;
  for (let i = 0; i < pairs.length; i += 2) {
    const slotIndex = pairs[i];
    const zOrderOffset = pairs[i + 1];
    while (originalIndex !== slotIndex) unchanged[unchangedIndex++] = originalIndex++;
    zOrders[originalIndex + zOrderOffset] = originalIndex++;
  }
  while (originalIndex < slotCount) unchanged[unchangedIndex++] = originalIndex++;
  const order: number[] = new Array(slotCount).fill(0);
  let i = slotCount;
  while (i--) {
    order[i] = zOrders[i] === -1 ? unchanged[--unchangedIndex] || 0 : zOrders[i] || 0;
  }
  return order;
}

/** `authoringToOrder` 的逆：把顺序数组写回**最小**的 `[slotIndex, offset, ...]` 对（编辑器落帧用）。
 *
 * 最小口径 = 只写「相对绑定顺序动过」的那些槽位，也就是不被最长递增子序列选中的位置 ——
 * 与官方面板标箭头的判据同一份（`_669.as:107-115` + `_97/_10600.as:60-87`）。
 * 这样 `orderToAuthoring` 之后 `authoringToOrder` 能原样还原，产物也和官方样本一致
 * （`samples/out-zorder-new` 的单槽位移动写出来就是 `[0, 22]`）。
 */
export function orderToAuthoring(order: number[] | undefined, slotCount: number): number[] | null {
  if (!order || order.length === 0 || slotCount <= 0) return null;
  const position = new Map<number, number>();
  order.forEach((original, at) => position.set(original, at));
  const kept = new Set(longestIncreasingSubsequence(order));
  const pairs: number[] = [];
  for (let original = 0; original < slotCount; original++) {
    const at = position.get(original);
    if (at === undefined || at === original || kept.has(at)) continue;
    pairs.push(original, at - original);
  }
  return pairs.length > 0 ? pairs : null;
}

/** 最长递增子序列的**下标**（官方 `_10600._10670` 的等价物；用于挑「没动过」的那些）。
 *
 * 官方重建时是从最优末尾往回走、从后往前写回数组，所以结果天然是**升序的值序列**；
 * 这里返回的是下标，排序后与官方口径一致（`_10669` 只做 `indexOf` 判定，与顺序无关）。
 */
export function longestIncreasingSubsequence(values: number[]): number[] {
  const length: number[] = new Array(values.length).fill(1);
  const previous: number[] = values.map((_, at) => at);
  let best = 0;
  for (let i = 1; i < values.length; i++) {
    for (let k = 0; k < i; k++) {
      if (values[k] < values[i] && length[k] + 1 > length[i]) {
        length[i] = length[k] + 1;
        previous[i] = k;
        // 官方只在**严格变大**时换 best ⇒ 保留最早达到该长度的那个
        if (length[i] > length[best]) best = i;
      }
    }
  }
  const out: number[] = [];
  let at = best;
  for (let guard = 0; guard <= values.length; guard++) {
    out.push(at);
    if (previous[at] === at) break;
    at = previous[at];
  }
  return out.sort((a, b) => a - b);
}

/**
 * Sample the `ZOrder(1)` timeline. It is stepped (no tweening): the frame that
 * was arrived at wins. `order[i]` is the original slot index drawn at position
 * `i`; an empty order means "restore the original order" (spec §15).
 *
 * `.dbbin` decodes straight into `order`; the JSON authoring form keeps the
 * `zOrder` pairs instead, so those are converted here with `slotCount`.
 */
export function sampleZOrder(
  animation: DbAnimationData | null,
  position: number,
  slotCount = 0,
): number[] | null {
  const frames = animation?.zOrder?.frame;
  const loc = locateFrame(frames, position);
  const frame = loc?.frame as DbZOrderFrame | undefined;
  if (!frame) return null;
  const order = frame.order
    ?? (frame.zOrder && slotCount > 0 ? authoringToOrder(frame.zOrder, slotCount) ?? undefined : undefined);
  return order && order.length > 0 ? order : null;
}

/**
 * Sample an `IKConstraint(30)` timeline. The official runtime takes
 * `bendPositive` from the frame it arrived at (stepped) while `weight` is
 * tweened towards the next frame (格式规范).
 */
export function sampleIkFrames(
  frames: DbIkFrame[] | undefined,
  position: number,
): { bendPositive: boolean; weight: number } | null {
  const loc = locateFrame(frames, position);
  if (!loc) return null;
  const from = loc.frame;
  const to = loc.next ?? from;
  return {
    bendPositive: from.bendPositive ?? true,
    weight: lerp(from.weight ?? 1, to.weight ?? 1, loc.progress),
  };
}

/**
 * Sample the DragonBones 5.x component timelines (`translateFrame` /
 * `rotateFrame` / `scaleFrame`). Their values are offsets relative to the bone's
 * bind pose — the official runtime composes
 * `local = bind ⊕ offset ⊕ pose` (see 格式规范).
 */
export function sampleComponentFrames(
  timeline: DbBoneTimeline | undefined,
  position: number,
): BoneComponentPose | null {
  if (!timeline) return null;
  const translate = sampleFields(timeline.translateFrame, position, [['x', 0], ['y', 0]]);
  const rotate = sampleRotations(timeline.rotateFrame, position, timeline.rotateExpanded === true);
  const scale = sampleFields(timeline.scaleFrame, position, [['x', 1], ['y', 1]]);
  if (!translate && !rotate && !scale) return null;
  return {
    x: translate?.x ?? 0,
    y: translate?.y ?? 0,
    rotation: rotate?.rotate ?? 0,
    skew: rotate?.skew ?? 0,
    scaleX: scale?.x ?? 1,
    scaleY: scale?.y ?? 1,
  };
}


/**
 * Surface deform axis at \`position\` (official \`SurfaceTimelineState.blend\`).
 *
 * The binary stores one shared constant block plus a per-key window
 * (\`axisHead\` / \`axisTail\` + \`frame.offset/util.vertices\`); values outside the window
 * come from the constants, inside it they interpolate between the two keys.
 */
export function sampleSurface(
  timeline: DbSurfaceTimeline | undefined,
  position: number,
  axisLength: number,
): Float32Array | null {
  if (!timeline?.frame || timeline.frame.length === 0 || axisLength <= 0) return null;
  const loc = locateFrame(timeline.frame, position);
  if (!loc) return null;
  const begin = Math.max(0, loc.frame.offset ?? 0);
  const from = loc.frame.vertices ?? [];
  const to = loc.next?.vertices ?? from;
  const head = timeline.axisHead ?? [];
  const tail = timeline.axisTail ?? [];
  const out = new Float32Array(axisLength);
  for (let i = 0; i < axisLength; i++) {
    if (i < begin) {
      out[i] = head[i] ?? 0;
      continue;
    }
    const at = i - begin;
    if (at >= from.length) {
      out[i] = tail[at - from.length] ?? 0;
      continue;
    }
    const a = from[at] ?? 0;
    const b = loc.next ? (to[at] ?? 0) : a;
    out[i] = lerp(a, b, loc.progress);
  }
  return out;
}
