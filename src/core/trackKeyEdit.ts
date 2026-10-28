/**
 * 时间轴「非骨骼轨道」的关键帧选区（官方 `Timeline` 的帧选择 / 复制 / 删除对插槽、事件同样生效）。
 *
 * 选区条目 `channel` 就是时间轴通道行的 id：
 *   slot-<插槽>-color · slot-<插槽>-display · ik-<约束> · events · zorder
 * 支持：删除、复制、粘贴、移动（复制 → 删除 → 粘贴）。IK / 绘制顺序可删，复制与移动暂不支持（会计入 skipped）。
 */
import type { Player } from './player';
import type { ExtraTrack } from './timelineTracks';
import {
  colorKeyAt, displayKeyAt, slotColorAt, setSlotColorKeyframe, removeSlotColorKeyframe,
  setSlotDisplayKeyframe, removeSlotDisplayKeyframe,
} from './slotEdit';
import { eventsAt, eventActionsAt, appendEventActions, removeEventFrame } from './eventEdit';
import { removeIkKeyframe } from './ikKeyEdit';
import { removeZOrderKeyframe } from './zorderEdit';

export interface TrackKeyRef { channel: string; frame: number }

type SlotColor = NonNullable<ReturnType<typeof slotColorAt>>;
type ActionRecord = Record<string, unknown>;

export interface TrackClipItem { channel: string; offset: number; color?: SlotColor; index?: number; actions?: ActionRecord[] }
export interface TrackClipboard { base: number; span: number; items: TrackClipItem[]; skipped: number }

interface Parsed { kind: 'color' | 'display' | 'ik' | 'events' | 'zorder'; name: string }

function parse(channel: string): Parsed | null {
  if (channel === 'events') return { kind: 'events', name: '' };
  if (channel === 'zorder') return { kind: 'zorder', name: '' };
  if (channel.startsWith('slot-')) {
    if (channel.endsWith('-color')) return { kind: 'color', name: channel.slice(5, -6) };
    if (channel.endsWith('-display')) return { kind: 'display', name: channel.slice(5, -8) };
  }
  // IK 轨道不拆通道：选区 id 就是轨道 id `ik-<约束名>`
  if (channel.startsWith('ik-')) return { kind: 'ik', name: channel.slice(3) };
  return null;
}

const keyOf = (ref: TrackKeyRef) => `${ref.channel}@${Math.round(ref.frame)}`;

/** 把一条轨道的一次点击 / 框选展开成通道级选区：有子通道就选中有键的那几条，否则选轨道本身。 */
export function expandTrackRef(track: ExtraTrack, channel: string | null, frame: number): TrackKeyRef[] {
  const at = Math.round(frame);
  if (channel) return [{ channel, frame: at }];
  if (track.channels?.length) {
    return track.channels
      .filter((entry) => entry.frames.some((value) => Math.round(value) === at))
      .map((entry) => ({ channel: entry.id, frame: at }));
  }
  return [{ channel: track.id, frame: at }];
}

/** 整个动画的轨道键（「选中全部关键帧」用）。 */
export function allTrackRefs(tracks: ExtraTrack[]): TrackKeyRef[] {
  const out: TrackKeyRef[] = [];
  for (const track of tracks) {
    if (track.channels?.length) {
      for (const channel of track.channels) for (const value of channel.frames) out.push({ channel: channel.id, frame: Math.round(value) });
    } else {
      for (const value of track.frames) out.push({ channel: track.id, frame: Math.round(value) });
    }
  }
  return out;
}

/** 合并两份选区（按通道+帧去重）。 */
export function mergeTrackRefs(a: TrackKeyRef[], b: TrackKeyRef[]): TrackKeyRef[] {
  const map = new Map<string, TrackKeyRef>();
  for (const ref of [...a, ...b]) map.set(keyOf(ref), { channel: ref.channel, frame: Math.round(ref.frame) });
  return [...map.values()];
}

/** 当前帧的插槽显示资源序号（`displayFrame.value` 或旧式 `frame[].displayIndex`）。 */
function displayIndexAt(player: Player, slot: string, frame: number): number | null {
  const timeline = player.animation?.slot?.find((entry) => entry.name === slot);
  if (!timeline) return null;
  const at = Math.round(frame);
  const list = (timeline.displayFrame?.length ? timeline.displayFrame : timeline.frame ?? []) as Array<{ duration?: number; value?: number; displayIndex?: number }>;
  let start = 0;
  for (const entry of list) {
    if (Math.abs(start - at) < 1e-4) {
      const value = timeline.displayFrame?.length ? entry.value : entry.displayIndex;
      return typeof value === 'number' ? value : null;
    }
    start += entry.duration ?? 1;
  }
  return null;
}

/** 删除选区里的键（同一帧的重复条目只删一次）。返回删掉的键数。 */
export function deleteTrackKeys(player: Player, refs: TrackKeyRef[]): number {
  const seen = new Set<string>();
  let removed = 0;
  for (const ref of refs) {
    const parsed = parse(ref.channel);
    if (!parsed) continue;
    const at = Math.round(ref.frame);
    const id = parsed.kind === 'ik' ? `ik:${parsed.name}@${at}` : parsed.kind === 'events' ? `events@${at}` : keyOf(ref);
    if (seen.has(id)) continue;
    seen.add(id);
    if (parsed.kind === 'color') {
      if (colorKeyAt(player, parsed.name, at) && removeSlotColorKeyframe(player, parsed.name, at)) removed += 1;
    } else if (parsed.kind === 'display') {
      if (displayKeyAt(player, parsed.name, at) && removeSlotDisplayKeyframe(player, parsed.name, at)) removed += 1;
    } else if (parsed.kind === 'ik') {
      if (player.animation && removeIkKeyframe(player.animation, parsed.name, at)) removed += 1;
    } else if (parsed.kind === 'events') {
      let guard = 0;
      while (eventsAt(player, at).length > 0 && guard < 50 && removeEventFrame(player, at, 0)) {
        removed += 1;
        guard += 1;
      }
    } else if (removeZOrderKeyframe(player, at)) removed += 1;
  }
  return removed;
}

/** 复制选区（颜色 / 显示资源 / 事件）；以最早的一帧为基准记相对偏移。 */
export function copyTrackKeys(player: Player, refs: TrackKeyRef[]): TrackClipboard | null {
  const items: TrackClipItem[] = [];
  let skipped = 0;
  const picked: Array<{ ref: TrackKeyRef; parsed: Parsed }> = [];
  for (const ref of refs) {
    const parsed = parse(ref.channel);
    if (!parsed || parsed.kind === 'ik' || parsed.kind === 'zorder') { skipped += 1; continue; }
    picked.push({ ref, parsed });
  }
  if (picked.length === 0) return skipped > 0 ? { base: 0, span: 0, items, skipped } : null;
  const base = Math.min(...picked.map(({ ref }) => Math.round(ref.frame)));
  let span = 0;
  for (const { ref, parsed } of picked) {
    const at = Math.round(ref.frame);
    const offset = at - base;
    span = Math.max(span, offset);
    if (parsed.kind === 'color') {
      const color = slotColorAt(player, parsed.name, at);
      if (color) items.push({ channel: ref.channel, offset, color: structuredClone(color) });
    } else if (parsed.kind === 'display') {
      const index = displayIndexAt(player, parsed.name, at);
      if (index !== null) items.push({ channel: ref.channel, offset, index });
    } else {
      const actions = eventActionsAt(player, at);
      if (actions.length > 0) items.push({ channel: ref.channel, offset, actions });
    }
  }
  if (items.length === 0 && skipped === 0) return null;
  return { base, span, items, skipped };
}

/** 把剪贴板里的键放到 `at` 起的位置（同一通道）。返回粘上的键数。 */
export function pasteTrackKeys(player: Player, clip: TrackClipboard, at: number): number {
  let pasted = 0;
  const origin = Math.round(at);
  for (const item of clip.items) {
    const parsed = parse(item.channel);
    if (!parsed) continue;
    const frame = origin + item.offset;
    if (item.color && parsed.kind === 'color') {
      if (setSlotColorKeyframe(player, parsed.name, frame, structuredClone(item.color))) pasted += 1;
    } else if (item.index !== undefined && parsed.kind === 'display') {
      if (setSlotDisplayKeyframe(player, parsed.name, frame, item.index)) pasted += 1;
    } else if (item.actions && parsed.kind === 'events') {
      if (appendEventActions(player, frame, item.actions)) pasted += 1;
    }
  }
  return pasted;
}

/** 移动：复制 → 删掉原位 → 粘到基准帧 + delta。IK / 绘制顺序不参与（计入 skipped，不动）。 */
export function moveTrackKeys(player: Player, refs: TrackKeyRef[], delta: number): { moved: number; skipped: number } {
  const clip = copyTrackKeys(player, refs);
  if (!clip || clip.items.length === 0) return { moved: 0, skipped: clip?.skipped ?? 0 };
  deleteTrackKeys(player, clip.items.map((item) => ({ channel: item.channel, frame: clip.base + item.offset })));
  const moved = pasteTrackKeys(player, clip, clip.base + Math.round(delta));
  return { moved, skipped: clip.skipped };
}
