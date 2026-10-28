/**
 * 时间轴的行模型，顺序照官方树（`_13545/_13544.as:48-164`）：
 * 骨骼 →［移动、旋转、缩放］→ 挂在这根骨骼上的插槽 →［颜色、显示资源］；之后 IK；最后绘制顺序、事件。
 * 骨骼在官方树里是**平铺**的（不按父子缩进），缩进只表示「属于上一层」。
 */
import type { BoneRow } from '../panels';
import type { ExtraTrack, TrackChannel } from '../../core/timelineTracks';
import type { BoneChannelName, ChannelKey } from '../../core/boneChannels';
import type { KeyKind, RowTone } from '../timelineLayout';

export interface LaneKey {
  frame: number;
  kind: KeyKind;
  tween: 0 | 1 | 2;
}

export type Lane =
  | { id: string; kind: 'bone'; depth: number; label: string; icon: string; tone: RowTone; keys: LaneKey[]; row: BoneRow; expandable: true }
  | { id: string; kind: 'chan'; depth: number; label: string; icon: string; tone: RowTone; keys: LaneKey[]; row: BoneRow; channel: BoneChannelName; expandable: false }
  | { id: string; kind: 'track'; depth: number; label: string; icon: string; tone: RowTone; keys: LaneKey[]; track: ExtraTrack; expandable: boolean }
  | { id: string; kind: 'trackChan'; depth: number; label: string; icon: string; tone: RowTone; keys: LaneKey[]; track: ExtraTrack; channel: TrackChannel; expandable: false };

const CHANNELS: Array<{ name: BoneChannelName; label: string; icon: string }> = [
  { name: 'translate', label: '移动', icon: 'move' },
  { name: 'rotate', label: '旋转', icon: 'rotate' },
  { name: 'scale', label: '缩放', icon: 'scale' },
];

const TRACK_KIND: Record<ExtraTrack['kind'], KeyKind> = { slot: 'slot', ik: 'ik', event: 'event', zOrder: 'zOrder' };

function channelKind(track: ExtraTrack, channel: TrackChannel): KeyKind {
  if (track.kind === 'slot') return channel.id.endsWith('-color') ? 'color' : 'displayIndex';
  return TRACK_KIND[track.kind];
}

const asKeys = (frames: number[], kind: KeyKind): LaneKey[] => frames.map((frame) => ({ frame, kind, tween: 0 }));

/** 多条子轨道在同一帧合并：只有一条 → 用它的颜色，多条 → `merged`（`_13547.color`） */
function mergeKeys(groups: LaneKey[][], merged: KeyKind): LaneKey[] {
  const map = new Map<number, LaneKey[]>();
  for (const group of groups) {
    for (const key of group) {
      const at = Math.round(key.frame * 1000) / 1000;
      const list = map.get(at) ?? [];
      list.push(key);
      map.set(at, list);
    }
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([frame, list]) => ({
      frame,
      kind: list.length === 1 ? list[0].kind : merged,
      tween: list[0].tween,
    }));
}

const chanKeys = (keys: ChannelKey[], kind: KeyKind): LaneKey[] => keys.map((key) => ({ frame: key.frame, kind, tween: key.tween }));

function trackKeys(track: ExtraTrack): LaneKey[] {
  if (track.channels?.length) {
    return mergeKeys(track.channels.map((channel) => asKeys(channel.frames, channelKind(track, channel))), track.kind === 'slot' ? 'slot' : TRACK_KIND[track.kind]);
  }
  return asKeys(track.frames, TRACK_KIND[track.kind]);
}

function pushTrack(out: Lane[], track: ExtraTrack, depth: number, open: Set<string>): void {
  const expandable = (track.channels?.length ?? 0) > 0;
  out.push({
    id: `track-${track.id}`, kind: 'track', depth, label: track.name, icon: track.icon,
    tone: 'other', keys: trackKeys(track), track, expandable,
  });
  if (!expandable || !open.has(track.id)) return;
  for (const channel of track.channels ?? []) {
    out.push({
      id: `trackchan-${channel.id}`, kind: 'trackChan', depth: depth + 1, label: channel.label, icon: channel.icon,
      tone: 'other', keys: asKeys(channel.frames, channelKind(track, channel)), track, channel, expandable: false,
    });
  }
}

export function buildLanes(rows: BoneRow[], tracks: ExtraTrack[], openBones: Set<string>, openTracks: Set<string>): Lane[] {
  const out: Lane[] = [];
  const shown = new Set(rows.map((row) => row.name));
  const slotsOf = new Map<string, ExtraTrack[]>();
  const rest: ExtraTrack[] = [];
  for (const track of tracks) {
    if (track.kind === 'slot' && track.parentBone) {
      if (!shown.has(track.parentBone)) continue;
      const list = slotsOf.get(track.parentBone) ?? [];
      list.push(track);
      slotsOf.set(track.parentBone, list);
    } else rest.push(track);
  }
  for (const row of rows) {
    const channels = row.channels;
    const groups = CHANNELS.map((entry) => chanKeys(channels?.[entry.name] ?? [], entry.name));
    const keys = channels
      ? mergeKeys(groups, 'mult')
      : row.keys.map((key) => ({ frame: key.frame, kind: 'mult' as KeyKind, tween: 1 as const }));
    out.push({ id: `bone-${row.index}`, kind: 'bone', depth: 0, label: row.name, icon: 'bone', tone: 'bone', keys, row, expandable: true });
    if (!openBones.has(row.name)) continue;
    CHANNELS.forEach((entry, index) => {
      out.push({
        id: `${entry.name === 'translate' ? 'move' : entry.name}-${row.index}`, kind: 'chan', depth: 1,
        label: entry.label, icon: entry.icon, tone: 'bone', keys: groups[index], row, channel: entry.name, expandable: false,
      });
    });
    for (const track of slotsOf.get(row.name) ?? []) pushTrack(out, track, 1, openTracks);
  }
  const order = (track: ExtraTrack) => (track.kind === 'slot' ? 0 : track.kind === 'ik' ? 1 : track.kind === 'zOrder' ? 2 : 3);
  for (const track of [...rest].sort((a, b) => order(a) - order(b))) pushTrack(out, track, 0, openTracks);
  return out;
}

/** 动画汇总条：整条动画所有轨道的并集（`_1707` 动画帧画菱形） */
export function summaryFrames(lanes: Lane[], allKeyFrames: number[]): number[] {
  const set = new Set<number>(allKeyFrames.map((frame) => Math.round(frame)));
  for (const lane of lanes) {
    if (lane.kind === 'track') for (const key of lane.keys) set.add(Math.round(key.frame));
  }
  return [...set].sort((a, b) => a - b);
}
