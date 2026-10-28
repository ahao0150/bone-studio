/**
 * Surface timeline export layout.
 *
 * The shipped runtime reads a `Surface(50)` timeline straight out of `*_ske.dbbin`
 * and ignores the JSON authoring key, so the binary header has to be written the way
 * the official writer does. Measured 2026-10-11: our reader stores the header slot
 * `TimelineOffset` back as `offset`, and forwarding the decoded object into the writer
 * re-emitted it as `Math.round(53 * 100) = 5300`. The runtime then read the wrong
 * header and silently dropped the whole deform (surface bone `tx` stayed 40 instead
 * of 46.25). This pins the field.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeDbbin } from '../src/core/parse/dbbinDecode';
import { encodeDbbin } from '../src/core/export/dbbin';

const HOME = '.';
const FIXTURE = process.env.BONESTUDIO_SURFACE_FIXTURE
  ?? join(process.env.BONESTUDIO_SAMPLES ?? HOME, 'Surface_Bin/Bicycle_ske.dbbin');

describe('surface timeline export', () => {
  it('keeps the header TimelineOffset at 0 (never the decoded header position)', () => {
    const source = decodeDbbin(readFileSync(FIXTURE));
    const exported = decodeDbbin(encodeDbbin(source.json as never));
    const armature = (exported.json as { armature: Array<{ name: string; animation: Array<{ name: string; surface?: Array<{ offset?: number; frame: unknown[] }> }> }> }).armature
      .find((a) => a.name === 'Bicycle')!;
    const surface = armature.animation.find((a) => a.name === 'bicycle')!.surface![0];
    // the decoded `offset` is the header's position inside `timelineArray`; the header's
    // own `TimelineOffset` slot is the next int and must stay 0 (it was 5300 = 53x100)
    const header = surface.offset as number;
    const timeline = Array.from(exported.arrays.timeline ?? []) as number[];
    expect(timeline[header + 1]).toBe(0);
    expect(surface.frame.length).toBeGreaterThan(0);
  });

  it('preserves the surface frame data through the round trip', () => {
    const source = decodeDbbin(readFileSync(FIXTURE));
    const before = (source.json as { armature: Array<{ name: string; animation: Array<{ name: string; surface?: Array<{ frame: Array<{ duration: number; vertices?: number[] }> }> }> }> }).armature
      .find((a) => a.name === 'Bicycle')!.animation.find((a) => a.name === 'bicycle')!.surface![0];
    const exported = decodeDbbin(encodeDbbin(source.json as never));
    const after = (exported.json as typeof source.json as never as { armature: Array<{ name: string; animation: Array<{ name: string; surface?: Array<{ frame: Array<{ duration: number; vertices?: number[] }> }> }> }> }).armature
      .find((a) => a.name === 'Bicycle')!.animation.find((a) => a.name === 'bicycle')!.surface![0];
    expect(after.frame.map((f) => f.duration)).toEqual(before.frame.map((f) => f.duration));
    expect(JSON.stringify(after.frame)).toBe(JSON.stringify(before.frame));
  });
});
