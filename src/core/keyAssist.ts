/**
 * 摄影表左上工具的三个开关 / 动作（官方摄影表文档「左侧工具栏」）：
 *
 * - 自动关键帧：属性变化时在播放头处落键 —— 只给**改到的通道**落键，没碰的通道不凭空长键；
 * - 编辑多帧：改一个选中的关键帧，其余选中的关键帧加上同样的增量（缩放按倍率）；
 * - 删除非必要帧：某通道上与前后关键帧数值相同、删掉也不改变动画的键。0 帧保留。
 */
import { boneChannelKeys, type BoneChannelName } from './boneChannels';
import { boneTimeline, removeBoneChannelKey, sampleTransform, setBoneChannelTransform, type BoneTransformValues } from './editing';
import type { KeySelectionEntry } from './keyEdit';
import type { Player } from './player';

const FIELDS: Record<BoneChannelName, Array<keyof BoneTransformValues>> = {
  translate: ['x', 'y'],
  rotate: ['skX', 'skY'],
  scale: ['scX', 'scY'],
};
const CHANNELS = Object.keys(FIELDS) as BoneChannelName[];
const EPS = 1e-3;
const near = (a: number, b: number) => Math.abs(a - b) < EPS;

export function touchedChannels(patch: Partial<BoneTransformValues>): BoneChannelName[] {
  return CHANNELS.filter((channel) => FIELDS[channel].some((field) => patch[field] !== undefined));
}

/** 自动关键帧：把 `patch` 落成播放头处改到的那几个通道的键（已有键就改值）。 */
export function autoKeyEdit(player: Player, bone: string, base: BoneTransformValues, patch: Partial<BoneTransformValues>): boolean {
  const values = { ...base, ...patch };
  let changed = false;
  for (const channel of touchedChannels(patch)) {
    changed = setBoneChannelTransform(player, bone, channel, player.position, values) || changed;
  }
  return changed;
}

function shifted(value: number, from: number, to: number, field: keyof BoneTransformValues) {
  if ((field === 'scX' || field === 'scY') && Math.abs(from) > EPS) return value * (to / from);
  return value + (to - from);
}

/**
 * 编辑多帧：`base` 是改之前播放头处的值，`patch` 是改后的值；把同样的增量加到这根骨骼其余选中的键上。
 * 只改该通道在那一帧**本来就有**的键。返回改了几个键。
 */
export function applyMultiFrameDelta(
  player: Player, bone: string, base: BoneTransformValues, patch: Partial<BoneTransformValues>, selection: KeySelectionEntry[],
): number {
  const touched = touchedChannels(patch);
  if (touched.length === 0) return 0;
  const keys = boneChannelKeys(player, bone);
  const here = Math.round(player.position);
  let count = 0;
  for (const entry of selection) {
    if (entry.bone !== bone || Math.round(entry.frame) === here) continue;
    const channels = entry.channel ? touched.filter((channel) => channel === entry.channel) : touched;
    for (const channel of channels) {
      if (!keys[channel].some((key) => near(key.frame, entry.frame))) continue;
      const values = sampleTransform(player, bone, entry.frame);
      for (const field of FIELDS[channel]) {
        const to = patch[field];
        if (to !== undefined) values[field] = shifted(values[field], base[field], to, field);
      }
      if (setBoneChannelTransform(player, bone, channel, entry.frame, values)) count++;
    }
  }
  return count;
}

const same = (a: BoneTransformValues, b: BoneTransformValues, channel: BoneChannelName) =>
  FIELDS[channel].every((field) => near(a[field], b[field]));

/** 删除非必要帧：返回删掉的通道键个数。 */
export function pruneRedundantKeys(player: Player, bones: string[]): number {
  let removed = 0;
  for (const bone of bones) {
    if (!boneTimeline(player, bone)) continue;
    for (const channel of CHANNELS) {
      const keys = boneChannelKeys(player, bone)[channel];
      if (keys.length < 2) continue;
      const values = keys.map((key) => sampleTransform(player, bone, key.frame));
      const drop: number[] = [];
      let kept = 0;
      for (let index = 1; index < keys.length; index++) {
        const last = index === keys.length - 1;
        if (same(values[kept], values[index], channel) && (last || same(values[index], values[index + 1], channel))) drop.push(keys[index].frame);
        else kept = index;
      }
      for (const frame of drop.reverse()) {
        if (removeBoneChannelKey(player, bone, channel, frame)) removed++;
      }
    }
  }
  return removed;
}
