/**
 * 骨骼时间轴按通道（平移 / 旋转 / 缩放）拆开的关键帧位置 —— 官方时间轴骨骼行下面固定挂这三条子行
 * （`_13545/_13544.as:76-95`），子行上的关键帧按通道上色（`_13547.color`）。
 *
 * 5.x 组件帧直接按各自的 `duration` 累加；4.x 的整帧 `frame[]` 按 `transform` 里出现的字段归到通道，
 * 一个字段都没有（= 回到绑定姿态）时三个通道都算有键。
 */
import type { Player } from './player';
import type { DbTweenFrame } from './types';
import { boneTimeline } from './editing';
import { resolveTween } from './runtime/animation';

export type BoneChannelName = 'translate' | 'rotate' | 'scale';

export interface ChannelKey {
  frame: number;
  /** 0 无补间（阶梯） · 1 直线补间 · 2 曲线补间（`_13496._13642` / `_11515`） */
  tween: 0 | 1 | 2;
}

export type BoneChannelKeys = Record<BoneChannelName, ChannelKey[]>;

function tweenOf(frame: DbTweenFrame): 0 | 1 | 2 {
  const type = resolveTween(frame).type;
  return type === 0 ? 0 : type === 2 ? 2 : 1;
}

function walk(frames: DbTweenFrame[] | undefined, keep?: (index: number) => boolean): ChannelKey[] {
  const out: ChannelKey[] = [];
  let at = 0;
  (frames ?? []).forEach((frame, index) => {
    if (!keep || keep(index)) out.push({ frame: Math.round(at * 1000) / 1000, tween: tweenOf(frame) });
    at += frame.duration ?? 1;
  });
  return out;
}

export function boneChannelKeys(player: Player | null, bone: string): BoneChannelKeys {
  const timeline = boneTimeline(player, bone);
  const empty: BoneChannelKeys = { translate: [], rotate: [], scale: [] };
  if (!timeline) return empty;
  const frames = timeline.frame;
  if (frames && frames.length > 0) {
    const has = (index: number, fields: string[]) => {
      const transform = (frames[index].transform ?? {}) as Record<string, unknown>;
      const any = Object.keys(transform).some((key) => transform[key] !== undefined);
      return !any || fields.some((field) => transform[field] !== undefined);
    };
    return {
      translate: walk(frames, (index) => has(index, ['x', 'y'])),
      rotate: walk(frames, (index) => has(index, ['skX', 'skY'])),
      scale: walk(frames, (index) => has(index, ['scX', 'scY'])),
    };
  }
  return {
    translate: walk(timeline.translateFrame),
    rotate: walk(timeline.rotateFrame),
    scale: walk(timeline.scaleFrame),
  };
}
