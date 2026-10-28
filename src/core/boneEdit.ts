/**
 * Bone hierarchy edits for the M2 editing kernel: create / delete / re-parent.
 *
 * Official flows (Loongbones editor docs, `pose-bone.md`): draw a bone with the
 * bone tool, delete it from the outline (or Delete), and set a parent either by
 * dragging the bone in the outline or by clicking "设置父级" and then picking the
 * new parent on the stage. Every operation here keeps the rest of the document
 * consistent — children, slot parents, animation timelines and IK constraints.
 */
import type { DbArmatureData, DbBoneData, DbSlotData, DbTransform } from './types';
import type { Player } from './player';
import { apply, decomposeMatrix, invert, matFromTransform, multiply, type Mat2D } from './runtime/math';
import { bindWorlds } from './editing';
import { reparentKeepingWorld } from './bindCompensate';

const IDENTITY: Mat2D = [1, 0, 0, 1, 0, 0];
const RAD2DEG = 180 / Math.PI;
const round2 = (value: number) => Math.round(value * 100) / 100;

/** `bone`, `bone_1`, `bone_2`, … — never collides with an existing bone. */
export function uniqueBoneName(armature: DbArmatureData, wanted: string): string {
  const base = wanted.trim() || 'bone';
  if (!armature.bone.some((entry) => entry.name === base)) return base;
  for (let i = 1; i < 1000; i++) {
    const candidate = `${base}_${i}`;
    if (!armature.bone.some((entry) => entry.name === candidate)) return candidate;
  }
  return `${base}_x`;
}

/** Round an authoring transform like the official writer does, dropping defaults. */
function normaliseTransform(t: DbTransform | undefined): DbTransform | undefined {
  if (!t) return undefined;
  const out: DbTransform = {};
  const x = round2(t.x ?? 0);
  const y = round2(t.y ?? 0);
  const skX = round2(t.skX ?? 0);
  const skY = round2(t.skY ?? 0);
  const scX = round2(t.scX ?? 1);
  const scY = round2(t.scY ?? 1);
  if (x !== 0) out.x = x;
  if (y !== 0) out.y = y;
  if (skX !== 0) out.skX = skX;
  if (skY !== 0) out.skY = skY;
  if (scX !== 1) out.scX = scX;
  if (scY !== 1) out.scY = scY;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Rebuild the runtime so an edit is visible immediately (keeps animation + frame). */
export function rebuildRuntime(player: Player): void {
  const position = player.position;
  const animation = player.animation?.name;
  player.setArmature(player.skeleton.armature.name);
  if (animation) player.setAnimation(animation);
  player.seek(position);
}

export interface AddBoneOptions {
  /** requested name (a unique suffix is appended when it is taken) */
  name?: string;
  /** parent bone name; `null`/`''` attaches the bone to the armature root */
  parent?: string | null;
  /** bind transform relative to the parent */
  transform?: DbTransform;
  /** bone length (cosmetic, and used by the two-bone IK solve) */
  length?: number;
}

/** Create a bone (the "创建骨骼" tool draws one as a child of the selection). */
export function addBone(player: Player, options: AddBoneOptions = {}): string | null {
  const armature = player.skeleton.armature;
  const parentName = (options.parent ?? '').trim();
  if (parentName && !armature.bone.some((entry) => entry.name === parentName)) return null;

  const name = uniqueBoneName(armature, options.name ?? 'bone');
  const bone: DbBoneData = { name };
  if (parentName) bone.parent = parentName;
  const transform = normaliseTransform(options.transform);
  if (transform) bone.transform = transform;
  if (typeof options.length === 'number' && options.length > 0) bone.length = round2(options.length);

  armature.bone.push(bone);
  rebuildRuntime(player);
  return name;
}

/**
 * Create a bone from two armature-space points — the official draw gesture.
 * `length` is the drawn segment, the direction becomes the bind rotation.
 */
export function addBoneBetween(
  player: Player,
  from: { x: number; y: number },
  to: { x: number; y: number },
  parent?: string | null,
): string | null {
  const armature = player.skeleton.armature;
  const parentName = (parent ?? '').trim();
  if (parentName && !armature.bone.some((entry) => entry.name === parentName)) return null;

  const parentWorld: Mat2D = parentName
    ? bindWorlds(armature.bone).get(parentName) ?? IDENTITY
    : IDENTITY;
  const inverse = invert(parentWorld);
  const start = apply(inverse, from.x, from.y);
  const end = apply(inverse, to.x, to.y);
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length < 1) return null;

  const degrees = Math.atan2(dy, dx) * RAD2DEG;
  return addBone(player, {
    parent: parentName || null,
    length,
    transform: { x: start[0], y: start[1], skX: degrees, skY: degrees, scX: 1, scY: 1 },
  });
}

/**
 * Delete a bone. Its children and slots are re-parented to its parent so nothing
 * silently disappears; its timelines and any IK constraint referencing it go away.
 * The last remaining bone cannot be deleted (an armature needs a root).
 */
export function removeBone(player: Player, name: string): boolean {
  const armature = player.skeleton.armature;
  if (armature.bone.length <= 1) return false;
  const index = armature.bone.findIndex((entry) => entry.name === name);
  if (index < 0) return false;
  const bone = armature.bone[index];
  const parent = bone.parent && armature.bone.some((entry) => entry.name === bone.parent) ? bone.parent : '';

  // 子骨骼与槽位上提一级，并做世界坐标补偿（之前只改 parent，子骨骼/部件会跳位）
  const fallbackSlotParent = parent || armature.bone.find((entry) => entry.name !== name)?.name || '';
  reparentKeepingWorld(armature, name, parent, fallbackSlotParent);
  for (const animation of armature.animation ?? []) {
    if (animation.bone) animation.bone = animation.bone.filter((timeline) => timeline.name !== name);
    if (animation.surface) animation.surface = animation.surface.filter((timeline) => timeline.name !== name);
  }
  if (armature.ik) armature.ik = armature.ik.filter((ik) => ik.bone !== name && ik.target !== name);
  armature.bone.splice(index, 1);
  rebuildRuntime(player);
  return true;
}

/**
 * Re-parent a bone, keeping its bind world pose (the official outline drag and the
 * "设置父级" two-click flow both behave that way). Refuses cycles and self-parents.
 */
export function setBoneParent(player: Player, name: string, parent: string | null): boolean {
  const armature = player.skeleton.armature;
  const bone = armature.bone.find((entry) => entry.name === name);
  if (!bone) return false;
  const nextParent = (parent ?? '').trim();
  if (nextParent === name) return false;
  if (nextParent && !armature.bone.some((entry) => entry.name === nextParent)) return false;

  for (let cursor = nextParent, guard = 0; cursor && guard < 1000; guard++) {
    const entry = armature.bone.find((item) => item.name === cursor);
    cursor = entry?.parent ?? '';
    if (cursor === name) return false;
  }

  const worlds = bindWorlds(armature.bone);
  const world = worlds.get(name) ?? matFromTransform(bone.transform);
  const parentWorld = nextParent ? worlds.get(nextParent) ?? IDENTITY : IDENTITY;
  const local = multiply(invert(parentWorld), world);
  const decomposed = decomposeMatrix(local);

  if (nextParent) bone.parent = nextParent;
  else delete bone.parent;
  bone.transform = normaliseTransform({
    x: local[4],
    y: local[5],
    skX: (decomposed.rotation + decomposed.skew) * RAD2DEG,
    skY: decomposed.rotation * RAD2DEG,
    scX: decomposed.scaleX,
    scY: decomposed.scaleY,
  });
  rebuildRuntime(player);
  return true;
}

/**
 * 设置骨骼长度（官方属性面板的「长度」）。
 *
 * 格式验证：`length` **不参与**世界矩阵的推导 —— 它是显示长度，只被
 *   - 双骨 IK 求解（`runtime/ik.ts`：`boneLength = |length| * hypot(world[0], world[1])`）
 *   - 骨骼 overlay 的末端位置
 * 用到。所以改完之后要重建骨架（`Player.rebuildSkeleton()`）才会生效。
 */
export function setBoneLength(armature: DbArmatureData, name: string, length: number): boolean {
  const bone = (armature.bone ?? []).find((entry) => entry.name === name);
  if (!bone) return false;
  if (!Number.isFinite(length) || length < 0) return false;
  bone.length = Math.round(length * 1000) / 1000;
  return true;
}

/** JSON 深拷贝：克隆出来的子树不能和原数据共享数组（改一个会连带改另一个）。 */
const deepCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * 克隆一根骨骼连同它的子树（官方 `MenuItem-duplicate`「克隆」）：
 * 子树里的骨骼、挂在它们身上的插槽、以及这些插槽的显示对象都深拷贝一份，新的子树挂回
 * 原骨骼的父级下（同级）。**时间轴不复制**（官方克隆骨骼也不带关键帧）。
 * 返回新子树的根骨骼名；骨骼不存在时返回 null。
 */
export function cloneBone(player: Player, name: string): string | null {
  const armature = player.skeleton.armature;
  const bones = armature.bone ?? [];
  const source = bones.find((entry) => entry.name === name);
  if (!source) return null;

  // ① 子树（含自己），深度优先
  const subtree: string[] = [];
  const walk = (boneName: string) => {
    subtree.push(boneName);
    for (const child of bones) {
      if ((child.parent ?? '') === boneName) walk(child.name);
    }
  };
  walk(name);

  // ② 名字映射（先占坑，避免新名字互相撞车）
  const takenBones = new Set<string>(bones.map((entry) => entry.name));
  const uniqueBone = (wanted: string): string => {
    if (!takenBones.has(wanted)) { takenBones.add(wanted); return wanted; }
    for (let i = 1; i < 1000; i++) {
      const candidate = `${wanted}_${i}`;
      if (!takenBones.has(candidate)) { takenBones.add(candidate); return candidate; }
    }
    return `${wanted}_x`;
  };
  const rename = new Map<string, string>();
  for (const old of subtree) rename.set(old, uniqueBone(`${old}_copy`));

  // ③ 深拷贝骨骼；子树内的父级映射到新名字，子树根仍挂在原来的父级下
  for (const old of subtree) {
    const src = bones.find((entry) => entry.name === old);
    if (!src) continue;
    const copy = deepCopy(src);
    copy.name = rename.get(old)!;
    const parent = src.parent ?? '';
    if (parent && rename.has(parent)) copy.parent = rename.get(parent)!;
    else if (parent) copy.parent = parent;
    else delete copy.parent;
    bones.push(copy);
  }

  // ④ 深拷贝挂在子树骨骼上的插槽（连同 skin 里的显示对象）
  const inSubtree = new Set(subtree);
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
  for (const slot of armature.slot ?? []) {
    const parent = slot.parent ?? '';
    const mappedParent = rename.get(parent);
    if (!mappedParent || !inSubtree.has(parent)) continue;
    const copy = deepCopy(slot);
    copy.name = uniqueSlot(`${slot.name}_copy`);
    copy.parent = mappedParent;
    newSlots.push(copy);
    const srcSlot = skin?.slot.find((entry) => entry.name === slot.name);
    if (skin && srcSlot) skin.slot.push({ name: copy.name, display: deepCopy(srcSlot.display) });
  }
  if (newSlots.length > 0) armature.slot.push(...newSlots);

  rebuildRuntime(player);
  return rename.get(name) ?? null;
}

/**
 * 「相关」骨骼（官方 `MenuItem-lockRelated` / `MenuItem-hideRelated`）：选中的骨骼 + 它的**祖先链** + 它的**整棵子树**。
 * 「无关」= 全体的补集；「其他」= 除选中骨骼以外的全部。三条定义合起来支撑官方那六个菜单项。
 */
export function relatedBoneNames(armature: DbArmatureData, name: string): string[] {
  const bones = armature.bone ?? [];
  const byName = new Map(bones.map((entry) => [entry.name, entry]));
  if (!byName.has(name)) return [];
  const out = new Set<string>([name]);
  // 祖先链（防环）
  let cursor = byName.get(name)?.parent ?? '';
  for (let step = 0; cursor && byName.has(cursor) && step < 1000; step++) {
    if (out.has(cursor)) break;
    out.add(cursor);
    cursor = byName.get(cursor)?.parent ?? '';
  }
  // 整棵子树
  const walk = (boneName: string) => {
    for (const child of bones) {
      if ((child.parent ?? '') !== boneName) continue;
      if (out.has(child.name)) continue;
      out.add(child.name);
      walk(child.name);
    }
  };
  walk(name);
  return [...out];
}
