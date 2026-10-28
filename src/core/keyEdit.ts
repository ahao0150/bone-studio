/**
 * Dope-sheet keyframe operations (official 摄影表: 框选 / 拖动 / 缩放 / 复制剪切粘贴删除).
 *
 * Every bone timeline is normalised to `(position, frame)` pairs before an edit and
 * rewritten afterwards with durations that still add up to the animation duration —
 * the invariant the exporter and the runtime sampler both rely on
 * (see 格式规范 / §22).
 */
import type { DbAnimationData, DbBoneFrame, DbBoneTimeline } from './types';
import { activeAnimation, boneTimeline, materializeComponentTimeline } from './editing';
import type { Player } from './player';
import { boneChannelKeys, type BoneChannelKeys, type BoneChannelName } from './boneChannels';
import {
  isComponentTimeline, putChannelKeys, readChannelKeys, relocateChannelKeys, takeChannelKeys,
} from './channelKeyEdit';

export interface KeySelectionEntry {
  bone: string;
  /** absolute position in frames — indexes would go stale after every edit */
  frame: number;
  /**
   * 通道子行（移动 / 旋转 / 缩放）上点中的键只选这一个通道，移动 / 缩放 / 删除 / 复制也只作用于它；
   * 缺省 = 骨骼汇总行上的整帧键。
   */
  channel?: BoneChannelName;
}

export interface KeyClipboard {
  /** frames between the first and the last copied key (inclusive) */
  span: number;
  /** `channel` 存在时 `frame.transform` 只带该通道的字段（bind 相对量） */
  tracks: Array<{ bone: string; channel?: BoneChannelName; keys: Array<{ offset: number; frame: DbBoneFrame }> }>;
}

interface PositionedKey {
  at: number;
  data: DbBoneFrame;
}

const round = (value: number) => Math.round(value * 1000) / 1000;
const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

/** `timeline.frame` -> absolute positions (frames are stored as running durations). */
function readKeys(timeline: DbBoneTimeline | null): PositionedKey[] {
  const frames = timeline?.frame ?? [];
  const out: PositionedKey[] = [];
  let at = 0;
  for (const frame of frames) {
    out.push({ at: round(at), data: frame });
    at += frame.duration || 0;
  }
  return out;
}

/** Rewrite a timeline in place from absolute positions; the last key holds the tail. */
function writeKeys(timeline: DbBoneTimeline, keys: PositionedKey[], duration: number): void {
  const sorted = [...keys].sort((a, b) => a.at - b.at);
  const frames: DbBoneFrame[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    const end = next ? next.at : duration;
    const frame: DbBoneFrame = { ...current.data };
    frame.duration = round(Math.max(0, end - current.at));
    frames.push(frame);
  }
  timeline.frame = frames;
}

function newTimeline(animation: DbAnimationData, bone: string): DbBoneTimeline {
  const timeline: DbBoneTimeline = { name: bone, frame: [] };
  animation.bone = animation.bone ?? [];
  animation.bone.push(timeline);
  return timeline;
}

/** Ensure a bone timeline can be edited as full frames (materialises component tracks). */
function editableTimeline(player: Player, bone: string): DbBoneTimeline | null {
  const animation = activeAnimation(player);
  if (!animation) return null;
  let timeline: DbBoneTimeline | null = boneTimeline(player, bone) ?? newTimeline(animation, bone);
  if ((timeline.frame?.length ?? 0) === 0) {
    const materialized = materializeComponentTimeline(player, bone);
    if (!materialized) return null;
    timeline = boneTimeline(player, bone);
  }
  return timeline;
}

/** positions per bone, matched against the current keys with a frame epsilon */
function selectionByBone(selection: KeySelectionEntry[]): Map<string, Set<number>> {
  const byBone = new Map<string, Set<number>>();
  for (const entry of selection) {
    const set = byBone.get(entry.bone) ?? new Set<number>();
    set.add(round(entry.frame));
    byBone.set(entry.bone, set);
  }
  return byBone;
}

const isSelected = (at: number, frames: Set<number>) =>
  [...frames].some((frame) => Math.abs(frame - at) < 1e-3);

interface ChannelGroup { bone: string; channel: BoneChannelName; frames: number[] }
const CHANNELS: BoneChannelName[] = ['translate', 'rotate', 'scale'];
const near = (a: number, b: number) => Math.abs(a - b) < 1e-3;

/**
 * 选区拆两路：BoneAll 骨骼上的整帧条目走整帧路径；带通道的条目、以及组件形式骨骼上的整帧条目
 * （展开成该帧实际存在的通道）按「骨骼 + 通道」分组走单通道路径。
 * BoneAll 骨骼同帧已有整帧条目时，通道条目并入整帧，不重复处理。
 */
function partition(player: Player, selection: KeySelectionEntry[]): { whole: KeySelectionEntry[]; groups: ChannelGroup[] } {
  const whole: KeySelectionEntry[] = [];
  const groups = new Map<string, ChannelGroup>();
  const keysOf = new Map<string, BoneChannelKeys>();
  const channelKeys = (bone: string) => {
    if (!keysOf.has(bone)) keysOf.set(bone, boneChannelKeys(player, bone));
    return keysOf.get(bone)!;
  };
  const isComponent = (bone: string) => {
    const timeline = boneTimeline(player, bone);
    return !!timeline && isComponentTimeline(timeline);
  };
  const add = (bone: string, channel: BoneChannelName, frame: number) => {
    if (!channelKeys(bone)[channel].some((key) => near(key.frame, frame))) return;
    const id = `${bone}#${channel}`;
    const group = groups.get(id) ?? { bone, channel, frames: [] };
    if (!group.frames.some((at) => near(at, frame))) group.frames.push(round(frame));
    groups.set(id, group);
  };
  for (const entry of selection) {
    const component = isComponent(entry.bone);
    if (entry.channel) {
      const covered = !component && selection.some((other) => !other.channel && other.bone === entry.bone && near(other.frame, entry.frame));
      if (!covered) add(entry.bone, entry.channel, entry.frame);
    } else if (!component) whole.push(entry);
    else for (const channel of CHANNELS) add(entry.bone, channel, entry.frame);
  }
  return { whole, groups: [...groups.values()] };
}

/** Minimal / maximal absolute frame covered by a selection (for clamping). */
function selectionRange(player: Player, whole: KeySelectionEntry[], groups: ChannelGroup[]): { min: number; max: number } | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let found = false;
  for (const entry of whole) {
    const keys = readKeys(boneTimeline(player, entry.bone));
    const key = keys.find((candidate) => Math.abs(candidate.at - round(entry.frame)) < 1e-3);
    if (!key) continue;
    found = true;
    min = Math.min(min, key.at);
    max = Math.max(max, key.at);
  }
  for (const frame of groups.flatMap((group) => group.frames)) {
    found = true;
    min = Math.min(min, frame);
    max = Math.max(max, frame);
  }
  return found ? { min, max } : null;
}

/** 单通道路径：每组按 `target(原位置)` 搬键。 */
function relocateGroups(player: Player, groups: ChannelGroup[], duration: number, target: (frame: number) => number): number {
  let moved = 0;
  for (const group of groups) {
    const timeline = boneTimeline(player, group.bone);
    if (!timeline) continue;
    const moves = new Map(group.frames.map((frame) => [frame, clamp(target(frame), 0, duration)] as const));
    moved += relocateChannelKeys(timeline, group.channel, moves, duration);
  }
  return moved;
}

/**
 * Move every selected key by `delta` frames. The whole selection is clamped so it
 * stays inside `[0, duration]` (a group drag keeps its internal spacing) and keys
 * that land on an existing, unselected key overwrite it — the official behaviour
 * when dropping a selection onto another key.
 */
export function moveKeys(player: Player, selection: KeySelectionEntry[], delta: number): number {
  const animation: DbAnimationData | null = activeAnimation(player);
  if (!animation || selection.length === 0 || delta === 0) return 0;
  const duration = animation.duration || player.duration || 1;
  const { whole, groups } = partition(player, selection);
  const range = selectionRange(player, whole, groups);
  if (!range) return 0;
  const shift = clamp(round(delta), -range.min, duration - range.max);
  if (shift === 0) return 0;

  const byBone = selectionByBone(whole);
  let moved = relocateGroups(player, groups, duration, (frame) => Math.round(frame + shift));
  for (const [bone, indexes] of byBone) {
    const timeline = boneTimeline(player, bone);
    if (!timeline) continue;
    const keys = readKeys(timeline);
    const selected = keys.filter((key) => isSelected(key.at, indexes));
    if (selected.length === 0) continue;
    const rest = keys.filter((key) => !isSelected(key.at, indexes));
    const next: PositionedKey[] = [];
    for (const key of selected) next.push({ at: clamp(Math.round(key.at + shift), 0, duration), data: key.data });
    for (const key of rest) {
      if (!next.some((entry) => Math.abs(entry.at - key.at) < 1e-4)) next.push(key);
    }
    writeKeys(timeline, next, duration);
    moved += selected.length;
  }
  return moved;
}

/**
 * Retime a selection by `factor` around its first key — the official
 * "框选后缩放 ⇒ 修改动画快慢" gesture. The animation duration is unchanged.
 */
export function scaleKeys(player: Player, selection: KeySelectionEntry[], factor: number): number {
  const animation = activeAnimation(player);
  if (!animation || selection.length === 0 || !Number.isFinite(factor) || factor <= 0) return 0;
  const duration = animation.duration || player.duration || 1;
  const { whole, groups } = partition(player, selection);
  const range = selectionRange(player, whole, groups);
  if (!range || range.max === range.min) return 0;
  const byBone = selectionByBone(whole);
  let scaled = relocateGroups(player, groups, duration, (frame) => Math.round(range.min + (frame - range.min) * factor));
  for (const [bone, indexes] of byBone) {
    const timeline = boneTimeline(player, bone);
    if (!timeline) continue;
    const keys = readKeys(timeline);
    const rest = keys.filter((key) => !isSelected(key.at, indexes));
    const next: PositionedKey[] = [];
    for (const key of keys) {
      if (!isSelected(key.at, indexes)) continue;
      const at = clamp(Math.round(range.min + (key.at - range.min) * factor), 0, duration);
      next.push({ at, data: key.data });
      scaled++;
    }
    for (const key of rest) {
      if (!next.some((entry) => Math.abs(entry.at - key.at) < 1e-4)) next.push(key);
    }
    writeKeys(timeline, next, duration);
  }
  return scaled;
}

/** Delete the selected keys, handing each removed span back to the previous frame. */
export function deleteKeys(player: Player, selection: KeySelectionEntry[]): number {
  const animation = activeAnimation(player);
  if (!animation || selection.length === 0) return 0;
  const duration = animation.duration || player.duration || 1;
  const { whole, groups } = partition(player, selection);
  const byBone = selectionByBone(whole);
  let removed = 0;
  for (const group of groups) {
    const timeline = boneTimeline(player, group.bone);
    if (timeline) removed += takeChannelKeys(timeline, group.channel, group.frames, duration).size;
  }
  for (const [bone, indexes] of byBone) {
    const timeline = boneTimeline(player, bone);
    if (!timeline) continue;
    const keys = readKeys(timeline);
    const keep = keys.filter((key) => !isSelected(key.at, indexes));
    if (keep.length === 0) {
      // the official runtime keeps a single frame so the timeline stays valid
      const first = keys[0] ?? { data: {} as DbBoneFrame };
      keep.push({ at: 0, data: { ...first.data, transform: undefined } });
    }
    removed += keys.length - keep.length;
    writeKeys(timeline, keep, duration);
  }
  return removed;
}

/** Copy the selection (offsets relative to its earliest key). */
export function copyKeys(player: Player, selection: KeySelectionEntry[]): KeyClipboard | null {
  const { whole, groups } = partition(player, selection);
  const range = selectionRange(player, whole, groups);
  if (!range) return null;
  const duration = activeAnimation(player)?.duration || player.duration || 1;
  const byBone = selectionByBone(whole);
  const tracks: KeyClipboard['tracks'] = [];
  for (const group of groups) {
    const timeline = boneTimeline(player, group.bone);
    if (!timeline) continue;
    const picked = [...readChannelKeys(timeline, group.channel, group.frames, duration)].map(([at, payload]) => {
      const { values, ...tween } = payload;
      return { offset: round(at - range.min), frame: { duration: 0, ...tween, transform: values } };
    });
    if (picked.length > 0) tracks.push({ bone: group.bone, channel: group.channel, keys: picked });
  }
  for (const [bone, indexes] of byBone) {
    const keys = readKeys(boneTimeline(player, bone));
    const picked = keys
      .filter((key) => isSelected(key.at, indexes))
      .map((key) => ({ offset: round(key.at - range.min), frame: { ...key.data } }));
    if (picked.length > 0) tracks.push({ bone, keys: picked });
  }
  if (tracks.length === 0) return null;
  return { span: round(range.max - range.min), tracks };
}

/** Paste a clipboard starting at `atFrame`, overwriting keys it lands on. */
export function pasteKeys(player: Player, clipboard: KeyClipboard | null, atFrame: number): number {
  const animation = activeAnimation(player);
  if (!animation || !clipboard) return 0;
  const duration = animation.duration || player.duration || 1;
  const start = clamp(Math.round(atFrame), 0, duration);
  let pasted = 0;
  for (const track of clipboard.tracks) {
    if (track.channel) {
      const target = boneTimeline(player, track.bone) ?? newTimeline(animation, track.bone);
      pasted += putChannelKeys(target, track.channel, track.keys.map((entry) => {
        const { transform, ...tween } = entry.frame;
        return { at: clamp(Math.round(start + entry.offset), 0, duration), payload: { ...tween, values: transform ?? {} } };
      }), duration);
      continue;
    }
    const timeline = editableTimeline(player, track.bone);
    if (!timeline) continue;
    const keys = readKeys(timeline);
    const next = [...keys];
    for (const entry of track.keys) {
      const at = clamp(Math.round(start + entry.offset), 0, duration);
      const existing = next.findIndex((key) => Math.abs(key.at - at) < 1e-4);
      if (existing >= 0) next[existing] = { at, data: { ...entry.frame } };
      else next.push({ at, data: { ...entry.frame } });
      pasted++;
    }
    writeKeys(timeline, next, duration);
  }
  return pasted;
}

/** Total number of keys currently selected (used by the dock's status line). */
export function selectionSize(selection: KeySelectionEntry[]): number {
  return selection.length;
}

/**
 * 官方 `MenuItem-distributeToFrames`「分布到关键帧」：把选区里的关键帧在**首尾之间等间隔**重排
 * （首尾不动，中间的均匀铺开）。按骨骼分别处理 —— 跨骨骼的选择各自在自己的时间轴上分布。
 * 少于 3 个关键帧时没有可分布的空间，直接返回 0。
 */
export function distributeKeys(player: Player, selection: KeySelectionEntry[]): number {
  const animation: DbAnimationData | null = activeAnimation(player);
  if (!animation || selection.length === 0) return 0;
  const duration = animation.duration || player.duration || 1;
  const { whole, groups } = partition(player, selection);
  const byBone = selectionByBone(whole);
  let moved = 0;
  for (const group of groups) {
    const frames = [...group.frames].sort((a, b) => a - b);
    if (frames.length < 3) continue;
    const step = (frames[frames.length - 1] - frames[0]) / (frames.length - 1);
    const slot = new Map(frames.map((frame, index) => [frame, Math.round(frames[0] + step * index)] as const));
    moved += relocateGroups(player, [group], duration, (frame) => slot.get(frame) ?? frame);
  }
  for (const [bone, indexes] of byBone) {
    const timeline = boneTimeline(player, bone);
    if (!timeline) continue;
    const keys = readKeys(timeline);
    const selected = keys.filter((key) => isSelected(key.at, indexes)).sort((a, b) => a.at - b.at);
    if (selected.length < 3) continue;
    const rest = keys.filter((key) => !isSelected(key.at, indexes));
    const first = selected[0].at;
    const last = selected[selected.length - 1].at;
    const step = (last - first) / (selected.length - 1);
    const next: PositionedKey[] = [];
    selected.forEach((key, index) => {
      next.push({ at: clamp(Math.round(first + step * index), 0, duration), data: key.data });
    });
    for (const key of rest) {
      if (!next.some((entry) => Math.abs(entry.at - key.at) < 1e-4)) next.push(key);
    }
    writeKeys(timeline, next, duration);
    moved += selected.length;
  }
  return moved;
}
