import { describe, expect, it } from 'vitest';
import { onionFrames } from '../src/ui/onionSkin';

describe('onion skin frames', () => {
  it('returns the neighbours in the middle of the timeline', () => {
    expect(onionFrames(10, 40)).toEqual({ prev: 9, next: 11 });
  });

  it('wraps at both ends, because armature animations loop by default', () => {
    expect(onionFrames(0, 40)).toEqual({ prev: 39, next: 1 });
    expect(onionFrames(39, 40)).toEqual({ prev: 38, next: 0 });
  });

  it('clamps positions outside the timeline', () => {
    expect(onionFrames(-5, 40)).toEqual({ prev: 39, next: 1 });
    expect(onionFrames(999, 40)).toEqual({ prev: 38, next: 0 });
  });

  it('returns null when there is nothing to compare against', () => {
    expect(onionFrames(0, 0)).toBeNull();
    expect(onionFrames(0, Number.NaN)).toBeNull();
    expect(onionFrames(0, -3)).toBeNull();
  });

  it('keeps a single-frame animation pointing at itself', () => {
    expect(onionFrames(0, 1)).toEqual({ prev: 0, next: 0 });
  });
});