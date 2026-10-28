/** M4 mesh geometry editing. Fixture: official Rooster JSON export; `hood` is a real skinned mesh. */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  findMesh, isBakedMesh, meshEdges, meshVertexCount, moveMeshVertex, readMesh, removeMeshVertex, setMeshVertex,
} from '../src/core/meshEdit';
import type { DbArmatureData, DbDisplayData } from '../src/core/types';

const SKELETON = 'samples/out-new/Rooster_An_ske.json';
const hasFixture = existsSync(SKELETON);
const loadArmature = (): DbArmatureData => JSON.parse(readFileSync(SKELETON, 'utf8')).armature[0] as DbArmatureData;

/** Flat weight stream is `[count, bone, weight, ...]` per vertex; assert it stays well formed. */
function parseWeights(flat: number[]): number {
  let at = 0;
  let verts = 0;
  while (at < flat.length) {
    const count = flat[at++];
    if (!(count >= 0)) throw new Error('bad weight count');
    at += count * 2;
    verts++;
  }
  if (at !== flat.length) throw new Error('weight stream overruns');
  return verts;
}

/** Triangles of a flat list, as triples. */
function tris(flat: number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i + 2 < flat.length; i += 3) out.push([flat[i], flat[i + 1], flat[i + 2]]);
  return out;
}

/** A five-vertex mesh, in the `*_ske.dbbin` form where bind-space points are baked. */
function bakedDisplay(): DbDisplayData {
  return {
    type: 'mesh',
    vertices: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    uvs: [0, 0, 1, 0, 1, 1, 0, 1, 0.5, 0.5],
    triangles: [0, 1, 2, 1, 3, 2],
    weights: Array.from({ length: 5 }, () => [1, 0, 1]).flat(),
    bindOffsets: [1, 10, 20, 1, 30, 40, 1, 50, 60, 1, 70, 80, 1, 90, 100],
    slotPose: [1, 0, 0, 1, 0, 0],
  };
}

function armatureWith(display: DbDisplayData): DbArmatureData {
  return {
    name: 't', bone: [], slot: [],
    skin: [{ name: '', slot: [{ name: 'm', display: [display] }] }],
  } as unknown as DbArmatureData;
}

describe.skipIf(!hasFixture)('meshEdit', () => {
  it('finds the hood mesh and counts its vertices', () => {
    const mesh = findMesh(loadArmature(), 'hood');
    expect(mesh).not.toBeNull();
    expect(meshVertexCount(mesh as DbDisplayData)).toBe(35);
    expect(meshEdges(mesh as DbDisplayData).length).toBeGreaterThan(0);
  });

  it('moves one vertex without touching the triangle list', () => {
    const arm = loadArmature();
    const mesh = findMesh(arm, 'hood') as DbDisplayData;
    const before = readMesh(mesh);
    const [x0, y0] = before.vertices[3];
    expect(moveMeshVertex(arm, 'hood', 3, 7.25, -4.5)).toBe(true);
    const after = readMesh(mesh);
    expect(after.vertices[3][0]).toBeCloseTo(x0 + 7.25, 6);
    expect(after.vertices[3][1]).toBeCloseTo(y0 - 4.5, 6);
    expect(after.triangles).toEqual(before.triangles);
    expect(after.vertices.length).toBe(before.vertices.length);
    expect(after.vertices[4]).toEqual(before.vertices[4]);
  });

  it('sets an absolute position and rejects out-of-range vertices or unknown slots', () => {
    const arm = loadArmature();
    expect(setMeshVertex(arm, 'hood', 2, 12.5, -3.25)).toBe(true);
    const mesh = findMesh(arm, 'hood') as DbDisplayData;
    expect(readMesh(mesh).vertices[2]).toEqual([12.5, -3.25]);
    expect(setMeshVertex(arm, 'hood', 35, 0, 0)).toBe(false);
    expect(setMeshVertex(arm, 'nope', 0, 0, 0)).toBe(false);
    expect(moveMeshVertex(arm, 'hood', -1, 1, 1)).toBe(false);
    expect(removeMeshVertex(arm, 'nope', 0)).toBe(false);
  });

  it('removes a vertex: drops its triangles, renumbers survivors, shrinks uvs and weights', () => {
    const arm = loadArmature();
    const mesh = findMesh(arm, 'hood') as DbDisplayData;
    const before = readMesh(mesh);
    const uvsBefore = [...(mesh.uvs as number[])];
    const weightsBefore = [...(mesh.weights as number[])];
    const vertsBefore = parseWeights(weightsBefore);
    expect(vertsBefore).toBe(before.vertices.length);
    const target = 5;
    // independent expectation: drop triangles that used the vertex, shift every higher index down
    const expected: number[] = [];
    for (const tri of tris(before.triangles)) {
      if (tri.includes(target)) continue;
      for (const k of tri) expected.push(k > target ? k - 1 : k);
    }
    expect(expected.length).toBeLessThan(before.triangles.length);

    expect(removeMeshVertex(arm, 'hood', target)).toBe(true);
    const after = readMesh(mesh);
    expect(after.vertices.length).toBe(before.vertices.length - 1);
    expect(after.triangles).toEqual(expected);
    expect(after.triangles.every((i) => i >= 0 && i < after.vertices.length)).toBe(true);
    expect(parseWeights(mesh.weights as number[])).toBe(vertsBefore - 1);
    const uvsAfter = mesh.uvs as number[];
    expect(uvsAfter.length).toBe(uvsBefore.length - 2);
    expect(uvsAfter.slice(target * 2, target * 2 + 2)).toEqual(uvsBefore.slice((target + 1) * 2, (target + 1) * 2 + 2));
  });

  it('baked 形态：缺绑定矩阵时拒绝移动（不半更新），删点则同步维护三条流', () => {
    const display = bakedDisplay();
    const arm = armatureWith(display);
    // 没有 bindWorld：移动整体失败，且不碰数据（第 73 轮起 dbbin 支持拖动，但需要绑定矩阵）
    const snapshot = JSON.stringify(display);
    expect(isBakedMesh(display)).toBe(true);
    expect(moveMeshVertex(arm, 'm', 1, 1, 2)).toBe(false);
    expect(setMeshVertex(arm, 'm', 1, 4, 6)).toBe(false);
    expect(JSON.stringify(display)).toBe(snapshot);

    // 删点：vertices / weights / bindOffsets 三条「按顶点」的流必须一起少一条
    const recordCount = (flat?: number[]): number => {
      let at = 0;
      let n = 0;
      const list = flat ?? [];
      while (at < list.length) {
        const count = list[at++];
        at += count * 2;
        n++;
      }
      return n;
    };
    expect(recordCount(display.weights)).toBe(5);
    expect(recordCount(display.bindOffsets)).toBe(5);
    expect(removeMeshVertex(arm, 'm', 1)).toBe(true);
    expect(meshVertexCount(display)).toBe(4);
    expect(recordCount(display.weights)).toBe(4);
    expect(recordCount(display.bindOffsets)).toBe(4);
  });

  it('meshEdges dedupes shared triangle edges', () => {
    const keys = meshEdges(bakedDisplay()).map(([a, b]) => (a < b ? `${a}:${b}` : `${b}:${a}`));
    expect(new Set(keys).size).toBe(keys.length);
    // triangles (0,1,2) and (1,3,2) share edge 1-2 exactly once
    expect(keys.filter((k) => k === '1:2').length).toBe(1);
  });
});
