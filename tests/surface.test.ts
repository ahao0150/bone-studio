/**
 * M4: `type: "surface"` bones and their `Surface(50)` deform timelines.
 *
 * The oracle is produced by the current upstream `DragonBones/Tools` build: the
 * converter shipped with DragonBones 5.6 (tools v50) silently drops surface
 * bones and their timelines (`createSurfaceTimeline` never matches
 * `surface.type !== BoneType.Surface`, and its bone loop has no surface branch), so
 * the only reference implementation of the family is the fixed upstream writer.
 * See 格式规范 and docs/OSS-REFERENCES.md.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { encodeDbbin } from '../src/core/export/dbbin';
import { decodeDbbin } from '../src/core/parse/dbbinDecode';

const ORACLE = 'samples';
const INPUT = `${ORACLE}/in-surface-min/SurfaceDemo_ske.json`;
const BINARY = `${ORACLE}/out-surface-min/SurfaceDemo_ske.dbbin`;
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const hasFixture = existsSync(INPUT) && existsSync(BINARY);

type Doc = {
  armature: Array<{
    bone: Array<{
      name: string; type?: unknown; parent?: string;
      segmentX?: number; segmentY?: number; vertices?: number[]; offset?: number;
    }>;
    animation: Array<{
      surface?: Array<{ name: string; offset?: number; frame?: Array<{ duration: number; offset?: number; vertices?: number[] }> }>;
      timeline?: Array<{ offset?: number; name?: string; type?: number }>;
    }>;
  }>;
};

describe.skipIf(!hasFixture)('surface bones + Surface(50) timelines', () => {
  it('decodes the official export into a vertex grid', () => {
    const decoded = decodeDbbin(readFileSync(BINARY));
    const doc = decoded.json as Doc;
    const bone = doc.armature[0].bone[1];
    expect(bone.name).toBe('surface');
    expect(bone.type).toBe('surface');
    expect(bone.parent).toBe('root');
    expect(bone.segmentX).toBe(2);
    expect(bone.segmentY).toBe(2);
    // (segmentX + 1) * (segmentY + 1) vertices, two floats each
    expect(bone.vertices?.length).toBe(18);
    expect(bone.vertices?.slice(0, 4)).toEqual([0, 0, 40, 0]);
    expect(bone.offset).toBeUndefined();
    expect(decoded.stats.surfaces).toBe(1);
    expect(decoded.stats.pending).toEqual([]);
  });

  it('rebuilds the deform windows and their tween spans', () => {
    const decoded = decodeDbbin(readFileSync(BINARY));
    const doc = decoded.json as Doc;
    const surface = doc.armature[0].animation[0].surface;
    expect(surface?.length).toBe(1);
    expect(surface?.[0].name).toBe('surface');
    expect(surface?.[0].offset).toBe(0);
    const frames = surface?.[0].frame ?? [];
    expect(frames.map((frame) => frame.duration)).toEqual([8, 12]);
    // both keys move different corners, so the whole 18-value axis stays animated
    expect(frames[0].offset).toBe(0);
    expect(frames[0].vertices?.slice(4, 6)).toEqual([12, -6]);
    expect(frames[0].vertices?.length).toBe(18);
    expect(frames[1].offset).toBe(0);
    expect(frames[1].vertices?.slice(0, 2)).toEqual([-5, 3]);
    expect(frames[1].vertices?.slice(16)).toEqual([7, -2]);
  });

  it('exports an authored surface timeline byte for byte', () => {
    const oracle = readFileSync(BINARY);
    const mine = Buffer.from(encodeDbbin(readJson(INPUT)));
    expect(mine.length).toBe(oracle.length);
    expect(mine.equals(oracle)).toBe(true);
  });

  it('re-encodes the official artifact byte for byte', () => {
    const oracle = readFileSync(BINARY);
    const mine = Buffer.from(encodeDbbin(decodeDbbin(oracle).json));
    expect(mine.length).toBe(oracle.length);
    expect(mine.equals(oracle)).toBe(true);
  });
});
