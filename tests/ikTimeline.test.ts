/**
 * `IKConstraint(30)` timeline regression.
 *
 * `in-ik` is the Bicycle project plus one authored IK timeline; the oracle in
 * `out-ik-binary` was produced by the tool shipped with DragonBones.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { Player } from '../src/core/player';
import { encodeDbbin } from '../src/core/export/dbbin';
import { decodeDbbin } from '../src/core/parse/dbbinDecode';
import { sampleIkFrames } from '../src/core/runtime/animation';

const ORACLE = 'samples';
const INPUT = `${ORACLE}/in-ik/Bicycle_ske.json`;
const BINARY = `${ORACLE}/out-ik-binary/Bicycle_ske.dbbin`;
const TEXTURE = `${ORACLE}/in-ik/Bicycle_tex.json`;
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const hasFixture = existsSync(INPUT) && existsSync(BINARY) && existsSync(TEXTURE);

describe.skipIf(!hasFixture)('IK constraint timelines (TimelineType 30)', () => {
  it('reproduces the shipped tool byte for byte', () => {
    const oracle = readFileSync(BINARY);
    const mine = Buffer.from(encodeDbbin(readJson(INPUT)));
    expect(mine.length).toBe(oracle.length);
    expect(mine.equals(oracle)).toBe(true);
  });

  it('decodes the authored keyframes', () => {
    const decoded = decodeDbbin(readFileSync(BINARY));
    const doc = decoded.json as { armature: Array<{ animation: Array<{ ik?: Array<{ name: string; frame: Array<{ bendPositive?: boolean; weight?: number }> }> }> }> };
    const timeline = doc.armature[0].animation[0].ik?.[0];
    expect(timeline?.name).toBe('bone_ik');
    expect(timeline?.frame.map((frame) => frame.bendPositive)).toEqual([true, false, false, false]);
    expect(timeline?.frame.map((frame) => frame.weight)).toEqual([1, 0.5, 1, 1]);
    expect(decoded.stats.pending).toEqual([]);
  });

  it('steps bendPositive and tweens weight', () => {
    const timeline = [{ duration: 18, bendPositive: true, weight: 1 }, { duration: 18, bendPositive: false, weight: 0.5 }];
    expect(sampleIkFrames(timeline, 0)).toEqual({ bendPositive: true, weight: 1 });
    expect(sampleIkFrames(timeline, 9)).toEqual({ bendPositive: true, weight: 0.75 });
    expect(sampleIkFrames(timeline, 27)).toEqual({ bendPositive: false, weight: 0.5 });
  });

  it('changes the solved pose while playing', () => {
    const decoded = decodeDbbin(readFileSync(BINARY));
    const texture = readJson(TEXTURE) as never;
    const withTimeline = new Player(decoded.json, texture);
    const without = JSON.parse(JSON.stringify(decoded.json)) as { armature: Array<{ animation: Array<{ ik?: unknown }> }> };
    delete without.armature[0].animation[0].ik;
    const withoutTimeline = new Player(without, texture);
    withTimeline.setAnimation('bicycle');
    withoutTimeline.setAnimation('bicycle');
    withTimeline.seek(9);
    withoutTimeline.seek(9);
    const a = withTimeline.renderItems();
    const b = withoutTimeline.renderItems();
    let moved = 0;
    for (let i = 0; i < a.length; i++) {
      for (let k = 0; k < a[i].positions.length; k++) moved = Math.max(moved, Math.abs(a[i].positions[k] - b[i].positions[k]));
    }
    expect(moved).toBeGreaterThan(20);
  });
});
