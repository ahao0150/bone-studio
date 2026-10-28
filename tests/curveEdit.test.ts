/**
 * Animation-curve editing (official 曲线面板).
 *
 * Two things are asserted here: the panel math must be **the same function the
 * runtime plays** (otherwise the preview lies), and the presets must be the control
 * points the shipped official samples contain (so they are the vendor's shapes,
 * not invented ones).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Player } from '../src/core/player';
import {
  CURVE_PRESETS, applyPreset, copyCurve, curveSamples, curveValue, keyFrameAt,
  pasteCurve, readKeyCurve, sanitizeCurve, setKeyCurve,
} from '../src/core/curveEdit';
import { getCurveEasingValue } from '../src/core/runtime/animation';
import { encodeDbbin } from '../src/core/export/dbbin';
import { decodeDbbin } from '../src/core/parse/dbbinDecode';

const SAMPLES = process.env.BONESTUDIO_SAMPLES
  ?? 'samples';
const readJson = (path: string): unknown => JSON.parse(readFileSync(join(SAMPLES, path), 'utf8'));

function makePlayer(): Player {
  const player = new Player(readJson('Rooster_Ani/Rooster_An_ske.json'), readJson('Rooster_Ani/Rooster_An_tex.json') as never);
  player.setAnimation(player.animationNames()[0]);
  return player;
}

/** The first bone timeline whose first key spans several frames. */
function busiest(player: Player) {
  let best: { name: string; index: number } | null = null;
  for (const timeline of player.animation?.bone ?? []) {
    const frames = timeline.frame ?? [];
    if (frames.length >= 2 && (frames[0].duration ?? 0) >= 4) {
      best = { name: timeline.name, index: 0 };
      break;
    }
  }
  if (!best) throw new Error('fixture needs a multi-frame timeline');
  return best;
}

/** A key whose *following* key has a different pose, so easing actually shows up. */
function animatedSpan(player: Player): { name: string; at: number; span: number } {
  for (const timeline of player.animation?.bone ?? []) {
    const frames = timeline.frame ?? [];
    for (let i = 0; i + 1 < frames.length; i++) {
      const a = frames[i].transform ?? {};
      const b = frames[i + 1].transform ?? {};
      const diff = Math.max(
        Math.abs((a.x ?? 0) - (b.x ?? 0)), Math.abs((a.y ?? 0) - (b.y ?? 0)),
        Math.abs((a.skX ?? 0) - (b.skX ?? 0)), Math.abs((a.skY ?? 0) - (b.skY ?? 0)),
        Math.abs((a.scX ?? 1) - (b.scX ?? 1)), Math.abs((a.scY ?? 1) - (b.scY ?? 1)),
      );
      if (diff > 2 && (frames[i].duration ?? 0) >= 4) {
        let at = 0;
        for (let k = 0; k < i; k++) at += frames[k].duration || 0;
        return { name: timeline.name, at, span: frames[i].duration ?? 1 };
      }
    }
  }
  throw new Error('fixture needs an animated span');
}

describe('curve presets come from the shipped samples', () => {
  it('keeps the vendor control points', () => {
    expect(CURVE_PRESETS.linear.kind).toBe('linear');
    expect(CURVE_PRESETS.step.kind).toBe('step');
    expect([...CURVE_PRESETS.easeIn.points]).toEqual([0.5, 0, 1, 1]);
    expect([...CURVE_PRESETS.easeOut.points]).toEqual([0, 0, 0.5, 1]);
    expect([...CURVE_PRESETS.easeInOut.points]).toEqual([0.5, 0, 0.5, 1]);
  });
});

describe('panel math matches the runtime', () => {
  it('is the same function the playback uses', () => {
    for (const preset of ['easeIn', 'easeOut', 'easeInOut'] as const) {
      const points = [...CURVE_PRESETS[preset].points];
      for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
        expect(curveValue(points, t)).toBeCloseTo(getCurveEasingValue(t, points), 12);
      }
    }
  });

  it('bends away from linear in the documented direction', () => {
    const easeIn = [...CURVE_PRESETS.easeIn.points];
    const easeOut = [...CURVE_PRESETS.easeOut.points];
    // 渐入 = starts slow (value below linear), 渐出 = starts fast (above linear)
    expect(curveValue(easeIn, 0.25)).toBeLessThan(0.25);
    expect(curveValue(easeOut, 0.25)).toBeGreaterThan(0.25);
    // 线性 preset is a straight line; the runtime's bisection stops at 0.01 in x,
    // so an identity *curve* is only linear to that tolerance (that is why the
    // editor's 线性 preset writes `tweenEasing: 0` instead of a curve)
    expect(curveValue([0, 0, 1, 1], 0.25)).toBeCloseTo(0.25, 1);
  });

  it('samples a polyline for the panel overlay', () => {
    const samples = curveSamples([0.5, 0, 0.5, 1], 9);
    expect(samples).toHaveLength(9);
    // the runtime's bisection stops at 0.01, so the endpoints are approximate by design
    expect(samples[0]).toBeLessThan(0.01);
    expect(samples[8]).toBeGreaterThan(0.99);
    expect(samples[4]).toBeCloseTo(0.5, 1);
  });
});

describe('reading and writing the selected keyframe curve', () => {
  it('round-trips every preset through the frame data', () => {
    const player = makePlayer();
    const { name } = busiest(player);
    const key = keyFrameAt(player, name, 0);
    expect(key).not.toBeNull();
    const at = key!.at;

    expect(applyPreset(player, name, at, 'easeInOut')).toBe(true);
    const state = readKeyCurve(player, name, at)!;
    expect(state.kind).toBe('curve');
    expect(state.points).toEqual([0.5, 0, 0.5, 1]);
    expect(state.duration).toBeGreaterThan(0);

    expect(applyPreset(player, name, at, 'linear')).toBe(true);
    expect(readKeyCurve(player, name, at)!.kind).toBe('linear');

    expect(applyPreset(player, name, at, 'step')).toBe(true);
    expect(readKeyCurve(player, name, at)!.kind).toBe('step');
  });

  it('copies and pastes a curve onto another keyframe', () => {
    const player = makePlayer();
    const { name } = busiest(player);
    const timeline = player.animation?.bone?.find((t) => t.name === name);
    const first = keyFrameAt(player, name, 0)!;
    applyPreset(player, name, first.at, 'easeOut');
    const clip = copyCurve(readKeyCurve(player, name, first.at)!);

    const secondAt = (timeline?.frame?.[0].duration ?? 0);
    expect(pasteCurve(player, name, secondAt, clip)).toBe(true);
    const state = readKeyCurve(player, name, secondAt)!;
    expect(state.kind).toBe('curve');
    expect(state.points).toEqual([0, 0, 0.5, 1]);
  });

  it('drives the runtime pose differently from linear', () => {
    const player = makePlayer();
    const { name, at, span } = animatedSpan(player);
    const poseAt = (preset: 'linear' | 'easeInOut', ratio: number) => {
      applyPreset(player, name, at, preset);
      player.seek(at + span * ratio);
      return player.skeleton.bones.find((b) => b.name === name)!.world.slice();
    };

    // A symmetric ease-in-out is deliberately ~linear at the exact midpoint, so the
    // difference has to be measured across the span. (The previous sampling at 0.5
    // only looked different because the old bezier bisection was coarse.)
    let delta = 0;
    for (const ratio of [0.15, 0.25, 0.35, 0.65, 0.75, 0.85]) {
      const linear = poseAt('linear', ratio);
      const eased = poseAt('easeInOut', ratio);
      delta = Math.max(delta, ...linear.map((value, index) => Math.abs(value - eased[index])));
    }
    expect(delta).toBeGreaterThan(0.05);
  });

  it('keeps the curve when the document is exported and read back', () => {
    const player = makePlayer();
    const { name } = busiest(player);
    const key = keyFrameAt(player, name, 0)!;
    applyPreset(player, name, key.at, 'easeInOut');

    const bytes = encodeDbbin({ armature: [player.skeleton.armature], frameRate: 24, name: 'curveRoundTrip' } as never);
    const decoded = decodeDbbin(bytes);
    const timelines = (decoded.json as {
      armature: Array<{
        animation: Array<{
          bone: Array<{
            name: string;
            frame?: Array<{ curve?: number[]; tweenType?: number; curveSamples?: number[] }>;
            translateFrame?: Array<{ curve?: number[]; curveSamples?: number[] }>;
            rotateFrame?: Array<{ curve?: number[]; curveSamples?: number[] }>;
            scaleFrame?: Array<{ curve?: number[]; curveSamples?: number[] }>;
          }>;
        }>;
      }>;
    }).armature[0].animation[0].bone;
    const exported = timelines.find((entry) => entry.name === name);
    expect(exported).toBeTruthy();
    const frames = [
      ...(exported?.frame ?? []),
      ...(exported?.translateFrame ?? []),
      ...(exported?.rotateFrame ?? []),
      ...(exported?.scaleFrame ?? []),
    ];
    // the curve is baked into a sampled table on export, exactly like the official writer
    const hasCurve = frames.some((frame) => (frame.curveSamples?.length ?? 0) > 0 || (frame.curve?.length ?? 0) > 0);
    expect(hasCurve).toBe(true);
  });

  it('sanitizes hand-dragged control points', () => {
    const points = sanitizeCurve([-3, 5, 0.5, -2]);
    expect(points[0]).toBe(-1);
    expect(points[1]).toBe(2);
    expect(points[2]).toBe(0.5);
    expect(points[3]).toBe(-1);
  });
});
