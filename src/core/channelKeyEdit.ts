/**
 * 单通道（移动 / 旋转 / 缩放）关键帧的取出与写入 —— 时间轴子行上的拖动、缩放、删除、复制粘贴都落到这里。
 *
 * - 5.x 组件形式：只改该通道自己的帧列表（`translateFrame` / `rotateFrame` / `scaleFrame`）；
 * - 4.x 整帧（BoneAll）形式：只搬该通道的 `transform` 字段，同帧其余通道原样不动；
 *   被摘空的帧（0 帧除外）整帧删掉，否则空 `{}` 会被当成「三个通道都有键」。
 *
 * 0 帧总保留一个键：运行时从第一帧开始累加 `duration`，首帧不在 0 会让整条时间线前移。
 */
import type { BoneChannelName } from './boneChannels';
import type { DbBoneFrame, DbBoneTimeline, DbTransform, DbTweenFrame } from './types';

/** 一个通道键的内容：补间 + 该通道的值（统一用 BoneAll 字段名存 bind 相对量）。 */
export interface ChannelPayload {
  tweenEasing?: number | null;
  curve?: number[];
  curveSamples?: number[];
  values: DbTransform;
}

type ComponentFrame = DbTweenFrame & { x?: number; y?: number; rotate?: number; skew?: number };
interface Item<T> { at: number; data: T }

const FIELDS: Record<BoneChannelName, Array<keyof DbTransform>> = {
  translate: ['x', 'y'],
  rotate: ['skX', 'skY'],
  scale: ['scX', 'scY'],
};
const IDENTITY: Required<DbTransform> = { x: 0, y: 0, skX: 0, skY: 0, scX: 1, scY: 1 };
const EPS = 1e-3;
const round = (value: number) => Math.round(value * 1000) / 1000;
const near = (a: number, b: number) => Math.abs(a - b) < EPS;

export function isComponentTimeline(timeline: DbBoneTimeline): boolean {
  return (timeline.frame?.length ?? 0) === 0 && ((timeline.translateFrame?.length ?? 0) > 0
    || (timeline.rotateFrame?.length ?? 0) > 0 || (timeline.scaleFrame?.length ?? 0) > 0);
}

function positioned<T extends DbTweenFrame>(frames: T[] | undefined): Array<Item<T>> {
  const out: Array<Item<T>> = [];
  let at = 0;
  for (const frame of frames ?? []) {
    out.push({ at: round(at), data: { ...frame } });
    at += frame.duration ?? 1;
  }
  return out;
}

function rebuild<T extends DbTweenFrame>(items: Array<Item<T>>, duration: number): T[] {
  const sorted = [...items].sort((a, b) => a.at - b.at);
  if (sorted.length > 0 && sorted[0].at > EPS) sorted.unshift({ at: 0, data: { ...sorted[0].data } });
  return sorted.map((item, index) => ({
    ...item.data,
    duration: round(Math.max(0, (sorted[index + 1]?.at ?? duration) - item.at)),
  }));
}

const tweenOf = (frame: DbTweenFrame): Omit<ChannelPayload, 'values'> => ({
  ...(frame.tweenEasing !== undefined ? { tweenEasing: frame.tweenEasing } : {}),
  ...(frame.curve ? { curve: [...frame.curve] } : {}),
  ...(frame.curveSamples ? { curveSamples: [...frame.curveSamples] } : {}),
});

function definedPart(transform: DbTransform | undefined, fields = Object.keys(IDENTITY) as Array<keyof DbTransform>): DbTransform {
  const out: DbTransform = {};
  for (const field of fields) if (transform?.[field] !== undefined) out[field] = transform[field];
  return out;
}

const isEmpty = (transform: DbTransform | undefined) => Object.keys(definedPart(transform)).length === 0;

function hasChannel(frame: DbBoneFrame, channel: BoneChannelName): boolean {
  return isEmpty(frame.transform) || FIELDS[channel].some((field) => frame.transform?.[field] !== undefined);
}

/** 空 `transform` 帧 = 三个通道都有键：先按「沿用上一帧」把值写实，摘一个通道才不会连带另外两个。 */
function makeExplicit(items: Array<Item<DbBoneFrame>>, index: number): void {
  if (!isEmpty(items[index].data.transform)) return;
  let carried: DbTransform = {};
  for (let i = 0; i < index; i++) carried = { ...carried, ...definedPart(items[i].data.transform) };
  items[index].data = { ...items[index].data, transform: { ...IDENTITY, ...carried } };
}

function listOf(timeline: DbBoneTimeline, channel: BoneChannelName): ComponentFrame[] | undefined {
  return channel === 'translate' ? timeline.translateFrame : channel === 'rotate' ? timeline.rotateFrame : timeline.scaleFrame;
}

function setList(timeline: DbBoneTimeline, channel: BoneChannelName, list: ComponentFrame[]): void {
  const value = list.length > 0 ? list : undefined;
  if (channel === 'translate') timeline.translateFrame = value;
  else if (channel === 'rotate') timeline.rotateFrame = value;
  else timeline.scaleFrame = value;
}

function toValues(channel: BoneChannelName, frame: ComponentFrame): DbTransform {
  if (channel === 'translate') return { x: frame.x ?? 0, y: frame.y ?? 0 };
  if (channel === 'scale') return { scX: frame.x ?? 1, scY: frame.y ?? 1 };
  const rotate = frame.rotate ?? 0;
  return { skY: rotate, skX: round(rotate + (frame.skew ?? 0)) };
}

function fromValues(channel: BoneChannelName, values: DbTransform): Partial<ComponentFrame> {
  if (channel === 'translate') return { x: values.x ?? 0, y: values.y ?? 0 };
  if (channel === 'scale') return { x: values.scX ?? 1, y: values.scY ?? 1 };
  const rotate = values.skY ?? 0;
  return { rotate, skew: round((values.skX ?? rotate) - rotate) };
}

/** 读出（`strip` 时同时摘掉）该通道在这些位置上的键；返回「请求位置 → 内容」。 */
function extract(
  timeline: DbBoneTimeline, channel: BoneChannelName, ats: number[], duration: number, strip: boolean,
): Map<number, ChannelPayload> {
  const out = new Map<number, ChannelPayload>();
  if (isComponentTimeline(timeline)) {
    const items = positioned(listOf(timeline, channel));
    const rest = items.filter((item) => {
      const at = ats.find((target) => near(target, item.at));
      if (at === undefined) return true;
      out.set(at, { ...tweenOf(item.data), values: toValues(channel, item.data) });
      return false;
    });
    if (strip && out.size > 0) setList(timeline, channel, rebuild(rest, duration));
    return out;
  }
  const items = positioned(timeline.frame).map((item) => ({ ...item, data: { ...item.data, transform: { ...item.data.transform } } }));
  const touched = new Set<number>();
  for (const at of ats) {
    const index = items.findIndex((item) => near(item.at, at) && hasChannel(item.data, channel));
    if (index < 0) continue;
    makeExplicit(items, index);
    const transform = items[index].data.transform!;
    out.set(at, { ...tweenOf(items[index].data), values: definedPart(transform, FIELDS[channel]) });
    for (const field of FIELDS[channel]) delete transform[field];
    touched.add(index);
  }
  if (strip && out.size > 0) {
    const kept = items.filter((item, index) => !touched.has(index) || item.at <= EPS || !isEmpty(item.data.transform));
    timeline.frame = rebuild(kept, duration);
  }
  return out;
}

export const readChannelKeys = (timeline: DbBoneTimeline, channel: BoneChannelName, ats: number[], duration: number) =>
  extract(timeline, channel, ats, duration, false);

export const takeChannelKeys = (timeline: DbBoneTimeline, channel: BoneChannelName, ats: number[], duration: number) =>
  extract(timeline, channel, ats, duration, true);

/** 写入通道键：落在已有键上 = 覆盖该通道的值（沿用目标帧的补间），否则插入新键。 */
export function putChannelKeys(
  timeline: DbBoneTimeline, channel: BoneChannelName, entries: Array<{ at: number; payload: ChannelPayload }>,
  duration: number, component = isComponentTimeline(timeline),
): number {
  if (entries.length === 0) return 0;
  if (component) {
    const items = positioned(listOf(timeline, channel));
    for (const { at, payload } of entries) {
      const { values, ...tween } = payload;
      const existing = items.find((item) => near(item.at, at));
      if (existing) existing.data = { ...existing.data, ...fromValues(channel, values) };
      else items.push({ at, data: { duration: 0, ...tween, ...fromValues(channel, values) } });
    }
    setList(timeline, channel, rebuild(items, duration));
    return entries.length;
  }
  const items = positioned(timeline.frame).map((item) => ({ ...item, data: { ...item.data, transform: { ...item.data.transform } } }));
  for (const { at, payload } of entries) {
    const { values, ...tween } = payload;
    const index = items.findIndex((item) => near(item.at, at));
    if (index >= 0) {
      makeExplicit(items, index);
      Object.assign(items[index].data.transform!, values);
    } else items.push({ at, data: { duration: 0, ...tween, transform: { ...values } } });
  }
  timeline.frame = rebuild(items, duration);
  return entries.length;
}

/** 把该通道的键按 `moves`（原位置 → 新位置）搬走：先全部取出再统一写入，互不覆盖。 */
export function relocateChannelKeys(
  timeline: DbBoneTimeline, channel: BoneChannelName, moves: Map<number, number>, duration: number,
): number {
  const component = isComponentTimeline(timeline);
  const taken = takeChannelKeys(timeline, channel, [...moves.keys()], duration);
  const entries = [...taken].map(([from, payload]) => ({ at: moves.get(from) ?? from, payload }));
  putChannelKeys(timeline, channel, entries, duration, component);
  return taken.size;
}
