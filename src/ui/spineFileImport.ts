/**
 * 浏览器端 Spine 导入：同批选中的 Spine JSON + `.atlas` + png 图集页 → DB 骨架/图集。
 *
 * - atlas 只取「覆盖贴图路径最多」的一份（404 占位的 .atlas 解析出 0 个区域，自然淘汰）。
 * - 每个贴图按区域从图集页裁出来、转正、补透明边，再重打成一张 DB 图集。
 * - spine-core 动态 import，入口 chunk 不增长。
 */
import type { DbSkeletonData, DbTextureAtlasData } from '../core/types';
import type { RasterImage } from '../core/raster';
import { blitRaster } from '../core/raster';
import { packAtlas, serializeTextureAtlas } from '../core/export/atlas';
import { parseSpineAtlas, type SpineAtlasPage, type TextureRegion } from '../core/parse/texture';
import { collectTextureAttachments, synthAtlasText, type SpineJson } from '../core/import/spineCommon';
import { extractSpineRegion, regionMapFromPages } from '../core/import/spineAtlasImage';
import { convertSpineRuntime } from '../core/import/spineConvert';
import { decodePngInBrowser, encodePngInBrowser, isPngBytes } from './pngBrowser';

export interface SpineImportOptions {
  name?: string;
  fps?: number;
  onProgress?: (done: number, total: number) => void;
}

export interface SpineImportResult {
  name: string;
  skeleton: DbSkeletonData;
  texture: DbTextureAtlasData;
  /** 重打包后的图集页（blob URL，调用方负责 revoke） */
  imageUrl: string;
  regions: number;
  animations: number;
  frames: number;
  warnings: string[];
}

const EMPTY: RasterImage = { width: 4, height: 4, rgba: new Uint8Array(64) };
const baseName = (p: string) => p.replace(/^.*[/\\]/, '').toLowerCase();

export async function importSpineFiles(
  jsonFile: File,
  extraFiles: File[],
  options: SpineImportOptions = {},
): Promise<SpineImportResult> {
  const sk = JSON.parse(await jsonFile.text()) as SpineJson;
  const name = options.name ?? jsonFile.name.replace(/\.json$/i, '');
  const warnings: string[] = [];
  const textures = collectTextureAttachments(sk).map((t) => t.path);
  if (!textures.length) warnings.push('骨架里没有可显示的贴图');

  // 1) 选覆盖最多的 .atlas
  let pages: SpineAtlasPage[] | null = null;
  let pageOf = new Map<string, { page: SpineAtlasPage; region: TextureRegion }>();
  let best = 0;
  for (const file of extraFiles.filter((f) => /\.atlas$/i.test(f.name))) {
    const parsed = parseSpineAtlas(await file.text());
    const names = new Set(parsed.flatMap((p) => p.regions.map((r) => r.name)));
    const score = textures.filter((t) => names.has(t)).length;
    if (score > best) {
      best = score;
      pages = parsed;
      pageOf = new Map();
      for (const pg of parsed) for (const r of pg.regions) if (!pageOf.has(r.name)) pageOf.set(r.name, { page: pg, region: r });
    }
  }
  const regions = pages ? regionMapFromPages(pages) : undefined;
  if (textures.length && !pages) warnings.push('没有可用的 .atlas，贴图按同名 png 放置');

  // 2) PNG 解码缓存（占位/损坏的 png 记为 null）
  const pngFiles = extraFiles.filter((f) => /\.(png|jpe?g|webp)$/i.test(f.name));
  const decoded = new Map<File, RasterImage | null>();
  const decode = async (file: File): Promise<RasterImage | null> => {
    if (!decoded.has(file)) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      decoded.set(file, isPngBytes(bytes) ? await decodePngInBrowser(bytes).catch(() => null) : null);
    }
    return decoded.get(file) ?? null;
  };
  const findPng = (wanted: string): File | undefined => {
    const b = baseName(wanted);
    return pngFiles.find((f) => baseName(f.name) === b) ?? pngFiles.find((f) => baseName(f.name) === `${b}.png`);
  };

  // 3) 逐张贴图还原
  const images: Array<{ name: string; img: RasterImage }> = [];
  const missing: string[] = [];
  for (const path of textures) {
    let img: RasterImage | null = null;
    const hit = pageOf.get(path);
    if (hit && pages) {
      const pagesWithFile = findPng(hit.page.imagePath) ?? (pages.length === 1 ? pngFiles[0] : undefined);
      const pageRaster = pagesWithFile ? await decode(pagesWithFile) : null;
      if (pageRaster) img = extractSpineRegion(pageRaster, hit.region);
    }
    if (!img) {
      const direct = findPng(path);
      const raster = direct ? await decode(direct) : null;
      if (raster) img = raster;
    }
    if (!img) {
      missing.push(path);
      img = EMPTY;
    }
    images.push({ name: path, img });
  }
  if (missing.length) {
    const head = missing.slice(0, 3).join('、');
    warnings.push(`缺少 ${missing.length} 张贴图（${head}${missing.length > 3 ? ' 等' : ''}）`);
  }

  // 4) 重打包成一张 DB 图集
  const packed = packAtlas(images.map((i) => ({ name: i.name, width: i.img.width, height: i.img.height })), { padding: 2, maxWidth: 2048 });
  const pageRaster: RasterImage = { width: packed.width, height: packed.height, rgba: new Uint8Array(packed.width * packed.height * 4) };
  packed.placements.forEach((p, i) => { const src = images[i]?.img; if (src) blitRaster(pageRaster, src, p.x, p.y); });
  const texture = serializeTextureAtlas(packed, { imagePath: `${name}_tex.png`, name });
  const imageUrl = URL.createObjectURL(await encodePngInBrowser(pageRaster));

  try {
    // 5) 动态加载官方运行时并转换
    const spine = await import('@esotericsoftware/spine-core');
    const atlasText = synthAtlasText(images.map((i) => ({ path: i.name, width: i.img.width, height: i.img.height })));
    const result = convertSpineRuntime(spine, sk, atlasText, {
      name, fps: options.fps ?? 24, regions, onProgress: options.onProgress,
    });
    return {
      name, skeleton: result.ske, texture, imageUrl,
      regions: images.length, animations: result.animations, frames: result.frames,
      warnings: [...warnings, ...result.warnings],
    };
  } catch (error) {
    URL.revokeObjectURL(imageUrl);
    throw error;
  }
}
