/**
 * Dope-sheet scale math (timeline zoom).
 *
 * The official editor zooms the timeline with the wheel over the ruler and shows
 * a horizontal scrollbar once the animation no longer fits
 * (Loongbones `ui-dope-sheet.md`). The container only owns the playhead, so the
 * positional math is pure and checked here.
 */
import { describe, expect, it } from 'vitest';
import {
  ZOOM_MAX, ZOOM_MIN, clampZoom, frameAtPointer, majorStepFor, scrollForAnchoredZoom,
  timelineMetrics, timelineTicks,
} from '../src/ui/timelineScale';

describe('timeline zoom metrics', () => {
  it('fits the whole animation at zoom 1', () => {
    const m = timelineMetrics({ duration: 54, viewportWidth: 1350, zoom: 1, scrollLeft: 0, position: 27 });
    expect(m.pxPerFrame).toBeCloseTo(25, 6);
    expect(m.contentWidth).toBe(1350);
    expect(m.playheadPx).toBeCloseTo(675, 6);
  });

  it('grows the content and offsets the playhead when zoomed / scrolled', () => {
    const m = timelineMetrics({ duration: 54, viewportWidth: 1350, zoom: 4, scrollLeft: 1200, position: 27 });
    expect(m.pxPerFrame).toBeCloseTo(100, 6);
    expect(m.contentWidth).toBeCloseTo(5400, 6);
    expect(m.playheadPx).toBeCloseTo(1500, 6);
  });

  it('clamps the zoom range', () => {
    expect(clampZoom(0)).toBe(1);
    expect(clampZoom(0.0001)).toBe(ZOOM_MIN);
    expect(clampZoom(1e6)).toBe(ZOOM_MAX);
    expect(clampZoom(Number.NaN)).toBe(1);
  });
});

describe('ruler ticks', () => {
  it('keeps major labels at least ~56px apart across the zoom range', () => {
    for (const zoom of [0.25, 0.5, 1, 2, 5, 12, 40]) {
      const { pxPerFrame } = timelineMetrics({ duration: 120, viewportWidth: 1200, zoom, scrollLeft: 0, position: 0 });
      const step = majorStepFor(pxPerFrame);
      expect(step * pxPerFrame).toBeGreaterThanOrEqual(56);
    }
  });

  it('keeps the tick density sane when zoomed far out', () => {
    // a 120 frame animation squeezed into ~12px: only the origin survives
    const tiny = timelineTicks(120, 0.1);
    expect(tiny.length).toBeLessThanOrEqual(2);

    const normal = timelineTicks(54, 25);
    expect(normal.length).toBeGreaterThan(5);
    expect(normal.some((tick) => !tick.major)).toBe(true);
    expect(normal[0].frame).toBe(0);

    // consecutive ticks are never closer than the 3px floor
    for (let i = 1; i < normal.length; i++) {
      expect((normal[i].frame - normal[i - 1].frame) * 25).toBeGreaterThanOrEqual(3);
    }
  });

  it('bounds the element count for a very long animation', () => {
    const ticks = timelineTicks(100000, 4, 500);
    expect(ticks.length).toBeLessThanOrEqual(500);
  });
});

describe('pointer ↔ frame mapping', () => {
  it('accounts for the horizontal scroll offset', () => {
    const frame = frameAtPointer({ clientX: 500, lanesLeft: 300, scrollLeft: 200, pxPerFrame: 25, duration: 54 });
    expect(frame).toBeCloseTo(16, 6);
  });

  it('clamps outside the animation', () => {
    expect(frameAtPointer({ clientX: 0, lanesLeft: 300, scrollLeft: 0, pxPerFrame: 25, duration: 54 })).toBe(0);
    expect(frameAtPointer({ clientX: 9000, lanesLeft: 300, scrollLeft: 0, pxPerFrame: 25, duration: 54 })).toBe(54);
  });

  it('keeps the cursor frame anchored when zooming', () => {
    const before = timelineMetrics({ duration: 54, viewportWidth: 1000, zoom: 1, scrollLeft: 0, position: 0 });
    const frame = frameAtPointer({ clientX: 800, lanesLeft: 300, scrollLeft: 0, pxPerFrame: before.pxPerFrame, duration: 54 });
    const after = timelineMetrics({ duration: 54, viewportWidth: 1000, zoom: 2, scrollLeft: 0, position: 0 });
    const scroll = scrollForAnchoredZoom({
      frame, clientX: 800, lanesLeft: 300, pxPerFrame: after.pxPerFrame, duration: 54, viewportWidth: 1000,
    });
    const anchored = timelineMetrics({ duration: 54, viewportWidth: 1000, zoom: 2, scrollLeft: scroll, position: frame });
    expect(anchored.playheadPx).toBeCloseTo(500, 3);
    expect(scroll).toBeGreaterThanOrEqual(0);
  });
});
