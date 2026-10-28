/**
 * Timeline editing operations for BoneStudio v0.2.
 *
 * The editor mutates the parsed DragonBones data in place; the runtime samples
 * the timeline on every frame, so edits show up immediately without a reload.
 * All writes keep the export format valid (`duration` per frame, seconds-free
 * frame counts, `tweenEasing: 0` = linear).
 */
import { remapZOrderTimelines } from './zorderRemap';
import type {
  DbAnimationData, DbArmatureData, DbBoneFrame, DbBoneTimeline, DbDisplayData, DbSkeletonData, DbTransform, DbTweenFrame,
} from './types';
import type { Player } from './player';
import { sampleBoneTransform, sampleComponentFrames } from './runtime/animation';
import { apply, invert, matFromTransform, multiply, type Mat2D } from './runtime/math';

export interface BoneTransformValues {
  x: number;
  y: number;
  skX: number;
  skY: number;
  scX: number;
  scY: number;
}

export interface KeyFrameRef {
  /** index inside `timeline.frame` */
  index: number;
  /** position in frames from the start of the animation */
  frame: number;
}

const EPS = 1e-4;
const round = (v: number) => Math.round(v * 1000) / 1000;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function activeAnimation(player: Player | null): DbAnimationData | null {
  return player?.animation ?? null;
}

export function boneTimeline(player: Player | null, name: string): DbBoneTimeline | null {
  return activeAnimation(player)?.bone?.find((t) => t.name === name) ?? null;
}

export function keyFrames(player: Player | null, name: string): KeyFrameRef[] {
  const timeline = boneTimeline(player, name);
  const frames = timeline?.frame;
  if (frames && frames.length > 0) {
    const out: KeyFrameRef[] = [];
    let at = 0;
    frames.forEach((frame, index) => {
      out.push({ index, frame: round(at) });
      at += frame.duration || 0;
    });
    return out;
  }
  // 5.x / binary timelines keep component frames (translate/rotate/scale)
  return componentKeyFrames(timeline);
}

function componentKeyFrames(timeline: DbBoneTimeline | null): KeyFrameRef[] {
  if (!timeline) return [];
  const positions = new Set<number>();
  for (const component of [timeline.translateFrame, timeline.rotateFrame, timeline.scaleFrame]) {
    let at = 0;
    for (const frame of component ?? []) {
      positions.add(round(at));
      at += frame.duration || 0;
    }
  }
  return [...positions].sort((a, b) => a - b).map((frame, index) => ({ index, frame }));
}

export function keyFrameMap(player: Player | null): Map<string, KeyFrameRef[]> {
  const map = new Map<string, KeyFrameRef[]>();
  const anim = activeAnimation(player);
  if (!anim) return map;
  let at = 0;
  const starts: number[] = [];
  for (const timeline of anim.bone ?? []) {
    void timeline;
  }
  for (const timeline of anim.bone ?? []) {
    map.set(timeline.name, keyFrames(player, timeline.name));
  }
  void starts;
  return map;
}

/**
 * The bind-relative delta at `position` — identity (`0/0/0/0/1/1`) when the bone has no keys.
 * Both the `.dbbin` component timelines and the JSON `frame[]` timelines store bind-relative
 * offsets, so this is the single place that decodes a timeline into offsets.
 */
export function sampleTransformDelta(player: Player, name: string, position: number): BoneTransformValues {
  const timeline = boneTimeline(player, name);
  // 5.x / binary component timelines (translateFrame / rotateFrame / scaleFrame)
  if (timeline && (timeline.frame?.length ?? 0) === 0) {
    const pose = sampleComponentFrames(timeline, position);
    if (pose) {
      return {
        x: pose.x,
        y: pose.y,
        skX: pose.rotation + pose.skew,
        skY: pose.rotation,
        scX: pose.scaleX,
        scY: pose.scaleY,
      };
    }
  }
  const sampled = sampleBoneTransform(timeline, position);
  return {
    x: sampled.x ?? 0,
    y: sampled.y ?? 0,
    skX: sampled.skX ?? 0,
    skY: sampled.skY ?? 0,
    scX: sampled.scX ?? 1,
    scY: sampled.scY ?? 1,
  };
}

/**
 * Absolute bone transform at `position`: the bind pose with the sampled delta composed on top
 * (`x + dx`, `rotation + dRotation`, `scale * dScale`).
 *
 * Convention (格式规范): `sampleTransform` **always** returns the absolute
 * transform and `setBoneTransform`'s `patch` is likewise absolute. A bone with no timeline
 * therefore reports its bind pose — the old third path returned identity (`0/0/0/0/1/1`), which
 * is what made `setBoneTransform` write `-bind` into a freshly created frame.
 */
export function sampleTransform(player: Player, name: string, position: number): BoneTransformValues {
  const bind = player.skeleton.armature.bone.find((bone) => bone.name === name)?.transform ?? {};
  // 骨架装配不套动画：面板读到的就是绑定姿态，和舞台一致。
  if (player.setupPose) {
    return {
      x: bind.x ?? 0,
      y: bind.y ?? 0,
      skX: bind.skX ?? 0,
      skY: bind.skY ?? 0,
      scX: bind.scX ?? 1,
      scY: bind.scY ?? 1,
    };
  }
  const delta = sampleTransformDelta(player, name, position);
  return {
    x: (bind.x ?? 0) + delta.x,
    y: (bind.y ?? 0) + delta.y,
    skX: (bind.skX ?? 0) + delta.skX,
    skY: (bind.skY ?? 0) + delta.skY,
    scX: (bind.scX ?? 1) * delta.scX,
    scY: (bind.scY ?? 1) * delta.scY,
  };
}

/**
 * 舞台 / 面板读值：动画采样叠上编辑期临时姿态（官方 `_416/_418.as` 的 `_3402` → `bone._2002`）。
 *
 * 与 `sampleTransform` 分开是必须的：`setBoneTransform` 内部用后者算基线，
 * 若临时姿态混进去，会把临时值当成「原值」写进关键帧。
 */
export function effectiveTransform(player: Player, name: string, position: number): BoneTransformValues {
  const override = player.poseOverrideOf(name);
  if (!override) return sampleTransform(player, name, position);
  return {
    x: override.x ?? 0,
    y: override.y ?? 0,
    skX: override.skX ?? 0,
    skY: override.skY ?? 0,
    scX: override.scX ?? 1,
    scY: override.scY ?? 1,
  };
}

export function readBoneTransform(player: Player | null, name: string | null): BoneTransformValues | null {
  if (!player || !name) return null;
  return effectiveTransform(player, name, player.position);
}

function ensureTimeline(player: Player, name: string): DbBoneTimeline {
  const anim = player.animation;
  if (!anim) throw new Error('当前工程没有动画数据');
  anim.bone = anim.bone ?? [];
  let timeline = anim.bone.find((t) => t.name === name);
  if (!timeline) {
    timeline = { name, frame: [] };
    anim.bone.push(timeline);
  }
  timeline.frame = timeline.frame ?? [];
  return timeline;
}

function startPositions(frames: DbBoneFrame[]): number[] {
  const out: number[] = [];
  let at = 0;
  for (const frame of frames) {
    out.push(at);
    at += frame.duration || 0;
  }
  return out;
}

/**
 * Write a transform keyframe for `name` at `position` (frames).
 * If a frame already sits on `position` it is updated, otherwise the covering
 * span is split so the surrounding interpolation is preserved.
 */
export function setBoneTransform(
  player: Player,
  name: string,
  position: number,
  patch: Partial<BoneTransformValues>,
  /** false：只改当前帧已有的关键帧，不新切一帧（手动打帧） */
  insert = true,
): boolean {
  if (player.setupPose) {
    const bone = player.skeleton.armature.bone.find((entry) => entry.name === name);
    if (!bone) return false;
    const next: DbTransform = { ...(bone.transform ?? {}) };
    if (patch.x !== undefined) next.x = round(patch.x);
    if (patch.y !== undefined) next.y = round(patch.y);
    if (patch.skX !== undefined) next.skX = round(patch.skX);
    if (patch.skY !== undefined) next.skY = round(patch.skY);
    if (patch.scX !== undefined) next.scX = round(patch.scX);
    if (patch.scY !== undefined) next.scY = round(patch.scY);
    bone.transform = next;
    return true;
  }
  const anim = player.animation;
  if (!anim) return false;
  const timeline = ensureTimeline(player, name);
  if ((timeline.frame?.length ?? 0) === 0) materializeComponentTimeline(player, name);
  const frames = ensureTimeline(player, name).frame as DbBoneFrame[];
  const duration = Math.max(1, anim.duration);
  const at = clamp(position, 0, duration);
  const effective = sampleTransform(player, name, at);
  const bind = player.skeleton.armature.bone.find((bone) => bone.name === name)?.transform ?? {};
  const bindScaleX = bind.scX ?? 1;
  const bindScaleY = bind.scY ?? 1;
  // `patch` and `effective` are absolute (see `sampleTransform`); stored frame values are
  // bind-relative deltas, so *every* channel is converted the same way. Keeping the absolute
  // `effective` for the channels the caller did not pass wrote an absolute value where a
  // delta belonged, so one edit doubled the bind offset (§23.33 / §23.35).
  const merged = {
    x: round((patch.x ?? effective.x) - (bind.x ?? 0)),
    y: round((patch.y ?? effective.y) - (bind.y ?? 0)),
    skX: round((patch.skX ?? effective.skX) - (bind.skX ?? 0)),
    skY: round((patch.skY ?? effective.skY) - (bind.skY ?? 0)),
    scX: round((patch.scX ?? effective.scX) / (bindScaleX === 0 ? 1 : bindScaleX)),
    scY: round((patch.scY ?? effective.scY) / (bindScaleY === 0 ? 1 : bindScaleY)),
  };

  if (frames.length === 0) {
    if (!insert) return false;
    if (at > EPS) frames.push({ duration: round(at), tweenEasing: 0, transform: { x: 0, y: 0, skX: 0, skY: 0, scX: 1, scY: 1 } });
    frames.push({ duration: Math.max(0.01, round(duration - at)), tweenEasing: 0, transform: merged });
    return true;
  }

  const starts = startPositions(frames);
  const exact = starts.findIndex((start) => Math.abs(start - at) < EPS);
  if (exact >= 0) {
    frames[exact].transform = merged;
    return true;
  }
  if (!insert) return false;

  for (let i = 0; i < frames.length; i++) {
    const span = frames[i].duration || 0;
    if (at > starts[i] + EPS && at < starts[i] + span - EPS) {
      const head = frames[i];
      const offset = at - starts[i];
      const tail: DbBoneFrame = {
        duration: Math.max(0.01, round(span - offset)),
        tweenEasing: head.tweenEasing,
        curve: head.curve,
        transform: merged,
      };
      head.duration = round(offset);
      frames.splice(i + 1, 0, tail);
      return true;
    }
  }

  const lastIndex = frames.length - 1;
  const lastStart = starts[lastIndex];
  const tail: DbBoneFrame = {
    duration: Math.max(0.01, round(duration - at)),
    tweenEasing: 0,
    transform: merged,
  };
  frames[lastIndex].duration = Math.max(0.01, round(at - lastStart));
  frames.push(tail);
  return true;
}

export function removeKeyFrame(player: Player, name: string, position: number): boolean {
  const timeline = boneTimeline(player, name);
  const frames = timeline?.frame;
  if (!frames || frames.length === 0) return false;
  const starts = startPositions(frames);
  const index = starts.findIndex((start) => Math.abs(start - position) < EPS);
  if (index < 0) return false;
  if (frames.length === 1) {
    frames[0].transform = { x: 0, y: 0, skX: 0, skY: 0, scX: 1, scY: 1 };
    return true;
  }
  const removed = frames[index];
  if (index + 1 < frames.length) {
    frames[index + 1].duration = round((frames[index + 1].duration || 0) + (removed.duration || 0));
  } else {
    frames[index - 1].duration = round((frames[index - 1].duration || 0) + (removed.duration || 0));
  }
  frames.splice(index, 1);
  return true;
}

/** Nearest keyframe strictly before/after `position`, for navigation shortcuts. */
export function neighbourKeyFrame(
  player: Player | null,
  name: string | null,
  position: number,
  direction: -1 | 1,
): number | null {
  if (!player) return null;
  const names = name ? [name] : (player.animation?.bone ?? []).map((t) => t.name);
  const positions = new Set<number>();
  for (const boneName of names) {
    for (const ref of keyFrames(player, boneName)) positions.add(ref.frame);
  }
  const sorted = [...positions].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  if (direction > 0) return sorted.find((p) => p > position + EPS) ?? sorted[0];
  const before = sorted.filter((p) => p < position - EPS);
  return before.length ? before[before.length - 1] : sorted[sorted.length - 1];
}

export function snapshotArmature(player: Player | null): string | null {
  if (!player) return null;
  return JSON.stringify(player.skeleton.armature);
}

export function restoreArmature(player: Player, snapshot: string): void {
  const data = JSON.parse(snapshot) as DbSkeletonData['armature'][number];
  Object.assign(player.skeleton.armature, data);
  const position = player.position;
  player.setArmature(player.skeleton.armature.name);
  player.seek(position);
}

/** Convenience: the armature currently edited. */
export function currentArmature(player: Player | null) {
  return player?.skeleton.armature ?? null;
}

/**
 * Set the tween easing of the keyframe sitting exactly on `position`.
 * `0` = linear ("添加补间" J), `NaN` = stepped, `null` = linear default.
 * The evidence for the value semantics is 格式规范 / §7.
 */
export function setTweenEasing(
  player: Player,
  name: string,
  position: number,
  easing: number | null,
): boolean {
  const timeline = boneTimeline(player, name);
  const frames = timeline?.frame;
  if (!frames || frames.length === 0) return false;
  const starts = startPositions(frames);
  const index = starts.findIndex((start) => Math.abs(start - position) < EPS);
  if (index < 0) return false;
  frames[index].tweenEasing = easing;
  frames[index].curve = undefined;
  return true;
}

export type SlotOrderMode = 'forward' | 'backward' | 'front' | 'bottom';

/**
 * Reorder a slot inside `armature.slot[]` (the array is the draw order).
 * The runtime copies the order at construction, so the skeleton is rebuilt.
 */
export function reorderSlot(player: Player, slotName: string, mode: SlotOrderMode): boolean {
  const armature = player.skeleton.armature;
  const index = armature.slot.findIndex((slot) => slot.name === slotName);
  if (index < 0) return false;
  const oldNames = armature.slot.map((slot) => slot.name);
  const [entry] = armature.slot.splice(index, 1);
  const target = mode === 'front'
    ? armature.slot.length
    : mode === 'bottom'
      ? 0
      : mode === 'forward'
        ? Math.min(armature.slot.length, index + 1)
        : Math.max(0, index - 1);
  armature.slot.splice(target, 0, entry);
  if (target === index) return false;            // 已在最上 / 最下：没有变化，不进撤销栈
  remapZOrderTimelines(armature, oldNames, armature.slot.map((slot) => slot.name));
  const position = player.position;
  player.setArmature(armature.name);
  player.seek(position);
  return true;
}

/** Relationship navigation used by the B / N / M shortcuts (格式规范). */
export function relatedBone(
  player: Player | null,
  name: string | null,
  kind: 'parent' | 'child' | 'brother',
): string | null {
  if (!player || !name) return null;
  const index = player.skeleton.boneIndexByName.get(name);
  if (index === undefined) return null;
  const bones = player.skeleton.bones;
  const parent = bones[index].parent;
  if (kind === 'parent') return parent >= 0 ? bones[parent].name : null;
  if (kind === 'child') {
    const child = bones.find((bone) => bone.parent === index);
    return child ? child.name : null;
  }
  const siblings = bones.filter((bone) => bone.parent === parent && bone.name !== name);
  return siblings.length > 0 ? siblings[0].name : null;
}

/**
 * Rename a bone and every reference to it (children, slot parents, timelines,
 * IK constraints). Renaming is the F2 command from 格式规范
 */
export function renameBone(player: Player, oldName: string, newName: string): boolean {
  const armature = player.skeleton.armature;
  const trimmed = newName.trim();
  if (!trimmed || trimmed === oldName) return false;
  const bone = armature.bone.find((entry) => entry.name === oldName);
  if (!bone) return false;
  if (armature.bone.some((entry) => entry.name === trimmed)) return false;
  bone.name = trimmed;
  for (const entry of armature.bone) {
    if (entry.parent === oldName) entry.parent = trimmed;
  }
  for (const slot of armature.slot) {
    if (slot.parent === oldName) slot.parent = trimmed;
  }
  for (const animation of armature.animation ?? []) {
    for (const timeline of animation.bone ?? []) {
      if (timeline.name === oldName) timeline.name = trimmed;
    }
  }
  for (const ik of armature.ik ?? []) {
    if (ik.bone === oldName) ik.bone = trimmed;
    if (ik.target === oldName) ik.target = trimmed;
  }
  const position = player.position;
  player.setArmature(armature.name);
  player.seek(position);
  return true;
}

/**
 * Convert a 5.x/binary component timeline into a full-frame (`frame[]`) timeline
 * so the editor can keep writing absolute keyframes. Component values are
 * bind-relative offsets, so the result is `bind ⊕ offset` per component.
 */
export function materializeComponentTimeline(player: Player, name: string): boolean {
  const timeline = boneTimeline(player, name);
  if (!timeline) return false;
  if ((timeline.frame?.length ?? 0) > 0) return true;
  const hasComponents = (timeline.translateFrame?.length ?? 0) > 0
    || (timeline.rotateFrame?.length ?? 0) > 0
    || (timeline.scaleFrame?.length ?? 0) > 0;
  if (!hasComponents) return false;

  type RawPose = { x?: number; y?: number; rotation?: number; skew?: number; scaleX?: number; scaleY?: number };
  const duration = Math.max(1, player.animation?.duration ?? 0);
  const bind = player.skeleton.armature.bone.find((bone) => bone.name === name)?.transform ?? {};
  const positions = new Set<number>();
  const rawAt = new Map<number, RawPose>();
  const easing = new Map<number, { tweenEasing: number; curveSamples?: number[] }>();
  const merge = (position: number, part: RawPose) => {
    rawAt.set(position, { ...(rawAt.get(position) ?? {}), ...part });
  };

  const walk = (
    length: number,
    frameAt: (index: number) => { duration: number; tweenEasing?: number | null; curveSamples?: number[] },
    read: (index: number) => RawPose,
  ) => {
    let at = 0;
    for (let index = 0; index < length; index++) {
      const frame = frameAt(index);
      const position = round(at);
      positions.add(position);
      merge(position, read(index));
      if (!easing.has(position)) {
        easing.set(position, { tweenEasing: frame.tweenEasing ?? 0, curveSamples: frame.curveSamples });
      }
      at += frame.duration || 0;
    }
  };

  const translate = timeline.translateFrame ?? [];
  const rotate = timeline.rotateFrame ?? [];
  const scale = timeline.scaleFrame ?? [];
  walk(translate.length, (index) => translate[index], (index) => ({ x: translate[index].x ?? 0, y: translate[index].y ?? 0 }));
  walk(rotate.length, (index) => rotate[index], (index) => ({ rotation: rotate[index].rotate ?? 0, skew: rotate[index].skew ?? 0 }));
  walk(scale.length, (index) => scale[index], (index) => ({ scaleX: scale[index].x ?? 1, scaleY: scale[index].y ?? 1 }));

  const sorted = [...positions].sort((a, b) => a - b);
  const framesOut: DbBoneFrame[] = sorted.map((position, index) => {
    const raw = rawAt.get(position) ?? {};
    const next = index + 1 < sorted.length ? sorted[index + 1] : duration;
    const ease = easing.get(position) ?? { tweenEasing: 0 };
    return {
      duration: Math.max(0.01, round(next - position)),
      tweenEasing: ease.tweenEasing,
      curveSamples: ease.curveSamples,
      // Delta frames: keep the raw bind-relative offsets verbatim. 只写这一位置真有键的通道 ——
      // 补默认值会给其它通道凭空造键（并把它们在这一帧拉回绑定姿态）；没写的字段运行时沿用上一帧
      transform: {
        ...(raw.x !== undefined ? { x: round(raw.x), y: round(raw.y ?? 0) } : {}),
        ...(raw.rotation !== undefined
          ? { skY: round(raw.rotation), skX: round(raw.rotation + (raw.skew ?? 0)) }
          : {}),
        ...(raw.scaleX !== undefined ? { scX: round(raw.scaleX), scY: round(raw.scaleY ?? 1) } : {}),
      },
    };
  });
  timeline.frame = framesOut;
  timeline.translateFrame = undefined;
  timeline.rotateFrame = undefined;
  timeline.scaleFrame = undefined;
  return true;
}

/**
 * 骨骼关键帧的三个通道 —— 官方 5.x 组件时间轴（translate / rotate / scale）。
 * 旗杆的红/白、单通道 K 帧都按它区分（用户 183 轮需求）。
 */
export type BoneChannel = 'translate' | 'rotate' | 'scale';

const CHANNEL_FIELDS: Record<BoneChannel, Array<keyof BoneTransformValues>> = {
  translate: ['x', 'y'],
  rotate: ['skX', 'skY'],
  scale: ['scX', 'scY'],
};

/** 该骨骼的时间轴是不是 5.x 组件形式（三条独立通道）。 */
function usesComponentTimeline(timeline: DbBoneTimeline): boolean {
  return (timeline.translateFrame?.length ?? 0) > 0
    || (timeline.rotateFrame?.length ?? 0) > 0
    || (timeline.scaleFrame?.length ?? 0) > 0;
}

function channelFramesOf(timeline: DbBoneTimeline, channel: BoneChannel): DbTweenFrame[] | undefined {
  return channel === 'translate' ? timeline.translateFrame
    : channel === 'rotate' ? timeline.rotateFrame
      : timeline.scaleFrame;
}

/** 通道帧的起始位置（按 duration 累加）。 */
function channelStarts(frames: Array<{ duration: number }>): number[] {
  const out: number[] = [];
  let at = 0;
  for (const frame of frames) {
    out.push(round(at));
    at += frame.duration || 0;
  }
  return out;
}

/**
 * 当前帧是否**已经**有该通道的关键帧 —— 官方两个旗杆的红/白判据（红=已存在、白=可以 K）。
 *
 * - 组件形式（5.x）：按该通道自己的帧列表判；
 * - BoneAll 形式：该帧要在，且 `transform` 里写了这个通道的字段（空 `{}` 帧 = 三个通道都还没写过）。
 */
export function boneChannelKeyAt(
  player: Player | null, name: string, channel: BoneChannel, frame: number,
): boolean {
  const timeline = player?.animation ? boneTimeline(player, name) : null;
  if (!timeline) return false;
  const at = round(frame);
  if (usesComponentTimeline(timeline)) {
    return channelStarts(channelFramesOf(timeline, channel) ?? [])
      .some((start) => Math.abs(start - at) < EPS);
  }
  const frames = timeline.frame ?? [];
  const index = channelStarts(frames).findIndex((start) => Math.abs(start - at) < EPS);
  if (index < 0) return false;
  const transform = frames[index].transform ?? {};
  return CHANNEL_FIELDS[channel].some((key) => transform[key] !== undefined);
}

/** 绝对姿态 → 该通道在数据里的存储值（组件帧与 BoneAll 帧都存 bind 相对量）。 */
function channelStoredValues(
  channel: BoneChannel, absolute: BoneTransformValues, bind: DbTransform,
): { x?: number; y?: number; rotation?: number; skew?: number } {
  if (channel === 'translate') {
    return { x: round(absolute.x - (bind.x ?? 0)), y: round(absolute.y - (bind.y ?? 0)) };
  }
  if (channel === 'rotate') {
    const rotation = round(absolute.skY - (bind.skY ?? 0));
    return { rotation, skew: round((absolute.skX - (bind.skX ?? 0)) - rotation) };
  }
  const bindX = bind.scX ?? 1;
  const bindY = bind.scY ?? 1;
  return { x: round(absolute.scX / (bindX === 0 ? 1 : bindX)), y: round(absolute.scY / (bindY === 0 ? 1 : bindY)) };
}

/** 该通道的「起始值」：平移 0 / 旋转 0 / 缩放 1（新补的第一帧用）。 */
function channelIdentityValues(channel: BoneChannel): Record<string, number> {
  if (channel === 'translate') return { x: 0, y: 0 };
  if (channel === 'rotate') return { rotate: 0, skew: 0 };
  return { x: 1, y: 1 };
}

/** 组件帧的字段名（旋转通道用 rotate / skew，与 BoneAll 的 skX / skY 不同）。 */
function channelComponentValues(
  channel: BoneChannel, stored: { x?: number; y?: number; rotation?: number; skew?: number },
): Record<string, number> {
  if (channel === 'translate') return { x: stored.x ?? 0, y: stored.y ?? 0 };
  if (channel === 'rotate') return { rotate: stored.rotation ?? 0, skew: stored.skew ?? 0 };
  return { x: stored.x ?? 1, y: stored.y ?? 1 };
}

/** BoneAll 帧的 transform 字段（旋转写 skY = rotation、skX = rotation + skew）。 */
function channelTransformValues(
  channel: BoneChannel, stored: { x?: number; y?: number; rotation?: number; skew?: number },
): DbTransform {
  if (channel === 'translate') return { x: stored.x ?? 0, y: stored.y ?? 0 };
  if (channel === 'rotate') {
    const rotation = stored.rotation ?? 0;
    return { skY: rotation, skX: round(rotation + (stored.skew ?? 0)) };
  }
  return { scX: stored.x ?? 1, scY: stored.y ?? 1 };
}









/* ---------------------------------------------------------- mesh weights */

/** Compose the armature's bind-pose world matrices, parent-first. */
export function bindWorlds(bones: Array<{ name: string; parent?: string; transform?: DbTransform }>): Map<string, Mat2D> {
  const index = new Map<string, number>();
  bones.forEach((bone, i) => index.set(bone.name, i));
  const out = new Map<string, Mat2D>();
  const resolve = (name: string): Mat2D => {
    const cached = out.get(name);
    if (cached) return cached;
    const bone = bones[index.get(name)!];
    const local = matFromTransform(bone.transform);
    const world = bone.parent ? multiply(resolve(bone.parent), local) : local;
    out.set(name, world);
    return world;
  };
  for (const bone of bones) resolve(bone.name);
  return out;
}

interface MeshPairs {
  /** per vertex: (bone index, weight) */
  list: Array<Array<[number, number]>>;
  /** per vertex: baked bind-space point per pair (dbbin exports) */
  baked?: Array<Array<[number, number]>>;
}

function readPairs(display: DbDisplayData, vertexCount: number): MeshPairs {
  const raw = display.weights ?? [];
  const list: Array<Array<[number, number]>> = [];
  let cursor = 0;
  for (let v = 0; v < vertexCount; v++) {
    const count = raw[cursor++] ?? 0;
    const pairs: Array<[number, number]> = [];
    for (let k = 0; k < count && cursor + 1 < raw.length; k++) {
      pairs.push([raw[cursor], raw[cursor + 1]]);
      cursor += 2;
    }
    list.push(pairs);
  }
  const offsets = display.bindOffsets;
  if (!offsets || offsets.length === 0) return { list };
  const baked: Array<Array<[number, number]>> = [];
  let at = 0;
  for (let v = 0; v < vertexCount; v++) {
    const count = offsets[at++] ?? 0;
    const pairs: Array<[number, number]> = [];
    for (let k = 0; k < count; k++) {
      pairs.push([offsets[at++] ?? 0, offsets[at++] ?? 0]);
    }
    baked.push(pairs);
  }
  return { list, baked };
}

function writePairs(display: DbDisplayData, pairs: MeshPairs, vertexCount: number): void {
  const weights: number[] = [];
  const offsets: number[] = [];

  for (let v = 0; v < vertexCount; v++) {
    const list = pairs.list[v] ?? [];
    weights.push(list.length);
    if (pairs.baked) offsets.push(list.length);
    for (let k = 0; k < list.length; k++) {
      weights.push(list[k][0], list[k][1]);
      if (pairs.baked) {
        const point = pairs.baked[v]?.[k] ?? [0, 0];
        offsets.push(point[0], point[1]);
      }
    }
  }
  display.weights = weights;
  if (pairs.baked) display.bindOffsets = offsets;
}

/* ------------------------------------------------------------ mesh weights */

/** Resolve the mesh display a weight edit targets. */
function findMeshDisplay(armature: DbArmatureData, slotName: string): DbDisplayData | null {
  for (const skin of armature.skin ?? []) {
    for (const slot of skin.slot ?? []) {
      if (slot.name !== slotName) continue;
      for (const display of slot.display ?? []) {
        if ((display.type === 'mesh' || display.type === 2) && (display.vertices?.length ?? 0) > 0) {
          return display;
        }
      }
    }
  }
  return null;
}

/** Renormalise a vertex so its influences sum to 1, dropping zeros. */
function renormalise(list: Array<[number, number]>, keep: number, wanted: number): void {
  const target = Math.max(0, Math.min(1, wanted));
  const others = list.filter(([bone]) => bone !== keep);
  const keepPair = list.find(([bone]) => bone === keep);
  if (keepPair) keepPair[1] = target;
  const otherSum = others.reduce((total, [, w]) => total + Math.max(0, w), 0);
  for (const pair of others) {
    pair[1] = otherSum > 0
      ? (Math.max(0, pair[1]) / otherSum) * (1 - target)
      : (1 - target) / others.length;
  }
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i][1] <= 1e-4) list.splice(i, 1);
  }
  if (list.length === 0 && target > 0) list.push([keep, 1]);
}

export interface VertexWeightEdit {
  slot: string;
  vertex: number;
  bone: string;
  /** 0..1; 0 removes the influence */
  weight: number;
}

/**
 * Paint one mesh vertex with a bone's influence and renormalise the rest.
 * Returns the mesh vertex count, or null when the target cannot be resolved.
 * The runtime re-skins on the next frame, so the edit is visible immediately.
 */
export function setVertexWeight(
  doc: DbSkeletonData | DbArmatureData,
  edit: VertexWeightEdit,
  armatureIndex = 0,
): number | null {
  const armature = 'armature' in doc ? doc.armature?.[armatureIndex] : doc;
  if (!armature) return null;
  const boneIndex = armature.bone.findIndex((bone) => bone.name === edit.bone);
  if (boneIndex < 0) return null;
  const display = findMeshDisplay(armature, edit.slot);
  if (!display) return null;
  const vertices = display.vertices ?? [];
  const vertexCount = Math.floor(vertices.length / 2);
  if (edit.vertex < 0 || edit.vertex >= vertexCount) return null;

  const pairs = readPairs(display, vertexCount);
  const list = pairs.list[edit.vertex] ?? (pairs.list[edit.vertex] = []);
  const wantsWeight = edit.weight > 0;
  const existing = list.findIndex(([bone]) => bone === boneIndex);

  if (wantsWeight && existing < 0) {
    // Every pair needs a bind reference: a bone-to-bind matrix for JSON exports,
    // or a baked bind-space point for binary exports.
    const worlds = bindWorlds(armature.bone);
    const bindWorld = worlds.get(edit.bone);
    if (!bindWorld) return null;
    const stored = display.slotPose;
    const slotBind: Mat2D = stored && stored.length >= 6
      ? [stored[0], stored[1], stored[2], stored[3], stored[4], stored[5]]
      : [1, 0, 0, 1, 0, 0];
    let bindSpace: [number, number] | null = null;
    if (pairs.baked && pairs.baked[edit.vertex]?.length) {
      const first = list[0];
      const firstBind = first ? worlds.get(armature.bone[first[0]]?.name ?? '') : undefined;
      const point = pairs.baked[edit.vertex][0];
      if (firstBind && point) bindSpace = apply(firstBind, point[0], point[1]);
    }
    if (!bindSpace) bindSpace = apply(slotBind, vertices[edit.vertex * 2], vertices[edit.vertex * 2 + 1]);
    if (pairs.baked) {
      const local = apply(invert(bindWorld), bindSpace[0], bindSpace[1]);
      pairs.baked[edit.vertex] = [...(pairs.baked[edit.vertex] ?? []), local];
    } else {
      const pose = display.bonePose ?? (display.bonePose = []);
      let present = false;
      for (let i = 0; i + 6 < pose.length; i += 7) if (pose[i] === boneIndex) present = true;
      if (!present) pose.push(boneIndex, ...bindWorld);
    }
    list.push([boneIndex, 0]);
  }

  renormalise(list, boneIndex, wantsWeight ? edit.weight : 0);
  writePairs(display, pairs, vertexCount);
  return vertexCount;
}

/**
 * The bones a mesh is currently skinned to —— `bonePose` 与 `weights` 的**并集**。
 *
 * 两个来源都要看：JSON 形态把绑定骨骼写在 `display.bonePose`（每 7 个一条），而二进制
 * 解码形态没有 `bonePose`（绑定烘进 `bindOffsets`），只有 `weights` 里引用过骨骼。
 * 早期实现「`bonePose` 非空就直接返回」，于是 dbbin 网格上刚加绑的骨骼会把列表短路成
 * 只剩它自己 —— 所以这里改成取并集：先按 `bonePose` 顺序排，再补 `weights` 里出现过的。
 */
export function meshWeightBones(armature: DbArmatureData, slotName: string): string[] {
  const display = findMeshDisplay(armature, slotName);
  if (!display) return [];
  const seen = new Set<number>();
  const out: string[] = [];
  const push = (index: number) => {
    if (seen.has(index)) return;
    seen.add(index);
    const name = armature.bone[index]?.name;
    if (name) out.push(name);
  };
  const pose = display.bonePose ?? [];
  for (let i = 0; i + 6 < pose.length; i += 7) push(pose[i]);
  const vertexCount = Math.floor((display.vertices?.length ?? 0) / 2);
  for (const list of readPairs(display, vertexCount).list) {
    for (const [index] of list) push(index);
  }
  return out;
}

/**
 * Bind a bone to a mesh — the official 「添加绑定骨骼」 button.
 *
 * The bone is registered in `bonePose` with its bind-pose world matrix so the export has a
 * bind reference, but **no vertex weight is changed**: the new bone starts at 0 influence and
 * the user paints it with the weight tool (official behaves the same way). Returns false when
 * the bone is unknown, the slot has no mesh, or the bone is already bound.
 */
export function addMeshWeightBone(armature: DbArmatureData, slotName: string, boneName: string): boolean {
  const boneIndex = armature.bone.findIndex((bone) => bone.name === boneName);
  if (boneIndex < 0) return false;
  const display = findMeshDisplay(armature, slotName);
  if (!display) return false;
  if (meshWeightBones(armature, slotName).includes(boneName)) return false;
  const bindWorld = bindWorlds(armature.bone).get(boneName);
  if (!bindWorld) return false;
  const pose = display.bonePose ?? (display.bonePose = []);
  pose.push(boneIndex, bindWorld[0], bindWorld[1], bindWorld[2], bindWorld[3], bindWorld[4], bindWorld[5]);
  // 二进制解码形态另有 `weightBones`（armature 骨骼索引登记表，由 dbbin 解码写入）。
  // 新骨骼只出现在 `bonePose` 里、登记表里却没有，导出时会两边对不上，所以一并登记。
  if ((display.bindOffsets?.length ?? 0) > 0) {
    const list = display.weightBones ?? (display.weightBones = []);
    if (!list.includes(boneIndex)) list.push(boneIndex);
  }
  return true;
}

/**
 * Unbind a bone — drop its `bonePose` entry and every vertex influence that referenced it,
 * renormalising the surviving influences back to 1 so the mesh keeps its shape.
 *
 * 返回值语义 = **数据是不是真的变了**（官方这里也是「列表里删掉一行」的成功/失败）。
 * 关键点：二进制解码形态的网格没有 `bonePose`，绑定只存在 `weights` 里 —— 只认 `bonePose`
 * 会让删除实际生效却返回 `false`，调用方（`App.tsx#runSlotEdit`）于是不刷新、不记历史，
 * 还误报「不在权重骨骼列表里」。
 */
export function removeMeshWeightBone(armature: DbArmatureData, slotName: string, boneName: string): boolean {
  const boneIndex = armature.bone.findIndex((bone) => bone.name === boneName);
  if (boneIndex < 0) return false;
  const display = findMeshDisplay(armature, slotName);
  if (!display) return false;
  const pose = display.bonePose ?? [];
  const kept: number[] = [];
  let removed = false;
  for (let i = 0; i + 6 < pose.length; i += 7) {
    if (pose[i] === boneIndex) { removed = true; continue; }
    for (let k = 0; k < 7; k++) kept.push(pose[i + k]);
  }
  display.bonePose = kept;

  const vertexCount = Math.floor((display.vertices?.length ?? 0) / 2);
  const pairs = readPairs(display, vertexCount);
  for (let v = 0; v < vertexCount; v++) {
    const list = pairs.list[v] ?? [];
    const next = list.filter(([bone]) => bone !== boneIndex);
    // 顶点里出现过这根骨骼同样是「删掉了东西」的证据（dbbin 形态只走这条）
    if (next.length !== list.length) removed = true;
    const sum = next.reduce((total, [, w]) => total + Math.max(0, w), 0);
    if (next.length > 0) {
      for (const pair of next) pair[1] = sum > 0 ? Math.max(0, pair[1]) / sum : 1 / next.length;
    }
    pairs.list[v] = next;
    if (pairs.baked) {
      pairs.baked[v] = (pairs.baked[v] ?? []).filter((_, k) => list[k]?.[0] !== boneIndex);
    }
  }
  writePairs(display, pairs, vertexCount);
  // 二进制形态的骨骼登记表跟着收缩：导出会用它，留下已解绑的条目会让权重对不上号。
  const bones = display.weightBones;
  if (bones && bones.length > 0) {
    const filtered = bones.filter((index) => index !== boneIndex);
    if (filtered.length !== bones.length) {
      display.weightBones = filtered;
      removed = true;
    }
  }
  return removed;
}

/**
 * 只写**一个通道**的关键帧（官方时间轴每一行都能单独 K，用户 183 轮需求）。
 *
 * - 组件形式（5.x）：写该通道自己的帧列表（插入 / 切分逻辑与 `setBoneTransform` 一致）；
 * - BoneAll 形式：只动这一帧 `transform` 里该通道的字段，其余字段原样保留。
 *
 * `absolute` 是绝对姿态（`sampleTransform` 的语义），函数内部换算成 bind 相对量。
 */
export function setBoneChannelTransform(
  player: Player, name: string, channel: BoneChannel, position: number, absolute: BoneTransformValues,
): boolean {
  const anim = player.animation;
  if (!anim) return false;
  const timeline = ensureTimeline(player, name);
  const bind = player.skeleton.armature.bone.find((bone) => bone.name === name)?.transform ?? {};
  const stored = channelStoredValues(channel, absolute, bind);
  const duration = Math.max(1, anim.duration);
  const at = clamp(position, 0, duration);

  if (usesComponentTimeline(timeline)) {
    const values = channelComponentValues(channel, stored);
    let list = channelFramesOf(timeline, channel);
    if (!list) {
      list = [];
      if (channel === 'translate') timeline.translateFrame = list as NonNullable<DbBoneTimeline['translateFrame']>;
      else if (channel === 'rotate') timeline.rotateFrame = list as NonNullable<DbBoneTimeline['rotateFrame']>;
      else timeline.scaleFrame = list as NonNullable<DbBoneTimeline['scaleFrame']>;
    }
    const starts = channelStarts(list);
    const exact = starts.findIndex((start) => Math.abs(start - at) < EPS);
    if (exact >= 0) { Object.assign(list[exact], values); return true; }
    for (let i = 0; i < list.length; i++) {
      const span = list[i].duration || 0;
      if (at > starts[i] + EPS && at < starts[i] + span - EPS) {
        const head = list[i];
        const offset = at - starts[i];
        list.splice(i + 1, 0, { ...head, duration: Math.max(0.01, round(span - offset)), ...values } as DbTweenFrame);
        head.duration = round(offset);
        return true;
      }
    }
    if (list.length === 0) {
      if (at > EPS) list.push({ duration: round(at), tweenEasing: 0, ...channelIdentityValues(channel) } as DbTweenFrame);
      list.push({ duration: Math.max(0.01, round(duration - at)), tweenEasing: 0, ...values } as DbTweenFrame);
      return true;
    }
    const last = list[list.length - 1];
    const headLength = round(at - starts[starts.length - 1]);
    if (headLength > EPS) {
      last.duration = headLength;
      list.push({ duration: Math.max(0.01, round(duration - at)), tweenEasing: 0, ...values } as DbTweenFrame);
    } else {
      Object.assign(last, values);
    }
    return true;
  }

  const frames = timeline.frame ?? (timeline.frame = []);
  const delta = channelTransformValues(channel, stored);
  const starts = channelStarts(frames);
  const exact = starts.findIndex((start) => Math.abs(start - at) < EPS);
  if (exact >= 0) {
    frames[exact].transform = { ...(frames[exact].transform ?? {}), ...delta };
    return true;
  }
  for (let i = 0; i < frames.length; i++) {
    const span = frames[i].duration || 0;
    if (at > starts[i] + EPS && at < starts[i] + span - EPS) {
      const head = frames[i];
      const offset = at - starts[i];
      const tail: DbBoneFrame = {
        duration: Math.max(0.01, round(span - offset)),
        tweenEasing: head.tweenEasing,
        curve: head.curve,
        transform: { ...delta },
      };
      head.duration = round(offset);
      frames.splice(i + 1, 0, tail);
      return true;
    }
  }
  if (frames.length === 0) {
    if (at > EPS) frames.push({ duration: round(at), tweenEasing: 0, transform: {} });
    frames.push({ duration: Math.max(0.01, round(duration - at)), tweenEasing: 0, transform: { ...delta } });
    return true;
  }
  const lastFrame = frames[frames.length - 1];
  const headLength = round(at - starts[starts.length - 1]);
  if (headLength > EPS) {
    lastFrame.duration = headLength;
    frames.push({ duration: Math.max(0.01, round(duration - at)), tweenEasing: 0, transform: { ...delta } });
  } else {
    lastFrame.transform = { ...(lastFrame.transform ?? {}), ...delta };
  }
  return true;
}

/** 删掉**一个通道**在当前帧的关键帧（再点一次旗杆）。 */
export function removeBoneChannelKey(
  player: Player, name: string, channel: BoneChannel, position: number,
): boolean {
  const timeline = player.animation ? boneTimeline(player, name) : null;
  if (!timeline) return false;
  const at = round(position);
  if (usesComponentTimeline(timeline)) {
    const list = channelFramesOf(timeline, channel);
    if (!list || list.length === 0) return false;
    const starts = channelStarts(list);
    const index = starts.findIndex((start) => Math.abs(start - at) < EPS);
    if (index < 0) return false;
    if (list.length === 1) {
      if (channel === 'translate') timeline.translateFrame = undefined;
      else if (channel === 'rotate') timeline.rotateFrame = undefined;
      else timeline.scaleFrame = undefined;
      return true;
    }
    const removed = list[index];
    if (index + 1 < list.length) list[index + 1].duration = round((list[index + 1].duration || 0) + (removed.duration || 0));
    else list[index - 1].duration = round((list[index - 1].duration || 0) + (removed.duration || 0));
    list.splice(index, 1);
    return true;
  }
  const frames = timeline.frame ?? [];
  const index = channelStarts(frames).findIndex((start) => Math.abs(start - at) < EPS);
  if (index < 0) return false;
  const transform = frames[index].transform;
  if (!transform) return false;
  let changed = false;
  for (const key of CHANNEL_FIELDS[channel]) {
    if (transform[key] !== undefined) { delete transform[key]; changed = true; }
  }
  // 摘空的帧整帧删掉（0 帧除外）：空 `transform` 会被时间轴当成「三个通道都有键」
  const emptied = changed && index > 0 && Object.values(transform).every((value) => value === undefined);
  if (emptied) {
    frames[index - 1].duration = round((frames[index - 1].duration || 0) + (frames[index].duration || 0));
    frames.splice(index, 1);
  }
  return changed;
}

/**
 * 时间轴「插入一帧」（官方 `Timeline.addFrame.tooltip` = "Move Right "）：
 * `at` 所在的帧片**加长 1 帧**，于是它之后的所有帧整体后移 1 帧，动画时长 +1。
 * 骨骼（BoneAll + 5.x 组件帧）、插槽、IK、FFD、层级顺序几条时间轴一起走。
 */
export function insertFrameAt(player: Player, at: number): boolean {
  const anim = player.animation;
  if (!anim) return false;
  const frame = Math.max(0, Math.round(at));
  const grow = <T extends { duration: number }>(frames: T[] | undefined): void => {
    if (!frames || frames.length === 0) return;
    let cursor = 0;
    for (const entry of frames) {
      const duration = entry.duration || 1;
      if (frame < cursor + duration) { entry.duration = duration + 1; return; }
      cursor += duration;
    }
  };
  for (const timeline of anim.bone ?? []) {
    grow(timeline.frame);
    grow(timeline.translateFrame);
    grow(timeline.rotateFrame);
    grow(timeline.scaleFrame);
  }
  for (const timeline of anim.slot ?? []) {
    grow(timeline.frame);
    grow(timeline.displayFrame);
    grow(timeline.colorFrame);
  }
  for (const timeline of anim.ik ?? []) grow(timeline.frame);
  for (const timeline of anim.ffd ?? []) grow(timeline.frame);
  if (anim.zOrder) grow(anim.zOrder.frame);
  anim.duration = Math.max(1, (anim.duration || 1) + 1);
  return true;
}

/**
 * 时间轴「删除一帧」（官方 `Timeline.delFrame.tooltip` = "Move Left "）：
 * `at` 所在的帧片**缩短 1 帧**（只剩 1 帧时整帧被吃掉），它之后的帧整体前移 1 帧，动画时长 −1。
 */
export function removeFrameAt(player: Player, at: number): boolean {
  const anim = player.animation;
  if (!anim) return false;
  const frame = Math.max(0, Math.round(at));
  const shrink = <T extends { duration: number }>(frames: T[] | undefined): void => {
    if (!frames || frames.length === 0) return;
    let cursor = 0;
    for (let index = 0; index < frames.length; index++) {
      const duration = frames[index].duration || 1;
      if (frame < cursor + duration) {
        if (duration > 1) frames[index].duration = duration - 1;
        else frames.splice(index, 1);
        return;
      }
      cursor += duration;
    }
  };
  for (const timeline of anim.bone ?? []) {
    shrink(timeline.frame);
    shrink(timeline.translateFrame);
    shrink(timeline.rotateFrame);
    shrink(timeline.scaleFrame);
  }
  for (const timeline of anim.slot ?? []) {
    shrink(timeline.frame);
    shrink(timeline.displayFrame);
    shrink(timeline.colorFrame);
  }
  for (const timeline of anim.ik ?? []) shrink(timeline.frame);
  for (const timeline of anim.ffd ?? []) shrink(timeline.frame);
  if (anim.zOrder) shrink(anim.zOrder.frame);
  anim.duration = Math.max(1, (anim.duration || 1) - 1);
  return true;
}