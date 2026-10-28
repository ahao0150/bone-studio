/**
 * Animation-curve editing (official 曲线面板 / 动画曲线).
 *
 * Official contract (Loongbones `ui-curve.md` / `anim-curve.md`):
 * the panel shows the curve **after the selected keyframe**; curves are polylines,
 * straight lines or bezier curves; clicking the curve adds a point and dragging a
 * point/handle edits it; the value range is usually 0–100 but may exceed it.
 *
 * Data shape (verified against the shipped official samples, §21): the curve is a
 * flat control-point list `[x2, y2, x3, y3, (x4, y4, x2, y2, x3, y3, …)]` where the
 * first/last vertices `(0,0)`/`(1,1)` are implied, so `length % 3 === 1` marks the
 * joined multi-segment form and `length === 4` is a single segment.
 */
import type { DbBoneFrame } from './types';
import { activeAnimation, boneTimeline, materializeComponentTimeline } from './editing';
import { getCurveEasingValue } from './runtime/animation';
import type { Player } from './player';

export type CurveKind = 'step' | 'linear' | 'easing' | 'curve';

export interface CurveState {
  kind: CurveKind;
  /** bezier control points (empty unless `kind === 'curve'`) */
  points: number[];
  /** quadratic easing amount when `kind === 'easing'` */
  easing?: number;
  /** the frame's tween span, in frames */
  duration: number;
  /** absolute position of the keyframe that owns this curve */
  frame: number;
}

/**
 * Presets the official panel exposes, using the control points that the shipped
 * official samples actually contain (`[0,0,1,1]` 391×, `[0.5,0,0.5,1]` 148×,
 * `[0,0,0.5,1]` 33×, `[0.5,0,1,1]` 22×).
 */
export const CURVE_PRESETS = {
  step: { label: '台阶', kind: 'step' as const },
  linear: { label: '线性', kind: 'linear' as const },
  // measured with the runtime's own evaluator: [0.5,0,1,1] starts slow (渐入),
  // [0,0,0.5,1] starts fast (渐出)
  easeIn: { label: '渐入', kind: 'curve' as const, points: [0.5, 0, 1, 1] },
  easeOut: { label: '渐出', kind: 'curve' as const, points: [0, 0, 0.5, 1] },
  easeInOut: { label: '渐入渐出', kind: 'curve' as const, points: [0.5, 0, 0.5, 1] },
} as const;

export type CurvePresetName = keyof typeof CURVE_PRESETS;

const round = (value: number) => Math.round(value * 1000) / 1000;
const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

function editableTimeline(player: Player, bone: string) {
  const animation = activeAnimation(player);
  if (!animation) return null;
  let timeline = boneTimeline(player, bone);
  if (!timeline) return null;
  if ((timeline.frame?.length ?? 0) === 0) {
    if (!materializeComponentTimeline(player, bone)) return null;
    timeline = boneTimeline(player, bone);
  }
  return timeline;
}

/** Keyframe at `frame`, or the last one before it (the panel edits "the key you are on"). */
export function keyFrameAt(player: Player | null, bone: string | null, frame: number): { frame: DbBoneFrame; at: number } | null {
  if (!player || !bone) return null;
  const timeline = boneTimeline(player, bone);
  const frames = timeline?.frame ?? [];
  if (frames.length === 0) {
    const materialized = keyFrameAtMaterialized(player, bone, frame);
    return materialized;
  }
  let at = 0;
  let best: { frame: DbBoneFrame; at: number } | null = null;
  for (const entry of frames) {
    if (at > frame + 1e-6) break;
    best = { frame: entry, at: round(at) };
    at += entry.duration || 0;
  }
  return best ?? (frames.length > 0 ? { frame: frames[0], at: 0 } : null);
}

/**
 * 组件形式只读：取播放头处（或之前）最近的通道键。不能在这里转成整帧 —— 属性面板每次渲染都会读，
 * 一转就给另外两个通道凭空补出键。
 */
function keyFrameAtMaterialized(player: Player, bone: string, frame: number) {
  const timeline = boneTimeline(player, bone);
  let best: { frame: DbBoneFrame; at: number } | null = null;
  let first: { frame: DbBoneFrame; at: number } | null = null;
  for (const component of [timeline?.translateFrame, timeline?.rotateFrame, timeline?.scaleFrame]) {
    let at = 0;
    for (const entry of component ?? []) {
      const start = round(at);
      first = first ?? { frame: entry as DbBoneFrame, at: start };
      if (start > frame + 1e-6) break;
      if (!best || start > best.at) best = { frame: entry as DbBoneFrame, at: start };
      at += entry.duration || 0;
    }
  }
  return best ?? first;
}

/**
 * 骨骼关键帧的补间状态（官方 `TweenFolderItem`）：tweenEasing 为 NaN = 不补间；有 curve = 曲线；其余 = 线性。
 * `exact`：播放头正好落在这个键上（属性面板只对「当前键」开放编辑）。
 * `rotate`：官方「旋转」：0 = 自动；>0 顺时针、圈数 = 值 - 1；<0 逆时针、圈数 = -值 - 1。
 */
export interface KeyTweenState {
  exact: boolean;
  tween: 'none' | 'line' | 'curve';
  rotate: number;
  last: boolean;
}

export function readKeyTween(player: Player | null, bone: string | null, frame: number): KeyTweenState | null {
  const key = keyFrameAt(player, bone, frame);
  if (!key) return null;
  const entry = key.frame as DbBoneFrame & { tweenRotate?: number };
  const frames = boneTimeline(player, bone!)?.frame ?? [];
  const tween = Number.isNaN(entry.tweenEasing as number) ? 'none' : entry.curve?.length ? 'curve' : 'line';
  return {
    exact: Math.abs(key.at - frame) < 1e-3,
    tween,
    rotate: Number(entry.tweenRotate ?? 0),
    last: frames.length > 0 && frames[frames.length - 1] === entry,
  };
}

/** 写「旋转」方向与圈数（0 = 自动，删掉字段）。 */
export function setTweenRotate(player: Player | null, bone: string | null, frame: number, value: number): boolean {
  if (!player || !bone || !editableTimeline(player, bone)) return false;
  const key = keyFrameAt(player, bone, frame);
  if (!key) return false;
  const entry = key.frame as DbBoneFrame & { tweenRotate?: number };
  if (value === 0) delete entry.tweenRotate;
  else entry.tweenRotate = value;
  return true;
}

export function readKeyCurve(player: Player | null, bone: string | null, frame: number): CurveState | null {
  const key = keyFrameAt(player, bone, frame);
  if (!key) return null;
  const { frame: entry, at } = key;
  const duration = entry.duration ?? 1;
  if (Number.isNaN(entry.tweenEasing as number)) return { kind: 'step', points: [], duration, frame: at };
  if (entry.curve && entry.curve.length > 0) {
    return { kind: 'curve', points: [...entry.curve], duration, frame: at };
  }
  const easing = entry.tweenEasing;
  if (typeof easing === 'number' && easing !== 0) return { kind: 'easing', points: [], easing, duration, frame: at };
  return { kind: 'linear', points: [], duration, frame: at };
}

/** Write a new curve / preset onto the selected keyframe. */
export function setKeyCurve(
  player: Player,
  bone: string,
  frame: number,
  next: { kind: CurveKind; points?: number[]; easing?: number },
): boolean {
  const timeline = editableTimeline(player, bone);
  if (!timeline) return false;
  const key = keyFrameAt(player, bone, frame);
  if (!key) return false;
  const entry = key.frame;
  switch (next.kind) {
    case 'step':
      entry.tweenEasing = Number.NaN;
      entry.curve = undefined;
      entry.curveSamples = undefined;
      return true;
    case 'linear':
      entry.tweenEasing = 0;
      entry.curve = undefined;
      entry.curveSamples = undefined;
      return true;
    case 'easing':
      entry.tweenEasing = next.easing ?? 0;
      entry.curve = undefined;
      entry.curveSamples = undefined;
      return true;
    case 'curve':
      if (!next.points || next.points.length < 4) return false;
      entry.curve = sanitizeCurve(next.points);
      entry.tweenEasing = undefined;
      entry.curveSamples = undefined;
      return true;
    default:
      return false;
  }
}

/** Keep the control points inside the official-ish range and ordered along x. */
export function sanitizeCurve(points: number[]): number[] {
  const out = points.map((value) => round(clamp(value, -1, 2)));
  for (let i = 0; i + 1 < out.length; i += 6) {
    // multi-segment joins are shared vertices: keep x monotonic so the sampler can
    // bisect (the official writer assumes increasing x)
    if (i + 6 < out.length) out[i + 6] = Math.max(out[i + 6], out[i] + 0.001);
  }
  return out;
}

export function applyPreset(
  player: Player,
  bone: string,
  frame: number,
  preset: CurvePresetName,
): boolean {
  const entry = CURVE_PRESETS[preset];
  if (entry.kind === 'step') return setKeyCurve(player, bone, frame, { kind: 'step' });
  if (entry.kind === 'linear') return setKeyCurve(player, bone, frame, { kind: 'linear' });
  return setKeyCurve(player, bone, frame, { kind: 'curve', points: [...entry.points] });
}

/** Eased progress at `t`, identical to what the runtime plays. */
export function curveValue(points: number[], t: number): number {
  if (points.length === 0) return t;
  return getCurveEasingValue(t, points);
}

/** Sample table for the panel's polyline overlay (`count` samples in `[0,1]`). */
export function curveSamples(points: number[], count: number, kind: CurveKind = 'curve'): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = count > 1 ? i / (count - 1) : 0;
    out.push(kind === 'curve' && points.length > 0 ? curveValue(points, t) : kind === 'step' ? 0 : t);
  }
  return out;
}

/** True when the frame's span can carry a curve (official: 台阶-only timelines). */
export function curveEditable(player: Player | null, bone: string | null, frame: number): boolean {
  const state = readKeyCurve(player, bone, frame);
  return state !== null && state.duration > 0;
}

/** Clipboard payload for 复制/粘贴曲线. */
export type CurveClipboard = { kind: CurveKind; points: number[]; easing?: number };

export function copyCurve(state: CurveState): CurveClipboard {
  return { kind: state.kind === 'easing' ? 'easing' : state.kind, points: [...state.points], easing: state.easing };
}

export function pasteCurve(player: Player, bone: string, frame: number, clip: CurveClipboard): boolean {
  if (clip.kind === 'step') return setKeyCurve(player, bone, frame, { kind: 'step' });
  if (clip.kind === 'linear') return setKeyCurve(player, bone, frame, { kind: 'linear' });
  if (clip.kind === 'easing') return setKeyCurve(player, bone, frame, { kind: 'easing', easing: clip.easing ?? 0 });
  return setKeyCurve(player, bone, frame, { kind: 'curve', points: [...clip.points] });
}
