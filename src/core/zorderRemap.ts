/**
 * 绑定（setup）槽位顺序变了之后，把各动画的 drawOrder（DB `zOrder`）关键帧改写到新下标上。
 *
 * zOrder 帧存的是「原始槽位下标 + 偏移」，下标指向 `armature.slot[]`。只改 setup 顺序不改时间轴，
 * 帧里的下标就指到了别的槽位上（或偏移越界），动画里的层级会乱。这里的口径：**关键帧上的绝对
 * 绘制顺序保持不变**（作者 K 的那一帧长什么样还是什么样），没有关键帧的时段跟随新的 setup 顺序。
 */
import { authoringToOrder, orderToAuthoring } from './runtime/animation';
import type { DbArmatureData } from './types';

export function remapZOrderTimelines(armature: DbArmatureData, oldNames: string[], newNames: string[]): number {
  if (oldNames.join('\u0000') === newNames.join('\u0000')) return 0;
  const n = newNames.length;
  const newIndex = new Map(newNames.map((name, i) => [name, i]));
  let changed = 0;
  for (const anim of armature.animation ?? []) {
    for (const frame of anim.zOrder?.frame ?? []) {
      const absolute = frame.order ?? authoringToOrder(frame.zOrder, oldNames.length);   // 位置 → 旧下标
      if (!absolute) continue;
      const names = absolute.map((i) => oldNames[i]);
      if (names.some((name) => name === undefined || !newIndex.has(name))) continue;
      const nextOrder = names.map((name) => newIndex.get(name)!);              // 位置 → 新下标
      if (frame.order) frame.order = nextOrder;
      if (frame.zOrder) {
        const pairs = encodeOrder(nextOrder, n);
        if (pairs && pairs.length) frame.zOrder = pairs; else delete frame.zOrder;   // 与新 setup 相同 → 空帧
      }
      changed++;
    }
  }
  return changed;
}

/** 顺序 → `[slotIndex, offset…]`：先用最小编码，解不回原顺序时退回「每根槽位都写一对」（总能往返）。 */
export function encodeOrder(order: number[], n: number): number[] | null {
  const identity = order.every((v, i) => v === i);
  if (identity) return null;
  const minimal = orderToAuthoring(order, n);
  const back = minimal ? authoringToOrder(minimal, n) : null;
  if (back && back.every((v, i) => v === order[i])) return minimal;
  const pos = new Array<number>(n);
  order.forEach((slot, i) => { pos[slot] = i; });
  const pairs: number[] = [];
  for (let slot = 0; slot < n; slot++) pairs.push(slot, pos[slot] - slot);
  return pairs;
}
