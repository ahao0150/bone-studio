/**
 * Stage ruler math (official 舞台标尺).
 *
 * The stage frames the artboard with world-coordinate rulers. Ticks must land on
 * the same camera mapping the renderer uses (`screen = world * scale + pan`) and
 * the labelled step has to stay in the 1 / 2 / 5 x 10^n family at every zoom.
 */
import { describe, expect, it } from 'vitest';
import { niceStep, rulerTicks } from '../src/ui/stageRuler';

describe('stage ruler', () => {
  it('keeps labelled ticks at least the target distance apart', () => {
    for (const scale of [0.03, 0.05, 0.2, 0.31, 0.7, 1, 1.7, 4, 12, 24]) {
      for (const target of [40, 56]) {
        const step = niceStep(scale, target);
        expect(step * scale).toBeGreaterThanOrEqual(target - 1e-6);
        expect(step * scale).toBeLessThan(target * 6);
      }
    }
  });

  it('only ever returns 1/2/5 x 10^n steps', () => {
    for (const scale of [0.03, 0.7, 1, 3.3, 24]) {
      const step = niceStep(scale, 56);
      const mantissa = Number((step / 10 ** Math.floor(Math.log10(step))).toFixed(6));
      expect([1, 2, 5, 10]).toContain(mantissa);
    }
  });

  it('places ticks with the renderer camera mapping', () => {
    const ticks = rulerTicks(0.5, 100, 400, 100);
    expect(ticks.filter((t) => t.major).map((t) => t.label))
      .toEqual(['-200', '-100', '0', '100', '200', '300', '400', '500', '600']);
    // screen = world * scale + pan
    expect(ticks.find((t) => t.zero)!.px).toBeCloseTo(100, 6);
    expect(ticks.find((t) => t.label === '100')!.px).toBeCloseTo(150, 6);
    expect(ticks.find((t) => t.label === '-200')!.px).toBeCloseTo(0, 6);
    // minor ticks subdivide each labelled step into five
    expect(ticks.filter((t) => !t.major).every((t) => t.label === '')).toBe(true);
    expect(ticks.length).toBe(41);
  });

  it('marks the origin exactly once', () => {
    const ticks = rulerTicks(1, 100, 200, 50);
    expect(ticks.filter((t) => t.zero).length).toBe(1);
    expect(ticks.find((t) => t.zero)!.px).toBe(100);
    expect(ticks.map((t) => t.label).filter(Boolean)).toEqual(['-100', '-50', '0', '50', '100']);
  });

  it('degrades safely on unusable input', () => {
    expect(rulerTicks(0, 0, 100, 10)).toEqual([]);
    expect(rulerTicks(1, 0, 0, 10)).toEqual([]);
    expect(rulerTicks(1, 0, 100, 0)).toEqual([]);
    expect(rulerTicks(1, Number.NaN, 100, 10)).toEqual([]);
    expect(rulerTicks(1e-9, 0, 100, 10)).toEqual([]);
  });
});
