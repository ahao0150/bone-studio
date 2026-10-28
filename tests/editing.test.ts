import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Player } from '../src/core/player';
import { parseSkeletonData, serializeSkeletonData } from '../src/core/parse/ske';
import {
  keyFrames, relatedBone, removeKeyFrame, renameBone, reorderSlot, restoreArmature, sampleTransform,
  setBoneTransform, setTweenEasing, snapshotArmature,
} from '../src/core/editing';
import type { DbBoneTimeline } from '../src/core/types';

const SAMPLES = process.env.BONESTUDIO_SAMPLES
  ?? 'samples';

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(join(SAMPLES, path), 'utf8'));
}

const rooster = {
  skeleton: readJson('Rooster_Ani/Rooster_An_ske.json'),
  texture: readJson('Rooster_Ani/Rooster_An_tex.json'),
};

function makePlayer(): Player {
  const player = new Player(rooster.skeleton, rooster.texture as never);
  player.setAnimation(player.animationNames()[0]);
  return player;
}

function totalDuration(timeline: DbBoneTimeline): number {
  return (timeline.frame ?? []).reduce((sum, frame) => sum + (frame.duration || 0), 0);
}

/** Longest first span in the animation, so a mid-span split has room to happen. */
function pickSpan(player: Player): { name: string; timeline: DbBoneTimeline; mid: number } {
  let best: { name: string; timeline: DbBoneTimeline; mid: number } | null = null;
  for (const timeline of player.animation?.bone ?? []) {
    const frames = timeline.frame ?? [];
    if (frames.length < 2) continue;
    const span = frames[0].duration || 0;
    if (span < 3) continue;
    const mid = Math.max(1, Math.floor(span / 2));
    if (!best || span > (best.timeline.frame?.[0].duration ?? 0)) {
      best = { name: timeline.name, timeline, mid };
    }
  }
  if (!best) throw new Error('no suitable timeline found in the sample data');
  return best;
}

describe('timeline editing', () => {
  it('splits a span and writes a transform keyframe', () => {
    const player = makePlayer();
    const { name, timeline, mid } = pickSpan(player);
    const before = keyFrames(player, name);
    const durationBefore = totalDuration(timeline);
    const baseline = sampleTransform(player, name, mid);

    expect(before.length).toBeGreaterThanOrEqual(2);
    expect(before.some((ref) => Math.abs(ref.frame - mid) < 1e-6)).toBe(false);

    const ok = setBoneTransform(player, name, mid, { x: baseline.x + 42, skX: baseline.skX + 15 });
    expect(ok).toBe(true);

    const after = keyFrames(player, name);
    expect(after.length).toBe(before.length + 1);
    expect(after.some((ref) => Math.abs(ref.frame - mid) < 1e-6)).toBe(true);
    // splitting must not change the animation length
    expect(totalDuration(timeline)).toBeCloseTo(durationBefore, 3);

    const written = sampleTransform(player, name, mid);
    expect(written.x).toBeCloseTo(baseline.x + 42, 3);
    expect(written.skX).toBeCloseTo(baseline.skX + 15, 3);
  });

  it('drives the runtime pose from the edited keyframe', () => {
    const player = makePlayer();
    const { name, mid } = pickSpan(player);
    const target = sampleTransform(player, name, mid).y + 33;
    setBoneTransform(player, name, mid, { y: target });
    player.seek(mid);
    const index = player.skeleton.boneIndexByName.get(name) ?? -1;
    expect(index).toBeGreaterThanOrEqual(0);
    // local matrix translation column (tx, ty)
    expect(player.skeleton.bones[index].local[5]).toBeCloseTo(target, 2);
  });

  it('removes a keyframe and gives the duration back to the previous frame', () => {
    const player = makePlayer();
    const { name, timeline, mid } = pickSpan(player);
    const startCount = keyFrames(player, name).length;
    const durationBefore = totalDuration(timeline);
    setBoneTransform(player, name, mid, { x: 7 });
    expect(removeKeyFrame(player, name, mid)).toBe(true);
    expect(keyFrames(player, name).length).toBe(startCount);
    expect(totalDuration(timeline)).toBeCloseTo(durationBefore, 3);
  });

  it('round-trips through the undo snapshot', () => {
    const player = makePlayer();
    const { name, mid } = pickSpan(player);
    const snapshot = snapshotArmature(player);
    const original = sampleTransform(player, name, mid);
    setBoneTransform(player, name, mid, { x: original.x + 120 });
    expect(sampleTransform(player, name, mid).x).toBeCloseTo(original.x + 120, 3);
    restoreArmature(player, snapshot as string);
    expect(sampleTransform(player, name, mid).x).toBeCloseTo(original.x, 2);
  });

  it('keeps the exported document parseable after edits', () => {
    const player = makePlayer();
    const { name, mid } = pickSpan(player);
    setBoneTransform(player, name, mid, { scX: 1.5 });
    const exported = JSON.parse(serializeSkeletonData(player.doc));
    const reparsed = parseSkeletonData(exported);
    expect(reparsed.armatures.length).toBeGreaterThan(0);
    const timeline = reparsed.armatures[0].animation
      ?.flatMap((animation) => animation.bone ?? [])
      .find((entry) => entry.name === name);
    expect(timeline?.frame?.length ?? 0).toBeGreaterThan(1);
  });
});


describe('authoritative editing ops (格式规范)', () => {
  it('sets tween easing on the keyframe at the current position', () => {
    const player = makePlayer();
    const { name, timeline } = pickSpan(player);
    const frames = timeline.frame ?? [];
    expect(setTweenEasing(player, name, 0, 0)).toBe(true);
    expect(frames[0].tweenEasing).toBe(0);
    expect(setTweenEasing(player, name, 0, Number.NaN)).toBe(true);
    expect(Number.isNaN(frames[0].tweenEasing as number)).toBe(true);
    // a position without a keyframe must not be touched
    expect(setTweenEasing(player, name, 0.5, 0)).toBe(false);
  });

  it('reorders slots for the = / - / Ctrl+= / Ctrl+- commands', () => {
    const player = makePlayer();
    const slots = player.skeleton.armature.slot;
    expect(slots.length).toBeGreaterThan(2);
    const first = slots[0].name;
    expect(reorderSlot(player, first, 'front')).toBe(true);
    expect(slots[slots.length - 1].name).toBe(first);
    // runtime slot order follows the authored array, so it must be rebuilt too
    const runtime = player.skeleton.slots.map((slot) => slot.name);
    expect(runtime[runtime.length - 1]).toBe(first);
    expect(reorderSlot(player, first, 'bottom')).toBe(true);
    expect(slots[0].name).toBe(first);
    expect(player.skeleton.slots[0].name).toBe(first);
  });

  it('navigates bone relationships (B / N / M)', () => {
    const player = makePlayer();
    const root = player.skeleton.armature.bone[0].name;
    expect(relatedBone(player, root, 'parent')).toBe(null);
    const child = relatedBone(player, root, 'child');
    expect(child).toBeTruthy();
    expect(relatedBone(player, child, 'parent')).toBe(root);
    expect(relatedBone(player, child, 'brother')).not.toBe(root);
  });
});



describe('rename (F2) keeps references consistent', () => {
  it('renames a bone and updates children, slots, timelines and ik', () => {
    const player = makePlayer();
    const armature = player.skeleton.armature;
    const target = armature.bone.find((bone) => armature.bone.some((child) => child.parent === bone.name))!.name;
    const child = armature.bone.find((bone) => bone.parent === target)!;
    const slotParent = armature.slot.find((slot) => slot.parent === target);
    const renamed = `${target}_renamed`;
    expect(renameBone(player, target, renamed)).toBe(true);
    expect(armature.bone.some((bone) => bone.name === target)).toBe(false);
    expect(armature.bone.find((bone) => bone.name === renamed)).toBeTruthy();
    expect(armature.bone.find((bone) => bone.name === child.name)?.parent).toBe(renamed);
    if (slotParent) expect(armature.slot.find((slot) => slot.name === slotParent.name)?.parent).toBe(renamed);
    for (const animation of armature.animation ?? []) {
      expect((animation.bone ?? []).some((timeline) => timeline.name === target)).toBe(false);
    }
    // the runtime must be rebuilt so the new names are addressable
    expect(player.skeleton.boneIndexByName.has(renamed)).toBe(true);
    expect(player.skeleton.boneIndexByName.has(target)).toBe(false);
    // duplicate names are rejected
    expect(renameBone(player, renamed, armature.bone[0].name)).toBe(false);
  });
});

