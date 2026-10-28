/**
 * Animation list operations (official 动画面板: 添加 / 克隆 / 删除动画).
 *
 * Every operation keeps the armature playable: at least one animation survives, a
 * new animation starts empty (one frame at position 0) and the active animation is
 * re-selected afterwards by the caller.
 */
import type { DbAnimationData } from './types';
import { activeAnimation } from './editing';
import type { Player } from './player';

const DEFAULT_DURATION = 40;

export function animationNames(player: Player | null): string[] {
  return (player?.skeleton.armature.animation ?? []).map((entry) => entry.name);
}

export function uniqueAnimationName(player: Player | null, wanted: string): string {
  const names = new Set(animationNames(player));
  if (!names.has(wanted)) return wanted;
  let index = 1;
  while (names.has(`${wanted}_${index}`)) index++;
  return `${wanted}_${index}`;
}

/** Add an empty animation and return its name (null when there is no armature). */
export function addAnimation(player: Player | null, name = 'animation'): string | null {
  if (!player) return null;
  const armature = player.skeleton.armature;
  armature.animation = armature.animation ?? [];
  const unique = uniqueAnimationName(player, name);
  armature.animation.push({
    name: unique,
    duration: DEFAULT_DURATION,
    playTimes: 1,
    bone: [],
    slot: [],
  });
  return unique;
}

/** Deep-copy an animation under a new name (official 克隆动画). */
export function cloneAnimation(player: Player | null, from: string): string | null {
  if (!player) return null;
  const source = (player.skeleton.armature.animation ?? []).find((entry) => entry.name === from);
  if (!source) return null;
  const copy = JSON.parse(JSON.stringify(source)) as DbAnimationData;
  copy.name = uniqueAnimationName(player, `${from}_copy`);
  player.skeleton.armature.animation = player.skeleton.armature.animation ?? [];
  player.skeleton.armature.animation.push(copy);
  return copy.name;
}

/**
 * 把名为 `name` 的动画挪到列表下标 `toIndex`。
 * 下标按移动前的顺序计，越界会夹到合法范围；位置没变返回 false。
 */
export function reorderAnimation(player: Player | null, name: string, toIndex: number): boolean {
  if (!player) return false;
  const list = player.skeleton.armature.animation ?? [];
  const from = list.findIndex((entry) => entry.name === name);
  if (from < 0 || list.length < 2) return false;
  const to = Math.max(0, Math.min(list.length - 1, Math.round(toIndex)));
  if (from === to) return false;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
  return true;
}

/** Remove an animation; the last one is kept so the armature stays playable. */
export function removeAnimation(player: Player | null, name: string): boolean {
  if (!player) return false;
  const list = player.skeleton.armature.animation ?? [];
  if (list.length <= 1) return false;
  const index = list.findIndex((entry) => entry.name === name);
  if (index < 0) return false;
  list.splice(index, 1);
  return true;
}

/** Duration is authored per animation; keep it in sync with the runtime length. */
export function setAnimationDuration(player: Player | null, name: string, duration: number): boolean {
  const animation = activeAnimation(player);
  const target = (player?.skeleton.armature.animation ?? []).find((entry) => entry.name === name)
    ?? (animation && animation.name === name ? animation : null);
  if (!target || !Number.isFinite(duration) || duration <= 0) return false;
  target.duration = Math.max(1, Math.round(duration));
  return true;
}
