/**
 * IK 角色判定（官方骨骼面板按角色给两套标题与行）。
 *
 * 官方 `_906/_909.as:419-423`：选中骨骼时分别查「该骨骼在链内」的约束（`_1981`）
 * 与「该骨骼作为目标」的约束（`_1966`），套 `Property.ik.fold`「IK约束」与
 * `Property.ik.foldtarget`「IK约束目标」两套标题。本文件锁 `ikRoleOf` 的这层语义，
 * 并证明它（以及面板「点击目标 = 定位」走的这条读路径）**不改任何数据**。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { addIkConstraint, ikRoleOf, validateIkConstraint } from '../src/core/ikEdit';
import type { DbArmatureData } from '../src/core/types';

const HOME = '.';
const SKELETON = `${HOME}/samples/out-new/Rooster_An_ske.json`;
const hasFixture = existsSync(SKELETON);
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

function toyArmature(): DbArmatureData {
  return {
    name: 'A',
    bone: [
      { name: 'root' },
      { name: 'a', parent: 'root', inheritRotation: true, inheritScale: true },
      { name: 'b', parent: 'a', inheritRotation: true, inheritScale: true },
      { name: 'c', parent: 'b', inheritRotation: true, inheritScale: true },
      { name: 'free', parent: 'root', inheritRotation: true, inheritScale: true },
    ],
    slot: [],
    skin: [],
    ik: [],
  } as unknown as DbArmatureData;
}

describe('IK 角色判定', () => {
  it('链末端 / 双骨的父级 → chain；目标骨骼 → target；无关骨骼 → null', () => {
    const arm = toyArmature();
    expect(addIkConstraint(arm, { bone: 'b', target: 'free', chain: 1 })).toBe('bone_ik');

    // 链末端与它的父级（chain > 0 把父级也算进链里）都是 chain
    expect(ikRoleOf(arm, 'b')).toEqual({ constraint: arm.ik![0], role: 'chain' });
    expect(ikRoleOf(arm, 'a')).toEqual({ constraint: arm.ik![0], role: 'chain' });
    // 目标骨骼是另一套面板：官方给「IK约束目标」标题，并省略「目标」行
    expect(ikRoleOf(arm, 'free')).toEqual({ constraint: arm.ik![0], role: 'target' });
    // 既不在链内、也不是目标
    expect(ikRoleOf(arm, 'c')).toBeNull();
    expect(ikRoleOf(arm, 'root')).toBeNull();
  });

  it('链内角色优先：同一根骨骼既是一条约束的目标又是另一条约束的链末端时算 chain', () => {
    const arm = toyArmature();
    // b → free（free 是目标）
    expect(addIkConstraint(arm, { bone: 'b', target: 'free', chain: 0 })).toBe('bone_ik');
    expect(ikRoleOf(arm, 'free')).toEqual({ constraint: arm.ik![0], role: 'target' });
    // 再让 free 自己当链末端建一条，目标换成 a
    expect(addIkConstraint(arm, { bone: 'free', target: 'a', chain: 0 })).toBe('bone_ik1');
    // 命中两条约束时 chain 优先（官方也是先查链内、再查目标）
    expect(ikRoleOf(arm, 'free')).toEqual({ constraint: arm.ik![1], role: 'chain' });
    expect(ikRoleOf(arm, 'a')).toEqual({ constraint: arm.ik![1], role: 'target' });
    expect(ikRoleOf(arm, 'b')).toEqual({ constraint: arm.ik![0], role: 'chain' });
  });

  it('被拒绝的目标不会凭空出现在角色表里', () => {
    const arm = toyArmature();
    expect(addIkConstraint(arm, { bone: 'b', target: 'free', chain: 0 })).toBe('bone_ik');
    // 链内骨骼的子骨骼不能当目标 → 校验拒绝，因此 c 永远不该被报成 target
    expect(validateIkConstraint(arm, { bone: 'b', target: 'c', chain: 0 }).ok).toBe(false);
    expect(ikRoleOf(arm, 'c')).toBeNull();
  });
});

describe.skipIf(!hasFixture)('IK 角色判定（Rooster 样例）', () => {
  it('shin_lt 是 chain（目标 leg_lt_eff），leg_lt_eff 是 target', () => {
    const doc = readJson(SKELETON);
    const armature = doc.armature[0] as DbArmatureData;
    const shin = ikRoleOf(armature, 'shin_lt');
    expect(shin?.role).toBe('chain');
    expect(shin?.constraint.target).toBe('leg_lt_eff');
    const target = ikRoleOf(armature, 'leg_lt_eff');
    expect(target?.role).toBe('target');
    expect(target?.constraint.name).toBe('bone_ik');
    // 右脚对称
    expect(ikRoleOf(armature, 'shin_rt')?.role).toBe('chain');
    expect(ikRoleOf(armature, 'leg_rt_eff')?.role).toBe('target');
    // 无关骨骼
    expect(ikRoleOf(armature, 'body_bone')).toBeNull();
  });

  it('角色判定是只读的（骨架与动画一个字节都不变）', () => {
    const doc = readJson(SKELETON);
    const armature = doc.armature[0] as DbArmatureData;
    const before = JSON.stringify(doc);
    // 面板「点击目标 = 定位」只走这条读路径 + React state，不碰文档
    for (const name of ['shin_lt', 'leg_lt_eff', 'thigh_lt', 'body_bone', 'nail_01_lt']) {
      ikRoleOf(armature, name);
    }
    expect(JSON.stringify(doc)).toBe(before);
  });
});
