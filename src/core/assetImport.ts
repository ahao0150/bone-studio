/**
 * 导入外部图片到图集 —— 官方菜单「导入资源到舞台...」/「导入资源到资源库...」
 * （`Menu.File.ImportAssets` / `Menu.File.ImportAssetsToLib`，strings.xml 第 87-88 行）。
 *
 * **格式验证边界（如实记录）**：格式规范里**没有**这两个菜单的实现（只有文案），所以行为按菜单语义
 * ＋本仓库既有的图集 / 槽位模型设计：资源库 = 图集切片；导入到资源库 = 重打包图集并加入新切片；
 * 导入到舞台 = 在此之上再建一个槽位显示它。
 *
 * 重打包流程与 `cli.ts` 的 `repack` 完全一致（decodePng → packAtlas → blitRaster → encodePng → serializeTextureAtlas）。
 */
import type { DbTextureAtlasData } from './types';
import { packAtlas, serializeTextureAtlas, type AtlasSource, type PackedAtlas } from './export/atlas';
import { parseTextureAtlas, type TextureAtlas } from './parse/texture';
import { blitRaster, cropRaster, type RasterImage } from './raster';

export interface ImportImageOptions {
  /** 现有图集；为空 = 新建一张只含这张图的图集 */
  atlas?: TextureAtlas | null;
  /** 现有图集的像素（`atlas` 非空时必需，否则旧切片会被留空） */
  baseRaster?: RasterImage | null;
  /** 新图（已解码的像素） */
  raster: RasterImage;
  /** 期望的切片名（通常取文件名） */
  name: string;
  maxWidth?: number;
  padding?: number;
}

export interface ImportImageResult {
  atlas: TextureAtlas;
  packed: PackedAtlas;
  json: DbTextureAtlasData;
  /** 重打包后的整页像素（调用方决定怎么编码成 PNG） */
  page: RasterImage;
  /** 实际写进去的切片名（重名时会加后缀） */
  name: string;
}

/** 新切片名不能和已有 region 冲突。 */
export function uniqueRegionName(atlas: TextureAtlas | null | undefined, wanted: string): string {
  const base = (wanted || 'image').replace(/\.[^.]+$/, '') || 'image';
  const used = new Set((atlas?.regions ?? []).map((region) => region.name));
  if (!used.has(base)) return base;
  for (let i = 1; i < 1000; i++) {
    const candidate = `${base}_${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}_${Date.now()}`;
}

/** 把一张新图并进图集（重新打包整页），返回新图集 / 新 PNG / 新的 `*_tex.json`。 */
export function importImageIntoAtlas(options: ImportImageOptions): ImportImageResult {
  const { atlas, baseRaster, raster } = options;
  const name = uniqueRegionName(atlas, options.name);
  const sources: AtlasSource[] = (atlas?.regions ?? []).map((region) => ({
    name: region.name,
    width: region.width,
    height: region.height,
    frameX: region.frameX,
    frameY: region.frameY,
    frameWidth: region.frameWidth,
    frameHeight: region.frameHeight,
  }));
  sources.push({ name, width: raster.width, height: raster.height });
  const packed = packAtlas(sources, { maxWidth: options.maxWidth ?? 2048, padding: options.padding ?? 1 });
  const page: RasterImage = {
    width: packed.width,
    height: packed.height,
    rgba: new Uint8Array(packed.width * packed.height * 4),
  };
  for (const placement of packed.placements) {
    if (placement.name === name) {
      blitRaster(page, raster, placement.x, placement.y);
      continue;
    }
    const region = atlas?.byName.get(placement.name);
    if (!region || !baseRaster) continue;
    blitRaster(page, cropRaster(baseRaster, region.x, region.y, region.width, region.height), placement.x, placement.y);
  }
  const json = serializeTextureAtlas(packed, {
    imagePath: atlas?.imagePath ?? 'atlas_tex.png',
    name: atlas?.name || 'atlas',
  });
  return { atlas: parseTextureAtlas(json), packed, json, page, name };
}