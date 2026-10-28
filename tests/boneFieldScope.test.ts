/**
 * Value semantics of `sampleTransform` / `setBoneTransform` — the regression that
 * §23.33 could not enable and §23.34 finally pinned down.
 *
 * Convention (格式规范): every form of keyframe data (`.dbbin`
 * `translateFrame` / `rotateFrame` / `scaleFrame`, and JSON `frame[].transform`) stores
 * a **bind-relative delta**. `sampleTransform` therefore returns the **absolute** pose
 * (bind composed with the delta), and `setBoneTransform`'s `patch` is absolute too.
 *
 * The three measurements recorded in §23.33 all came from one bug: `setBoneTransform`
 * wrote the absolute `effective` value into channels the caller had not passed, where a
 * delta belonged. One edit then added the bind offset a second time (`-bind` before
 * round 56, `2x bind` after it). These tests pin both directions.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Player } from '../src/core/player';
import {
  boneTimeline, keyFrames, sampleTransform, sampleTransformDelta, setBoneTransform,
} from '../src/core/editing';
import type { DbTransform } from '../src/core/types';

const SAMPLES = process.env.BONESTUDIO_SAMPLES
  ?? 'samples';

const readJson = (path: string): unknown => JSON.parse(readFileSync(join(SAMPLES, path), 'utf8'));

// `parseSkeletonData` keeps the parsed object by reference, so a module-level fixture
// would let one test observe another test's edits. Re-read per player instead.
function makePlayer(): Player {
  const player = new Player(
    readJson('Rooster_Ani/Rooster_An_ske.json'),
    readJson('Rooster_Ani/Rooster_An_tex.json') as never,
  );
  player.setAnimation('rooster_idle_anim');
  return player;
}

function bindOf(player: Player, name: string): DbTransform {
  return player.skeleton.armature.bone.find((bone) => bone.name === name)?.transform ?? {};
}

/** Frame index of the key start sitting on `position` (null when there is none). */
function frameIndexAt(player: Player, name: string, position: number): number | null {
  const found = keyFrames(player, name).find((ref) => Math.abs(ref.frame - position) < 1e-6);
  return found ? found.index : null;
}

const BONE = 'body_bone';
const MID = 10;

describe('sampleTransform / setBoneTransform value semantics (§23.35)', () => {
  it('reads the sample fixture the way the spec describes it', () => {
    const player = makePlayer();
    const bind = bindOf(player, BONE);
    // projects/Rooster_Ani: body_bone binds at (-95, 35) and frame 20 carries a +5 y offset
    expect(bind.x).toBe(-95);
    expect(bind.y).toBe(35);
  });

  it('composes the bind pose with the sampled delta', () => {
    const player = makePlayer();
    const bind = bindOf(player, BONE);

    expect(sampleTransformDelta(player, BONE, 0)).toMatchObject({ x: 0, y: 0, scX: 1, scY: 1 });
    expect(sampleTransform(player, BONE, 0).x).toBeCloseTo(-95, 6);
    expect(sampleTransform(player, BONE, 0).y).toBeCloseTo(35, 6);

    // frame 20 is the key carrying y: +5, so the absolute pose is bind.y + 5 (= 40,
    // the value the property panel showed when §9 was written)
    expect(sampleTransform(player, BONE, 20).x).toBeCloseTo(bind.x ?? 0, 6);
    expect(sampleTransform(player, BONE, 20).y).toBeCloseTo((bind.y ?? 0) + 5, 6);
  });

  it('reports the bind pose for a bone with no timeline (was: identity)', () => {
    const player = makePlayer();
    player.animation!.bone = (player.animation!.bone ?? []).filter((entry) => entry.name !== BONE);
    expect(boneTimeline(player, BONE)).toBeNull();

    const values = sampleTransform(player, BONE, 0);
    expect(values.x).toBeCloseTo(-95, 6);
    expect(values.y).toBeCloseTo(35, 6);
    expect(values.scX).toBeCloseTo(1, 6);
    expect(values.scY).toBeCloseTo(1, 6);
  });

  it('keeps the untouched channels as deltas when only one field is passed', () => {
    const player = makePlayer();
    const before = sampleTransform(player, BONE, MID);
    const deltaBefore = sampleTransformDelta(player, BONE, MID);

    expect(setBoneTransform(player, BONE, MID, { skX: before.skX + 15 })).toBe(true);

    const after = sampleTransform(player, BONE, MID);
    expect(after.skX).toBeCloseTo(before.skX + 15, 3);
    expect(after.x).toBeCloseTo(before.x, 3);
    expect(after.y).toBeCloseTo(before.y, 3);
    expect(after.scX).toBeCloseTo(before.scX, 6);
    expect(after.scY).toBeCloseTo(before.scY, 6);

    // the split keyframe must store bind-relative deltas, and the untouched ones verbatim
    const index = frameIndexAt(player, BONE, MID);
    expect(index).not.toBeNull();
    const transform = boneTimeline(player, BONE)!.frame![index!].transform!;
    expect(Math.abs(transform.x ?? 0)).toBeLessThan(1e-3);
    // `setBoneTransform` rounds stored values to 3 decimals, so allow one quantum
    expect(Math.abs((transform.y ?? 0) - deltaBefore.y)).toBeLessThan(1e-3);
    expect(Math.abs((transform.scX ?? 1) - deltaBefore.scX)).toBeLessThan(1e-3);
    expect(Math.abs((transform.scY ?? 1) - deltaBefore.scY)).toBeLessThan(1e-3);
  });

  it('moves only the channel named by a partial patch (the drag path)', () => {
    const player = makePlayer();
    const before = sampleTransform(player, BONE, MID);

    expect(setBoneTransform(player, BONE, MID, { x: before.x + 42 })).toBe(true);

    const after = sampleTransform(player, BONE, MID);
    expect(after.x).toBeCloseTo(before.x + 42, 3);
    expect(after.y).toBeCloseTo(before.y, 3);

    // the runtime pose must agree with the editor's absolute transform
    player.seek(MID);
    const index = player.skeleton.boneIndexByName.get(BONE) ?? -1;
    expect(index).toBeGreaterThanOrEqual(0);
    expect(player.skeleton.bones[index].local[5]).toBeCloseTo(after.y, 2);
    expect(player.skeleton.bones[index].local[4]).toBeCloseTo(after.x, 2);
  });

  it('does not accumulate the bind offset over repeated edits (the 2x measurement)', () => {
    const player = makePlayer();
    const before = sampleTransform(player, BONE, MID);

    setBoneTransform(player, BONE, MID, { skX: before.skX + 15 });
    const once = sampleTransform(player, BONE, MID);
    setBoneTransform(player, BONE, MID, { skX: once.skX + 15 });
    const twice = sampleTransform(player, BONE, MID);

    expect(twice.skX).toBeCloseTo(before.skX + 30, 3);
    expect(twice.x).toBeCloseTo(before.x, 3);
    expect(twice.y).toBeCloseTo(before.y, 3);
  });
});