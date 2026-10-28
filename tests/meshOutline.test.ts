import { describe, expect, it } from 'vitest';
import { binarizeAlpha, outlineFromAlpha, resampleOutline, traceLongestOutline } from '../src/core/meshOutline';

/** 在 w×h 里画一个实心矩形，返回 alpha 通道。 */
function rectAlpha(w: number, h: number, rx: number, ry: number, rw: number, rh: number): Uint8Array {
  const alpha = new Uint8Array(w * h);
  for (let y = ry; y < ry + rh; y++) {
    for (let x = rx; x < rx + rw; x++) alpha[y * w + x] = 255;
  }
  return alpha;
}

describe('二值化（官方 _13917）', () => {
  it('treats anything above the tolerance as solid', () => {
    const alpha = new Uint8Array([0, 1, 2, 255]);
    expect([...binarizeAlpha(alpha, 2, 2, 1)]).toEqual([0, 0, 1, 1]);
    expect([...binarizeAlpha(alpha, 2, 2, 0)]).toEqual([0, 1, 1, 1]);
  });
});

describe('轮廓追踪与重采样（官方 _654.outline）', () => {
  it('walks the whole border of a solid rectangle', () => {
    const w = 8;
    const h = 8;
    const binary = binarizeAlpha(rectAlpha(w, h, 2, 2, 5, 5), w, h);
    const contour = traceLongestOutline(binary, w, h);
    // 5×5 实心块的边界像素（周长）正好 16 个
    expect(contour.length).toBe(16);
    // 每个点都必须落在矩形的边上
    for (const [x, y] of contour) {
      const onBorder = (x === 2 || x === 6 || y === 2 || y === 6) && x >= 2 && x <= 6 && y >= 2 && y <= 6;
      expect(onBorder, `轮廓点 (${x},${y}) 不在矩形边界上`).toBe(true);
    }
    // 不重复回到起点（闭环由调用方补）
    expect(contour[0]).not.toEqual(contour[contour.length - 1]);
  });

  it('returns nothing for an empty bitmap and for a single solid pixel', () => {
    expect(traceLongestOutline(new Uint8Array(64), 8, 8)).toEqual([]);
    const one = new Uint8Array(64);
    one[3 * 8 + 3] = 1;
    expect(traceLongestOutline(one, 8, 8).length).toBe(1);
  });

  it('samples more points as the density threshold grows', () => {
    const points = traceLongestOutline(binarizeAlpha(rectAlpha(32, 32, 4, 4, 24, 24), 32, 32), 32, 32);
    const sparse = resampleOutline(points, 0.3);   // 密度 1
    const dense = resampleOutline(points, 0.7);    // 密度 5
    expect(dense.length).toBeGreaterThan(sparse.length);
    expect(sparse.length).toBeGreaterThanOrEqual(6);
    // 重采样后的点仍然贴在矩形边界上
    for (const [x, y] of [...sparse, ...dense]) {
      expect(Math.abs(x - 4) < 0.001 || Math.abs(x - 27) < 0.001 || Math.abs(y - 4) < 0.001 || Math.abs(y - 27) < 0.001).toBe(true);
    }
  });

  it('runs the whole chain from alpha to outline', () => {
    const outline = outlineFromAlpha(rectAlpha(16, 16, 3, 3, 10, 10), 16, 16, 0.5);
    expect(outline.length).toBeGreaterThanOrEqual(6);
    const xs = outline.map((p) => p[0]);
    const ys = outline.map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(3, 6);
    expect(Math.max(...xs)).toBeCloseTo(12, 6);
    expect(Math.min(...ys)).toBeCloseTo(3, 6);
    expect(Math.max(...ys)).toBeCloseTo(12, 6);
  });
});