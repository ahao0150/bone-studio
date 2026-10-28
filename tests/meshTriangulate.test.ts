import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { Player } from '../src/core/player';
import { findMesh, meshEdges, readMesh } from '../src/core/meshEdit';
import { triangleAreaSum, triangulateMesh } from '../src/core/triangulate';

const HOME = '.';
const DIR = `${HOME}/samples/Rooster_Ani`;
const SKELETON = `${DIR}/Rooster_An_ske.json`;
const TEXTURE = `${DIR}/Rooster_An_tex.json`;
const hasFixture = existsSync(SKELETON) && existsSync(TEXTURE);

/**
 * 真实网格回归。
 *
 * 注意**不要**拿 `display.edges` 当轮廓闭环去裁：样例里 `shin_01`（61 顶点 / 60 三角形）
 * 的 `edges` 有 120 条，并不是一个简单闭环（官方也不做「用旧边重三角化」这件事）。
 * 这里断言的是 Delaunay 本身的性质：**顶点一个都不能漏**，且凸包面积 ≥ 原网格面积。
 */
describe.skipIf(!hasFixture)('真实网格上的 Delaunay', () => {
  it('uses every vertex and never covers less than the original mesh', () => {
    const player = new Player(
      JSON.parse(readFileSync(SKELETON, 'utf8')),
      JSON.parse(readFileSync(TEXTURE, 'utf8')),
    );
    const rows: string[] = [];
    let checked = 0;
    for (const slot of player.skeleton.armature.slot) {
      const display = findMesh(player.skeleton.armature, slot.name);
      if (!display) continue;
      const { vertices, triangles } = readMesh(display);
      if (vertices.length < 3 || triangles.length < 3) continue;
      const original: Array<[number, number, number]> = [];
      for (let i = 0; i + 2 < triangles.length; i += 3) original.push([triangles[i], triangles[i + 1], triangles[i + 2]]);
      const before = triangleAreaSum(vertices, original);

      const rebuilt = triangulateMesh(vertices);
      const after = triangleAreaSum(vertices, rebuilt);
      const used = new Set(rebuilt.flat());
      rows.push(`${slot.name}: verts ${vertices.length}, tris ${original.length} -> ${rebuilt.length}, area ${before.toFixed(1)} <= ${after.toFixed(1)}, edges ${meshEdges(display).length}`);

      for (let v = 0; v < vertices.length; v++) {
        expect(used.has(v), `${slot.name} 的顶点 ${v} 没被 Delaunay 用上`).toBe(true);
      }
      expect(after, `${slot.name} 的覆盖面积小于原网格`).toBeGreaterThanOrEqual(before - 1e-6);
      checked++;
    }
    console.log(rows.join('\n'));
    expect(checked).toBeGreaterThan(3);
  });
});