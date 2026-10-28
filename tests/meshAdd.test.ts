/**
 * M4 加点：在一条被三角形共享的边上插入顶点并细分三角形。
 * 除结构断言外还验证「细分不改变几何」—— 三角形面积总和必须守恒。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  addMeshVertexOnEdge, findEdgeIndex, findMesh, isBakedMesh, meshEdges, meshVertexCount, readMesh,
} from '../src/core/meshEdit';
import type { DbArmatureData, DbDisplayData } from '../src/core/types';

const SKELETON = 'samples/out-new/Rooster_An_ske.json';
const hasFixture = existsSync(SKELETON);
const loadArmature = (): DbArmatureData => JSON.parse(readFileSync(SKELETON, 'utf8')).armature[0] as DbArmatureData;

const SLOT = 'hood';

/** Triangle triples of a flat index list. */
function tris(flat: number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i + 2 < flat.length; i += 3) out.push([flat[i], flat[i + 1], flat[i + 2]]);
  return out;
}

/** Total unsigned area of a mesh (shoelace per triangle). */
function area(display: DbDisplayData): number {
  const { vertices, triangles } = readMesh(display);
  let sum = 0;
  for (const [i0, i1, i2] of tris(triangles)) {
    const [x0, y0] = vertices[i0];
    const [x1, y1] = vertices[i1];
    const [x2, y2] = vertices[i2];
    sum += Math.abs((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)) / 2;
  }
  return sum;
}

/** How many triangles use the unordered pair (a, b). */
function edgeFan(display: DbDisplayData, a: number, b: number): number {
  return tris(display.triangles ?? []).filter((tri) => tri.includes(a) && tri.includes(b)).length;
}

/** A shared interior edge (used by two triangles) plus its fan size. */
function interiorEdge(display: DbDisplayData): { a: number; b: number; fan: number } {
  for (const [a, b] of meshEdges(display)) {
    const fan = edgeFan(display, a, b);
    if (fan === 2) return { a, b, fan };
  }
  throw new Error('no interior edge in fixture');
}

/** Vertex-record count of the flat `[count, bone, weight, ...]` weight stream. */
function weightRecords(flat: number[]): Array<Array<[number, number]>> {
  const out: Array<Array<[number, number]>> = [];
  let at = 0;
  while (at < flat.length) {
    const count = flat[at++];
    const pairs: Array<[number, number]> = [];
    for (let k = 0; k < count; k++) {
      pairs.push([flat[at], flat[at + 1]]);
      at += 2;
    }
    out.push(pairs);
  }
  if (at !== flat.length) throw new Error('weight stream overruns');
  return out;
}

describe.skipIf(!hasFixture)('mesh 加点', () => {
  it('findEdgeIndex 与端点顺序无关', () => {
    const mesh = findMesh(loadArmature(), SLOT) as DbDisplayData;
    const [a, b] = meshEdges(mesh)[0];
    const index = findEdgeIndex(mesh, a, b);
    expect(index).toBe(0);
    expect(findEdgeIndex(mesh, b, a)).toBe(0);
    expect(findEdgeIndex(mesh, 900, 901)).toBe(-1);
  });

  it('插入顶点：+1 顶点、细分使用该边的每个三角形、面积守恒', () => {
    const arm = loadArmature();
    const mesh = findMesh(arm, SLOT) as DbDisplayData;
    const beforeArea = area(mesh);
    const beforeVerts = meshVertexCount(mesh);
    const beforeTris = tris(mesh.triangles ?? []).length;
    const beforeUvs = (mesh.uvs as number[]).length;
    const { a, b, fan } = interiorEdge(mesh);
    const [ax, ay] = readMesh(mesh).vertices[a];

    const index = addMeshVertexOnEdge(arm, SLOT, a, b, 0.5) as number;
    expect(index).toBe(beforeVerts);
    const after = readMesh(mesh);
    expect(after.vertices.length).toBe(beforeVerts + 1);
    expect(tris(mesh.triangles ?? []).length).toBe(beforeTris + fan);
    expect((mesh.uvs as number[]).length).toBe(beforeUvs + 2);
    expect(after.triangles.every((i) => i >= 0 && i < after.vertices.length)).toBe(true);
    // 新顶点正好落在边上
    const mid = readMesh(mesh).vertices[index];
    const end = readMesh(mesh).vertices[b];
    expect(mid[0]).toBeCloseTo((ax + end[0]) / 2, 6);
    expect(mid[1]).toBeCloseTo((ay + end[1]) / 2, 6);
    expect(after.triangles).toContain(index);
    // 细分不改变几何
    expect(area(mesh)).toBeCloseTo(beforeArea, 6);
  });

  it('权重按 t 混合并重新归一化，顶点数+1', () => {
    const arm = loadArmature();
    const mesh = findMesh(arm, SLOT) as DbDisplayData;
    const before = weightRecords([...(mesh.weights as number[])]);
    const { a, b } = interiorEdge(mesh);
    expect(addMeshVertexOnEdge(arm, SLOT, a, b, 0.25)).not.toBeNull();
    const after = weightRecords([...(mesh.weights as number[])]);
    expect(after.length).toBe(before.length + 1);
    const added = after[after.length - 1];
    expect(added.length).toBeGreaterThan(0);
    const sum = added.reduce((acc, [, w]) => acc + w, 0);
    expect(sum).toBeCloseTo(1, 2);
    // 混出来的骨骼必须来自两端点之一
    const allowed = new Set([...before[a], ...before[b]].map(([bone]) => bone));
    expect(added.every(([bone]) => allowed.has(bone))).toBe(true);
  });

  it('拒绝：非共享边、越界、同点、以及 dbbin 烘焙形态', () => {
    const arm = loadArmature();
    const mesh = findMesh(arm, SLOT) as DbDisplayData;
    const count = meshVertexCount(mesh);
    expect(addMeshVertexOnEdge(arm, SLOT, 0, 0, 0.5)).toBeNull();
    expect(addMeshVertexOnEdge(arm, SLOT, -1, 2, 0.5)).toBeNull();
    expect(addMeshVertexOnEdge(arm, SLOT, 0, count, 0.5)).toBeNull();
    expect(addMeshVertexOnEdge(arm, 'nope', 0, 1, 0.5)).toBeNull();
    // 一条两侧顶点数相距最远的“边”几乎必然不是三角形边；用真实边反向构造更可靠
    const { a, b } = interiorEdge(mesh);
    const far = (a + Math.floor(count / 2)) % count;
    if (far !== a && far !== b && edgeFan(mesh, a, far) === 0) {
      expect(addMeshVertexOnEdge(arm, SLOT, a, far, 0.5)).toBeNull();
    }
    const baked = { type: 'mesh', vertices: [0, 0, 1, 0, 1, 1], triangles: [0, 1, 2], bindOffsets: [1, 0, 0] } as DbDisplayData;
    expect(isBakedMesh(baked)).toBe(true);
    expect(addMeshVertexOnEdge({ name: 'x', bone: [], slot: [], skin: [{ name: '', slot: [{ name: 'm', display: [baked] }] }] } as unknown as DbArmatureData, 'm', 0, 1, 0.5)).toBeNull();
  });
});
