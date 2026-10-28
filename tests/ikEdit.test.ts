/**
 * IK 约束编辑（S-09）。
 * 校验规则逐条对应官方编辑器文案；最后一组用例用**运行时姿态**证明约束真的参与求解。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { Player } from '../src/core/player';
import {
  addIkConstraint, addIkConstraintWithTarget, ikConstraintOf, ikConstraints, removeIkConstraint,
  setIkConstraint, validateIkConstraint,
} from '../src/core/ikEdit';
import { serializeSkeletonData } from '../src/core/parse/ske';
import type { DbArmatureData } from '../src/core/types';

const HOME = '.';
const SKELETON = `${HOME}/samples/out-new/Rooster_An_ske.json`;
const TEXTURE = `${HOME}/samples/out-new/Rooster_An_tex.json`;
const hasFixture = existsSync(SKELETON) && existsSync(TEXTURE);
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

/** 一个可控的小骨架，用来逐条触发校验失败。 */
function toyArmature(): DbArmatureData {
  return {
    name: 'A',
    bone: [
      { name: 'root' },
      { name: 'a', parent: 'root', inheritRotation: true, inheritScale: true },
      { name: 'b', parent: 'a', inheritRotation: true, inheritScale: true },
      { name: 'c', parent: 'b', inheritRotation: true, inheritScale: true },
      { name: 'noInherit', parent: 'root', inheritRotation: false, inheritScale: true },
      { name: 'free', parent: 'root', inheritRotation: true, inheritScale: true },
    ],
    slot: [],
    skin: [],
    ik: [],
  } as unknown as DbArmatureData;
}

describe('IK 约束编辑', () => {
  it('逐条复现官方编辑器的创建限制', () => {
    const arm = toyArmature();
    const reason = (spec: Parameters<typeof validateIkConstraint>[1]) => {
      const r = validateIkConstraint(arm, spec);
      return r.ok ? null : r.reason;
    };
    expect(reason({ bone: 'b', target: 'free' })).toBeNull();
    expect(reason({ bone: 'ghost', target: 'free' })).toBe('约束骨骼不存在');
    expect(reason({ bone: 'b', target: 'ghost' })).toBe('目标骨骼不存在');
    expect(reason({ bone: 'b', target: 'b' })).toBe('目标不能是约束骨骼自身');
    expect(reason({ bone: 'b', target: 'free', chain: 3 })).toBe('请选择不多于 2 根骨骼');
    expect(reason({ bone: 'root', target: 'free' })).toBe('不可选择根骨骼');
    expect(reason({ bone: 'noInherit', target: 'free' })).toBe('添加约束骨骼必须继承旋转缩放');
    // 目标是链里骨骼的后代 → 自锁
    expect(reason({ bone: 'b', target: 'c' })).toBe('不可将子骨骼设置为约束目标');
    // chain=2 时父级必须在（这里 a 是 root 的子，连续；用一个断链场景）
    expect(reason({ bone: 'b', target: 'free', chain: 1 })).toBeNull();
  });

  it('一根骨骼只能属于一个约束', () => {
    const arm = toyArmature();
    expect(addIkConstraint(arm, { bone: 'b', target: 'free' })).toBe('bone_ik');
    // b 已被占用
    expect(validateIkConstraint(arm, { bone: 'b', target: 'free' }).ok).toBe(false);
    // 双骨（chain > 0）时父级 a 也算被占用
    const second = validateIkConstraint(arm, { bone: 'c', target: 'free', chain: 1 });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('选择骨骼已经有约束骨骼');
  });

  it('命名沿用官方习惯（bone_ik / bone_ik1）并可增删改', () => {
    const arm = toyArmature();
    expect(addIkConstraint(arm, { bone: 'b', target: 'free' })).toBe('bone_ik');
    // 第二条用单骨（chain = 0），否则双骨会连父级 b 一起占用、与第一条冲突
    expect(addIkConstraint(arm, { bone: 'c', target: 'free', chain: 0 })).toBe('bone_ik1');
    expect(ikConstraints(arm).length).toBe(2);
    expect(ikConstraintOf(arm, 'b')?.name).toBe('bone_ik');
    // 双骨（chain > 0）时父级也能查到同一条约束
    expect(setIkConstraint(arm, 'bone_ik', { chain: 1, weight: 0.5, bendPositive: false })).toBe(true);
    expect(ikConstraintOf(arm, 'a')?.name).toBe('bone_ik');
    expect(ikConstraints(arm)[0].weight).toBe(0.5);
    expect(removeIkConstraint(arm, 'bone_ik')).toBe(true);
    expect(removeIkConstraint(arm, 'bone_ik')).toBe(false);
    expect(ikConstraints(arm).length).toBe(1);
  });

  it.skipIf(!hasFixture)('官方样例：约束参与运行时求解（删掉约束姿态就变）', () => {
    const doc = readJson(SKELETON);
    const texture = readJson(TEXTURE) as never;
    const armature = doc.armature[0] as DbArmatureData;
    expect(ikConstraints(armature).length).toBe(2);

    const player = new Player(doc, texture);
    player.setAnimation('rooster_idle_anim');
    player.seek(6);
    const snapshot = () => player.skeleton.bones.map((b) => [...b.world]);
    const withIk = snapshot();

    expect(removeIkConstraint(armature, 'bone_ik')).toBe(true);
    player.rebuildSkeleton();
    player.seek(6);
    const withoutIk = snapshot();

    let worst = 0;
    for (let i = 0; i < withIk.length; i++) {
      for (let k = 0; k < 6; k++) worst = Math.max(worst, Math.abs(withIk[i][k] - withoutIk[i][k]));
    }
    console.log('removing the IK changed bone matrices by up to', worst.toExponential(3));
    expect(worst).toBeGreaterThan(1e-3);   // 约束确实在起作用

    // 加回去，姿态应当恢复原样
    expect(addIkConstraint(armature, {
      name: 'bone_ik', bone: 'shin_lt', target: 'leg_lt_eff', chain: 1,
    })).toBe('bone_ik');
    player.rebuildSkeleton();
    player.seek(6);
    const restored = snapshot();
    let back = 0;
    for (let i = 0; i < withIk.length; i++) {
      for (let k = 0; k < 6; k++) back = Math.max(back, Math.abs(withIk[i][k] - restored[i][k]));
    }
    console.log('after re-adding the same IK, worst diff', back.toExponential(3));
    expect(back).toBeLessThan(1e-6);

    // 导出时 ik 段要跟着走
    const exported = JSON.parse(serializeSkeletonData(player.doc));
    expect((exported.armature[0].ik ?? []).length).toBe(2);
  });
});

describe.skipIf(!hasFixture)('在骨骼末端生成约束目标（Property.ik.endPick）', () => {
  it('新建目标骨骼并立刻生效，位置与官方样例同构', () => {
    const doc = readJson(SKELETON);
    const player = new Player(doc, readJson(TEXTURE) as never);
    const armature = doc.armature[0] as DbArmatureData;
    player.setAnimation('rooster_idle_anim');
    player.seek(6);

    const bonesBefore = (armature.bone ?? []).length;
    const ikBefore = ikConstraints(armature).length;
    const poseBefore = new Map(player.skeleton.bones.map((b) => [b.name, [...b.world]]));

    // shin_lt 已经被 bone_ik 占用 —— 必须拒绝，不能悄悄覆盖
    const busy = addIkConstraintWithTarget(player.skeleton, 'shin_lt');
    expect('error' in busy).toBe(true);
    if ('error' in busy) expect(busy.error).toBe('选择骨骼已经有约束骨骼');
    // 根骨骼也不能做约束骨骼
    const root = addIkConstraintWithTarget(player.skeleton, 'root');
    expect('error' in root).toBe(true);
    if ('error' in root) expect(root.error).toBe('不可选择根骨骼');

    // 样例的 bone_ik 是双骨（chain=1），已经占用了 shin_lt + thigh_lt —— 换 body_bone
    const made = addIkConstraintWithTarget(player.skeleton, 'body_bone');
    expect('name' in made).toBe(true);
    if (!('name' in made)) return;
    expect((armature.bone ?? []).length).toBe(bonesBefore + 1);
    expect(ikConstraints(armature).length).toBe(ikBefore + 1);

    const target = (armature.bone ?? []).find((b) => b.name === made.target);
    expect(target).toBeTruthy();
    // 官方样例里 leg_lt_eff 挂在 rooster_rig（链的上一层）下 —— 新目标应当同构
    expect(target?.parent).toBe('rooster_rig');
    // 而且父级必须排在数组前面，否则骨架解析会断链
    const targetIndex = (armature.bone ?? []).findIndex((b) => b.name === made.target);
    const parentIndex = (armature.bone ?? []).findIndex((b) => b.name === 'rooster_rig');
    expect(parentIndex).toBeLessThan(targetIndex);

    player.rebuildSkeleton();
    player.seek(6);
    const justAdded = player.skeleton.bones.map((b) => [...b.world]);
    const moved = (a: number[][], b: number[][]) => {
      let worst = 0;
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        for (let k = 0; k < 6; k++) worst = Math.max(worst, Math.abs(a[i][k] - b[i][k]));
      }
      return worst;
    };
    // 目标就生成在骨骼末端方向上，所以刚建好时几乎不需要旋转（这是对的）。
    // 真正证明「IK 在驱动骨骼」的做法是把目标挪开，看骨骼是否跟过去。
    const targetBone = (armature.bone ?? []).find((b) => b.name === made.target)!;
    const base = targetBone.transform ?? {};
    targetBone.transform = { ...base, x: (base.x ?? 0) + 120, y: (base.y ?? 0) - 80 };
    player.rebuildSkeleton();
    player.seek(6);
    const afterMove = player.skeleton.bones.map((b) => [...b.world]);
    const worst = moved(justAdded, afterMove);
    console.log('moving the IK target rotated the chain by up to', worst.toExponential(3));
    expect(worst).toBeGreaterThan(1e-3);
  });
});

describe.skipIf(!hasFixture)('IK 权重语义', () => {
  it('weight = 0 与「没有约束」等价，weight = 1 时约束生效', () => {
    const doc = readJson(SKELETON);
    const player = new Player(doc, readJson(TEXTURE) as never);
    const armature = doc.armature[0] as DbArmatureData;
    player.setAnimation('rooster_idle_anim');
    const seek = () => {
      player.rebuildSkeleton();
      player.seek(6);
      return player.skeleton.bones.map((b) => [...b.world]);
    };
    const withIk = seek();

    expect(setIkConstraint(armature, 'bone_ik', { weight: 0 })).toBe(true);
    const zeroWeight = seek();

    // 参照组：直接删掉约束
    expect(removeIkConstraint(armature, 'bone_ik')).toBe(true);
    const without = seek();

    const diff = (a: number[][], b: number[][]) => {
      let worst = 0;
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        for (let k = 0; k < 6; k++) worst = Math.max(worst, Math.abs(a[i][k] - b[i][k]));
      }
      return worst;
    };
    const zeroVsNone = diff(zeroWeight, without);
    const ikVsNone = diff(withIk, without);
    console.log('weight=0 vs no constraint:', zeroVsNone.toExponential(3), '| weight=1 vs no constraint:', ikVsNone.toExponential(3));
    expect(zeroVsNone).toBeLessThan(1e-6);   // 权重 0 就是不起作用
    expect(ikVsNone).toBeGreaterThan(1e-3);  // 权重 1 确实在起作用
  });
});
