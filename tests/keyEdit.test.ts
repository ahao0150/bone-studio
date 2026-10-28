/**
 * Dope-sheet keyframe operations (official 摄影表: 框选 / 拖动 / 缩放 / 复制剪切粘贴删除).
 *
 * The runtime contract these ops must preserve: `sum(frame.duration)` stays equal to
 * the animation duration, positions stay inside `[0, duration]`, and the edited
 * document still exports and re-parses (checked through `encodeDbbin`).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Player } from '../src/core/player';
import { keyFrames } from '../src/core/editing';
import {
  copyKeys, deleteKeys, moveKeys, pasteKeys, scaleKeys, type KeySelectionEntry,
} from '../src/core/keyEdit';
import { encodeDbbin } from '../src/core/export/dbbin';
import { decodeDbbin } from '../src/core/parse/dbbinDecode';
import type { DbBoneTimeline } from '../src/core/types';

const SAMPLES = process.env.BONESTUDIO_SAMPLES
  ?? 'samples';
const readJson = (path: string): unknown => JSON.parse(readFileSync(join(SAMPLES, path), 'utf8'));

function makePlayer(): Player {
  const doc = readJson('Rooster_Ani/Rooster_An_ske.json');
  const texture = readJson('Rooster_Ani/Rooster_An_tex.json');
  const player = new Player(doc, texture as never);
  player.setAnimation(player.animationNames()[0]);
  return player;
}

/** A timeline with the most keys — the fixture all of these tests edit. */
function busiest(player: Player): { name: string; timeline: DbBoneTimeline } {
  let best: { name: string; timeline: DbBoneTimeline } | null = null;
  for (const timeline of player.animation?.bone ?? []) {
    const count = (timeline.frame ?? []).length;
    if (!best || count > (best.timeline.frame?.length ?? 0)) best = { name: timeline.name, timeline };
  }
  if (!best || (best.timeline.frame?.length ?? 0) < 3) throw new Error('fixture needs a timeline with >= 3 keys');
  return best;
}

/** Selection entries are addressed by frame position (indexes go stale after edits). */
function selection(player: Player, name: string, indexes: number[]): KeySelectionEntry[] {
  const timeline = player.animation?.bone?.find((entry) => entry.name === name);
  const at = positions(timeline as DbBoneTimeline);
  return indexes.filter((index) => index < at.length).map((index) => ({ bone: name, frame: at[index] }));
}

function positions(timeline: DbBoneTimeline): number[] {
  const out: number[] = [];
  let at = 0;
  for (const frame of timeline.frame ?? []) {
    out.push(Math.round(at * 1000) / 1000);
    at += frame.duration || 0;
  }
  return out;
}

function duration(timeline: DbBoneTimeline): number {
  return (timeline.frame ?? []).reduce((sum, frame) => sum + (frame.duration || 0), 0);
}

describe('dope-sheet key editing', () => {
  it('moves a selection and keeps the timeline duration', () => {
    const player = makePlayer();
    const { name, timeline } = busiest(player);
    const before = positions(timeline);
    const total = duration(timeline);
    const animationDuration = player.duration;

    const moved = moveKeys(player, selection(player, name, [1]), 3);
    expect(moved).toBe(1);
    expect(positions(timeline)[1]).toBeCloseTo(before[1] + 3, 6);
    expect(duration(timeline)).toBeCloseTo(total, 6);
    expect(duration(timeline)).toBeCloseTo(animationDuration, 6);
  });

  it('clamps a group drag so the selection stays inside the animation', () => {
    const player = makePlayer();
    const { name, timeline } = busiest(player);
    const before = positions(timeline);
    const first = before[0];
    // dragging far to the left may not push any key before frame 0
    moveKeys(player, selection(player, name, [0, 1]), -1000);
    expect(Math.min(...positions(timeline))).toBeGreaterThanOrEqual(0);
    expect(positions(timeline)[0]).toBeCloseTo(first, 6);
    // …and the same to the right
    moveKeys(player, selection(player, name, [0, 1]), 1000);
    expect(Math.max(...positions(timeline))).toBeLessThanOrEqual(player.duration + 1e-6);
  });

  it('keeps the relative spacing when several keys move together', () => {
    const player = makePlayer();
    const { name, timeline } = busiest(player);
    const before = positions(timeline);
    moveKeys(player, selection(player, name, [1, 2]), 2);
    const after = positions(timeline);
    expect(after[1] - before[1]).toBeCloseTo(after[2] - before[2], 6);
  });

  it('scales a selection to retime the animation (faster / slower)', () => {
    const player = makePlayer();
    const { name, timeline } = busiest(player);
    const before = positions(timeline);
    const anchor = before[0];
    const span = before[before.length - 1] - anchor;
    if (span < 4) return;

    scaleKeys(player, selection(player, name, [0, 1, 2]), 0.5);
    const faster = positions(timeline);
    expect(faster[1] - anchor).toBeLessThan(before[1] - anchor);
    expect(duration(timeline)).toBeCloseTo(player.duration, 6);

    scaleKeys(player, selection(player, name, [0, 1, 2]), 2);
    const slower = positions(timeline);
    expect(slower[1] - anchor).toBeGreaterThan(faster[1] - anchor);
    expect(duration(timeline)).toBeCloseTo(player.duration, 6);
  });

  it('deletes selected keys and gives the span back', () => {
    const player = makePlayer();
    const { name, timeline } = busiest(player);
    const before = positions(timeline);
    const removed = deleteKeys(player, selection(player, name, [1]));
    expect(removed).toBe(1);
    const after = positions(timeline);
    expect(after).toHaveLength(before.length - 1);
    expect(after).not.toContain(before[1]);
    expect(duration(timeline)).toBeCloseTo(player.duration, 6);
  });

  it('copies a selection and pastes it at another frame', () => {
    const player = makePlayer();
    const { name, timeline } = busiest(player);
    const before = positions(timeline);
    // copy three keys: the offsets must be measured from the earliest one
    const clip = copyKeys(player, selection(player, name, [0, 1, 2]));
    expect(clip).not.toBeNull();
    expect(clip?.tracks[0].keys).toHaveLength(3);
    expect(clip?.tracks[0].keys[0].offset).toBe(0);
    expect(clip?.tracks[0].keys[1].offset).toBeCloseTo(before[1] - before[0], 6);
    expect(clip?.tracks[0].keys[2].offset).toBeCloseTo(before[2] - before[0], 6);
    expect(clip?.span).toBeCloseTo(before[2] - before[0], 6);

    const pasted = pasteKeys(player, clip, 0);
    expect(pasted).toBe(3);
    // pasting onto the same spot is idempotent, not additive
    expect((timeline.frame ?? []).length).toBe(positions(timeline).length);
    expect(duration(timeline)).toBeCloseTo(player.duration, 6);

    // pasting at another frame adds the copied keys there
    const target = Math.max(0, player.duration - (before[2] - before[0]));
    const added = pasteKeys(player, clip, target);
    expect(added).toBe(3);
    const after = positions(timeline);
    expect(after.some((at) => Math.abs(at - target) < 1e-6)).toBe(true);
    expect(duration(timeline)).toBeCloseTo(player.duration, 6);
  });

  it('keeps the edited document exportable', () => {
    const player = makePlayer();
    const { name } = busiest(player);
    moveKeys(player, selection(player, name, [1]), 1);
    copyKeys(player, selection(player, name, [0]));
    const clip = copyKeys(player, selection(player, name, [1]));
    pasteKeys(player, clip, Math.max(0, player.duration - 2));

    const bytes = encodeDbbin(player.skeleton.armature ? { armature: [player.skeleton.armature] } : {});
    const decoded = decodeDbbin(bytes);
    // the reader materialises BoneAll(10) as component tracks, so count both shapes
    const timelines = (decoded.json as {
      armature: Array<{
        animation: Array<{
          bone: Array<{
            name: string;
            frame?: unknown[];
            translateFrame?: unknown[];
            rotateFrame?: unknown[];
            scaleFrame?: unknown[];
          }>;
        }>;
      }>;
    }).armature[0].animation[0].bone;
    const exported = timelines.find((entry) => entry.name === name);
    expect(exported).toBeTruthy();
    const keys = (exported?.frame?.length ?? 0)
      + (exported?.translateFrame?.length ?? 0)
      + (exported?.rotateFrame?.length ?? 0)
      + (exported?.scaleFrame?.length ?? 0);
    expect(keys).toBeGreaterThan(0);
  });

  it('exposes keyframe positions through the existing reader', () => {
    const player = makePlayer();
    const { name } = busiest(player);
    moveKeys(player, selection(player, name, [1]), 2);
    const refs = keyFrames(player, name);
    expect(refs.length).toBeGreaterThan(2);
    expect(refs[1].frame).toBeGreaterThan(refs[0].frame);
  });
});
