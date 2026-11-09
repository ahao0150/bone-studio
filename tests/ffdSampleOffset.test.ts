/**
 * Regression test for FFD (mesh deform) sampling with non-zero frame offset.
 *
 * Bug: `sampleFfd` did not correctly handle the windowed data format used by
 * `*_ske.dbbin` decoded timelines. When `frame.offset > 0`, the deform values
 * are stored in a compact window and should be read as `frame.vertices[i - frame.offset]`,
 * but the old code used `frame.vertices[offset + i]` which reads the wrong indices.
 *
 * This caused mesh deformation to be completely wrong when the FFD timeline's
 * constant head (`axisHead`) was non-empty, leading to visible rendering errors.
 */
import { describe, expect, it } from 'vitest';
import { sampleFfd, locateFrame } from '../src/core/runtime/animation';
import type { DbFfdTimeline, DbFfdFrame } from '../src/core/types';

describe('sampleFfd windowed format handling', () => {
  it('reads values at correct indices when frame.offset > 0', () => {
    // Simulate a decoded dbbin FFD timeline with windowed data:
    // - Total axis length: 8 floats (4 vertices × 2 coords)
    // - Constant head: [0, 0] (first vertex never deforms)
    // - Window offset: 2 (deform starts at index 2)
    // - Window values: [10, 20, 30, 40] (vertices 1 and 2 deform)
    // - Constant tail: [0, 0] (last vertex never deforms)
    const timeline: DbFfdTimeline = {
      slot: 'test-slot',
      axisHead: [0, 0],
      axisTail: [0, 0],
      frame: [
        {
          duration: 10,
          offset: 2,
          vertices: [10, 20, 30, 40],
          tweenEasing: 0,
        },
      ],
    };

    // Sample at frame 0 - should get the deform values correctly positioned
    const result = sampleFfd(timeline, 0, 0, 8);
    expect(result).not.toBeNull();

    // Index 0, 1: should be from axisHead = [0, 0]
    expect(result![0]).toBe(0);
    expect(result![1]).toBe(0);

    // Index 2, 3, 4, 5: should be from frame.vertices = [10, 20, 30, 40]
    expect(result![2]).toBe(10);
    expect(result![3]).toBe(20);
    expect(result![4]).toBe(30);
    expect(result![5]).toBe(40);

    // Index 6, 7: should be from axisTail = [0, 0]
    expect(result![6]).toBe(0);
    expect(result![7]).toBe(0);
  });

  it('interpolates correctly between two windowed frames with different offsets', () => {
    // Two frames with different window positions
    const timeline: DbFfdTimeline = {
      slot: 'test-slot',
      axisHead: [0, 0],
      axisTail: [0, 0],
      frame: [
        {
          duration: 10,
          offset: 2,
          vertices: [10, 20, 30, 40],
          tweenEasing: 0,
        },
        {
          duration: 10,
          offset: 2,
          vertices: [20, 40, 60, 80],
          tweenEasing: 0,
        },
      ],
    };

    // Sample at frame 5 (50% progress)
    const result = sampleFfd(timeline, 5, 0, 8);
    expect(result).not.toBeNull();

    // Index 0, 1: still from axisHead
    expect(result![0]).toBe(0);
    expect(result![1]).toBe(0);

    // Index 2, 3, 4, 5: interpolated 50% between frames
    expect(result![2]).toBeCloseTo(15, 4);
    expect(result![3]).toBeCloseTo(30, 4);
    expect(result![4]).toBeCloseTo(45, 4);
    expect(result![5]).toBeCloseTo(60, 4);

    // Index 6, 7: still from axisTail
    expect(result![6]).toBe(0);
    expect(result![7]).toBe(0);
  });

  it('handles full-array format (JSON editor style) correctly', () => {
    // JSON editor style: vertices array uses absolute indices, no axisHead/axisTail
    const timeline: DbFfdTimeline = {
      slot: 'test-slot',
      frame: [
        {
          duration: 10,
          vertices: [1, 2, 3, 4, 5, 6, 7, 8],
          tweenEasing: 0,
        },
      ],
    };

    const result = sampleFfd(timeline, 0, 0, 8);
    expect(result).not.toBeNull();
    expect(Array.from(result!)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('returns zeros for indices outside the window with empty axisHead/axisTail', () => {
    // Window format but with empty constant regions
    const timeline: DbFfdTimeline = {
      slot: 'test-slot',
      axisHead: [],
      axisTail: [],
      frame: [
        {
          duration: 10,
          offset: 2,
          vertices: [10, 20],
          tweenEasing: 0,
        },
      ],
    };

    const result = sampleFfd(timeline, 0, 0, 6);
    expect(result).not.toBeNull();

    // Indices before window should be 0
    expect(result![0]).toBe(0);
    expect(result![1]).toBe(0);

    // Window values
    expect(result![2]).toBe(10);
    expect(result![3]).toBe(20);

    // Indices after window should be 0
    expect(result![4]).toBe(0);
    expect(result![5]).toBe(0);
  });
});

describe('locateFrame edge cases', () => {
  it('handles single-frame timeline at exact position', () => {
    const frames = [{ duration: 10, tweenEasing: 0 }];
    const loc = locateFrame(frames, 0);
    expect(loc).not.toBeNull();
    expect(loc!.index).toBe(0);
    expect(loc!.progress).toBe(0);
  });

  it('clamps progress to 0 at the last frame', () => {
    const frames = [
      { duration: 5, tweenEasing: 0 },
      { duration: 5, tweenEasing: 0 },
    ];
    // At position 5, we're at the start of frame 1
    const loc = locateFrame(frames, 5);
    expect(loc).not.toBeNull();
    expect(loc!.index).toBe(1);
    expect(loc!.progress).toBe(0);
  });
});
