/**
 * 导入资源到图集（P1 P-18）— 重打包后：新切片在、旧切片像素没丢、重名自动加后缀。
 */
import { describe, expect, it } from 'vitest';
import { importImageIntoAtlas, uniqueRegionName } from '../src/core/assetImport';
import { parseTextureAtlas } from '../src/core/parse/texture';
import type { RasterImage } from '../src/core/raster';

const put = (img: RasterImage, x: number, y: number, rgba: [number, number, number, number]) => {
  const i = (y * img.width + x) * 4;
  img.rgba[i] = rgba[0];
  img.rgba[i + 1] = rgba[1];
  img.rgba[i + 2] = rgba[2];
  img.rgba[i + 3] = rgba[3];
};
const get = (img: RasterImage, x: number, y: number) => {
  const i = (y * img.width + x) * 4;
  return [img.rgba[i], img.rgba[i + 1], img.rgba[i + 2], img.rgba[i + 3]];
};
const fill = (img: RasterImage, x0: number, y0: number, w: number, h: number, rgba: [number, number, number, number]) => {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(img, x, y, rgba);
};

/** 一张 8×8 的旧图集底图：左上 2×2 红、右边 2×2 蓝。 */
function baseAtlasFixture() {
  const json = {
    name: 'atlas',
    imagePath: 'atlas_tex.png',
    width: 8,
    height: 8,
    SubTexture: [
      { name: 'red', x: 0, y: 0, width: 2, height: 2 },
      { name: 'blue', x: 2, y: 0, width: 2, height: 2 },
    ],
  };
  const atlas = parseTextureAtlas(json as never);
  const raster: RasterImage = { width: 8, height: 8, rgba: new Uint8Array(8 * 8 * 4) };
  fill(raster, 0, 0, 2, 2, [255, 0, 0, 255]);
  fill(raster, 2, 0, 2, 2, [0, 0, 255, 255]);
  return { atlas, raster };
}

const green = (): RasterImage => {
  const raster: RasterImage = { width: 2, height: 2, rgba: new Uint8Array(2 * 2 * 4) };
  fill(raster, 0, 0, 2, 2, [0, 255, 0, 255]);
  return raster;
};

describe('导入资源到图集（官方「导入资源到资源库 / 舞台」）', () => {
  it('重打包后新切片存在，旧切片像素原样保留', () => {
    const { atlas, raster } = baseAtlasFixture();
    const result = importImageIntoAtlas({ atlas, baseRaster: raster, raster: green(), name: 'green' });
    expect(result.name).toBe('green');
    expect(result.atlas.regions.map((r) => r.name).sort()).toEqual(['blue', 'green', 'red']);

    const page = result.page;
    for (const name of ['red', 'blue', 'green']) {
      const region = result.atlas.byName.get(name)!;
      const expected = name === 'red' ? [255, 0, 0, 255] : name === 'blue' ? [0, 0, 255, 255] : [0, 255, 0, 255];
      for (let y = 0; y < region.height; y++) {
        for (let x = 0; x < region.width; x++) {
          expect(get(page, region.x + x, region.y + y), `${name} @${x},${y}`).toEqual(expected);
        }
      }
    }
  });

  it('没有旧图集时就是一张只有新切片的图集', () => {
    const result = importImageIntoAtlas({ atlas: null, raster: green(), name: 'shot.png' });
    expect(result.name).toBe('shot');                        // 去掉扩展名
    expect(result.atlas.regions.map((r) => r.name)).toEqual(['shot']);
    expect(result.page.width * result.page.height).toBeGreaterThanOrEqual(4);   // packer 会对齐页面尺寸
  });

  it('重名自动加后缀，不会覆盖已有切片', () => {
    const { atlas, raster } = baseAtlasFixture();
    expect(uniqueRegionName(atlas, 'red')).toBe('red_1');
    expect(uniqueRegionName(atlas, 'red.png')).toBe('red_1');
    expect(uniqueRegionName(atlas, 'green')).toBe('green');
    const result = importImageIntoAtlas({ atlas, baseRaster: raster, raster: green(), name: 'red' });
    expect(result.name).toBe('red_1');
    expect(result.atlas.regions.length).toBe(3);
  });
});