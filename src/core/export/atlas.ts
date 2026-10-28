/**
 * Texture atlas packing: a deterministic shelf packer plus the DragonBones
 * `*_tex.json` and Spine `.atlas` writers (shapes mirror the parsers in
 * `core/parse/texture.ts`).
 *
 * Pure module: no Node APIs, so the editor can use it too.
 */
import type { DbSubTexture, DbTextureAtlasData } from '../types';

export interface AtlasSource {
  name: string;
  width: number;
  height: number;
  /** optional trim metadata carried through from the source atlas */
  frameX?: number;
  frameY?: number;
  frameWidth?: number;
  frameHeight?: number;
}

export interface AtlasPlacement extends AtlasSource {
  x: number;
  y: number;
}

export interface PackedAtlas {
  width: number;
  height: number;
  placements: AtlasPlacement[];
}

export interface PackOptions {
  /** gap between sprites in pixels (default 1) */
  padding?: number;
  /** page width ceiling; the packer grows the page height instead (default 2048) */
  maxWidth?: number;
  /** round the page size up to this multiple (default 4, GPU friendly) */
  align?: number;
}

/**
 * Shelf packing: sort by height (descending, ties by name), fill a row until the
 * width ceiling is reached, then start a new row. Deterministic for a given
 * input, and never overlaps because every sprite owns its own cell.
 */
export function packAtlas(sources: AtlasSource[], options: PackOptions = {}): PackedAtlas {
  const padding = Math.max(0, options.padding ?? 1);
  const maxWidth = Math.max(1, options.maxWidth ?? 2048);
  const align = Math.max(1, options.align ?? 4);
  const order = [...sources].sort((a, b) => (b.height - a.height) || a.name.localeCompare(b.name));
  const placed = new Map<string, AtlasPlacement>();
  let shelfY = 0;
  let shelfHeight = 0;
  let x = 0;
  let usedWidth = 0;
  for (const source of order) {
    const width = Math.max(1, Math.round(source.width));
    const height = Math.max(1, Math.round(source.height));
    if (x > 0 && x + width + padding > maxWidth) {
      shelfY += shelfHeight + padding;
      shelfHeight = 0;
      x = 0;
    }
    placed.set(source.name, { ...source, width, height, x, y: shelfY });
    x += width + padding;
    usedWidth = Math.max(usedWidth, x - padding);
    shelfHeight = Math.max(shelfHeight, height);
  }
  const roundUp = (value: number) => Math.max(align, Math.ceil(value / align) * align);
  return {
    width: roundUp(usedWidth),
    height: roundUp(shelfY + shelfHeight),
    placements: sources.map((source) => placed.get(source.name)!),
  };
}

/** DragonBones `*_tex.json`, in the key order the shipped exporter writes. */
export function serializeTextureAtlas(
  packed: PackedAtlas,
  meta: { imagePath: string; name?: string },
): DbTextureAtlasData {
  const SubTexture = packed.placements.map((p) => ({
    frameWidth: p.frameWidth ?? p.width,
    y: p.y,
    frameHeight: p.frameHeight ?? p.height,
    frameX: p.frameX ?? 0,
    height: p.height,
    frameY: p.frameY ?? 0,
    width: p.width,
    name: p.name,
    x: p.x,
  })) as unknown as DbSubTexture[];
  return {
    imagePath: meta.imagePath,
    SubTexture,
    width: packed.width,
    name: meta.name ?? meta.imagePath.replace(/\.[^.]+$/, ''),
    height: packed.height,
  } as unknown as DbTextureAtlasData;
}

/** Spine `.atlas` text (the exact shape `parseSpineAtlas` consumes). */
export function serializeSpineAtlas(packed: PackedAtlas, imagePath: string): string {
  const lines: string[] = [
    imagePath,
    `size: ${packed.width},${packed.height}`,
    'format: RGBA8888',
    'filter: Linear,Linear',
    'repeat: none',
  ];
  for (const p of packed.placements) {
    lines.push(p.name);
    lines.push('  rotate: false');
    lines.push(`  xy: ${p.x}, ${p.y}`);
    lines.push(`  size: ${p.width}, ${p.height}`);
    lines.push(`  orig: ${p.frameWidth ?? p.width}, ${p.frameHeight ?? p.height}`);
    lines.push(`  offset: ${p.frameX ?? 0}, ${p.frameY ?? 0}`);
    lines.push('  index: -1');
  }
  return lines.join('\n') + '\n';
}
