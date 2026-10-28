import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { Player } from '../src/core/player';
import { autoWeightMesh, pointSegmentDistance } from '../src/core/weightsAuto';
import { findMesh, isBakedMesh } from '../src/core/meshEdit';

const HOME = '.';
const SKELETON = `${HOME}/samples/out-new/Rooster_An_ske.json`;
const TEXTURE = `${HOME}/samples/out-new/Rooster_An_tex.json`;
const hasFixture = existsSync(SKELETON) && existsSync(TEXTURE);

function openPlayer(): Player {
  return new Player(
    JSON.parse(readFileSync(SKELETON, 'utf8')),
    JSON.parse(readFileSync(TEXTURE, 'utf8')),
  );
}

/** 找一个「JSON 形态、有多根绑定骨骼」的网格槽位。 */
function findWeightedMesh(player: Player): string | null {
  for (const slot of player.skeleton.armature.slot) {
    const display = findMesh(player.skeleton.armature, slot.name);
    if (!display || isBakedMesh(display)) continue;
    const pose = display.bonePose ?? [];
    if (pose.length >= 14) return slot.name;
  }
  return null;
}

describe('点到线段的距离', () => {
  it('handles the perpendicular foot, the endpoints and a degenerate segment', () => {
    expect(pointSegmentDistance(0, 5, -10, 0, 10, 0)).toBeCloseTo(5, 9);
    expect(pointSegmentDistance(-20, 0, -10, 0, 10, 0)).toBeCloseTo(10, 9);
    expect(pointSegmentDistance(20, 0, -10, 0, 10, 0)).toBeCloseTo(10, 9);
    expect(pointSegmentDistance(3, 4, 5, 5, 5, 5)).toBeCloseTo(Math.hypot(2, 1), 9);
  });
});

describe.skipIf(!hasFixture)('自动权重（官方 _566.autoWeight）', () => {
  it('recomputes normalised weights for every vertex, at most 4 bones each', () => {
    const player = openPlayer();
    const slotName = findWeightedMesh(player);
    expect(slotName, '样例里应有 JSON 形态的带权重网格').not.toBeNull();

    const result = autoWeightMesh(player, slotName!);
    console.log('autoWeight', slotName, JSON.stringify(result));
    expect(result.skipped).toBeUndefined();
    expect(result.vertices).toBeGreaterThan(0);
    expect(result.bones).toBeGreaterThan(1);

    const display = findMesh(player.skeleton.armature, slotName!)!;
    const raw = display.weights ?? [];
    const vertexCount = (display.vertices?.length ?? 0) / 2;
    let cursor = 0;
    for (let v = 0; v < vertexCount; v++) {
      const count = raw[cursor++];
      expect(count, `顶点 ${v} 的骨骼数应在 1..4`).toBeGreaterThanOrEqual(1);
      expect(count).toBeLessThanOrEqual(4);
      let sum = 0;
      for (let k = 0; k < count; k++) {
        const weight = raw[cursor + 1];
        expect(Number.isFinite(weight)).toBe(true);
        expect(weight).toBeGreaterThan(0);
        sum += weight;
        cursor += 2;
      }
      expect(sum).toBeCloseTo(1, 6);
    }
    expect(cursor).toBe(raw.length);
  });

  it('refuses meshes with fewer than two bound bones, and baked meshes', () => {
    const player = openPlayer();
    const slotName = findWeightedMesh(player);
    const display = findMesh(player.skeleton.armature, slotName!)!;
    const fullPose = [...(display.bonePose ?? [])];
    // 只留一根骨骼 → 官方门槛 `bones.length > 1` 不满足
    display.bonePose = fullPose.slice(0, 7);
    const result = autoWeightMesh(player, slotName!);
    expect(result.vertices).toBe(0);
    expect(result.skipped).toContain('2 根骨骼');
    display.bonePose = fullPose;

    expect(autoWeightMesh(player, '不存在的槽位').skipped).toContain('不是网格');
    expect(autoWeightMesh(null, 'x').skipped).toContain('没有打开');
  });

  it('falls back to the first bound bone when no bone origin sits inside the mesh', () => {
    const player = openPlayer();
    const slotName = findWeightedMesh(player)!;
    const display = findMesh(player.skeleton.armature, slotName)!;
    // 把网格整体挪走 → 没有骨骼原点落在网格内 → 走官方 filterBone 的兜底分支
    display.slotPose = [1, 0, 0, 1, 100000, 100000];
    const result = autoWeightMesh(player, slotName);
    expect(result.fallback).toBe(true);
    expect(result.bones).toBe(0);
    expect(result.vertices).toBeGreaterThan(0);
    const raw = display.weights ?? [];
    expect(raw[1]).toBe(display.bonePose![0]);   // 第一根绑定骨骼
    expect(raw[2]).toBe(1);                      // 权重 1
  });
});