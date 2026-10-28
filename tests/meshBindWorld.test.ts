/**
 * `Skeleton.bindWorld` 的语义验证。
 *
 * JSON 形态的 `display.bonePose` 显式存了「每根骨骼的绑定世界矩阵」，而 dbbin 形态把它烘进了
 * `bindOffsets` —— 所以只要 bindWorld 能与官方 JSON 的 bonePose 对上，dbbin 的位移公式
 * `bakedDelta = inverse(bindWorld_k) · slotPose · localDelta` 才有依据。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { Player } from '../src/core/player';
import type { DbArmatureData, DbDisplayData } from '../src/core/types';

const HOME = '.';
const SKELETON = `${HOME}/samples/out-new/Rooster_An_ske.json`;
const TEXTURE = `${HOME}/samples/out-new/Rooster_An_tex.json`;
const hasFixture = existsSync(SKELETON) && existsSync(TEXTURE);
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

describe.skipIf(!hasFixture)('bindWorld 语义', () => {
  it('与官方 bonePose 里的绑定矩阵逐元素一致', () => {
    const doc = readJson(SKELETON);
    const player = new Player(doc, readJson(TEXTURE) as never);
    const armature = doc.armature[0] as DbArmatureData;
    let checked = 0;
    let worst = 0;
    for (const skin of armature.skin ?? []) {
      for (const slot of skin.slot ?? []) {
        for (const display of (slot.display ?? []) as DbDisplayData[]) {
          const pose = display.bonePose;
          if (!pose || pose.length === 0) continue;
          for (let i = 0; i + 6 < pose.length; i += 7) {
            const boneIndex = pose[i];
            const bind = player.skeleton.bindWorld[boneIndex];
            expect(bind, `bindWorld[${boneIndex}] 缺失`).toBeDefined();
            for (let k = 0; k < 6; k++) {
              // 相对误差：矩阵元素量级是几百，绝对容差没有说服力
              const scale = Math.max(1, Math.abs(pose[i + 1 + k]));
              worst = Math.max(worst, Math.abs(bind[k] - pose[i + 1 + k]) / scale);
            }
            checked++;
          }
        }
      }
    }
    console.log('checked', checked, 'bone poses, worst relative diff', worst.toExponential(3));
    expect(checked).toBeGreaterThan(50);
    // 相对误差 1e-5 已经远小于「绑错骨骼」会造成的偏差（那会是百分级）
    expect(worst).toBeLessThan(1e-5);
  });
});
