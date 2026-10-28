/**
 * FFD 编辑（M-12）。
 * 判据用渲染器：改一个顶点的 FFD 偏移后，**该顶点的舞台位置必须变化**，而其他顶点不动；
 * 清掉轨道后形变要消失（回到基础网格）。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { Player } from '../src/core/player';
import { clearFfdFrame, ffdTimelineOf, readFfdVertex, removeFfdTrack, setFfdVertex } from '../src/core/ffdEdit';
import { findMesh, meshVertexCount } from '../src/core/meshEdit';
import { serializeSkeletonData } from '../src/core/parse/ske';
import type { DbAnimationData, DbArmatureData } from '../src/core/types';

const HOME = '.';
const SKELETON = `${HOME}/samples/in-new-bicycle/Bicycle_ske.json`;
const TEXTURE = `${HOME}/samples/Bicycle_Bin/Bicycle_tex.json`;
const hasFixture = existsSync(SKELETON) && existsSync(TEXTURE);
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const SLOT = 'upperbody';

function worldVertex(player: Player, slot: string, vertex: number): [number, number] {
  const item = player.renderItems().find((entry) => entry.slot === slot && entry.kind === 'mesh');
  if (!item) throw new Error(`no mesh item for ${slot}`);
  return [item.positions[vertex * 2], item.positions[vertex * 2 + 1]];
}

function frameStarts(frames: Array<{ duration?: number }>): number[] {
  const out: number[] = [];
  let at = 0;
  for (const f of frames) {
    out.push(at);
    at += f.duration ?? 1;
  }
  return out;
}

describe.skipIf(!hasFixture)('FFD 编辑', () => {
  it('改一个顶点的 FFD 只影响它自己，清掉轨道后回到基础网格', () => {
    const doc = readJson(SKELETON);
    const player = new Player(doc, readJson(TEXTURE) as never);
    const armature = doc.armature[0] as DbArmatureData;
    const animation = (armature.animation ?? [])[0] as DbAnimationData;
    player.setAnimation(animation.name);
    const timeline = ffdTimelineOf(animation, SLOT);
    expect(timeline).toBeTruthy();
    const starts = frameStarts(timeline!.frame ?? []);
    expect(starts.length).toBeGreaterThan(0);
    const frame = starts[0];
    const mesh = findMesh(armature, SLOT)!;
    const count = meshVertexCount(mesh);

    // 挑一个在该帧有非零变形的顶点（证明测试确实作用在 FFD 上）
    let vertex = -1;
    for (let v = 0; v < count; v++) {
      const [ox, oy] = readFfdVertex(timeline, frame, v, count);
      if (Math.abs(ox) + Math.abs(oy) > 1e-6) { vertex = v; break; }
    }
    if (vertex < 0) vertex = 0;
    const other = vertex === 0 ? 1 : 0;

    player.seek(frame);
    const before = worldVertex(player, SLOT, vertex);
    const otherBefore = worldVertex(player, SLOT, other);
    const [ox0] = readFfdVertex(timeline, frame, vertex, count);

    expect(setFfdVertex(animation, SLOT, frame, vertex, 6, 0, count)).toBe(true);
    player.seek(frame);
    const after = worldVertex(player, SLOT, vertex);
    const otherAfter = worldVertex(player, SLOT, other);
    const moved = Math.hypot(after[0] - before[0], after[1] - before[1]);
    const otherMoved = Math.hypot(otherAfter[0] - otherBefore[0], otherAfter[1] - otherBefore[1]);
    console.log('ffd vertex moved', moved.toFixed(3), '| neighbour moved', otherMoved.toFixed(4), '| offset', ox0, '->', readFfdVertex(timeline, frame, vertex, count)[0]);
    expect(moved).toBeGreaterThan(1);            // 真的动了
    expect(readFfdVertex(timeline, frame, vertex, count)[0]).toBeCloseTo(ox0 + 6, 3);
    expect(otherMoved).toBeLessThan(1e-4);       // 只动目标顶点

    // 清掉这条轨道 → 刚才的形变必须被撤销，且回到基础网格位置
    expect(removeFfdTrack(animation, SLOT)).toBe(true);
    player.seek(frame);
    const cleared = worldVertex(player, SLOT, vertex);
    expect(Math.hypot(cleared[0] - after[0], cleared[1] - after[1])).toBeGreaterThan(0.5);
    expect(Math.hypot(cleared[0] - before[0], cleared[1] - before[1])).toBeLessThan(1e-4);
  });

  it('在不存在的帧上写入会插帧，且总时长不变', () => {
    const doc = readJson(SKELETON);
    const armature = doc.armature[0] as DbArmatureData;
    const animation = (armature.animation ?? [])[0] as DbAnimationData;
    const timeline = ffdTimelineOf(animation, SLOT)!;
    const count = meshVertexCount(findMesh(armature, SLOT)!);
    const before = frameStarts(timeline.frame ?? []);
    const durationBefore = (timeline.frame ?? []).reduce((sum, f) => sum + (f.duration ?? 1), 0);

    // 找一个不在已有帧上的位置
    let target = -1;
    for (let f = 0; f <= durationBefore; f++) {
      if (!before.some((start) => Math.abs(start - f) < 1e-4)) { target = f; break; }
    }
    expect(target).toBeGreaterThanOrEqual(0);

    expect(setFfdVertex(animation, SLOT, target, 0, 3, 0, count)).toBe(true);
    const after = frameStarts(timeline.frame ?? []);
    const durationAfter = (timeline.frame ?? []).reduce((sum, f) => sum + (f.duration ?? 1), 0);
    console.log('frames', before.length, '->', after.length, '| positions', after.join(','), '| duration', durationBefore, '->', durationAfter);
    expect(after.length).toBe(before.length + 1);
    expect(after).toContain(target);
    expect(Math.abs(durationAfter - durationBefore)).toBeLessThan(1e-6);
    // 帧起点必须严格递增
    for (let i = 1; i < after.length; i++) expect(after[i]).toBeGreaterThan(after[i - 1]);
  });

  it('写入的 FFD 会随骨架导出', () => {
    const doc = readJson(SKELETON);
    const armature = doc.armature[0] as DbArmatureData;
    const animation = (armature.animation ?? [])[0] as DbAnimationData;
    const count = meshVertexCount(findMesh(armature, SLOT)!);
    expect(setFfdVertex(animation, SLOT, 0, 2, 4, 1, count)).toBe(true);
    // serializeSkeletonData 收的是 SkeletonDoc（内部是 raw），这里直接包一层走真实导出路径
    const json = serializeSkeletonData({ raw: doc } as never);
    const track = (JSON.parse(json).armature[0].animation[0].ffd ?? []).find((t: { slot: string }) => t.slot === SLOT);
    expect(track).toBeTruthy();
    expect(Array.isArray(track.frame)).toBe(true);
    expect(track.frame.length).toBeGreaterThan(0);
  });
});
