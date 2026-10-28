/**
 * 「层级」（绘制顺序）编辑内核 —— 官方 `_857/DrawOrderPanel` + `_555/_558` 控制器的等价物。
 *
 * 口径（清洁室格式验证，行号见 格式规范）：
 * - 列表是**槽位的倒序**：绘制顺序靠后 = 画在上层（`_558.as:701-717`）。
 * - 每行左侧箭头是**相对绑定顺序**的位移，用最长递增子序列（LIS）挑出「没动过」的那些，
 *   剩下的按位移方向标 `-1`（上移/前移，`arrow_up`）或 `1`（下移/后移，`arrow_down`）
 *   （`_669.as:64-115` + `_97/_10600.as:60-87`）。
 * - 装配模式改的是**绑定顺序**（写 `armature.slot[]`，`reorderSlot`）；动画模式只改
 *   **临时顺序**，等「添加层级关键帧」旗杆才落 `animation.zOrder` 关键帧（`_574.as:376-392`）。
 */
import { encodeOrder, remapZOrderTimelines } from './zorderRemap';
import type { DbAnimationData, DbZOrderFrame, DbZOrderTimeline } from './types';
import { activeAnimation, type SlotOrderMode } from './editing';
import { longestIncreasingSubsequence, orderToAuthoring, sampleZOrder } from './runtime/animation';
import type { Player } from './player';

const EPS = 1e-3;
const round = (value: number) => Math.round(value * 1000) / 1000;

/** LIS 的下标集合（官方 `_10600._10670` + `_10669` 挑「没动过」的那些）。 */
const longestIncreasing = longestIncreasingSubsequence;

/** 绑定顺序的槽位名（`armature.slot[]` 本身即绘制顺序）。 */
export function bindOrder(player: Player | null): string[] {
  return (player?.skeleton.armature.slot ?? []).map((slot) => slot.name);
}

/** 当前**生效**的绘制顺序（名字，升序 = 从最下层到最上层）。 */
export function drawOrder(player: Player | null): string[] {
  if (!player) return [];
  const bind = bindOrder(player);
  const animation = player.setupPose ? null : player.animation;
  const order = player.zOrderOverride
    ?? (animation ? sampleZOrder(animation, player.position, bind.length) : null);
  if (!order) return bind;
  return order.map((index) => bind[index]).filter((name): name is string => Boolean(name));
}

/** 名字数组 → 原始下标数组（`order[i]` = 画在第 `i` 位的原始槽位下标）。 */
export function namesToOrder(bind: string[], names: string[]): number[] {
  const index = new Map(bind.map((name, at) => [name, at]));
  return names.map((name) => index.get(name) ?? 0);
}

/**
 * 相对绑定顺序的位移标记：`-1` = 比绑定顺序更靠前（画得更上层，`arrow_up`），
 * `1` = 更靠后（`arrow_down`），没有就返回 0（不画箭头）。
 */
export function orderMarks(bind: string[], order: number[]): Map<string, -1 | 0 | 1> {
  const marks = new Map<string, -1 | 0 | 1>();
  const position = new Map<number, number>();
  order.forEach((original, at) => position.set(original, at));
  const kept = new Set(longestIncreasing(order));
  for (let original = 0; original < bind.length; original++) {
    const at = position.get(original);
    if (at === undefined || kept.has(at)) continue;
    marks.set(bind[original], at > original ? -1 : 1);
  }
  return marks;
}

/**
 * 在顺序数组里按官方四个层级动作重排：前 / 后各挪一格，或直接置顶 / 置底（`_558.as:339-385`）。
 * 越界或没有变化返回 null。注意方向：**数字越大越靠上层**（画得更晚）。
 */
export function moveSlotOrder(
  bind: string[],
  order: number[],
  name: string,
  mode: SlotOrderMode,
): number[] | null {
  const original = bind.indexOf(name);
  if (original < 0) return null;
  const from = order.indexOf(original);
  if (from < 0) return null;
  const next = [...order];
  next.splice(from, 1);
  const to = mode === 'front' ? next.length
    : mode === 'bottom' ? 0
      : mode === 'forward' ? Math.min(next.length, from + 1)
        : Math.max(0, from - 1);
  if (to === from) return null;
  next.splice(to, 0, original);
  return next;
}

/**
 * 装配模式：把绑定顺序整体重排（写 `armature.slot[]`）。
 * 与 `editing.ts` 的 `reorderSlot` 同一口径 —— 运行时在构造时拷了一份顺序，所以必须重建骨架。
 */
export function setBindOrder(player: Player, names: string[]): boolean {
  const armature = player.skeleton.armature;
  const slots = armature.slot ?? [];
  const byName = new Map(slots.map((slot) => [slot.name, slot]));
  const next = names.map((name) => byName.get(name));
  if (next.length !== slots.length || next.some((slot) => !slot)) return false;
  const oldNames = slots.map((slot) => slot.name);
  armature.slot = next as typeof slots;
  remapZOrderTimelines(armature, oldNames, names);
  const position = player.position;
  player.setArmature(armature.name);
  player.seek(position);
  return true;
}

/** 当前帧是否已经有关键帧（官方 `_574.as:1764` 的 `getFrameByIndex`）。 */
export function zOrderKeyed(player: Player | null, position: number): boolean {
  return frameIndexAt(activeAnimation(player), position) >= 0;
}

/**
 * 旗杆状态：`2` = 顺序改过但没落帧（黄），`1` = 当前帧有关键帧（红），`0` = 无键（白）。
 * 官方 `_574.as:1756-1770` 的 `_10748`。
 */
export function zOrderKeyStatus(pending: boolean, keyed: boolean): 0 | 1 | 2 {
  if (pending) return 2;
  return keyed ? 1 : 0;
}

function frameIndexAt(animation: DbAnimationData | null, position: number): number {
  const frames = animation?.zOrder?.frame ?? [];
  let at = 0;
  for (let i = 0; i < frames.length; i++) {
    if (Math.abs(at - position) < EPS) return i;
    at += frames[i].duration || 0;
  }
  return -1;
}

/** 把 `order` 写成当前帧的 `ZOrder(1)` 关键帧（授权 JSON 形态：`[slotIndex, offset, ...]`）。 */
export function setZOrderKeyframe(player: Player, order: number[]): boolean {
  const animation = activeAnimation(player);
  if (!animation) return false;
  const slotCount = (player.skeleton.armature.slot ?? []).length;
  if (slotCount <= 0) return false;
  const duration = animation.duration || player.duration || 1;
  const at = round(player.position);
  const pairs = encodeOrder(order, slotCount) ?? [];   // 最小编码解不回原顺序时退回全量对（orderToAuthoring 对部分排列有损）
  const frames = readFrames(animation);
  const existing = frames.findIndex((frame) => Math.abs(frame.at - at) < EPS);
  const entry = { at, data: { zOrder: pairs } as DbZOrderFrame };
  if (existing >= 0) frames[existing] = entry;
  else frames.push(entry);
  writeFrames(animation, frames, duration);
  return true;
}

/** 删掉当前帧的 `ZOrder(1)` 关键帧（时长并进相邻帧）；没有就返回 false。 */
export function removeZOrderKeyframe(player: Player, position: number): boolean {
  const animation = activeAnimation(player);
  if (!animation) return false;
  const frames = readFrames(animation);
  const index = frames.findIndex((frame) => Math.abs(frame.at - round(position)) < EPS);
  if (index < 0) return false;
  const duration = animation.duration || player.duration || 1;
  frames.splice(index, 1);
  if (frames.length === 0) {
    animation.zOrder = undefined;
    return true;
  }
  writeFrames(animation, frames, duration);
  return true;
}

interface PositionedFrame { at: number; data: DbZOrderFrame }

function readFrames(animation: DbAnimationData): PositionedFrame[] {
  const out: PositionedFrame[] = [];
  let at = 0;
  for (const frame of animation.zOrder?.frame ?? []) {
    out.push({ at: round(at), data: frame });
    at += frame.duration || 0;
  }
  return out;
}

function writeFrames(animation: DbAnimationData, frames: PositionedFrame[], duration: number): void {
  const sorted = [...frames].sort((a, b) => a.at - b.at);
  const out: DbZOrderFrame[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const next = sorted[i + 1];
    const end = next ? next.at : duration;
    const frame: DbZOrderFrame = { ...sorted[i].data };
    frame.duration = round(Math.max(0, end - sorted[i].at));
    // 授权 JSON 只保留 `zOrder` 对数；`order` 是解码端的中间形态，别写回盘。
    delete (frame as { order?: number[] }).order;
    out.push(frame);
  }
  animation.zOrder = { frame: out } satisfies DbZOrderTimeline;
}
