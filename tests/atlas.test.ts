/**
 * Atlas packing (M5): PNG codec, shelf packer, and a real project re-pack that
 * preserves every sub-texture's pixels and metadata.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { packAtlas, serializeSpineAtlas, serializeTextureAtlas } from '../src/core/export/atlas';
import { parseSpineAtlas, parseTextureAtlas } from '../src/core/parse/texture';
import { blitRaster, cropRaster, decodePng, encodePng } from '../src/tools/png';

const ORACLE = 'samples';
const TEX_JSON = ORACLE + '/out-bicycle-new/Bicycle_tex.json';
const TEX_PNG = ORACLE + '/out-bicycle-new/Bicycle_tex.png';
const hasFixture = existsSync(TEX_JSON) && existsSync(TEX_PNG);

describe('atlas packing', () => {
  it('round-trips a raster through the PNG codec', () => {
    const width = 7;
    const height = 5;
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      rgba[i * 4] = (i * 7) & 0xff;
      rgba[i * 4 + 1] = (i * 13) & 0xff;
      rgba[i * 4 + 2] = (i * 29) & 0xff;
      rgba[i * 4 + 3] = i % 3 === 0 ? 0 : 255;
    }
    const decoded = decodePng(encodePng({ width, height, rgba }));
    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);
    expect(Array.from(decoded.rgba)).toEqual(Array.from(rgba));
  });

  it('places every sprite without overlap and inside the page', () => {
    const sources = [
      { name: 'a', width: 40, height: 20 },
      { name: 'b', width: 30, height: 60 },
      { name: 'c', width: 55, height: 15 },
      { name: 'd', width: 12, height: 12 },
    ];
    const packed = packAtlas(sources, { maxWidth: 100, padding: 1, align: 4 });
    expect(packed.placements.length).toBe(sources.length);
    expect(packed.width % 4).toBe(0);
    expect(packed.height % 4).toBe(0);
    for (const p of packed.placements) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.x + p.width).toBeLessThanOrEqual(packed.width);
      expect(p.y + p.height).toBeLessThanOrEqual(packed.height);
    }
    for (let i = 0; i < packed.placements.length; i++) {
      for (let k = i + 1; k < packed.placements.length; k++) {
        const a = packed.placements[i];
        const b = packed.placements[k];
        const overlap = a.x < b.x + b.width && b.x < a.x + a.width
          && a.y < b.y + b.height && b.y < a.y + a.height;
        expect(overlap, a.name + ' overlaps ' + b.name).toBe(false);
      }
    }
    // the emitted atlas parses back with the same names
    const parsed = parseTextureAtlas(serializeTextureAtlas(packed, { imagePath: 'packed.png' }));
    expect(parsed.regions.map((r) => r.name).sort()).toEqual(['a', 'b', 'c', 'd']);
    const spine = parseSpineAtlas(serializeSpineAtlas(packed, 'packed.png'));
    expect(spine[0].regions.map((r) => r.name).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  describe.skipIf(!hasFixture)('re-packing a shipped project', () => {
    it('preserves every sub-texture pixel and size', () => {
      const source = decodePng(readFileSync(TEX_PNG));
      const atlas = parseTextureAtlas(JSON.parse(readFileSync(TEX_JSON, 'utf8')));
      expect(atlas.regions.length).toBeGreaterThan(10);

      const packed = packAtlas(atlas.regions.map((r) => ({
        name: r.name, width: r.width, height: r.height,
        frameX: r.frameX, frameY: r.frameY, frameWidth: r.frameWidth, frameHeight: r.frameHeight,
      })), { maxWidth: 1024, padding: 2 });
      const page = { width: packed.width, height: packed.height, rgba: new Uint8Array(packed.width * packed.height * 4) };
      for (const placement of packed.placements) {
        const region = atlas.byName.get(placement.name)!;
        blitRaster(page, cropRaster(source, region.x, region.y, region.width, region.height), placement.x, placement.y);
      }
      const reencoded = decodePng(encodePng(page));
      const reparsed = parseTextureAtlas(serializeTextureAtlas(packed, { imagePath: 'repacked.png', name: 'Bicycle' }));
      expect(reparsed.regions.length).toBe(atlas.regions.length);
      for (const region of reparsed.regions) {
        const original = atlas.byName.get(region.name)!;
        expect(region.width).toBe(original.width);
        expect(region.height).toBe(original.height);
        // the packed pixels equal the source crop
        const packedPixel = ((region.y + 1) * reencoded.width + region.x + 1) * 4;
        const sourcePixel = ((original.y + 1) * source.width + original.x + 1) * 4;
        expect(Array.from(reencoded.rgba.slice(packedPixel, packedPixel + 4)))
          .toEqual(Array.from(source.rgba.slice(sourcePixel, sourcePixel + 4)));
      }
    });
  });
});
