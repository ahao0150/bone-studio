/**
 * §110 网格「重置」（官方 `RESET_ORIGIN` → `Mesh._3196()` → `_2092(w,h)`）：
 * 把网格重建成覆盖整张图片的 **4 角点矩形**（2 个三角形），并清空绑定 / 权重 / 手绘边。
 * `_4326()` 的 no-op 守卫（已是默认矩形）与 dbbin 烘焙形态的拒绝也要能区分对错。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  findMesh, isBakedMesh, isDefaultRectMesh, meshVertexCount, readMesh, readUserEdges, resetMeshGeometry,
} from '../src/core/meshEdit';
import type { DbArmatureData, DbDisplayData } from '../src/core/types';

const SKELETON = 'samples/out-new/Rooster_An_ske.json';
const hasFixture = existsSync(SKELETON);
const loadArmature = (): DbArmatureData => JSON.parse(readFileSync(SKELETON, 'utf8')).armature[0] as DbArmatureData;

const SLOT = 'hood';
/** 任意图集区域：重置只关心宽高与左上角，宽高决定矩形尺寸、左上角决定 UV。 */
const REGION = { x: 100, y: 50, width: 40, height: 20 };

function meshArmature(display: DbDisplayData): DbArmatureData {
  return { name: 'x', bone: [], slot: [], skin: [{ name: '', slot: [{ name: 'm', display: [display] }] }] } as unknown as DbArmatureData;
}

describe('mesh 重置（官方 _2092）', () => {
  it('重建成 4 角点矩形：顶点 / 三角形 / 轮廓 / uv 全部对齐官方', () => {
    const display = {
      type: 'mesh',
      vertices: [1, 1, 5, 1, 5, 9, 1, 9, 3, 5],
      triangles: [0, 1, 2, 0, 2, 3, 1, 4, 2],
      uvs: [0, 0, 1, 0, 1, 1, 0, 1, 0.5, 0.5],
      userEdges: [0, 1, 2, 3],
    } as DbDisplayData;
    const arm = meshArmature(display);

    expect(resetMeshGeometry(arm, 'm', REGION)).toBe(true);

    const out = findMesh(arm, 'm') as DbDisplayData;
    expect(meshVertexCount(out)).toBe(4);
    // 顶点顺序与官方 `_2092` 一致：(-w/2,-h/2) (w/2,-h/2) (-w/2,h/2) (w/2,h/2)
    expect(out.vertices).toEqual([-20, -10, 20, -10, -20, 10, 20, 10]);
    // 官方两个三角形 (0,1,2) 与 (1,3,2)
    expect(out.triangles).toEqual([0, 1, 2, 1, 3, 2]);
    // 官方 outline 闭环 [0,1, 1,3, 3,2, 2,0]
    expect(out.edges).toEqual([0, 1, 1, 3, 3, 2, 2, 0]);
    // uv 取区域四角，顶点序一致
    expect(out.uvs).toEqual([100, 50, 140, 50, 100, 70, 140, 70]);
    // 手绘边清空（官方 `_2092` 里 userEdges.length = 0）
    expect(readUserEdges(out)).toEqual([]);
  });

  it('清空绑定：weights / bindOffsets / bonePose / slotPose / offset 都不再残留', () => {
    const display = {
      type: 'mesh',
      vertices: [0, 0, 4, 0, 4, 4, 0, 4],
      triangles: [0, 1, 2, 0, 2, 3],
      weights: [2, 0, 0.5, 1, 0.5],
      bonePose: [1, 0, 0, 1, 0, 0],
      slotPose: [1, 0, 0, 1, 3, 4],
      offset: 7,
    } as DbDisplayData;
    const arm = meshArmature(display);

    expect(resetMeshGeometry(arm, 'm', REGION)).toBe(true);

    const out = findMesh(arm, 'm') as DbDisplayData;
    expect(out.weights).toBeUndefined();
    expect(out.bindOffsets).toBeUndefined();
    expect(out.bonePose).toBeUndefined();
    expect(out.slotPose).toBeUndefined();
    expect(out.offset).toBeUndefined();
  });

  it('isDefaultRectMesh：重置前 false、重置后 true（`_4326` 的 no-op 守卫）', () => {
    const display = {
      type: 'mesh',
      vertices: [-20, -10, 20, -10, -20, 10, 21, 10],  // 最后一角偏差 1 → 不是默认矩形
      triangles: [0, 1, 2, 1, 3, 2],
    } as DbDisplayData;
    expect(isDefaultRectMesh(display, REGION)).toBe(false);

    const arm = meshArmature(display);
    expect(resetMeshGeometry(arm, 'm', REGION)).toBe(true);
    expect(isDefaultRectMesh(findMesh(arm, 'm') as DbDisplayData, REGION)).toBe(true);
  });

  it('拒绝：dbbin 烘焙形态、非网格槽位、以及不存在的槽位', () => {
    const baked = {
      type: 'mesh', vertices: [0, 0, 1, 0, 1, 1], triangles: [0, 1, 2], bindOffsets: [1, 0, 0],
    } as DbDisplayData;
    expect(isBakedMesh(baked)).toBe(true);
    expect(resetMeshGeometry(meshArmature(baked), 'm', REGION)).toBe(false);

    const image = { type: 'image', path: 'hood' } as DbDisplayData;
    expect(resetMeshGeometry(meshArmature(image), 'm', REGION)).toBe(false);
    expect(resetMeshGeometry(meshArmature(image), 'nope', REGION)).toBe(false);
  });
});

describe.skipIf(!hasFixture)('mesh 重置 · 真实样例', () => {
  it('hood：重置后回到 4 顶点 / 2 三角形，权重被清空', () => {
    const arm = loadArmature();
    const before = findMesh(arm, SLOT) as DbDisplayData;
    expect(meshVertexCount(before)).toBeGreaterThan(4);
    expect(before.weights?.length ?? 0).toBeGreaterThan(0);

    expect(resetMeshGeometry(arm, SLOT, REGION)).toBe(true);

    const after = findMesh(arm, SLOT) as DbDisplayData;
    expect(readMesh(after).vertices.length).toBe(4);
    expect(after.triangles).toEqual([0, 1, 2, 1, 3, 2]);
    expect(after.weights).toBeUndefined();
    expect(isDefaultRectMesh(after, REGION)).toBe(true);
  });
});
