/**
 * Surface 骨自身的拟合矩阵（官方 `Surface._updateGlobalTransformMatrix`）。
 *
 * 该矩阵是把 [-200,200]² 的网格空间拟合到三个中点：a = 四角中心、b = (右上,右下) 中点、
 * c = (左下,右下) 中点。公式本身已验证与官方一致；第 30 轮的闭环缺口不在拟合，
 * 而在**喂进去的顶点值**（形变时间轴在 t=0 的取值），证据见 `docs/evidence/closure-oracle.json`
 * 的 `surface` 样本。
 */
import { describe, expect, it } from 'vitest';
import { SurfaceRuntime } from '../src/core/runtime/surface';

/** `surface(2x2)` from `samples/in-surface/Bicycle_ske.json` */
const BASE = [0, 0, 40, 0, 80, 0, 0, 30, 40, 30, 80, 30, 0, 60, 40, 60, 80, 60];

describe('surface global transform', () => {
  it('fits the undeformed 2x2 grid to a=(40,30) b=(80,30) c=(40,60)', () => {
    const surface = new SurfaceRuntime(2, 2, BASE.slice());
    surface.updateVertices(null, null);
    surface.updateMatrix();
    // a is the grid centre: the official runtime reports tx = 40 for this fixture
    expect(surface.matrix[4]).toBeCloseTo(40, 9);
    expect(surface.matrix[5]).toBeCloseTo(30, 9);
  });

  it('moves with the deform the caller feeds in (frame 0 of the shipped timeline)', () => {
    const surface = new SurfaceRuntime(2, 2, BASE.slice());
    // the shipped `bicycle` surface timeline starts with (25,15) on vertex #2
    for (let i = 0; i < surface.deform.length; i++) surface.deform[i] = 0;
    surface.deform[4] = 25;
    surface.deform[5] = 15;
    surface.updateVertices(null, null);
    surface.updateMatrix();
    expect(surface.matrix[4]).toBeCloseTo(46.25, 6);
    expect(surface.matrix[5]).toBeCloseTo(33.75, 6);
  });
});
