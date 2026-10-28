/**
 * 事件帧（官方 `Event` 时间轴 / `EventPanel`）：动画自己的 `frame[].actions`。
 *
 * 官方图 5 给三类添加入口：**自定义事件 / 声音事件 / 动画控制（跳转播放）**。
 * 这里写最小可用模型：在某一帧加 / 删一个事件、列出某帧的事件。
 * 时不落 `duration` 之外的字段，导出格式保持 `animation.frame[]` 原样。
 */
import type { Player } from './player';
import type { DbActionFrame } from './types';

export type EventKind = 'custom' | 'sound' | 'action';

const round = (value: number) => Math.round(value * 1000) / 1000;

/** 一帧上的事件（列表用）。 */
export interface EventEntry {
  index: number;
  label: string;
  kind: string;
  /** 官方 `EventFolderItem`：目标骨骼与三类参数 */
  bone: string;
  ints: number[];
  floats: number[];
  strings: string[];
}

function startsOf(frames: Array<{ duration?: number }>): number[] {
  const out: number[] = [];
  let at = 0;
  for (const frame of frames) {
    out.push(round(at));
    at += frame.duration ?? 1;
  }
  return out;
}

function frames(player: Player): DbActionFrame[] {
  const animation = player.animation;
  if (!animation) throw new Error('当前工程没有动画数据');
  return animation.frame ?? (animation.frame = []);
}

/** 覆盖 `frame` 的那一帧的下标（没有就新建一帧，语义与骨骼帧的切分一致）。 */
function frameIndexAt(list: DbActionFrame[], frame: number, duration: number): number {
  const at = Math.max(0, Math.round(frame));
  const starts = startsOf(list);
  const exact = starts.findIndex((value) => Math.abs(value - at) < 1e-4);
  if (exact >= 0) return exact;
  for (let index = 0; index < list.length; index++) {
    const span = list[index].duration ?? 1;
    if (at > starts[index] && at < starts[index] + span) {
      const head = list[index];
      const tail: DbActionFrame = { duration: Math.max(0.01, round(span - (at - starts[index]))) };
      head.duration = round(at - starts[index]);
      list.splice(index + 1, 0, tail);
      return index + 1;
    }
  }
  const last = list.length - 1;
  if (last >= 0) {
    const lastStart = starts[last];
    const head = round(at - lastStart);
    if (head > 0) {
      list[last].duration = head;
      const tail: DbActionFrame = { duration: Math.max(0.01, round(Math.max(1, duration) - at)) };
      list.push(tail);
      return list.length - 1;
    }
    return last;
  }
  if (at > 0) list.push({ duration: round(at) });
  list.push({ duration: Math.max(0.01, round(Math.max(1, duration) - at)) });
  return list.length - 1;
}

/** 当前帧的事件列表（面板用）。 */
export function eventsAt(player: Player | null, frame: number): EventEntry[] {
  const animation = player?.animation;
  if (!player || !animation) return [];
  const list = animation.frame ?? [];
  const starts = startsOf(list);
  const at = Math.max(0, Math.round(frame));
  const index = starts.findIndex((value) => Math.abs(value - at) < 1e-4);
  if (index < 0) return [];
  const actions = (list[index].actions ?? []) as Array<Record<string, unknown>>;
  return actions.map((action, position) => ({
    index: position,
    label: String(action.name ?? action.gotoAndPlay ?? action.type ?? 'event'),
    kind: action.gotoAndPlay ? 'action' : String(action.sound ? 'sound' : 'custom'),
    bone: action.bone ? String(action.bone) : '',
    ints: [...((action.ints as number[] | undefined) ?? [])],
    floats: [...((action.floats as number[] | undefined) ?? [])],
    strings: [...((action.strings as string[] | undefined) ?? [])],
  }));
}

/** 官方「添加自定义事件 / 声音事件 / 动画控制」。 */
export function addEventFrame(player: Player | null, frame: number, kind: EventKind, name: string): boolean {
  if (!player?.animation) return false;
  const list = frames(player);
  const duration = player.animation.duration || 1;
  const index = frameIndexAt(list, frame, duration);
  const target = list[index];
  const action: Record<string, unknown> = kind === 'action'
    ? { type: 0, name, gotoAndPlay: name }
    : kind === 'sound'
      ? { name, sound: name }
      : { name };
  target.actions = [...(target.actions ?? []), action];
  return true;
}

/** 删掉某帧上的第 `position` 个事件。 */
export function removeEventFrame(player: Player | null, frame: number, position: number): boolean {
  const animation = player?.animation;
  if (!player || !animation) return false;
  const list = animation.frame ?? [];
  const starts = startsOf(list);
  const at = Math.max(0, Math.round(frame));
  const index = starts.findIndex((value) => Math.abs(value - at) < 1e-4);
  if (index < 0) return false;
  const actions = [...((list[index].actions ?? []) as unknown[])];
  if (position < 0 || position >= actions.length) return false;
  actions.splice(position, 1);
  if (actions.length > 0) list[index].actions = actions;
  else delete list[index].actions;
  return true;
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** 某个事件帧起点上的事件原始对象（复制用，深拷贝）。 */
export function eventActionsAt(player: Player | null, frame: number): Array<Record<string, unknown>> {
  const animation = player?.animation;
  if (!player || !animation) return [];
  const list = animation.frame ?? [];
  const starts = startsOf(list);
  const at = Math.max(0, Math.round(frame));
  const index = starts.findIndex((value) => Math.abs(value - at) < 1e-4);
  if (index < 0) return [];
  return clone((list[index].actions ?? []) as Array<Record<string, unknown>>);
}

/** 把复制来的事件原样追加到某帧（没有这一帧就新建，与 `addEventFrame` 同一套切分）。 */
export function appendEventActions(player: Player | null, frame: number, actions: Array<Record<string, unknown>>): boolean {
  if (!player?.animation || actions.length === 0) return false;
  const list = frames(player);
  const index = frameIndexAt(list, frame, player.animation.duration || 1);
  list[index].actions = [...((list[index].actions ?? []) as unknown[]), ...clone(actions)] as DbActionFrame['actions'];
  return true;
}

/** 官方 `EventFolderItem` 的目标骨骼 / 整型 / 浮点 / 字符串：只改传入的字段。 */
export function updateEventParams(
  player: Player | null,
  frame: number,
  position: number,
  patch: { bone?: string; ints?: number[]; floats?: number[]; strings?: string[] },
): boolean {
  const animation = player?.animation;
  if (!player || !animation) return false;
  const list = animation.frame ?? [];
  const starts = startsOf(list);
  const at = Math.max(0, Math.round(frame));
  const index = starts.findIndex((value) => Math.abs(value - at) < 1e-4);
  if (index < 0) return false;
  const actions = [...((list[index].actions ?? []) as Array<Record<string, unknown>>)];
  const current = actions[position];
  if (!current) return false;
  const next: Record<string, unknown> = { ...current };
  if (patch.bone !== undefined) { if (patch.bone) next.bone = patch.bone; else delete next.bone; }
  if (patch.ints !== undefined) next.ints = patch.ints;
  if (patch.floats !== undefined) next.floats = patch.floats;
  if (patch.strings !== undefined) next.strings = patch.strings;
  actions[position] = next;
  list[index].actions = actions as DbActionFrame['actions'];
  return true;
}