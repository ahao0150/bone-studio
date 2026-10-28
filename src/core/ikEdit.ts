/**
 * IK 约束编辑（M2 的 S-09）。
 *
 * 数据契约取自官方样例：`armature.ik[]` 每项记的是**链末端骨骼**
 * （`bone`）+ 链长 `chain`（1 或 2）+ `target`；骨骼上**不带** ik 字段。
 * 创建时官方编辑器的一组限制写在自己的界面文案里（`strings.xml`）：
 *
 *   Property.ik.moreBones   "请不要选择多于2根骨骼"
 *   Property.ik.noInherit   "添加约束骨骼必须继承旋转缩放"
 *   Tip.IK.RootNoIK         "不可选择根骨骼!"
 *   Tip.IK.NoParentChild    "所选骨骼非连续骨骼！"
 *   Tip.IK.HasConstraint    "选择骨骼已经有约束骨骼，请重新选择！"
 *   Tip.IK.NoChild          "不可将子骨骼设置为约束目标！"
 *
 * 这些限制在下面对应成一条条校验，并且有逐条测试。
 */
import type { DbArmatureData, DbBoneData, DbIkConstraintData } from './types';
import type { Skeleton } from './runtime/skeleton';
import { invert, parseBoolean } from './runtime/math';
import { uniqueBoneName } from './boneEdit';

export type IkValidation = { ok: true } | { ok: false; reason: string };

export interface IkConstraintSpec {
  name?: string;
  /** 链的**末端**骨骼（DragonBones 约定） */
  bone: string;
  target: string;
  /**
   * 官方 `chain` 只区分「要不要把父级也算进链里」：
   *   `0`（或缺省）= 单骨；`> 0` = 双骨（链 = bone + bone.parent）。
   * 依据：runtime/ik.ts 的 `twoBone = (constraint.chain ?? 0) > 0`，
   * 与官方样例一致（Rooster 的 `bone_ik` chain=1 作用在 shin_lt + thigh_lt 上）。
   */
  chain?: number;
  bendPositive?: boolean;
  weight?: number;
}

export function ikConstraints(armature: DbArmatureData): DbIkConstraintData[] {
  return armature.ik ?? [];
}

/** 某根骨骼参与的约束（链末端或链内骨骼）。 */
export function ikConstraintOf(armature: DbArmatureData, boneName: string): DbIkConstraintData | null {
  const byName = new Map((armature.bone ?? []).map((b) => [b.name, b]));
  for (const c of ikConstraints(armature)) {
    if (c.bone === boneName) return c;
    // 双骨（chain > 0）时链是 [bone, bone.parent]：问 bone.parent 时要能查到这条约束
    if ((c.chain ?? 0) > 0 && (byName.get(c.bone)?.parent ?? null) === boneName) return c;
  }
  return null;
}

/**
 * 选中的骨骼在这条约束里的**角色** —— 官方骨骼面板按它决定标题与可见行
 * （`_906/_909.as:419-423`：`rootArmatureData._1966(bone)` 查「该骨骼作为目标」的约束、
 * `_1981(bone)` 查「该骨骼在链内」的约束，分别套 `Property.ik.foldtarget`「IK约束目标」
 * 与 `Property.ik.fold`「IK约束」两套标题）。链内优先于目标（骨架校验不允许两者重合）。
 */
export function ikRoleOf(
  armature: DbArmatureData, boneName: string,
): { constraint: DbIkConstraintData; role: 'chain' | 'target' } | null {
  const chain = ikConstraintOf(armature, boneName);
  if (chain) return { constraint: chain, role: 'chain' };
  const targeting = ikConstraints(armature).find((c) => c.target === boneName);
  return targeting ? { constraint: targeting, role: 'target' } : null;
}

/** 沿祖先链向上，找「根骨骼的直接子级」（官方放 IK 目标的层级）。 */
function rootChildOf(bones: DbBoneData[], boneName: string): string | null {
  const byName = new Map(bones.map((b) => [b.name, b]));
  let current = byName.get(boneName);
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current.name)) return null;
    seen.add(current.name);
    if (!current.parent) return null;               // 本身就是根骨骼
    const parent = byName.get(current.parent);
    if (!parent) return null;
    if (!parent.parent) return current.name;        // 父级是根 → current 就是根的直接子级
    current = parent;
  }
  return null;
}

const inherits = (bone: DbBoneData): boolean =>
  parseBoolean(bone.inheritRotation, true) && parseBoolean(bone.inheritScale, true);

function isDescendant(bones: DbBoneData[], candidate: string, ancestor: string): boolean {
  const byName = new Map(bones.map((b) => [b.name, b]));
  let current = byName.get(candidate)?.parent ?? null;
  const guard = new Set<string>();
  while (current) {
    if (current === ancestor) return true;
    if (guard.has(current)) return false;
    guard.add(current);
    current = byName.get(current)?.parent ?? null;
  }
  return false;
}

/** 官方编辑器的全部创建限制。`ignoreName` 用于「改已存在的约束」，跳过它自己。 */
export function validateIkConstraint(
  armature: DbArmatureData, spec: IkConstraintSpec, ignoreName?: string,
): IkValidation {
  const bones = armature.bone ?? [];
  const byName = new Map(bones.map((b) => [b.name, b]));
  const end = byName.get(spec.bone);
  const target = byName.get(spec.target);
  if (!end) return { ok: false, reason: '约束骨骼不存在' };
  if (!target) return { ok: false, reason: '目标骨骼不存在' };
  if (spec.bone === spec.target) return { ok: false, reason: '目标不能是约束骨骼自身' };

  const chainCheck = validateIkChain(armature, spec.bone, spec.chain ?? 1, ignoreName);
  if (!chainCheck.ok) return chainCheck;
  const chain = Math.max(0, Math.min(1, Math.round(spec.chain ?? 0)));
  const parentName = end.parent;
  const first = chain > 0 && parentName ? byName.get(parentName) : undefined;
  const chainBones: DbBoneData[] = first ? [end, first] : [end];

  // 目标不能落在被约束链的子树里（否则约束会自锁）
  for (const b of chainBones) {
    if (isDescendant(bones, spec.target, b.name)) return { ok: false, reason: '不可将子骨骼设置为约束目标' };
  }

  // 一根骨骼只能属于一个约束
  const chainNames = new Set(chainBones.map((b) => b.name));
  for (const c of ikConstraints(armature)) {
    if (ignoreName && c.name === ignoreName) continue;
    const used = new Set([c.bone, ...(c.chain === 2 ? [byName.get(c.bone)?.parent ?? ''] : [])]);
    for (const name of chainNames) if (used.has(name)) return { ok: false, reason: '选择骨骼已经有约束骨骼' };
  }
  return { ok: true };
}

/** 官方命名习惯：`bone_ik`、`bone_ik1`…（看样例的 `bone_ik6`） */
function uniqueIkName(armature: DbArmatureData, base = 'bone_ik'): string {
  const used = new Set(ikConstraints(armature).map((c) => c.name));
  if (!used.has(base)) return base;
  for (let i = 1; ; i++) {
    const candidate = `${base}${i}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** 添加约束；校验不过返回 null。返回最终使用的名字。 */
export function addIkConstraint(armature: DbArmatureData, spec: IkConstraintSpec): string | null {
  const check = validateIkConstraint(armature, spec);
  if (!check.ok) return null;
  const wanted = spec.name && !ikConstraints(armature).some((c) => c.name === spec.name) ? spec.name : null;
  const constraint: DbIkConstraintData = {
    name: wanted ?? uniqueIkName(armature),
    bone: spec.bone,
    target: spec.target,
    chain: Math.max(0, Math.min(1, Math.round(spec.chain ?? 0))),
  };
  if (spec.bendPositive !== undefined) constraint.bendPositive = spec.bendPositive;
  if (spec.weight !== undefined) constraint.weight = spec.weight;
  if (!armature.ik) armature.ik = [];
  armature.ik.push(constraint);
  return constraint.name;
}

export function removeIkConstraint(armature: DbArmatureData, name: string): boolean {
  const list = armature.ik;
  if (!list) return false;
  const index = list.findIndex((c) => c.name === name);
  if (index < 0) return false;
  list.splice(index, 1);
  return true;
}

/** 改约束字段（target / weight / bendPositive / chain），改动同样过校验。 */
export function setIkConstraint(
  armature: DbArmatureData, name: string, patch: Partial<IkConstraintSpec>,
): boolean {
  const constraint = ikConstraints(armature).find((c) => c.name === name);
  if (!constraint) return false;
  const next: IkConstraintSpec = {
    bone: patch.bone ?? constraint.bone,
    target: patch.target ?? constraint.target,
    chain: patch.chain ?? constraint.chain ?? 1,
  };
  const check = validateIkConstraint(armature, next, name);
  if (!check.ok) return false;
  constraint.bone = next.bone;
  constraint.target = next.target;
  constraint.chain = Math.max(1, Math.min(2, Math.round(next.chain ?? 1)));
  if (patch.bendPositive !== undefined) constraint.bendPositive = patch.bendPositive;
  if (patch.weight !== undefined) constraint.weight = patch.weight;
  return true;
}

/** 只校验「链」本身（不含目标）：创建末端目标骨骼时还没目标可用。 */
export function validateIkChain(
  armature: DbArmatureData, boneName: string, chainInput = 1, ignoreName?: string,
): IkValidation {
  const bones = armature.bone ?? [];
  const byName = new Map(bones.map((b) => [b.name, b]));
  const end = byName.get(boneName);
  if (!end) return { ok: false, reason: '约束骨骼不存在' };
  if (chainInput > 1) return { ok: false, reason: '请选择不多于 2 根骨骼' };
  if (!end.parent) return { ok: false, reason: '不可选择根骨骼' };
  // chain > 0 才是双骨（把父级也算进链里）
  const chain = Math.max(0, Math.min(1, Math.round(chainInput)));
  const first = chain > 0 ? byName.get(end.parent) : undefined;
  if (chain > 0 && !first) return { ok: false, reason: '所选骨骼非连续骨骼' };
  for (const b of [end, first].filter(Boolean) as DbBoneData[]) {
    if (!inherits(b)) return { ok: false, reason: '添加约束骨骼必须继承旋转缩放' };
  }
  const chainNames = new Set([end.name, ...(first ? [first.name] : [])]);
  for (const c of ikConstraints(armature)) {
    if (ignoreName && c.name === ignoreName) continue;
    const used = new Set([c.bone, ...((c.chain ?? 0) > 0 ? [byName.get(c.bone)?.parent ?? ''] : [])]);
    for (const name of chainNames) if (used.has(name)) return { ok: false, reason: '选择骨骼已经有约束骨骼' };
  }
  return { ok: true };
}

/**
 * 官方 `Property.ik.endPick`（"在骨骼末端生成约束目标"）：在链末端的**末端位置**新建一根骨骼当目标，
 * 再建约束。目标挂到**链最上层骨骼的父级**下 —— 与官方样例一致（`leg_lt_eff.parent = rooster_rig`），
 * 也保证目标不在链的子树里（否则会被自己的校验拒绝）。
 */
export function addIkConstraintWithTarget(
  skeleton: Skeleton, boneName: string, chainInput = 0,
): { name: string; target: string } | { error: string } {
  const armature = skeleton.armature;
  const bones = armature.bone ?? [];
  const check = validateIkChain(armature, boneName, chainInput);
  if (!check.ok) return { error: check.reason };

  const boneIndex = bones.findIndex((b) => b.name === boneName);
  const end = bones[boneIndex];
  const chain = Math.max(0, Math.min(1, Math.round(chainInput)));
  // 官方把 IK 目标挂在**根骨骼的直接子级**（骨架主轴）下，例如
  // shin_lt > thigh_lt > body_bone > rooster_rig > root 的目标是 leg_lt_eff(parent = rooster_rig)
  const parentName = rootChildOf(bones, boneName);
  if (!parentName) return { error: '不可选择根骨骼' };
  const parentIndex = bones.findIndex((b) => b.name === parentName);
  const parentRuntime = skeleton.bones[parentIndex === boneIndex ? boneIndex : parentIndex];
  const endRuntime = skeleton.bones[boneIndex];
  if (!parentRuntime || !endRuntime) return { error: '骨架尚未就绪' };

  // 链末端的末端点（世界）→ 目标父级的局部坐标
  const world = endRuntime.world;
  const tipX = world[0] * (endRuntime.length ?? 0) + world[4];
  const tipY = world[1] * (endRuntime.length ?? 0) + world[5];
  const inv = invert(parentRuntime.world);
  const localX = inv[0] * tipX + inv[2] * tipY + inv[4];
  const localY = inv[1] * tipX + inv[3] * tipY + inv[5];
  const round = (v: number) => Math.round(v * 100) / 100;

  const targetName = uniqueBoneName(armature, `${boneName}_eff`);
  // 骨架按数组顺序解析，父级必须排在前面 —— 插到父级后面即可
  bones.splice(parentIndex + 1, 0, {
    name: targetName,
    parent: parentName,
    transform: { x: round(localX), y: round(localY) },
  } as DbBoneData);

  const name = addIkConstraint(armature, { bone: boneName, target: targetName, chain });
  if (!name) {
    bones.splice(parentIndex + 1, 1);
    return { error: '创建约束失败' };
  }
  return { name, target: targetName };
}
