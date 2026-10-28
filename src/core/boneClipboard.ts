/**
 * 骨骼的复制 / 粘贴 / 选择性粘贴（官方 `MenuItem-copyBone` / `MenuItem-pasteBone` /
 * `MenuItem-selectivePaste`）。
 *
 * 格式验证（`界面文案表` + `格式规范`）：
 *  - 复制：把**选中的骨骼连同它的子树**放进剪贴板（子树的骨骼 + 挂在它们身上的插槽 + 显示对象）；
 *  - 粘贴：整份挂回当前选中的骨骼下（同级）；
 *  - 选择性粘贴：标题「选择粘贴内容」，可勾选 `SelectivePaste.childBone`「子骨骼」与
 *    `SelectivePaste.animationKeyFrame`「动画关键帧」—— 官方用一个位掩码把这两个开关传下去；
 *  - 只有**骨架装配模式**下才能粘贴（`Tip-canPasteInArmatureMode`「骨骼装配模式下才能粘贴」）。
 */
import type {
  DbArmatureData, DbAnimationData, DbBoneData, DbBoneTimeline,
  DbSkinSlotData, DbSlotData, DbSlotTimeline,
} from './types';
import type { Player } from './player';
import { rebuildRuntime } from './boneEdit';

/** JSON 深拷贝：剪贴板里的数据不能和骨架共享数组。 */
const deepCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export interface BoneClipboard {
  /** 被复制的子树根骨骼名 */
  root: string;
  bones: DbBoneData[];
  slots: DbSlotData[];
  skinSlots: DbSkinSlotData[];
  /** 复制时当前动画里这些骨骼 / 插槽的关键帧轨道（选择性粘贴用） */
  boneTracks: DbBoneTimeline[];
  slotTracks: DbSlotTimeline[];
}

/** 子树（含自己），深度优先。 */
export function subtreeBoneNames(armature: DbArmatureData, name: string): string[] {
  const bones = armature.bone ?? [];
  if (!bones.some((entry) => entry.name === name)) return [];
  const out: string[] = [];
  const walk = (boneName: string) => {
    out.push(boneName);
    for (const child of bones) if ((child.parent ?? '') === boneName) walk(child.name);
  };
  walk(name);
  return out;
}

/** 复制：骨骼子树（骨骼 + 插槽 + 显示对象 + 当前动画里它们的轨道）→ 剪贴板。 */
export function copyBoneSubtree(player: Player | null, name: string): BoneClipboard | null {
  if (!player) return null;
  const armature = player.skeleton.armature;
  const names = subtreeBoneNames(armature, name);
  if (names.length === 0) return null;
  const inTree = new Set(names);
  const bones = (armature.bone ?? []).filter((entry) => inTree.has(entry.name)).map((entry) => deepCopy(entry));
  const slots = (armature.slot ?? []).filter((entry) => inTree.has(entry.parent ?? '')).map((entry) => deepCopy(entry));
  const slotNames = new Set(slots.map((entry) => entry.name));
  const skinSlots = (armature.skin?.[0]?.slot ?? [])
    .filter((entry) => slotNames.has(entry.name)).map((entry) => deepCopy(entry));
  const animation = player.animation as DbAnimationData | null | undefined;
  const boneTracks = (animation?.bone ?? []).filter((track) => inTree.has(track.name)).map((track) => deepCopy(track));
  const slotTracks = (animation?.slot ?? []).filter((track) => slotNames.has(track.name)).map((track) => deepCopy(track));
  return { root: name, bones, slots, skinSlots, boneTracks, slotTracks };
}
/** 粘贴：把剪贴板里的子树挂到 `parent` 下（`children=false` 时只粘根骨骼）。 */
export function pasteBoneSubtree(
  player: Player | null,
  parent: string | null,
  clipboard: BoneClipboard | null,
  options: { children?: boolean; keyFrames?: boolean } = {},
): string | null {
  if (!player || !clipboard) return null;
  const children = options.children !== false;
  const keyFrames = options.keyFrames !== false;
  const armature = player.skeleton.armature;
  const bones = armature.bone ?? [];

  // ① 选择性粘贴的「子骨骼」开关：关掉就只粘子树自己的根
  const source = children
    ? clipboard.bones
    : clipboard.bones.filter((entry) => entry.name === clipboard.root);
  if (!source.some((entry) => entry.name === clipboard.root)) return null;

  const rename = new Map<string, string>();
  const takenBones = new Set<string>(bones.map((entry) => entry.name));
  const uniqueBone = (wanted: string): string => {
    if (!takenBones.has(wanted)) { takenBones.add(wanted); return wanted; }
    for (let i = 1; i < 1000; i++) {
      const candidate = `${wanted}_${i}`;
      if (!takenBones.has(candidate)) { takenBones.add(candidate); return candidate; }
    }
    return `${wanted}_x`;
  };
  for (const entry of source) rename.set(entry.name, uniqueBone(`${entry.name}_copy`));

  // ② 骨骼：子树内的父级映射到新名字，子树根挂到粘贴目标下
  for (const entry of source) {
    const copy = deepCopy(entry);
    copy.name = rename.get(entry.name)!;
    const oldParent = entry.parent ?? '';
    if (rename.has(oldParent)) copy.parent = rename.get(oldParent)!;
    else if (entry.name === clipboard.root) {
      if (parent) copy.parent = parent; else delete copy.parent;
    } else if (oldParent) copy.parent = oldParent;
    else delete copy.parent;
    bones.push(copy);
  }

  // ③ 插槽 + 显示对象
  const skin = armature.skin?.[0];
  const takenSlots = new Set<string>((armature.slot ?? []).map((entry) => entry.name));
  const uniqueSlot = (wanted: string): string => {
    if (!takenSlots.has(wanted)) { takenSlots.add(wanted); return wanted; }
    for (let i = 1; i < 1000; i++) {
      const candidate = `${wanted}_${i}`;
      if (!takenSlots.has(candidate)) { takenSlots.add(candidate); return candidate; }
    }
    return `${wanted}_x`;
  };
  const newSlots: DbSlotData[] = [];
  const slotRename = new Map<string, string>();
  for (const slot of clipboard.slots) {
    const mappedParent = rename.get(slot.parent ?? '');
    if (!mappedParent) continue;
    const copy = deepCopy(slot);
    copy.name = uniqueSlot(`${slot.name}_copy`);
    copy.parent = mappedParent;
    newSlots.push(copy);
    slotRename.set(slot.name, copy.name);
    const src = clipboard.skinSlots.find((entry) => entry.name === slot.name);
    if (skin && src) skin.slot.push({ name: copy.name, display: deepCopy(src.display) });
  }
  if (newSlots.length > 0) armature.slot.push(...newSlots);

  // ④ 选择性粘贴的「动画关键帧」开关：把这些轨道改名后追加到当前动画
  const animation = player.animation as DbAnimationData | null | undefined;
  if (keyFrames && animation) {
    for (const track of clipboard.boneTracks) {
      const mapped = rename.get(track.name);
      if (!mapped) continue;
      const copy = deepCopy(track);
      copy.name = mapped;
      animation.bone = [...(animation.bone ?? []), copy];
    }
    for (const track of clipboard.slotTracks) {
      const mapped = slotRename.get(track.name);
      if (!mapped) continue;
      const copy = deepCopy(track);
      copy.name = mapped;
      animation.slot = [...(animation.slot ?? []), copy];
    }
  }

  rebuildRuntime(player);
  return rename.get(clipboard.root) ?? null;
}