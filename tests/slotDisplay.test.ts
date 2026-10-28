/** 显示对象的增删（官方 MenuItem-pasteDisplay / deleteDisplay）。 */
import { describe, expect, it } from 'vitest';
import { Player } from '../src/core/player';
import { appendSlotDisplay, removeSlotDisplay, slotData } from '../src/core/slotEdit';

function makeDoc() {
  return {
    name: 'slotDisplayTest',
    version: '5.5',
    compatibleVersion: '5.5',
    frameRate: 24,
    armature: [{
      name: 'A',
      type: 'armature',
      frameRate: 24,
      aabb: { x: 0, y: 0, width: 100, height: 100 },
      bone: [{ name: 'root' }],
      slot: [{ name: 'art', parent: 'root', displayIndex: 0 }],
      skin: [{ name: 'default', slot: [{ name: 'art', display: [{ type: 'image', name: 'art', path: 'art' }] }] }],
      animation: [],
    }],
  };
}

const TEXTURE = {
  name: 'tex', imagePath: 'tex.png', width: 16, height: 16,
  SubTexture: [{ name: 'art', x: 0, y: 0, width: 16, height: 16 }],
};

const makePlayer = () => new Player(JSON.parse(JSON.stringify(makeDoc())), JSON.parse(JSON.stringify(TEXTURE)) as never);
const displays = (player: Player) => player.skeleton.armature.skin[0].slot[0].display;

describe('显示对象的增删（官方 pasteDisplay / deleteDisplay）', () => {
  it('appends a display copy', () => {
    const player = makePlayer();
    expect(displays(player).length).toBe(1);
    expect(appendSlotDisplay(player, 'art', { type: 'image', name: 'art2', path: 'art2' })).toBe(true);
    expect(displays(player).length).toBe(2);
    expect(displays(player)[1].path).toBe('art2');
  });

  it('removes the current display and clamps displayIndex', () => {
    const player = makePlayer();
    appendSlotDisplay(player, 'art', { type: 'image', name: 'b', path: 'b' });
    appendSlotDisplay(player, 'art', { type: 'image', name: 'c', path: 'c' });
    slotData(player.skeleton.armature, 'art')!.displayIndex = 2;
    expect(removeSlotDisplay(player, 'art')).toBe(true);
    expect(displays(player).map((d) => d.path)).toEqual(['art', 'b']);
    expect(slotData(player.skeleton.armature, 'art')!.displayIndex).toBe(1);
  });

  it('refuses to remove the last display', () => {
    const player = makePlayer();
    expect(removeSlotDisplay(player, 'art')).toBe(false);
    expect(displays(player).length).toBe(1);
  });

  it('returns false for unknown slots and null players', () => {
    expect(removeSlotDisplay(makePlayer(), 'nope')).toBe(false);
    expect(appendSlotDisplay(null, 'art', { type: 'image' })).toBe(false);
  });
});