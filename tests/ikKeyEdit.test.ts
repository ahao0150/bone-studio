/**
 * IK 关键帧编辑（属性面板旗杆的落点）。
 *
 * 两层判据：
 *   1. 数据语义 —— 打键 / 插键 / 删键的帧结构与 `editing.ts`、`ffdEdit.ts` 一致（时长守恒、起点递增）；
 *   2. 运行时 —— IK 时间轴真的改变姿态（这是「k 帧」这件事的意义所在）。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { Player } from '../src/core/player';
import {
  ikBindValues, ikKeyAt, ikTimelineOf, readIkKey, removeIkKeyframe, setIkKeyframe,
} from '../src/core/ikKeyEdit';
import { removeIkConstraint } from '../src/core/ikEdit';
import type { DbAnimationData, DbArmatureData, DbIkConstraintData } from '../src/core/types';

const HOME = '.';
const SKELETON = `${HOME}/samples/out-new/Rooster_An_ske.json`;
const TEXTURE = `${HOME}/samples/out-new/Rooster_An_tex.json`;
const hasFixture = existsSync(SKELETON) && existsSync(TEXTURE);
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

const starts = (frames: Array<{ duration?: number }>): number[] => {
  const out: number[] = [];
  let at = 0;
  for (const frame of frames) {
    out.push(at);
    at += frame.duration ?? 1;
  }
  return out;
};
const total = (frames: Array<{ duration?: number }>): number =>
  frames.reduce((sum, frame) => sum + (frame.duration ?? 1), 0);

function emptyAnimation(duration = 20): DbAnimationData {
  return { name: 'a', duration, frame: [] } as unknown as DbAnimationData;
}

describe('IK 关键帧编辑', () => {
  it('第一帧落在播放头，头部补一帧沿用绑定值（打键之前的姿态不变）', () => {
    const animation = emptyAnimation();
    const base = { weight: 1, bendPositive: true };
    expect(setIkKeyframe(animation, 'bone_ik', 10, { weight: 0.5, bendPositive: false }, base)).toBe(true);
    const frames = ikTimelineOf(animation, 'bone_ik')!.frame!;
    expect(starts(frames)).toEqual([0, 10]);
    expect(total(frames)).toBe(20);
    expect(readIkKey(animation, 'bone_ik', 0)).toEqual(base);
    expect(readIkKey(animation, 'bone_ik', 10)).toEqual({ weight: 0.5, bendPositive: false });
    expect(ikKeyAt(animation, 'bone_ik', 10)).toBe(true);
    expect(ikKeyAt(animation, 'bone_ik', 5)).toBe(false);
  });

  it('帧 0 打键时不补头帧', () => {
    const animation = emptyAnimation(12);
    setIkKeyframe(animation, 'bone_ik', 0, { weight: 0.25, bendPositive: false });
    const frames = ikTimelineOf(animation, 'bone_ik')!.frame!;
    expect(starts(frames)).toEqual([0]);
    expect(total(frames)).toBe(12);
  });

  it('区间里打键会一分为二，删键把时长并回相邻帧，掏空后整条轨道移除', () => {
    const animation = emptyAnimation();
    const base = { weight: 1, bendPositive: true };
    setIkKeyframe(animation, 'bone_ik', 10, { weight: 0.5, bendPositive: false }, base);
    // 落在 (0,10) 中间 → 拆帧
    setIkKeyframe(animation, 'bone_ik', 4, { weight: 0.8, bendPositive: true }, base);
    let frames = ikTimelineOf(animation, 'bone_ik')!.frame!;
    expect(starts(frames)).toEqual([0, 4, 10]);
    expect(total(frames)).toBe(20);
    // bendPositive 是阶梯量：区间里取该帧的值（不是补间）
    expect(readIkKey(animation, 'bone_ik', 7)).toEqual({ weight: expect.closeTo(0.65, 5), bendPositive: true });

    expect(removeIkKeyframe(animation, 'bone_ik', 4)).toBe(true);
    frames = ikTimelineOf(animation, 'bone_ik')!.frame!;
    // 删掉中间的键 → 它的时长并进**下一帧**，后一个键的起点因此前移 6 帧（与 ffdEdit 同语义），
    // 值仍是原来那个键的值；总时长守恒。
    expect(starts(frames)).toEqual([0, 4]);
    expect(total(frames)).toBe(20);
    expect(readIkKey(animation, 'bone_ik', 4)).toEqual({ weight: 0.5, bendPositive: false });

    expect(removeIkKeyframe(animation, 'bone_ik', 0)).toBe(true);   // 剩一帧（时长 20）
    expect(removeIkKeyframe(animation, 'bone_ik', 0)).toBe(true);   // 删掉最后一帧 → 整条轨道移除
    expect(ikTimelineOf(animation, 'bone_ik')).toBeNull();
    expect(animation.ik ?? []).toEqual([]);
  });

  it('绑定值经过 parseBoolean（字符串 "false" 不当真值）', () => {
    const constraint = { name: 'c', bone: 'b', target: 't', bendPositive: 'false', weight: 0.3 } as DbIkConstraintData;
    expect(ikBindValues(constraint)).toEqual({ weight: 0.3, bendPositive: false });
  });
});

describe.skipIf(!hasFixture)('IK 时间轴驱动运行时', () => {
  it('在某一帧打 IK 键后，该帧的姿态按关键帧求解（weight=0 等价于没有约束）', () => {
    const doc = readJson(SKELETON);
    const player = new Player(doc, readJson(TEXTURE) as never);
    const armature = doc.armature[0] as DbArmatureData;
    player.setAnimation('rooster_idle_anim');
    const animation = player.animation as DbAnimationData;
    const seek = (frame: number) => {
      player.rebuildSkeleton();
      player.seek(frame);
      return player.skeleton.bones.map((bone) => [...bone.world]);
    };
    const diff = (a: number[][], b: number[][]) => {
      let worst = 0;
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        for (let k = 0; k < 6; k++) worst = Math.max(worst, Math.abs(a[i][k] - b[i][k]));
      }
      return worst;
    };
    const constraint = (armature.ik ?? [])[0];

    const bound = seek(6);                                   // 绑定约束生效
    expect(setIkKeyframe(animation, constraint.name, 6, { weight: 0, bendPositive: true }, ikBindValues(constraint))).toBe(true);
    const keyedZero = seek(6);
    expect(removeIkConstraint(armature, constraint.name)).toBe(true);
    const without = seek(6);
    // 关键帧上的 weight=0 应当和不带约束一致 —— 证明键真的进了求解链
    const zeroVsNone = diff(keyedZero, without);
    const boundVsNone = diff(bound, without);
    console.log('keyed weight=0 vs no constraint:', zeroVsNone.toExponential(3),
      '| bind weight=1 vs no constraint:', boundVsNone.toExponential(3));
    expect(zeroVsNone).toBeLessThan(1e-6);
    expect(boundVsNone).toBeGreaterThan(1e-3);
    // 帧 0 的头帧沿用绑定值 → 该帧仍是「约束生效」的姿态
    expect(diff(seek(0), without)).toBeGreaterThan(1e-3);
  });
});
