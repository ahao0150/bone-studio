/**
 * 纯数据的 RGBA 光栅工具（**不依赖 Node**）。
 *
 * 从 `tools/png.ts` 抽出来：那个模块用了 `node:zlib`，一旦被 UI 代码（或经 core 间接）import，
 * 浏览器打包就会把 `node:zlib` 拖进来 —— 实测会让整个 App 起不来。
 * 需要 PNG 编解码的调用方自己去用平台实现（浏览器 canvas / CLI 的 `tools/png`）。
 */
export interface RasterImage {
  width: number;
  height: number;
  /** straight RGBA, row-major */
  rgba: Uint8Array;
}

/** Copy a rectangle out of a raster (clamped to its bounds). */
export function cropRaster(image: RasterImage, x: number, y: number, width: number, height: number): RasterImage {
  const out = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    const sy = y + row;
    if (sy < 0 || sy >= image.height) continue;
    for (let col = 0; col < width; col++) {
      const sx = x + col;
      if (sx < 0 || sx >= image.width) continue;
      const s = (sy * image.width + sx) * 4;
      const d = (row * width + col) * 4;
      out[d] = image.rgba[s];
      out[d + 1] = image.rgba[s + 1];
      out[d + 2] = image.rgba[s + 2];
      out[d + 3] = image.rgba[s + 3];
    }
  }
  return { width, height, rgba: out };
}

/** Blit a raster into a larger canvas at (x, y). */
export function blitRaster(target: RasterImage, source: RasterImage, x: number, y: number): void {
  for (let row = 0; row < source.height; row++) {
    const sy = y + row;
    if (sy < 0 || sy >= target.height) continue;
    for (let col = 0; col < source.width; col++) {
      const sx = x + col;
      if (sx < 0 || sx >= target.width) continue;
      const s = (row * source.width + col) * 4;
      const d = (sy * target.width + sx) * 4;
      target.rgba[d] = source.rgba[s];
      target.rgba[d + 1] = source.rgba[s + 1];
      target.rgba[d + 2] = source.rgba[s + 2];
      target.rgba[d + 3] = source.rgba[s + 3];
    }
  }
}