import { describe, expect, it } from 'vitest';
import {
  ALPHA_TOLERANCE, itemOpaqueAt, itemUvAt, sampleAlpha, uvAtMesh, uvAtQuad, type AlphaMask,
} from '../src/core/alphaHit';
import type { RenderItem } from '../src/core/runtime/skeleton';
import type { TextureRegion } from '../src/core/parse/texture';

const region: TextureRegion = {
  name: 'r', x: 0, y: 0, width: 10, height: 10,
  frameX: 0, frameY: 0, frameWidth: 10, frameHeight: 10,
};

/** 16×16 的掩码，只在 [4,12)² 里画一块实心方块（其余全透明）。 */
function centerBlockMask(): AlphaMask {
  const width = 16;
  const height = 16;
  const alpha = new Uint8Array(width * height);
  for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) alpha[y * width + x] = 255;
  return { width, height, alpha };
}

function imageItem(positions: number[], uvs: number[]): RenderItem {
  return {
    kind: 'image', slot: 's', region,
    positions: Float32Array.from(positions), uvs: Float32Array.from(uvs),
    alpha: 1, tint: 0xffffff, blend: 'normal',
  };
}

function meshItem(positions: number[], uvs: number[], triangles: number[]): RenderItem {
  return {
    kind: 'mesh', slot: 'm', region,
    positions: Float32Array.from(positions), uvs: Float32Array.from(uvs),
    triangles: Uint16Array.from(triangles),
    alpha: 1, tint: 0xffffff, blend: 'normal',
  };
}

// 官方 `_652/_654.as` 第 121-152 行 `_4252` 是点内多边形；这里先把「世界坐标 → 图集 UV」这半步
// 单独钉死，再往上叠 alpha 采样。
describe('舞台拾取的 alpha 判定（透明区域不触发）', () => {
  it('轴对齐四边形：世界坐标反算出对应图集像素 UV，框外返回 null', () => {
    // 10×10 的世界方块，映射到图集里的 (100,200) 起、同样 10×10
    const item = imageItem(
      [0, 0, 10, 0, 10, 10, 0, 10],
      [100, 200, 110, 200, 110, 210, 100, 210],
    );
    expect(uvAtQuad(item.positions, item.uvs, 5, 5)).toEqual([105, 205]);
    expect(uvAtQuad(item.positions, item.uvs, 0, 0)).toEqual([100, 200]);
    expect(uvAtQuad(item.positions, item.uvs, -0.5, 5)).toBeNull();
    expect(uvAtQuad(item.positions, item.uvs, 10.5, 5)).toBeNull();
    expect(uvAtQuad(item.positions, item.uvs, 5, 12)).toBeNull();
  });

  it('旋转 + 缩放的四边形照样能反算（世界→UV 是仿射映射）', () => {
    // 局部 (0..10)² 先转 90°、放大 2 倍、再平移 (100,50)
    const toWorld = ([lx, ly]: [number, number]): [number, number] => [100 - 2 * ly, 50 + 2 * lx];
    const corners: Array<[number, number]> = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const positions: number[] = [];
    for (const c of corners) positions.push(...toWorld(c));
    const item = imageItem(positions, [0, 0, 10, 0, 10, 10, 0, 10]);
    // 局部 (5,5) → 世界 (90,60) → UV (5,5)
    expect(itemUvAt(item, 90, 60)).toEqual([5, 5]);
    // 局部 (2.5, 7.5) → 世界 (85, 55) → UV (2.5, 7.5)
    expect(itemUvAt(item, 85, 55)).toEqual([2.5, 7.5]);
    // 反方向偏出四边形
    expect(itemUvAt(item, 130, 60)).toBeNull();
  });

  it('网格：落在三角形内按重心坐标插值 UV，落在外面返回 null', () => {
    const item = meshItem(
      [0, 0, 10, 0, 0, 10],
      [0, 0, 20, 0, 0, 20],
      [0, 1, 2],
    );
    expect(itemUvAt(item, 2, 2)).toEqual([4, 4]);
    expect(itemUvAt(item, 8, 8)).toBeNull();      // 斜边之外
    expect(itemUvAt(item, 2, 9)).toBeNull();
  });

  it('掩码没准备好时回落到几何判定（异步解码不会让舞台点不动）', () => {
    const item = imageItem([0, 0, 10, 0, 10, 10, 0, 10], [0, 0, 10, 0, 10, 10, 0, 10]);
    expect(itemOpaqueAt(item, null, 5, 5)).toBe(true);
    expect(itemOpaqueAt(item, null, 50, 50)).toBe(false);
  });

  it('透明像素判为未命中、实心像素判为命中（阈值 alpha > 0）', () => {
    const mask = centerBlockMask();
    expect(ALPHA_TOLERANCE).toBe(0);
    expect(sampleAlpha(mask, 8, 8)).toBe(255);
    expect(sampleAlpha(mask, 1, 1)).toBe(0);
    expect(sampleAlpha(mask, -1, 8)).toBe(0);
    expect(sampleAlpha(mask, 99, 99)).toBe(0);

    // 16×16 的显示对象，1:1 映射到掩码像素：中心实心、左上透明
    const item = imageItem([0, 0, 16, 0, 16, 16, 0, 16], [0, 0, 16, 0, 16, 16, 0, 16]);
    expect(itemOpaqueAt(item, mask, 8, 8)).toBe(true);
    expect(itemOpaqueAt(item, mask, 1, 1)).toBe(false);
    // 非零但极低的 alpha 也算实心（tolerance = 0）
    const faint: AlphaMask = { width: 4, height: 4, alpha: new Uint8Array(16) };
    faint.alpha[0] = 1;
    expect(itemOpaqueAt(item, faint, 0.5, 0.5)).toBe(true);
    // 阈值抬高后同一个像素判为未命中
    expect(itemOpaqueAt(item, faint, 0.5, 0.5, 1)).toBe(false);
  });

  it('网格的透明区域同样不命中（UV 落在掩码的全透明处）', () => {
    const mask = centerBlockMask();
    const item = meshItem([0, 0, 16, 0, 0, 16], [0, 0, 16, 0, 0, 16], [0, 1, 2]);
    expect(itemOpaqueAt(item, mask, 8, 8)).toBe(true);
    expect(itemOpaqueAt(item, mask, 1, 1)).toBe(false);
  });
});
