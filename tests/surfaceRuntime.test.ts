/**
 * Surface runtime regression: our surface deform must reproduce what the official
 * runtime plays.
 *
 * The oracle (`docs/evidence/surface-child-oracle.json`) was produced by the
 * published DragonBones runtime (Egret build 5.7.000, built from
 * `DragonBones/DragonBonesJS`) reading the *binary* export from upstream
 * `DragonBones/Tools` — the very bytes `encodeDbbin` writes byte-for-byte.
 * The fixture deforms the middle vertex of a 2x2 surface grid linearly across
 * frames 0..10 with three bones hanging inside the grid.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { decodeDbbin } from '../src/core/parse/dbbinDecode';
import { Skeleton, boneWorldMatrix } from '../src/core/runtime/skeleton';
import type { DbSkeletonData } from '../src/core/types';

// Oracle fixtures are internal evidence and are not shipped with the open-source repo
// (see .gitignore: docs/evidence/). Set the env vars to point at your own captures;
// when neither file exists the whole suite skips instead of failing.
const ORACLE = process.env.BONESTUDIO_ORACLE_DIR ?? 'samples';
const BINARY = `${ORACLE}/out-surface-child/SurfaceChild_ske.dbbin`;
const EVIDENCE = process.env.BONESTUDIO_SURFACE_ORACLE ?? 'docs/evidence/surface-child-oracle.json';
const hasFixture = existsSync(BINARY) && existsSync(EVIDENCE);

interface Pose { a: number; b: number; c: number; d: number; tx: number; ty: number }
const oracle = hasFixture
  ? JSON.parse(readFileSync(EVIDENCE, 'utf8')) as { frames: Array<{ frame: number; pose: Record<string, Pose> }> }
  : { frames: [] };

/** World matrix of a bone at an animation position (frames). */
function poseAt(skeleton: Skeleton, name: string, position: number): Pose | null {
  const m = boneWorldMatrix(skeleton, name);
  if (!m) return null;
  return { a: m[0], b: m[1], c: m[2], d: m[3], tx: m[4], ty: m[5] };
}

describe.skipIf(!hasFixture)('surface runtime deform (official oracle)', () => {
  it('deforms exactly like the published runtime across the ramp', () => {
    const decoded = decodeDbbin(readFileSync(BINARY));
    const doc = decoded.json as DbSkeletonData;
    const skeleton = new Skeleton(doc.armature[0]);
    const animation = skeleton.getAnimation('surf');
    expect(animation).not.toBeNull();

    let worst = 0;
    for (const entry of oracle.frames) {
      skeleton.update(animation, entry.frame);
      for (const name of ['child', 'child2', 'child3']) {
        const mine = poseAt(skeleton, name, entry.frame);
        const want = entry.pose[name];
        expect(mine).not.toBeNull();
        if (!mine || !want) continue;
        for (const key of ['a', 'b', 'c', 'd', 'tx', 'ty'] as const) {
          worst = Math.max(worst, Math.abs(mine[key] - want[key]));
        }
      }
    }
    // the runtime maths is double precision; anything above a hundredth means a
    // different deform model (hull / inheritance), not rounding
    expect(worst).toBeLessThan(0.01);
  });

  it('actually moves the children (the deform is not a no-op)', () => {
    const decoded = decodeDbbin(readFileSync(BINARY));
    const skeleton = new Skeleton((decoded.json as DbSkeletonData).armature[0]);
    const animation = skeleton.getAnimation('surf');
    skeleton.update(animation, 0);
    const start = poseAt(skeleton, 'child', 0);
    skeleton.update(animation, 10);
    const end = poseAt(skeleton, 'child', 10);
    expect(start && end).toBeTruthy();
    if (!start || !end) return;
    expect(Math.hypot(end.tx - start.tx, end.ty - start.ty)).toBeGreaterThan(50);
    // the grid's own fitted matrix is the deform driver
    expect(end.a).toBeCloseTo(start.a, 6);
  });

  it('reports the runtime grid through surfaceInfo()', () => {
    const decoded = decodeDbbin(readFileSync(BINARY));
    const skeleton = new Skeleton((decoded.json as DbSkeletonData).armature[0]);
    const animation = skeleton.getAnimation('surf');
    skeleton.update(animation, 10);
    const info = skeleton.surfaceInfo();
    expect(info.length).toBe(1);
    expect(info[0].name).toBe('surface');
    expect(info[0].vertices).toBe(9);
    expect(info[0].deformMax).toBeCloseTo(60, 6);
    expect(info[0].child).toBe('child');
    expect(info[0].childX).toBeCloseTo(60, 6);
    expect(info[0].childY).toBeCloseTo(-40, 6);
  });

  it('interpolates linearly between the two keys', () => {
    const decoded = decodeDbbin(readFileSync(BINARY));
    const skeleton = new Skeleton((decoded.json as DbSkeletonData).armature[0]);
    const animation = skeleton.getAnimation('surf');
    skeleton.update(animation, 5);
    const mid = poseAt(skeleton, 'child', 5);
    expect(mid?.tx).toBeCloseTo(30, 4);
    expect(mid?.ty).toBeCloseTo(-20, 4);
  });
});
