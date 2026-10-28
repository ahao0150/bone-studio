/**
 * IK 约束关键帧编辑 —— 属性面板「IK 权重 / 弯曲方向」右侧旗杆的落点。
 *
 * 数据契约（`格式规范` §13.4；官方 `IKConstraint(30)` 时间轴）：
 *   - `animation.ik[]` 按**约束名**（不是骨骼名）一条轨道；
 *   - 每帧存 `weight`（0..1，二进制里是 `round(weight * 100)`）与 `bendPositive`（bool）；
 *   - 求值见 `runtime/animation.ts#sampleIkFrames`：`bendPositive` 阶梯、`weight` 线性补间。
 *
 * 插帧语义与骨骼（`editing.ts#setBoneTransform`）/ FFD（`ffdEdit.ts`）保持一致：
 * 命中已有帧就改；落在区间里就把该帧一分为二；在末尾之后追加。
 * 轨道为空且播放头 > 0 时先在 0 插一帧「沿用绑定值」的头帧，保证打键之前的姿态不变。
 */
import type { DbAnimationData, DbIkConstraintData, DbIkFrame, DbIkTimeline } from './types';
import { parseBoolean } from './runtime/math';
import { sampleIkFrames } from './runtime/animation';

const EPS = 1e-4;
const round = (value: number) => Math.round(value * 1000) / 1000;

/** 一帧 IK 值（与 `DbIkFrame` 的可写字段一一对应）。 */
export interface IkKeyValues {
  weight: number;
  bendPositive: boolean;
}

export function ikTimelineOf(animation: DbAnimationData, name: string): DbIkTimeline | null {
  return (animation.ik ?? []).find((timeline) => timeline.name === name) ?? null;
}

function ensureTimeline(animation: DbAnimationData, name: string): DbIkTimeline {
  if (!animation.ik) animation.ik = [];
  const existing = ikTimelineOf(animation, name);
  if (existing) return existing;
  const created: DbIkTimeline = { name, frame: [] };
  animation.ik.push(created);
  return created;
}

/** 每帧的起始帧号（累加 duration；缺省 duration = 1，见 §14.3）。 */
function startPositions(frames: DbIkFrame[]): number[] {
  const starts: number[] = [];
  let at = 0;
  for (const frame of frames) {
    starts.push(at);
    at += frame.duration ?? 1;
  }
  return starts;
}

function writeFrame(frame: DbIkFrame, values: IkKeyValues): void {
  frame.weight = round(values.weight);
  frame.bendPositive = values.bendPositive;
}

/** 绑定约束上的取值（没有关键帧时的回落；`bendPositive` 走官方的 `parseBoolean`）。 */
export function ikBindValues(constraint: DbIkConstraintData): IkKeyValues {
  return {
    weight: constraint.weight ?? 1,
    bendPositive: parseBoolean(constraint.bendPositive, true),
  };
}

/** 播放头采样到的 IK 值；没有轨道 / 帧时返回 null（调用方回落到绑定约束）。 */
export function readIkKey(
  animation: DbAnimationData | null | undefined, name: string, position: number,
): IkKeyValues | null {
  const timeline = animation ? ikTimelineOf(animation, name) : null;
  return timeline ? sampleIkFrames(timeline.frame, position) : null;
}

/** 播放头是否正好落在某个 IK 帧的起点上（旗杆的点亮条件）。 */
export function ikKeyAt(
  animation: DbAnimationData | null | undefined, name: string, position: number,
): boolean {
  const timeline = animation ? ikTimelineOf(animation, name) : null;
  if (!timeline?.frame?.length) return false;
  return startPositions(timeline.frame).some((start) => Math.abs(start - position) < EPS);
}

/**
 * 在 `position` 写一帧 IK 值。`base` 是轨道为空时头帧（帧 0）沿用的取值，
 * 通常传绑定约束的 weight / bendPositive —— 这样打键之前的姿态保持不变。
 */
export function setIkKeyframe(
  animation: DbAnimationData, name: string, position: number,
  values: IkKeyValues, base?: IkKeyValues,
): boolean {
  const timeline = ensureTimeline(animation, name);
  const duration = Math.max(1, animation.duration ?? 1);
  const at = Math.min(duration, Math.max(0, position));
  const frames = timeline.frame ?? (timeline.frame = []);

  if (frames.length === 0) {
    if (at > EPS) {
      const head: DbIkFrame = { duration: round(at), tweenEasing: 0 };
      writeFrame(head, base ?? values);
      frames.push(head);
    }
    const tail: DbIkFrame = { duration: Math.max(0.01, round(duration - at)), tweenEasing: 0 };
    writeFrame(tail, values);
    frames.push(tail);
    return true;
  }

  const starts = startPositions(frames);
  const exact = starts.findIndex((start) => Math.abs(start - at) < EPS);
  if (exact >= 0) {
    writeFrame(frames[exact], values);
    return true;
  }

  for (let i = 0; i < frames.length; i++) {
    const span = frames[i].duration ?? 1;
    if (at > starts[i] + EPS && at < starts[i] + span - EPS) {
      const head = frames[i];
      const split = at - starts[i];
      const tail: DbIkFrame = {
        duration: Math.max(0.01, round(span - split)),
        tweenEasing: head.tweenEasing,
        curve: head.curve,
        curveSamples: head.curveSamples,
      };
      head.duration = round(split);
      writeFrame(tail, values);
      frames.splice(i + 1, 0, tail);
      return true;
    }
  }

  const lastIndex = frames.length - 1;
  const tail: DbIkFrame = { duration: Math.max(0.01, round(duration - at)), tweenEasing: 0 };
  writeFrame(tail, values);
  frames[lastIndex].duration = Math.max(0.01, round(at - starts[lastIndex]));
  frames.push(tail);
  return true;
}

function dropFrame(frames: DbIkFrame[], index: number): void {
  if (frames.length <= 1) {
    frames.splice(0, frames.length);
    return;
  }
  const span = frames[index].duration ?? 1;
  if (index + 1 < frames.length) frames[index + 1].duration = (frames[index + 1].duration ?? 1) + span;
  else frames[index - 1].duration = (frames[index - 1].duration ?? 1) + span;
  frames.splice(index, 1);
}

/** 删掉当前帧的 IK 键，时长并进相邻帧。轨道被掏空就整条去掉。 */
export function removeIkKeyframe(animation: DbAnimationData, name: string, position: number): boolean {
  const timeline = ikTimelineOf(animation, name);
  if (!timeline?.frame?.length) return false;
  const index = startPositions(timeline.frame).findIndex((start) => Math.abs(start - position) < EPS);
  if (index < 0) return false;
  dropFrame(timeline.frame, index);
  if (timeline.frame.length === 0) removeIkTrack(animation, name);
  return true;
}

/** 清掉某条 IK 约束的整条轨道。 */
export function removeIkTrack(animation: DbAnimationData, name: string): boolean {
  const list = animation.ik;
  if (!list) return false;
  const index = list.findIndex((timeline) => timeline.name === name);
  if (index < 0) return false;
  list.splice(index, 1);
  return true;
}
