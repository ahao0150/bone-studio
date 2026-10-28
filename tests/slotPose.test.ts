import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Player } from '../src/core/player';
import { IDENTITY } from '../src/core/runtime/math';
import { slotDisplayWorld } from '../src/core/runtime/skeleton';
import {
  poseFromGizmo, readSlotDisplayTransform, setSlotDisplayTransform, slotPoseEditable,
} from '../src/core/slotPose';
import type { BoneTransformValues } from '../src/core/editing';

const SAMPLES = process.env.BONESTUDIO_SAMPLES
  ?? 'samples';

function makePlayer(): Player {
  const root = join(SAMPLES, 'Rooster_Ani');
  const player = new Player(
    JSON.parse(readFileSync(join(root, 'Rooster_An_ske.json'), 'utf8')),
    JSON.parse(readFileSync(join(root, 'Rooster_An_tex.json'), 'utf8')),
  );
  player.setAnimation(player.animationNames()[0]);
  player.setupPose = true;
  player.applyPose();
  return player;
}

const base: BoneTransformValues = { x: 0, y: 0, skX: 0, skY: 0, scX: 1, scY: 1 };

describe('slot pose (armature ZXCV)', () => {
  it('writes an image display transform and moves its world origin', () => {
    const player = makePlayer();
    const name = player.skeleton.slots.find((slot) => slotPoseEditable(player, slot.name))?.name;
    expect(name).toBeTruthy();
    const original = readSlotDisplayTransform(player, name!)!;
    const before = slotDisplayWorld(player.skeleton, name!)!;
    expect(setSlotDisplayTransform(player, name!, { x: original.x + 12 })).toBe(true);
    player.applyPose();
    const after = slotDisplayWorld(player.skeleton, name!)!;
    expect(readSlotDisplayTransform(player, name!)?.x).toBeCloseTo(original.x + 12, 3);
    expect(Math.hypot(after[4] - before[4], after[5] - before[5])).toBeGreaterThan(1);
  });

  it('refuses mesh displays', () => {
    const player = makePlayer();
    const mesh = player.skeleton.slots.find((slot) => !slotPoseEditable(player, slot.name));
    if (!mesh) return;
    expect(setSlotDisplayTransform(player, mesh.name, { x: 3 })).toBe(false);
  });

  it('moves in parent space by the screen delta when the parent is identity', () => {
    const patch = poseFromGizmo({
      gizmo: 'move', clientX: 0, clientY: 0, dx: 20, dy: -8, stageScale: 2,
      originScreenX: 0, originScreenY: 0, startAngle: 0, startDistance: 60, startAxis: 12, startAxisY: 12,
      startValues: base, current: base, parent: IDENTITY, selfWorld: IDENTITY, space: 'world',
    });
    expect(patch).toEqual({ x: 10, y: -4 });
  });
});
