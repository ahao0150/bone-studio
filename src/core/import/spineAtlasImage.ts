/**
 * Spine `.atlas` 区域的像素还原（纯光栅，无 DOM/fs）。
 * 把页面里存的一块区域还原成「未裁剪、正向」的完整图：先按 rotate 裁存储矩形并转回来，
 * 再按 offsets 把它贴回 `orig` 尺寸（透明边补齐）。这样打进 DB 图集时
 * width/height = orig、frameX/frameY = 0，不需要再翻译 Sp​ine 的偏移语义。
 */
import { blitRaster, cropRaster, type RasterImage } from '../raster';
import type { SpineAtlasPage, TextureRegion } from '../parse/texture';
import type { RegionInfo, RegionMap } from './spineBind';

function blank(width: number, height: number): RasterImage {
  return { width, height, rgba: new Uint8Array(width * height * 4) };
}

function copyPixel(src: RasterImage, sx: number, sy: number, out: RasterImage, dx: number, dy: number): void {
  const s = (sy * src.width + sx) * 4;
  const d = (dy * out.width + dx) * 4;
  out.rgba[d] = src.rgba[s];
  out.rgba[d + 1] = src.rgba[s + 1];
  out.rgba[d + 2] = src.rgba[s + 2];
  out.rgba[d + 3] = src.rgba[s + 3];
}

/** 顺时针 90°（y 向下坐标）：s(x,y) → d(h-1-y, x)。 */
export function rotate90CW(src: RasterImage): RasterImage {
  const out = blank(src.height, src.width);
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) copyPixel(src, x, y, out, src.height - 1 - y, x);
  }
  return out;
}

/** 逆时针 90°：s(x,y) → d(y, w-1-x)。 */
export function rotate90CCW(src: RasterImage): RasterImage {
  const out = blank(src.height, src.width);
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) copyPixel(src, x, y, out, y, src.width - 1 - x);
  }
  return out;
}

export function rotate180(src: RasterImage): RasterImage {
  const out = blank(src.width, src.height);
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) copyPixel(src, x, y, out, src.width - 1 - x, src.height - 1 - y);
  }
  return out;
}

/**
 * 从解析出的 atlas 页面构造转换器需要的区域表（同名区域取第一个）。
 * `scale` 缺省为 1；页面尺寸用于把归一化 UV 换算回像素。
 */
export function regionMapFromPages(pages: SpineAtlasPage[]): RegionMap {
  const map: RegionMap = new Map();
  for (const page of pages) {
    for (const r of page.regions) {
      if (map.has(r.name)) continue;
      map.set(r.name, {
        x: r.x, y: r.y, width: r.width, height: r.height,
        frameX: r.frameX, frameY: r.frameY, frameWidth: r.frameWidth, frameHeight: r.frameHeight,
        ...(r.rotate ? { rotate: r.rotate } : {}),
        pageWidth: page.width, pageHeight: page.height,
        scale: page.scale ?? 1,
      });
    }
  }
  return map;
}

export type { RegionInfo, RegionMap };

/**
 * 从图集页面里还原一个区域。
 * - `rotate: 90/270`：页面上占的是转置后的矩形，裁剪后转回正向（样本实证为 90 时顺时针还原）。
 * - `frameWidth/Height` 大于裁剪结果：按 Spine 的 `offset`（x 从左、y 从下）贴回透明整图。
 */
export function extractSpineRegion(page: RasterImage, region: TextureRegion): RasterImage {
  const rot = (((region.rotate ?? 0) % 360) + 360) % 360;
  const transposed = rot === 90 || rot === 270;
  const storedW = transposed ? region.height : region.width;
  const storedH = transposed ? region.width : region.height;
  let crop = cropRaster(page, region.x, region.y, Math.max(1, storedW), Math.max(1, storedH));
  if (rot === 90) crop = rotate90CW(crop);
  else if (rot === 270) crop = rotate90CCW(crop);
  else if (rot === 180) crop = rotate180(crop);

  const frameW = region.frameWidth || region.width;
  const frameH = region.frameHeight || region.height;
  if (crop.width === frameW && crop.height === frameH) return crop;

  const out = blank(Math.max(1, frameW), Math.max(1, frameH));
  // Spine 的 offsetY 从原图底边向上量；y 向下时贴回位置是 frameHeight - offsetY - crop.height
  blitRaster(out, crop, region.frameX, frameH - region.frameY - crop.height);
  return out;
}
