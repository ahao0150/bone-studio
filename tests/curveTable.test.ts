/**
 * Easing-curve pipeline — 官方「预采样表 + 表查找」，而不是逐帧解析贝塞尔。
 *
 * 证据：把官方随程序发布的运行时当 oracle 播放 Rooster，`body_bone` 的
 * `[0.5,0,0.5,1]`（20 帧）逐帧进度与「按 `duration+1` 预采样 + 表查找」吻合到
 * 5.6e-16，而与解析贝塞尔相差约 1.4e-3（见 `docs/evidence/closure-oracle.json`）。
 * 本文件把这条实测曲线钉成回归。
 */
import { describe, expect, it } from 'vitest';
import {
  curveEasingValue, frameProgress, getCurveEasingValue, sampleEasingCurve,
} from '../src/core/runtime/animation';
import { parseBoolean } from '../src/core/runtime/math';
import { curveValue } from '../src/core/curveEdit';

/** 官方运行时在 t = 0, 0.1, … 1.0 处的进度（从 oracle 帧矩阵反解，见曲线证据） */
const OFFICIAL = [0, 0.01524, 0.06558, 0.16142, 0.30964, 0.4999, 0.69036, 0.83858, 0.93442, 0.98476, 1];
const CURVE = [0.5, 0, 0.5, 1];

describe('easing curve pipeline', () => {
  it('pre-samples into duration + 1 entries starting at t = 1/(n+1)', () => {
    const samples = new Array<number>(21).fill(0);
    expect(sampleEasingCurve(CURVE, samples)).toBe(true); // length % 3 === 1 -> endpoints omitted
    expect(samples).toHaveLength(21);
    // the vendor bisects with a 1e-4 tolerance, so the midpoint lands at 0.4999
    expect(samples[10]).toBeCloseTo(0.5, 3);
    expect(samples[0]).toBeGreaterThan(0);
    expect(samples[20]).toBeLessThan(1);
    // 4-decimal quantisation, exactly like the vendor's Int16Array of `y * 10000`
    for (const value of samples) expect(Math.round(value * 10000) / 10000).toBe(value);
  });

  it('reproduces the official runtime frame for frame', () => {
    for (let i = 0; i < OFFICIAL.length; i++) {
      const t = i / (OFFICIAL.length - 1);
      expect(getCurveEasingValue(t, CURVE, 20)).toBeCloseTo(OFFICIAL[i], 5);
    }
    // the analytic bezier is *not* what the runtime plays — guard against regressing to it
    expect(Math.abs(getCurveEasingValue(0.1, CURVE, 20) - 0.014622)).toBeGreaterThan(1e-4);
  });

  it('goes through the same table for JSON and binary frames', () => {
    const jsonFrame = { duration: 20, curve: CURVE };
    const samples = new Array<number>(21);
    sampleEasingCurve(CURVE, samples);
    const binaryFrame = { duration: 20, curveSamples: samples, tweenRaw: 21 };
    for (const t of [0, 0.05, 0.1, 0.37, 0.5, 0.82, 1]) {
      expect(frameProgress(jsonFrame, t)).toBeCloseTo(frameProgress(binaryFrame, t), 12);
    }
  });

  it('keeps the panel preview on the same function the runtime plays', () => {
    expect(curveValue(CURVE, 0.5)).toBeCloseTo(frameProgress({ duration: 20, curve: CURVE }, 0.5), 12);
  });

  it('reproduces the vendor `_getBoolean` table for the string spellings', () => {
    // Bicycle ships `"bendPositive": "false"` — a truthy string in JS
    expect(parseBoolean('false', true)).toBe(false);
    expect(parseBoolean('0', true)).toBe(false);
    expect(parseBoolean('', true)).toBe(false);
    expect(parseBoolean('true', false)).toBe(true);
    expect(parseBoolean(true, false)).toBe(true);
    expect(parseBoolean(undefined, true)).toBe(true);
    expect(parseBoolean(null, true)).toBe(true);
  });

  it('handles degenerate and boundary input', () => {
    expect(curveEasingValue(0, [0.25], 1)).toBe(0);
    expect(curveEasingValue(1, [0.25], 1)).toBe(1);
    // straight table lookup between the implicit 0 / 1 endpoints
    expect(curveEasingValue(0.5, [0.25, 0.75], 2)).toBeCloseTo(0.5, 12);
  });
});
