/** 「分布到关键帧」（官方 MenuItem-distributeToFrames）：首尾不动，中间的等间隔铺开。 */
import { describe, expect, it } from 'vitest';
import { Player } from '../src/core/player';
import { distributeKeys } from '../src/core/keyEdit';
import { keyFrames } from '../src/core/editing';

function makeDoc(frames: number[]) {
  const boneFrames = frames.map((at, index) => ({
    duration: (frames[index + 1] ?? at + 10) - at,
    x: 0,
    y: 0,
  }));
  return {
    name: 'distributeTest',
    version: '5.5',
    compatibleVersion: '5.5',
    frameRate: 24,
    armature: [{
      name: 'A',
      type: 'armature',
      frameRate: 24,
      aabb: { x: 0, y: 0, width: 10, height: 10 },
      bone: [{ name: 'root' }, { name: 'arm', parent: 'root' }],
      slot: [],
      skin: [],
      animation: [{ name: 'anim', duration: 40, bone: [{ name: 'arm', frame: boneFrames }] }],
    }],
  };
}

const TEXTURE = { name: 't', imagePath: 't.png', width: 1, height: 1, SubTexture: [] };
const makePlayer = (frames: number[]) => new Player(JSON.parse(JSON.stringify(makeDoc(frames))), JSON.parse(JSON.stringify(TEXTURE)) as never);
const positions = (player: Player) => keyFrames(player, 'arm').map((k) => k.frame);
const selectAll = (player: Player) => keyFrames(player, 'arm').map((k) => ({ bone: 'arm', frame: k.frame }));

describe('分布到关键帧（官方 MenuItem-distributeToFrames）', () => {
  it('evens out the middle keys between the first and the last', () => {
    const player = makePlayer([0, 12, 20, 30]);
    expect(positions(player)).toEqual([0, 12, 20, 30]);
    const moved = distributeKeys(player, selectAll(player));
    expect(moved).toBe(4);
    // 首尾 0 与 30 不动，中间铺成 10 与 20
    expect(positions(player)).toEqual([0, 10, 20, 30]);
  });

  it('leaves an already-even selection untouched', () => {
    const player = makePlayer([0, 10, 20, 30]);
    distributeKeys(player, selectAll(player));
    expect(positions(player)).toEqual([0, 10, 20, 30]);
  });

  it('does nothing when fewer than three keys are selected', () => {
    const player = makePlayer([0, 12, 30]);
    const selection = selectAll(player).slice(0, 2);
    expect(distributeKeys(player, selection)).toBe(0);
    expect(positions(player)).toEqual([0, 12, 30]);
  });
});