/**
 * 补间线上的右键「删除补间 / 添加补间」：改的是**这段补间线所属的那个键**（段起点），不新增关键帧。
 *
 * - 4.x 整帧（BoneAll）形式：补间挂在整帧上，改点击处所在的那一段；
 * - 5.x 组件形式：汇总行（channel 缺省）改三个通道各自在该处的段，子行只改自己的通道。
 *
 * 最后一个键之后没有补间线，不处理。
 */
import type { BoneChannelName } from './boneChannels';
import { boneTimeline } from './editing';
import type { Player } from './player';
import type { DbTweenFrame } from './types';

const EPS = 1e-3;

/** 点击处所在段的起点帧下标；落在最后一个键上或之后返回 -1。 */
function spanIndex(frames: DbTweenFrame[], at: number): number {
  let start = 0;
  for (let index = 0; index < frames.length - 1; index++) {
    const end = start + (frames[index].duration ?? 1);
    if (at >= start - EPS && at < end - EPS) return index;
    start = end;
  }
  return -1;
}

function apply(frame: DbTweenFrame, on: boolean) {
  frame.tweenEasing = on ? 0 : Number.NaN;
  frame.curve = undefined;
  frame.curveSamples = undefined;
}

export function setSpanTween(player: Player | null, bone: string, channel: BoneChannelName | undefined, at: number, on: boolean): boolean {
  const timeline = boneTimeline(player, bone);
  if (!timeline) return false;
  const lists: Array<DbTweenFrame[] | undefined> = (timeline.frame?.length ?? 0) > 0
    ? [timeline.frame]
    : channel
      ? [channel === 'translate' ? timeline.translateFrame : channel === 'rotate' ? timeline.rotateFrame : timeline.scaleFrame]
      : [timeline.translateFrame, timeline.rotateFrame, timeline.scaleFrame];
  let changed = false;
  for (const frames of lists) {
    if (!frames) continue;
    const index = spanIndex(frames, at);
    if (index < 0) continue;
    apply(frames[index], on);
    changed = true;
  }
  return changed;
}
