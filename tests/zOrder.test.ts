/**
 * `ZOrder(1)` timeline regression.
 *
 * `in-zorder` is the Bicycle project plus one authored z-order timeline; the
 * oracle in `out-zorder-new-as-binary` was produced by the shipped tool chain
 * (`-t new` then `-t binary`).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { Player } from '../src/core/player';
import { encodeDbbin } from '../src/core/export/dbbin';
import { decodeDbbin } from '../src/core/parse/dbbinDecode';

const ORACLE = 'samples';
const INPUT = `${ORACLE}/out-zorder-new/Bicycle_ske.json`;
const BINARY = `${ORACLE}/out-zorder-new-as-binary/Bicycle_ske.dbbin`;
const TEXTURE = `${ORACLE}/out-zorder-new/Bicycle_tex.json`;
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const hasFixture = existsSync(INPUT) && existsSync(BINARY) && existsSync(TEXTURE);

describe.skipIf(!hasFixture)('z-order timelines (TimelineType 1)', () => {
  it('reproduces the shipped tool byte for byte', () => {
    const oracle = readFileSync(BINARY);
    const mine = Buffer.from(encodeDbbin(readJson(INPUT)));
    expect(mine.length).toBe(oracle.length);
    expect(mine.equals(oracle)).toBe(true);
  });

  it('decodes the slot permutation', () => {
    const decoded = decodeDbbin(readFileSync(BINARY));
    const doc = decoded.json as { armature: Array<{ animation: Array<{ zOrder?: { frame?: Array<{ duration: number; order?: number[] }> } }> }> };
    const frames = doc.armature[0].animation[0].zOrder?.frame ?? [];
    expect(frames.length).toBe(2);
    // slot 0 is pulled to the last draw position, every other slot shifts up
    expect(frames[0].order).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 0]);
    expect(frames[1].order).toEqual([]);
    expect(decoded.stats.pending).toEqual([]);
  });

  it('reorders the drawables while playing', () => {
    const decoded = decodeDbbin(readFileSync(BINARY));
    const player = new Player(decoded.json, readJson(TEXTURE) as never);
    player.setAnimation('bicycle');
    player.seek(36);
    const original = player.renderItems().map((item) => item.slot);
    player.seek(0);
    const reordered = player.renderItems().map((item) => item.slot);
    expect([...reordered].sort()).toEqual([...original].sort());
    expect(reordered).not.toEqual(original);
    // the first slot of the armature is drawn last while the timeline is active
    expect(reordered[reordered.length - 1]).toBe(original[0]);
    expect(reordered[0]).toBe(original[1]);
  });
});
