/**
 * dbbin 形态的加点与删点（M-13 收口）。
 *
 * 二进制形态把绑定坐标烘进 `bindOffsets`，所以加/删顶点时这条流必须与 `weights` 一样
 * 按顶点对齐地维护；`bindOffsets` 的第 k 个烘焙点属于 `weights` 里第 k 根骨骼。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { Player } from '../src/core/player';
import { addMeshVertexOnEdge, findMesh, meshVertexCount, moveMeshVertex, removeMeshVertex } from '../src/core/meshEdit';
import { decodeDbbin } from '../src/core/parse/dbbinDecode';
import type { DbArmatureData, DbDisplayData } from '../src/core/types';

const HOME = '.';
const BINARY = `${HOME}/samples/out-binary/Rooster_An_ske.dbbin`;
const TEXTURE = `${HOME}/samples/out-new/Rooster_An_tex.json`;
const hasFixture = existsSync(BINARY) && existsSync(TEXTURE);
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const SLOT = 'hood';

function binaryPlayer(): Player {
  const player = new Player(decodeDbbin(readFileSync(BINARY)).json, readJson(TEXTURE) as never);
  player.setAnimation('rooster_idle_anim');
  player.seek(6);
  return player;
}

const bindWorldOf = (player: Player) => (index: number) => player.skeleton.bindWorld[index] ?? null;

/** 每条「按顶点一条记录」的流（weights / bindOffsets 同构）→ 每个顶点的记录长度。 */
function recordCounts(flat: number[] | undefined): number[] {
  const out: number[] = [];
  let at = 0;
  const list = flat ?? [];
  while (at < list.length) {
    const count = list[at++];
    out.push(count);
    at += count * 2;
  }
  return out;
}

function tris(flat: number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i + 2 < flat.length; i += 3) out.push([flat[i], flat[i + 1], flat[i + 2]]);
  return out;
}

/** 一条被两个三角形共享的边（内部边），加点会把它一分为二。 */
function interiorEdge(mesh: DbDisplayData): { a: number; b: number } {
  const triangles = mesh.triangles ?? [];
  const fan = new Map<string, number>();
  for (const tri of tris(triangles)) {
    for (let k = 0; k < 3; k++) {
      const x = tri[k];
      const y = tri[(k + 1) % 3];
      const key = x < y ? `${x}_${y}` : `${y}_${x}`;
      fan.set(key, (fan.get(key) ?? 0) + 1);
    }
  }
  for (const [key, count] of fan) {
    if (count === 2) {
      const [x, y] = key.split('_').map(Number);
      return { a: x, b: y };
    }
  }
  throw new Error('no interior edge in fixture');
}

function worldVertex(player: Player, slot: string, vertex: number): [number, number] {
  const item = player.renderItems().find((entry) => entry.slot === slot && entry.kind === 'mesh');
  if (!item) throw new Error(`no mesh item for ${slot}`);
  return [item.positions[vertex * 2], item.positions[vertex * 2 + 1]];
}

describe.skipIf(!hasFixture)('dbbin 加点/删点', () => {
  it('加点：结构同步，且新顶点可以跟手拖动', () => {
    const player = binaryPlayer();
    const armature = player.skeleton.armature as DbArmatureData;
    const mesh = findMesh(armature, SLOT) as DbDisplayData;
    const beforeVerts = meshVertexCount(mesh);
    const beforeTris = tris(mesh.triangles ?? []).length;
    expect((mesh.bindOffsets ?? []).length).toBeGreaterThan(0);
    const { a, b } = interiorEdge(mesh);

    const index = addMeshVertexOnEdge(armature, SLOT, a, b, 0.5, { bindWorld: bindWorldOf(player) });
    expect(index).toBe(beforeVerts);
    expect(meshVertexCount(mesh)).toBe(beforeVerts + 1);
    expect(tris(mesh.triangles ?? []).length).toBe(beforeTris + 2);
    // 三条「按顶点」的流必须一起长一条记录，且新记录的骨骼数一致
    expect(recordCounts(mesh.weights).length).toBe(beforeVerts + 1);
    expect(recordCounts(mesh.bindOffsets).length).toBe(beforeVerts + 1);
    const newIndex = index as number;
    expect(recordCounts(mesh.bindOffsets)[newIndex]).toBe(recordCounts(mesh.weights)[newIndex]);

    // 数值对拍：新顶点拖动时渲染必须按 J 变化 —— 烘焙点算错（少骨骼/错骨骼）这里就会红
    const jacobian = player.skeleton.meshVertexJacobian(SLOT, newIndex);
    expect(jacobian).not.toBeNull();
    const [ja, jb] = jacobian as [number, number, number, number];
    const origin = worldVertex(player, SLOT, newIndex);
    const eps = 0.1;
    expect(moveMeshVertex(armature, SLOT, newIndex, eps, 0, { bindWorld: bindWorldOf(player) })).toBe(true);
    const moved = worldVertex(player, SLOT, newIndex);
    expect(Math.abs(ja * eps - (moved[0] - origin[0]))).toBeLessThan(1e-3);
    expect(Math.abs(jb * eps - (moved[1] - origin[1]))).toBeLessThan(1e-3);
  });

  it('删点：烘焙记录与权重记录一起少一条', () => {
    const player = binaryPlayer();
    const armature = player.skeleton.armature as DbArmatureData;
    const mesh = findMesh(armature, SLOT) as DbDisplayData;
    const beforeVerts = meshVertexCount(mesh);
    const beforeBaked = recordCounts(mesh.bindOffsets).length;
    const beforeWeights = recordCounts(mesh.weights).length;
    expect(beforeBaked).toBe(beforeVerts);

    expect(removeMeshVertex(armature, SLOT, 5)).toBe(true);
    expect(meshVertexCount(mesh)).toBe(beforeVerts - 1);
    expect(recordCounts(mesh.bindOffsets).length).toBe(beforeBaked - 1);
    expect(recordCounts(mesh.weights).length).toBe(beforeWeights - 1);
    // 剩下的记录数仍与顶点数一致（错位的话后面会越读越乱）
    expect(recordCounts(mesh.bindOffsets).length).toBe(meshVertexCount(mesh));
  });

  it('加点缺少绑定矩阵时拒绝，并且不留下半更新', () => {
    const player = binaryPlayer();
    const armature = player.skeleton.armature as DbArmatureData;
    const mesh = findMesh(armature, SLOT) as DbDisplayData;
    const snapshot = {
      verts: meshVertexCount(mesh),
      tris: (mesh.triangles ?? []).length,
      baked: (mesh.bindOffsets ?? []).length,
      weights: (mesh.weights ?? []).length,
      vertices: (mesh.vertices ?? []).length,
    };
    const { a, b } = interiorEdge(mesh);
    // 不传 bindWorld：必须整个操作失败，而不是「顶点加了、烘焙点没加」
    expect(addMeshVertexOnEdge(armature, SLOT, a, b, 0.5)).toBeNull();
    expect(meshVertexCount(mesh)).toBe(snapshot.verts);
    expect((mesh.triangles ?? []).length).toBe(snapshot.tris);
    expect((mesh.bindOffsets ?? []).length).toBe(snapshot.baked);
    expect((mesh.weights ?? []).length).toBe(snapshot.weights);
    expect((mesh.vertices ?? []).length).toBe(snapshot.vertices);
  });
});
