/**
 * Action-frame dispatch: stepped markers fire when the playhead enters their
 * span, and `Play` actions switch animation (official ActionType semantics).
 */
import { describe, expect, it } from 'vitest';
import { Player } from '../src/core/player';

const makeDoc = () => ({
  version: '5.5',
  name: 'action-fixture',
  frameRate: 24,
  armature: [{
    name: 'a',
    frameRate: 24,
    bone: [{ name: 'root' }],
    slot: [],
    skin: [{ name: '', slot: [] }],
    animation: [
      { name: 'idle', duration: 24, frame: [{ duration: 10 }, { duration: 14, actions: [{ type: 0, name: 'walk' }] }] },
      { name: 'walk', duration: 24, frame: [{ duration: 24, actions: [{ type: 11, name: 'step' }] }] },
    ],
  }],
});

describe('action frame dispatch', () => {
  it('fires when the playhead enters the marker span', () => {
    const seen: unknown[] = [];
    const player = new Player(makeDoc(), null, { onAction: (action) => seen.push(action) });
    player.setAnimation('idle');
    seen.length = 0;
    player.seek(5);
    expect(seen.length).toBe(0);
    player.seek(12);
    expect(seen.length).toBe(1);
    // Play action switched the animation
    expect(player.currentAnimationName()).toBe('walk');
  });

  it('does not re-fire when the playhead stays inside the span', () => {
    const seen: unknown[] = [];
    const player = new Player(makeDoc(), null, { onAction: (action) => seen.push(action) });
    player.setAnimation('idle');
    seen.length = 0;
    player.seek(12);
    const afterFirst = seen.length;
    player.seek(13);
    player.seek(14);
    expect(seen.length).toBe(afterFirst);
  });

  it('supports the 4.x gotoAndPlay spelling', () => {
    const doc = makeDoc() as { armature: Array<{ animation: Array<{ frame?: unknown[] }> }> };
    doc.armature[0].animation[0].frame = [{ duration: 10 }, { duration: 14, actions: [{ gotoAndPlay: 'walk' }] }];
    const player = new Player(doc, null, {});
    player.setAnimation('idle');
    player.seek(11);
    expect(player.currentAnimationName()).toBe('walk');
  });

  it('fires while stepping through the marker', () => {
    const seen: unknown[] = [];
    const player = new Player(makeDoc(), null, { onAction: (action) => seen.push(action) });
    player.setAnimation('idle');
    seen.length = 0;
    player.play();
    for (let i = 0; i < 20; i++) player.step(1 / 24);
    expect(seen.length).toBeGreaterThanOrEqual(1);
  });
});
