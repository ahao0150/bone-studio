/**
 * FFD（网格变形）编辑 —— M4 的「FFD 可视化编辑」。
 *
 * 数据契约（§23.12–23.18 已格式验证）：
 *   - `animation.ffd[]` 按**槽位**一条轨道，轨道有自己的 `offset`（窗口在顶点浮点轴上的起点）；
 *   - 每个关键帧的 `vertices` 是**偏移量**（不是绝对坐标），索引 = `offset + 顶点浮点索引`；
 *   - 求值是 `base[i] = display.vertices[i] + lerp(frame.vertices[offset+i], next.vertices[offset+i])`
 *     （`runtime/animation.ts` 的 `sampleFfd`）。
 *
 * 写帧沿用骨骼时间轴的同一套插帧语义（`editing.ts` 的 `setBoneTransform`）：
 * 命中已有帧就改；落在区间里就把该帧一分为二；在末尾之后则缩短末帧并追加。
 */
import type { DbAnimationData, DbFfdFrame, DbFfdTimeline } from './types';
import { sampleFfd } from './runtime/animation';

const EPS = 1e-4;
const round = (value: number) => Math.round(value * 1000) / 1000;

/** 每条帧的起始帧号（累加 duration；缺省 duration = 1，见 §14.3）。 */
function startPositions(frames: DbFfdFrame[]): number[] {
  const starts: number[] = [];
  let at = 0;
  for (const frame of frames) {
    starts.push(at);
    at += frame.duration ?? 1;
  }
  return starts;
}

export function ffdTimelineOf(animation: DbAnimationData, slot: string): DbFfdTimeline | null {
  return (animation.ffd ?? []).find((timeline) => timeline.slot === slot) ?? null;
}

function ensureTimeline(animation: DbAnimationData, slot: string): DbFfdTimeline {
  if (!animation.ffd) animation.ffd = [];
  const existing = ffdTimelineOf(animation, slot);
  if (existing) return existing;
  const created: DbFfdTimeline = { slot, frame: [] };
  animation.ffd.push(created);
  return created;
}

/** 当前帧上某个顶点的 FFD 偏移（没有轨道/帧时是 0,0）。 */
export function readFfdVertex(
  timeline: DbFfdTimeline | null, position: number, vertex: number, vertexCount: number,
): [number, number] {
  const empty: [number, number] = [0, 0];
  if (!timeline || vertex < 0 || vertex >= vertexCount) return empty;
  const values = sampleFfd(timeline, position, timeline.offset ?? 0, vertexCount * 2);
  if (!values) return empty;
  return [values[vertex * 2], values[vertex * 2 + 1]];
}

/**
 * 把某个顶点在当前帧的 FFD 偏移增加 `(dx, dy)`。
 * 新帧会先以**当前采样值**为底（这样只动被拖的那个顶点，其余顶点保持不变）。
 */
export function setFfdVertex(
  animation: DbAnimationData, slot: string, position: number, vertex: number,
  dx: number, dy: number, vertexCount: number,
): boolean {
  if (vertex < 0 || vertex >= vertexCount) return false;
  const timeline = ensureTimeline(animation, slot);
  const floatCount = vertexCount * 2;
  const offset = timeline.offset ?? 0;
  const values = Array.from(sampleFfd(timeline, position, offset, floatCount) ?? new Array(floatCount).fill(0));
  values[vertex * 2] = round(values[vertex * 2] + dx);
  values[vertex * 2 + 1] = round(values[vertex * 2 + 1] + dy);

  const duration = Math.max(1, animation.duration ?? 1);
  const at = Math.min(duration, Math.max(0, position));
  const frames = timeline.frame ?? (timeline.frame = []);
  const write = (frame: DbFfdFrame) => {
    const target = frame.vertices ?? (frame.vertices = []);
    for (let i = 0; i < floatCount; i++) target[offset + i] = values[i];
  };

  if (frames.length === 0) {
    if (at > EPS) frames.push({ duration: round(at), tweenEasing: 0 });
    frames.push({ duration: Math.max(0.01, round(duration - at)), tweenEasing: 0 });
    write(frames[frames.length - 1]);
    return true;
  }

  const starts = startPositions(frames);
  const exact = starts.findIndex((start) => Math.abs(start - at) < EPS);
  if (exact >= 0) {
    write(frames[exact]);
    return true;
  }

  for (let i = 0; i < frames.length; i++) {
    const span = frames[i].duration ?? 1;
    if (at > starts[i] + EPS && at < starts[i] + span - EPS) {
      const head = frames[i];
      const split = at - starts[i];
      const tail: DbFfdFrame = {
        duration: Math.max(0.01, round(span - split)),
        tweenEasing: head.tweenEasing,
        curve: head.curve,
        curveSamples: head.curveSamples,
      };
      head.duration = round(split);
      write(tail);
      frames.splice(i + 1, 0, tail);
      return true;
    }
  }

  const lastIndex = frames.length - 1;
  const tail: DbFfdFrame = { duration: Math.max(0.01, round(duration - at)), tweenEasing: 0 };
  write(tail);
  const lastSpan = frames[lastIndex].duration ?? 1;
  frames[lastIndex].duration = Math.max(0.01, round(lastSpan - (duration - at)));
  frames.push(tail);
  return true;
}

/** 当前播放头是不是这条 FFD 轨道上某个带偏移的帧的起点。没有 vertices 的占位帧不算键。 */
export function ffdKeyAt(animation: DbAnimationData | null | undefined, slot: string, position: number): boolean {
  const timeline = animation ? ffdTimelineOf(animation, slot) : null;
  if (!timeline?.frame?.length) return false;
  const starts = startPositions(timeline.frame);
  const index = starts.findIndex((start) => Math.abs(start - position) < EPS);
  return index >= 0 && (timeline.frame[index].vertices?.length ?? 0) > 0;
}

function dropFrame(frames: DbFfdFrame[], index: number): void {
  if (frames.length <= 1) {
    frames.splice(0, frames.length);
    return;
  }
  const removed = frames[index];
  const span = removed.duration ?? 1;
  if (index + 1 < frames.length) {
    frames[index + 1].duration = (frames[index + 1].duration ?? 1) + span;
  } else {
    frames[index - 1].duration = (frames[index - 1].duration ?? 1) + span;
  }
  frames.splice(index, 1);
}

/**
 * 删掉当前帧的 FFD 键，时长并进相邻帧。轨道被掏空就整条去掉。
 * 只清偏移会让帧还在，旗杆会一直亮。
 */
export function removeFfdKeyframe(animation: DbAnimationData, slot: string, position: number): boolean {
  const timeline = ffdTimelineOf(animation, slot);
  if (!timeline?.frame?.length) return false;
  const starts = startPositions(timeline.frame);
  const index = starts.findIndex((start) => Math.abs(start - position) < EPS);
  if (index < 0 || (timeline.frame[index].vertices?.length ?? 0) === 0) return false;
  dropFrame(timeline.frame, index);
  if (timeline.frame.length === 0 || timeline.frame.every((frame) => (frame.vertices?.length ?? 0) === 0)) {
    removeFfdTrack(animation, slot);
  }
  return true;
}

/** 清掉某个槽位的整条 FFD 轨道。 */
export function removeFfdTrack(animation: DbAnimationData, slot: string): boolean {
  const list = animation.ffd;
  if (!list) return false;
  const index = list.findIndex((timeline) => timeline.slot === slot);
  if (index < 0) return false;
  list.splice(index, 1);
  return true;
}

/** 清掉某一帧的 FFD（把该帧的偏移归零；帧本身保留）。 */
export function clearFfdFrame(
  animation: DbAnimationData, slot: string, position: number,
): boolean {
  const timeline = ffdTimelineOf(animation, slot);
  if (!timeline?.frame?.length) return false;
  const starts = startPositions(timeline.frame);
  const index = starts.findIndex((start) => Math.abs(start - position) < EPS);
  if (index < 0) return false;
  delete timeline.frame[index].vertices;
  return true;
}
