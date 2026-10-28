/**
 * 「子骨骼可控」的编辑期实现 —— 官方 `StageFilterBar` 第三列（`_1844._2969`）。
 *
 * 官方语义（`_226/_14062.as` 第 64-145 行）：
 *   开关为**真**（默认，「子骨骼可控」）→ 改父级时子级跟着动；
 *   开关为**假** → 直属子骨骼的局部变换被反算，让它们保持自己的世界变换。
 *
 * 本仓库的骨骼变换走 `setBoneTransform(player, name, frame, patch)`（写当前帧的关键帧数据），
 * 所以这里拆成两步，让调用方在**同一条编辑路径**上完成反算：
 *   1. `snapshotChildWorlds(player, boneName)` —— 改父级**之前**记下直属子骨骼的世界矩阵；
 *   2. `childLocalValues(player, snapshot)` —— 改完父级（并 `rebuildSkeleton()` 到当前帧）之后，
 *      按 `newLocal = inverse(newParentWorld) × oldChildWorld` 反算，返回**可直接喂给
 *      `setBoneTransform` 的绝对局部值**。
 *
 * 与官方的差异（如实记录）：官方只改编辑期运行时姿态，这里把反算结果写进**当前帧的关键帧**
 * —— 见 `格式规范` §54。
 */
import type { Player } from './player';
import { RAD2DEG, decomposeMatrix, invert, multiply, type Mat2D } from './runtime/math';

export interface ChildWorldSnapshot {
  name: string;
  /** 骨骼在 armature.bone / skeleton.bones 里的下标 */
  index: number;
  world: Mat2D;
}

export interface ChildLocalValues {
  name: string;
  values: { x: number; y: number; skX: number; skY: number; scX: number; scY: number };
}

/** 记下 `boneName` 的**直属**子骨骼当前世界矩阵（改父级之前调用）。 */
export function snapshotChildWorlds(player: Player, boneName: string): ChildWorldSnapshot[] {
  const skeleton = player.skeleton;
  const out: ChildWorldSnapshot[] = [];
  skeleton.bones.forEach((bone, index) => {
    if (bone.parent < 0) return;
    if (skeleton.bones[bone.parent]?.name !== boneName) return;
    out.push({ name: bone.name, index, world: [...bone.world] as Mat2D });
  });
  return out;
}

/**
 * 改完父级、并把骨架更新到当前帧之后调用：算出每个子骨骼该写回的绝对局部变换。
 * 数组顺序与快照一致；找不到的骨骼会被跳过。
 */
export function childLocalValues(player: Player, snapshot: ChildWorldSnapshot[]): ChildLocalValues[] {
  if (snapshot.length === 0) return [];
  const skeleton = player.skeleton;
  const out: ChildLocalValues[] = [];
  for (const entry of snapshot) {
    const runtime = skeleton.bones[entry.index];
    if (!runtime || runtime.parent < 0) continue;
    const parentWorld = skeleton.bones[runtime.parent]?.world;
    if (!parentWorld) continue;
    const local = multiply(invert(parentWorld), entry.world);
    const t = decomposeMatrix(local);
    out.push({
      name: entry.name,
      values: {
        x: t.x,
        y: t.y,
        skX: (t.rotation + t.skew) * RAD2DEG,
        skY: t.rotation * RAD2DEG,
        scX: t.scaleX,
        scY: t.scaleY,
      },
    });
  }
  return out;
}

/**
 * 便捷判断：`boneInherit === true`（官方默认）时什么都不用做 —— 子级自然跟随。
 * 调用方据此决定要不要 `snapshotChildWorlds()`。
 */
export function shouldFreezeChildren(boneInherit: boolean): boolean {
  return !boneInherit;
}
/* ---------------- 「子图片可控」的编辑期补偿（官方 `_1844._2968`） ---------------- */

export interface SlotWorldSnapshot {
  slot: string;
  /** 槽位挂在哪根骨骼下（槽位世界矩阵 = 该骨骼世界矩阵） */
  boneIndex: number;
  world: Mat2D;
}

/** 记下挂在 `boneName` 下的槽位当前世界矩阵（改父级之前调用）。 */
export function snapshotSlotWorlds(player: Player, boneName: string): SlotWorldSnapshot[] {
  const skeleton = player.skeleton;
  const out: SlotWorldSnapshot[] = [];
  skeleton.slots.forEach((slot) => {
    if (slot.parentBone < 0) return;
    if (skeleton.bones[slot.parentBone]?.name !== boneName) return;
    out.push({ slot: slot.name, boneIndex: slot.parentBone, world: [...skeleton.bones[slot.parentBone].world] as Mat2D });
  });
  return out;
}

/**
 * 改完父级并重建之后：算出每个槽位的显示补偿矩阵 `inverse(newWorld) × oldWorld`。
 * 把结果写进 `skeleton.setDisplayOverride(slot, matrix)` 就能让图片保持原来的世界位置（不落盘）。
 */
export function displayOverridesFor(player: Player, snapshot: SlotWorldSnapshot[]): Array<{ slot: string; matrix: Mat2D }> {
  const skeleton = player.skeleton;
  const out: Array<{ slot: string; matrix: Mat2D }> = [];
  for (const entry of snapshot) {
    const runtime = skeleton.slots.find((slot) => slot.name === entry.slot);
    if (!runtime || runtime.parentBone < 0) continue;
    const newWorld = skeleton.bones[runtime.parentBone]?.world;
    if (!newWorld) continue;
    out.push({ slot: entry.slot, matrix: multiply(invert(newWorld), entry.world) });
  }
  return out;
}