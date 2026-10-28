/**
 * Spine `.atlas` 解析扩展 + 区域像素还原：
 * - 旧版 `bounds:` / 页级 `scale:` / `rotate: 90` 必须解析正确（spineboy 样本即此格式）
 * - 旋转存放的区域还原方向用合成像素锁死（s(0,0) 顺时针后落在右上角）
 * - trim offsets 贴回 orig 尺寸透明整图
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseSpineAtlas } from '../src/core/parse/texture';
import { extractSpineRegion, rotate90CCW, rotate90CW } from '../src/core/import/spineAtlasImage';
import type { RasterImage } from '../src/core/raster';

const SAMPLE = 'D:/前端测试/spine-samples/spineboy.atlas';
const hasSample = existsSync(SAMPLE);

/** 每个像素的红色通道编码 `y * 16 + x`，绿色通道固定 7，便于断言搬运方向。 */
function encoded(width: number, height: number): RasterImage {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      rgba[i] = y * 16 + x;
      rgba[i + 1] = 7;
      rgba[i + 2] = 0;
      rgba[i + 3] = 255;
    }
  }
  return { width, height, rgba };
}

const red = (img: RasterImage, x: number, y: number) => img.rgba[(y * img.width + x) * 4];

describe('Spine atlas parsing (legacy bounds format)', () => {
  it('parses bounds / scale / rotate from a spineboy-style page', () => {
    const text = [
      'spineboy.png',
      '\tsize: 1024, 256',
      '\tfilter: Linear, Linear',
      '\tscale: 0.5',
      'crosshair',
      '\tbounds: 352, 7, 45, 45',
      'front-fist-open',
      '\tbounds: 710, 51, 43, 44',
      '\trotate: 90',
    ].join('\n');
    const pages = parseSpineAtlas(text);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ imagePath: 'spineboy.png', width: 1024, height: 256, scale: 0.5 });
    // `scale: 0.5` must not become a bogus region name
    expect(pages[0].regions.map((r) => r.name)).toEqual(['crosshair', 'front-fist-open']);
    const region = pages[0].regions[1];
    // width/height stay the logical (unrotated) size; the stored rectangle is transposed
    expect(region).toMatchObject({ x: 710, y: 51, width: 43, height: 44, rotate: 90 });
    expect(region.frameWidth).toBe(43);
    expect(region.frameHeight).toBe(44);
  });

  it('keeps the classic xy/size/orig/offset path intact', () => {
    const pages = parseSpineAtlas([
      'sheet.png', 'size: 1024,1024', 'head',
      '  rotate: false', '  xy: 10, 20', '  size: 30, 40', '  orig: 32, 42', '  offset: 1, 2',
    ].join('\n'));
    expect(pages[0].regions[0]).toMatchObject({ name: 'head', x: 10, y: 20, width: 30, height: 40, frameX: 1, frameY: 2, frameWidth: 32, frameHeight: 42 });
    expect(pages[0].regions[0].rotate).toBeUndefined();
  });

  it('parses legacy offsets:', () => {
    const pages = parseSpineAtlas([
      'sheet.png', 'size: 512,512',
      'torso', '  bounds: 2, 3, 20, 30', '  offsets: 1, 4, 22, 38',
    ].join('\n'));
    expect(pages[0].regions[0]).toMatchObject({ x: 2, y: 3, width: 20, height: 30, frameX: 1, frameY: 4, frameWidth: 22, frameHeight: 38 });
  });
});

describe('spine region extraction', () => {
  it('rotates a stored 90° region clockwise back to upright', () => {
    const src = encoded(4, 3); // w=4 h=3
    const cw = rotate90CW(src);
    expect([cw.width, cw.height]).toEqual([3, 4]);
    // s(0,0) moves to the top-right corner of the output
    expect(red(cw, cw.width - 1, 0)).toBe(red(src, 0, 0));
    // s(w-1,0) moves to the bottom-right corner
    expect(red(cw, cw.width - 1, cw.height - 1)).toBe(red(src, 3, 0));
    // round trip
    const back = rotate90CCW(cw);
    expect([back.width, back.height]).toEqual([4, 3]);
    expect(red(back, 0, 0)).toBe(red(src, 0, 0));
  });

  it('crops a transposed stored rect, rotates it and pads back to orig size', () => {
    // page 8x8; region logically 3x2, stored rotated => occupies 2 wide x 3 tall at (1,0)
    const page = encoded(8, 8);
    const out = extractSpineRegion(page, {
      name: 'arm', x: 1, y: 0, width: 3, height: 2,
      frameX: 0, frameY: 0, frameWidth: 3, frameHeight: 2, rotate: 90,
    });
    expect([out.width, out.height]).toEqual([3, 2]);
    // stored pixel (1,0) is the logical top-right after clockwise restoration
    expect(red(out, 2, 0)).toBe(red(page, 1, 0));
    expect(red(out, 0, 0)).toBe(red(page, 1, 2));
  });

  it('re-inserts a trimmed region into a transparent orig-sized image', () => {
    const page = encoded(8, 8);
    const out = extractSpineRegion(page, {
      name: 'head', x: 2, y: 1, width: 4, height: 2,
      frameX: 3, frameY: 5, frameWidth: 10, frameHeight: 9,
    });
    expect([out.width, out.height]).toEqual([10, 9]);
    // top = frameHeight - offsetY - height = 9 - 5 - 2 = 2
    expect(red(out, 3, 2)).toBe(red(page, 2, 1));
    expect(red(out, 6, 3)).toBe(red(page, 5, 2));
    // padding stays transparent
    expect(out.rgba[(0 * 10 + 0) * 4 + 3]).toBe(0);
  });

  it.skipIf(!hasSample)('restores every region of the real spineboy atlas to its orig size', () => {
    const pages = parseSpineAtlas(readFileSync(SAMPLE, 'utf8'));
    expect(pages[0].scale).toBe(0.5);
    const rotated = pages[0].regions.filter((r) => r.rotate === 90);
    expect(rotated.length).toBeGreaterThan(0);
    for (const region of pages[0].regions) {
      const img = extractSpineRegion({ width: pages[0].width, height: pages[0].height, rgba: new Uint8Array(pages[0].width * pages[0].height * 4) }, region);
      expect([img.width, img.height]).toEqual([region.frameWidth, region.frameHeight]);
    }
  });
});
