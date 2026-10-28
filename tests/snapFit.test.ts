import { describe, expect, it } from 'vitest';
import { prepareReference, snapSearch, spriteFromRaster } from '../src/core/snapFit';
import { extendRegion } from '../src/core/jointWeld';
import type { RasterImage } from '../src/core/raster';

/** 白底上画一个带内部横线的深色 L 形 */
function shape(w: number, h: number, ox: number, oy: number, white: boolean): RasterImage {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const lx = x - ox, ly = y - oy;
    const inside = (lx >= 0 && lx < 20 && ly >= 0 && ly < 60) || (lx >= 0 && lx < 50 && ly >= 40 && ly < 60);
    if (inside) { const v = ly === 20 ? 200 : 40; rgba.set([v, v, v, 255], i); } else if (white) rgba.set([255, 255, 255, 255], i);
  }
  return { width: w, height: h, rgba };
}

describe('snapFit', () => {
  it('把偏移的部件按轮廓吸回参考位置', () => {
    const ref = prepareReference(shape(160, 160, 50, 50, true));
    const sp = spriteFromRaster(shape(160, 160, 59, 44, false))!;
    const r = snapSearch(ref, sp, { radius: 16, priorWeight: 0 });
    expect(r.improved).toBe(true);
    expect(Math.abs(r.pose.dx + 9)).toBeLessThan(1.5);
    expect(Math.abs(r.pose.dy - 6)).toBeLessThan(1.5);
  });
  it('strength=0.5 只走一半；超出半径不会跳过去', () => {
    const ref = prepareReference(shape(160, 160, 50, 50, true));
    const sp = spriteFromRaster(shape(160, 160, 58, 50, false))!;
    expect(Math.abs(snapSearch(ref, sp, { radius: 16, strength: 0.5, priorWeight: 0 }).pose.dx + 4)).toBeLessThan(1);
    const far = snapSearch(ref, sp, { radius: 3, priorWeight: 0 });
    expect(Math.hypot(far.pose.dx, far.pose.dy)).toBeLessThanOrEqual(3.01);
  });
});

describe('extendRegion', () => {
  it('只在关节附近把切口向外延伸', () => {
    const img = shape(60, 70, 5, 5, false);
    const { image, filled } = extendRegion(img, [{ x: 15, y: 65 }], 4, 10);
    expect(filled).toBeGreaterThan(0);
    expect(image.width).toBe(68);
    // 关节下方（原来透明）现在不透明；远处（左上角外侧）保持透明
    expect(image.rgba[((65 + 4 + 2) * 68 + 15 + 4) * 4 + 3]).toBe(255);
    expect(image.rgba[((4 + 2) * 68 + 4 + 2) * 4 + 3]).toBe(0);
  });
});
