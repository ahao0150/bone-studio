/** CLI `repack` writes a packed page plus `*_tex.json` / `.atlas` companions. */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { main } from '../src/cli';
import { parseSpineAtlas, parseTextureAtlas } from '../src/core/parse/texture';
import { decodePng } from '../src/tools/png';

const ORACLE = 'samples';
const TEX_JSON = ORACLE + '/out-bicycle-new/Bicycle_tex.json';
const OUT = 'work/cli-repack-test';
const hasFixture = existsSync(TEX_JSON);

describe.skipIf(!hasFixture)('CLI repack', () => {
  it('packs the atlas and writes both companion formats', () => {
    expect(main(['repack', '-i', TEX_JSON, '-o', OUT, '--max-width', '1024', '--padding', '2', '--spine'])).toBe(0);
    const json = JSON.parse(readFileSync(OUT + '/Bicycle_tex.json', 'utf8'));
    const atlas = parseTextureAtlas(json);
    expect(atlas.regions.length).toBe(15);
    const page = decodePng(readFileSync(OUT + '/Bicycle_tex.png'));
    expect(page.width).toBe(json.width);
    expect(page.height).toBe(json.height);
    for (const region of atlas.regions) {
      expect(region.x + region.width).toBeLessThanOrEqual(page.width);
      expect(region.y + region.height).toBeLessThanOrEqual(page.height);
    }
    const spine = parseSpineAtlas(readFileSync(OUT + '/Bicycle.atlas', 'utf8'));
    expect(spine[0].regions.length).toBe(15);
    expect(spine[0].width).toBe(json.width);
  });
});
