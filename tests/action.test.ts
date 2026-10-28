/**
 * `Action(0)` timeline regression.
 *
 * `in-action` is the Bicycle project plus an armature-level action timeline;
 * the oracle in `out-action-new-as-binary` came from the shipped tool chain
 * (`-t new` then `-t binary`).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { Player } from '../src/core/player';
import { encodeDbbin } from '../src/core/export/dbbin';
import { decodeDbbin } from '../src/core/parse/dbbinDecode';

const ORACLE = 'samples';
const INPUT = `${ORACLE}/out-action-new/Bicycle_ske.json`;
const BINARY = `${ORACLE}/out-action-new-as-binary/Bicycle_ske.dbbin`;
const TEXTURE = `${ORACLE}/out-action-new/Bicycle_tex.json`;
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const hasFixture = existsSync(INPUT) && existsSync(BINARY) && existsSync(TEXTURE);

describe.skipIf(!hasFixture)('action timelines (TimelineType 0)', () => {
  it('reproduces the shipped tool byte for byte', () => {
    const oracle = readFileSync(BINARY);
    const mine = Buffer.from(encodeDbbin(readJson(INPUT)));
    expect(mine.length).toBe(oracle.length);
    expect(mine.equals(oracle)).toBe(true);
  });

  it('collects the action table and rebuilds the frames', () => {
    const decoded = decodeDbbin(readFileSync(BINARY));
    type Doc = {
      armature: Array<{
        actions?: unknown[];
        animation: Array<{ frame?: Array<{ duration: number; actions?: unknown[] }> }>;
      }>;
    };
    const doc = decoded.json as Doc;
    expect(doc.armature[0].actions?.length).toBe(3);
    const frames = doc.armature[0].animation[0].frame ?? [];
    expect(frames.map((frame) => frame.duration)).toEqual([20, 20, 14]);
    expect(frames.map((frame) => frame.actions?.length)).toEqual([1, 2, 0]);
    expect(decoded.stats.pending).toEqual([]);
  });

  it('still plays the animation with action frames present', () => {
    const decoded = decodeDbbin(readFileSync(BINARY));
    const player = new Player(decoded.json, readJson(TEXTURE) as never);
    player.setAnimation('bicycle');
    player.seek(20);
    expect(player.renderItems().length).toBeGreaterThan(10);
  });
});
