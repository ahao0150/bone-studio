/**
 * 骨骼长度编辑（P-12）。
 *
 * `length` 不参与世界矩阵，只被**双骨 IK 求解**与骨骼 overlay 用到 ——
 * 所以判据是：构造一条双骨 IK，改长度后运行时姿态必须变化；改回去必须精确恢复。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { Player } from '../src/core/player';
import { setBoneLength } from '../src/core/boneEdit';
import { addIkConstraint, removeIkConstraint } from '../src/core/ikEdit';
import type { DbArmatureData } from '../src/core/types';

const HOME = '.';
const SKELETON = `${HOME}/samples/out-new/Rooster_An_ske.json`;
const TEXTURE = `${HOME}/samples/out-new/Rooster_An_tex.json`;
const hasFixture = existsSync(SKELETON) && existsSync(TEXTURE);
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

const worstDiff = (a: number[][], b: number[][]) => {
  let worst = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    for (let k = 0; k < 6; k++) worst = Math.max(worst, Math.abs(a[i][k] - b[i][k]));
  }
  return worst;
};

describe.skipIf(!hasFixture)('骨骼长度', () => {
  it('校验：不存在的骨骼与负长度都拒绝', () => {
    const armature = readJson(SKELETON).armature[0] as DbArmatureData;
    expect(setBoneLength(armature, 'ghost', 10)).toBe(false);
    expect(setBoneLength(armature, 'thigh_lt', -1)).toBe(false);
    expect(setBoneLength(armature, 'thigh_lt', Number.NaN)).toBe(false);
    expect(setBoneLength(armature, 'thigh_lt', 40)).toBe(true);
    expect((armature.bone ?? []).find((b) => b.name === 'thigh_lt')?.length).toBe(40);
  });

  it('长度进入双骨 IK 求解：改长度姿态就变，改回去精确恢复', () => {
    const doc = readJson(SKELETON);
    const player = new Player(doc, readJson(TEXTURE) as never);
    const armature = doc.armature[0] as DbArmatureData;
    player.setAnimation('rooster_idle_anim');
    player.seek(6);
    const snapshot = () => player.skeleton.bones.map((b) => [...b.world]);

    // 把 shin_lt 的单骨约束换成双骨（链 = thigh_lt → shin_lt）
    expect(removeIkConstraint(armature, 'bone_ik')).toBe(true);
    expect(addIkConstraint(armature, { bone: 'shin_lt', target: 'leg_lt_eff', chain: 1 })).toBeTruthy();
    // 先 rebuild 一次作为基线：rebuildSkeleton 自身会改变一次姿态（IK 直写世界矩阵），
    // 不先归一化的话会把它的副作用算到「长度」头上。
    player.rebuildSkeleton();
    player.seek(6);
    const before = snapshot();

    // 双骨求解用的是**链末端**骨骼的 length（runtime/ik.ts 的 boneIndex = 链末端）
    const runtimeLength = player.skeleton.bones.find((b) => b.name === 'shin_lt')!.length;
    expect(runtimeLength).toBeGreaterThan(0);

    expect(setBoneLength(armature, 'shin_lt', runtimeLength * 0.4)).toBe(true);
    player.rebuildSkeleton();
    player.seek(6);
    const shortened = snapshot();
    const changed = worstDiff(before, shortened);
    console.log('shrinking the chain-end bone moved the pose by', changed.toExponential(3));
    expect(changed).toBeGreaterThan(1e-3);

    expect(setBoneLength(armature, 'shin_lt', runtimeLength)).toBe(true);
    player.rebuildSkeleton();
    player.seek(6);
    const restored = snapshot();
    console.log('after restoring the length, worst diff', worstDiff(before, restored).toExponential(3));
    expect(worstDiff(before, restored)).toBeLessThan(1e-6);
  });

  it('单骨 IK 不使用长度（长度不参与其中）', () => {
    const doc = readJson(SKELETON);
    const player = new Player(doc, readJson(TEXTURE) as never);
    const armature = doc.armature[0] as DbArmatureData;
    player.setAnimation('rooster_idle_anim');
    player.seek(6);
    const snapshot = () => player.skeleton.bones.map((b) => [...b.world]);
    // 样例自带的 bone_ik 是 chain=1，也就是**双骨**；这里换成真正的单骨（chain = 0）再测
    expect(removeIkConstraint(armature, 'bone_ik')).toBe(true);
    expect(addIkConstraint(armature, { bone: 'shin_lt', target: 'leg_lt_eff', chain: 0 })).toBeTruthy();
    player.rebuildSkeleton();
    player.seek(6);
    const before = snapshot();
    const runtimeLength = player.skeleton.bones.find((b) => b.name === 'shin_lt')!.length;

    // 控制组：什么都不改，只做一次 rebuild + seek。rebuildSkeleton 本身会让 IK 直写的
    // 世界矩阵重新推导一次，产生一个固定的"基线漂移"；必须把它和「长度的影响」分开。
    player.rebuildSkeleton();
    player.seek(6);
    const control = snapshot();
    const baselineDrift = worstDiff(before, control);

    expect(setBoneLength(armature, 'shin_lt', runtimeLength * 0.5)).toBe(true);
    player.rebuildSkeleton();
    player.seek(6);
    const after = snapshot();
    const withLengthChange = worstDiff(before, after);
    console.log('single-bone IK: baseline drift', baselineDrift.toExponential(3),
      '| with the length halved', withLengthChange.toExponential(3));
    // 单骨求解只朝向目标，长度完全不参与 —— 两次差异必须**一模一样**（都只是 rebuild 的漂移）
    expect(Math.abs(withLengthChange - baselineDrift)).toBeLessThan(1e-9);
  });
});
