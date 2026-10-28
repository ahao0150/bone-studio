/**
 * 时间轴里**骨骼之外**的轨道（官方时间轴除骨骼外还列：插槽 / IK 约束 / 事件 / 绘制顺序）。
 *
 * 这里只做**只读**的轨道模型 —— 每条轨道有哪些帧（帧位置），供时间轴渲染行与帧点。
 * 写入口各自独立：插槽走 `core/slotEdit.ts`、IK 走 `core/ikEdit.ts`、绘制顺序走 `core/zorderEdit.ts`、
 * 事件帧是 `animation.frame[].actions`。
 */
import type { Player } from './player';
import { colorKeyAt, displayKeyAt } from './slotEdit';
import { ikKeyAt } from './ikKeyEdit';
import { zOrderKeyed } from './zorderEdit';
import { eventsAt } from './eventEdit';

export type TrackKind = 'slot' | 'ik' | 'event' | 'zOrder';

export interface TrackChannel {
  id: string;
  label: string;
  /** icons.tsx 里的图标名 */
  icon: string;
  frames: number[];
  /** 当前帧是不是已经打过键（时间轴上旗杆的红 / 白） */
  keyed?: boolean;
}

export interface ExtraTrack {
  id: string;
  kind: TrackKind;
  name: string;
  icon: string;
  /** 整条轨道的汇总帧（行首菱形 / 「这一列有没有帧」判定） */
  frames: number[];
  /** 可展开的子通道（插槽：颜色 / 显示资源；IK 不拆通道） */
  channels?: TrackChannel[];
  /** 当前帧这条轨道有没有键（绘制顺序这种单通道轨道用它点亮旗杆） */
  keyed?: boolean;
  /** 插槽轨道挂在哪根骨骼下面（官方树：骨骼 → 平移/旋转/缩放 → 插槽） */
  parentBone?: string;
}

/** 帧位置列表：按 `duration` 累加（与时间轴其它地方同一口径）。 */
function startsOf(frames: Array<{ duration?: number }> | undefined): number[] {
  const out: number[] = [];
  if (!frames) return out;
  let at = 0;
  for (const frame of frames) {
    out.push(Math.round(at));
    at += frame.duration ?? 1;
  }
  return out;
}

const uniq = (values: number[]) => [...new Set(values)].sort((a, b) => a - b);

/**
 * 当前动画里所有「非骨骼」轨道。
 * 注意：**行是否显示只看数据里有没有这条轨道**（官方同理）—— 没有帧的 IK 约束也照样列一行。
 */
export function extraTracks(player: Player | null, frame = 0): ExtraTrack[] {
  const anim = player?.animation;
  if (!player || !anim) return [];
  const out: ExtraTrack[] = [];

  // 插槽：颜色 / 显示资源（5.x 拆成 colorFrame + displayFrame；4.x 合成在 frame[] 里）
  // 官方：骨架里的每个插槽都列一行（没有帧也列，`_13502._1861`），所以以骨架为准，动画里的帧按名字合并
  const animSlots = new Map((anim.slot ?? []).map((entry) => [entry.name, entry] as const));
  const slotNames = [...new Set([
    ...(player.skeleton.armature.slot ?? []).map((entry) => entry.name),
    ...(anim.slot ?? []).map((entry) => entry.name),
  ])];
  for (const name of slotNames) {
    const slot = animSlots.get(name);
    const legacy = startsOf(slot?.frame);
    const colorFrames = slot?.colorFrame?.length
      ? startsOf(slot.colorFrame)
      : legacy.filter((_, index) => slot?.frame?.[index]?.color !== undefined);
    const displayFrames = slot?.displayFrame?.length
      ? startsOf(slot.displayFrame)
      : legacy.filter((_, index) => slot?.frame?.[index]?.displayIndex !== undefined);
    out.push({
      id: `slot-${name}`,
      kind: 'slot',
      name,
      icon: 'image',
      frames: uniq([...colorFrames, ...displayFrames]),
      keyed: colorKeyAt(player, name, frame) || displayKeyAt(player, name, frame),
      parentBone: player.skeleton.armature.slot?.find((entry) => entry.name === name)?.parent,
      channels: [
        { id: `slot-${name}-color`, label: '颜色', icon: 'drop', frames: colorFrames, keyed: colorKeyAt(player, name, frame) },
        { id: `slot-${name}-display`, label: '显示资源', icon: 'image', frames: displayFrames, keyed: displayKeyAt(player, name, frame) },
      ],
    });
  }

  // IK：一条约束一行、不拆子通道 —— 官方一个 IK 帧同时存权重与弯曲方向（`_35_13487.as:1960-1961`），无法分开打键
  for (const constraint of player.skeleton.armature.ik ?? []) {
    const timeline = anim.ik?.find((entry) => entry.name === constraint.name);
    out.push({
      id: `ik-${constraint.name}`,
      kind: 'ik',
      name: constraint.name,
      icon: 'anchor',
      frames: startsOf(timeline?.frame),
      keyed: ikKeyAt(anim, constraint.name, frame),
    });
  }

  // 事件帧（官方 Event 时间轴）；绘制顺序（官方 Draw Order）
  const eventFrames = startsOf(anim.frame).filter((_, index) => ((anim.frame ?? [])[index].actions?.length ?? 0) > 0);
  out.push({ id: 'events', kind: 'event', name: '事件', icon: 'key', frames: eventFrames, keyed: eventsAt(player, frame).length > 0 });
  out.push({
    id: 'zorder', kind: 'zOrder', name: '绘制顺序', icon: 'layers',
    frames: startsOf(anim.zOrder?.frame), keyed: zOrderKeyed(player, frame),
  });

  return out;
}