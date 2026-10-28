import type { DbSubTexture, DbTextureAtlasData } from '../types';

export interface TextureRegion {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** trimmed-frame offsets (Sprite sheet trimming) */
  frameX: number;
  frameY: number;
  frameWidth: number;
  frameHeight: number;
  /** Spine `.atlas` only: the region is stored rotated by this many degrees (0/90/180/270). */
  rotate?: number;
}

export interface TextureAtlas {
  name: string;
  imagePath: string;
  width: number;
  height: number;
  regions: TextureRegion[];
  byName: Map<string, TextureRegion>;
}

export function parseTextureAtlas(raw: DbTextureAtlasData): TextureAtlas {
  const regions = (raw.SubTexture ?? []).map((s: DbSubTexture): TextureRegion => ({
    name: s.name,
    x: s.x,
    y: s.y,
    width: s.width,
    height: s.height,
    frameX: s.frameX ?? 0,
    frameY: s.frameY ?? 0,
    frameWidth: s.frameWidth ?? s.width,
    frameHeight: s.frameHeight ?? s.height,
  }));
  const byName = new Map<string, TextureRegion>();
  for (const r of regions) if (!byName.has(r.name)) byName.set(r.name, r);
  return {
    name: raw.name ?? '',
    imagePath: raw.imagePath,
    width: raw.width ?? 0,
    height: raw.height ?? 0,
    regions,
    byName,
  };
}

export interface SpineAtlasPage {
  imagePath: string;
  width: number;
  height: number;
  /** Page-level `scale:` — attachment sizes in the skeleton JSON are this many times the atlas pixels. */
  scale?: number;
  regions: TextureRegion[];
}

/**
 * Parse a Spine `.atlas` text file (used by DragonBones's Spine importer and
 * produced by its Spine export). Format:
 *   page.png
 *   size: 1024,1024
 *   format: RGBA8888
 *   filter: Linear,Linear
 *   repeat: none
 *   <regionName>
 *     rotate: false
 *     xy: 2, 2
 *     size: 301, 230
 *     orig: 301, 230
 *     offset: 0, 0
 *     index: -1
 */
export function parseSpineAtlas(text: string): SpineAtlasPage[] {
  const PAGE_KEYS = new Set(['size', 'format', 'filter', 'repeat', 'pma', 'scale']);
  const lines = text.split(/\r?\n/);
  const pages: SpineAtlasPage[] = [];
  let page: SpineAtlasPage | null = null;
  let region: TextureRegion | null = null;
  let rotate = 0;

  const commitRegion = () => {
    if (page && region) {
      region.frameWidth = region.frameWidth || region.width;
      region.frameHeight = region.frameHeight || region.height;
      // `width`/`height` stay the unrotated (logical) size, matching spine-core's
      // TextureRegion; the stored rectangle is swapped at crop time when rotate is set.
      if (rotate) region.rotate = rotate;
      page.regions.push(region);
    }
    region = null;
    rotate = 0;
  };

  const applyValue = (key: string, value: string) => {
    const nums = value.split(',').map((v) => Number(v.trim()));
    if (!region) {
      if (key === 'size' && page) { page.width = nums[0]; page.height = nums[1]; }
      else if (key === 'scale' && page) { page.scale = nums[0]; }
      return;
    }
    if (key === 'xy') { region.x = nums[0]; region.y = nums[1]; }
    else if (key === 'bounds') { region.x = nums[0]; region.y = nums[1]; region.width = nums[2]; region.height = nums[3]; }
    else if (key === 'size') { region.width = nums[0]; region.height = nums[1]; }
    else if (key === 'orig') { region.frameWidth = nums[0]; region.frameHeight = nums[1]; }
    else if (key === 'offsets') { region.frameX = nums[0]; region.frameY = nums[1]; region.frameWidth = nums[2]; region.frameHeight = nums[3]; }
    else if (key === 'offset') { region.frameX = nums[0]; region.frameY = nums[1]; }
    else if (key === 'rotate') { rotate = value === 'true' ? 90 : value === 'false' ? 0 : Number(value) || 0; }
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const indented = /^\s/.test(rawLine);
    const trimmed = line.trim();

    if (!indented) {
      // a new page image?
      if (/\.(png|jpg|jpeg|webp)$/i.test(trimmed)) {
        commitRegion();
        page = { imagePath: trimmed, width: 0, height: 0, regions: [] };
        pages.push(page);
        continue;
      }
      const colon = trimmed.indexOf(':');
      const key = colon > 0 ? trimmed.slice(0, colon).trim().toLowerCase() : '';
      // page-level attribute (size/format/filter/repeat) before any region
      if (page && !region && colon > 0 && PAGE_KEYS.has(key)) {
        applyValue(key, trimmed.slice(colon + 1).trim());
        continue;
      }
      // otherwise: a region name
      if (page) {
        commitRegion();
        region = {
          name: trimmed, x: 0, y: 0, width: 0, height: 0,
          frameX: 0, frameY: 0, frameWidth: 0, frameHeight: 0,
        };
      }
      continue;
    }

    const [key, value] = trimmed.split(':').map((p) => p.trim());
    if (!key || value === undefined) continue;
    applyValue(key.toLowerCase(), value);
  }
  commitRegion();
  return pages;
}
export function spineAtlasToDragonBones(pages: SpineAtlasPage[]): DbTextureAtlasData[] {
  return pages.map((p, i) => ({
    name: `atlas${i}`,
    imagePath: p.imagePath,
    width: p.width,
    height: p.height,
    SubTexture: p.regions.map((r) => ({
      name: r.name, x: r.x, y: r.y,
      // DB sub-textures cannot rotate; rotated regions are stored transposed.
      width: r.rotate === 90 || r.rotate === 270 ? r.height : r.width,
      height: r.rotate === 90 || r.rotate === 270 ? r.width : r.height,
      frameX: r.frameX, frameY: r.frameY, frameWidth: r.frameWidth, frameHeight: r.frameHeight,
    })),
  }));
}


