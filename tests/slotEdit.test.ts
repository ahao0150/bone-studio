/**
 * Slot editing kernel (M2) — the official `pose-slot.md` flows.
 *
 * Blend modes come from the shipped runtime's `BlendMode` enum, so these tests pin
 * the *ids*, the *string names* the JSON form uses, the Pixi mapping, and the fact
 * that slot edits keep skins / timelines / action frames consistent.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Player } from '../src/core/player';
import { serializeSkeletonData } from '../src/core/parse/ske';
import { encodeDbbin } from '../src/core/export/dbbin';
import { decodeDbbin } from '../src/core/parse/dbbinDecode';
import {
  BLEND_MODES, addSlot, blendModeIndex, blendModeLabel, blendModeName, blendModePixi,
  byteToChannel, channelToByte, colorKeyAt, isIdentityColor, readSlotColor, removeSlot, removeSlotColorKeyframe,
  renameSlot, setSlotBlendMode, setSlotColor, setSlotColorKeyframe, setSlotDisplayIndex, setSlotDisplayKeyframe,
  slotColorAt, slotData, slotNames, uniqueSlotName,
} from '../src/core/slotEdit';

const SAMPLES = process.env.BONESTUDIO_SAMPLES
  ?? 'samples';
const readJson = (path: string): unknown => JSON.parse(readFileSync(join(SAMPLES, path), 'utf8'));

function makePlayer(): Player {
  const player = new Player(readJson('Rooster_Ani/Rooster_An_ske.json'), readJson('Rooster_Ani/Rooster_An_tex.json') as never);
  player.setAnimation(player.animationNames()[0]);
  return player;
}

describe('blend modes (official BlendMode enum)', () => {
  it('keeps the shipped runtime ids', () => {
    expect(BLEND_MODES.map((m) => `${m.id}:${m.name}`)).toEqual([
      '0:normal', '1:add', '2:alpha', '3:darken', '4:difference', '5:erase', '6:hardlight',
      '7:invert', '8:layer', '9:lighten', '10:multiply', '11:overlay', '12:screen', '13:subtract',
    ]);
  });

  it('accepts both authoring forms', () => {
    // JSON form: string name; binary form: numeric id
    expect(blendModeIndex('add')).toBe(1);
    expect(blendModeIndex('Add')).toBe(1);
    expect(blendModeIndex(1)).toBe(1);
    expect(blendModeIndex('multiply')).toBe(10);
    expect(blendModeIndex(undefined)).toBe(0);
    expect(blendModeIndex('nope')).toBe(0);
    expect(blendModeIndex(999)).toBe(13);
    expect(blendModeIndex(-4)).toBe(0);
    expect(blendModeName(1)).toBe('add');
    expect(blendModeLabel('add')).toBe('叠加');
  });

  it('maps to the closest Pixi v8 mode', () => {
    expect(blendModePixi('add')).toBe('add');
    expect(blendModePixi('normal')).toBe('normal');
    expect(blendModePixi('multiply')).toBe('multiply');
    expect(blendModePixi('screen')).toBe('screen');
    expect(blendModePixi('hardlight')).toBe('hard-light');
    // modes with no Pixi equivalent must not throw / must not silently become add
    expect(blendModePixi('erase')).toBe('normal');
    expect(blendModePixi('layer')).toBe('normal');
  });
});

describe('slot edits', () => {
  it('lists slots and de-duplicates names', () => {
    const player = makePlayer();
    expect(slotNames(player.skeleton.armature).length).toBeGreaterThan(0);
    expect(slotNames(null)).toEqual([]);
    const existing = slotNames(player.skeleton.armature)[0];
    expect(uniqueSlotName(player.skeleton.armature, 'BrandNew')).toBe('BrandNew');
    expect(uniqueSlotName(player.skeleton.armature, existing)).toBe(`${existing}_1`);
  });

  it('creates an empty slot under a bone, in the armature and every skin', () => {
    const player = makePlayer();
    const bone = player.skeleton.armature.bone[0].name;
    const before = player.skeleton.armature.slot.length;
    const created = addSlot(player, bone, 'glow');
    expect(created).toBe('glow');
    expect(player.skeleton.armature.slot.length).toBe(before + 1);
    const entry = slotData(player.skeleton.armature, 'glow')!;
    expect(entry.parent).toBe(bone);
    expect(entry.displayIndex).toBe(-1);
    expect(entry.blendMode).toBe('normal');
    for (const skin of player.skeleton.armature.skin) {
      expect(skin.slot.some((s) => s.name === 'glow')).toBe(true);
    }
    expect(addSlot(player, 'no-such-bone', 'x')).toBeNull();
    expect(addSlot(null, bone)).toBeNull();
  });

  it('removes a slot together with its skin entry and timelines', () => {
    const player = makePlayer();
    const target = player.skeleton.armature.slot[0].name;
    expect(removeSlot(player, target)).toBe(true);
    expect(slotData(player.skeleton.armature, target)).toBeUndefined();
    for (const skin of player.skeleton.armature.skin) expect(skin.slot.some((s) => s.name === target)).toBe(false);
    for (const animation of player.skeleton.armature.animation ?? []) {
      expect((animation.slot ?? []).some((t) => t.name === target)).toBe(false);
    }
    expect(removeSlot(player, target)).toBe(false);
    expect(removeSlot(null, target)).toBe(false);
  });

  it('renames a slot everywhere it is referenced', () => {
    const player = makePlayer();
    const target = player.skeleton.armature.slot[0].name;
    expect(renameSlot(player, target, 'renamed')).toBe(true);
    expect(slotData(player.skeleton.armature, 'renamed')).toBeDefined();
    expect(slotData(player.skeleton.armature, target)).toBeUndefined();
    for (const skin of player.skeleton.armature.skin) {
      expect(skin.slot.some((s) => s.name === 'renamed')).toBe(true);
      expect(skin.slot.some((s) => s.name === target)).toBe(false);
    }
    // timeline names follow too (Rooster drives slot colour / display)
    for (const animation of player.skeleton.armature.animation ?? []) {
      for (const timeline of animation.slot ?? []) expect(timeline.name).not.toBe(target);
    }
    expect(renameSlot(player, 'renamed', '')).toBe(false);
    expect(renameSlot(player, 'renamed', 'renamed')).toBe(false);
    expect(renameSlot(player, 'missing', 'x')).toBe(false);
    // collisions are refused rather than silently merged
    const other = slotNames(player.skeleton.armature).find((n) => n !== 'renamed')!;
    expect(renameSlot(player, other, 'renamed')).toBe(false);
  });

  it('writes blend mode / display index / colour into the JSON form', () => {
    const player = makePlayer();
    const target = slotNames(player.skeleton.armature)[0];
    expect(setSlotBlendMode(player, target, 1)).toBe(true);
    expect(slotData(player.skeleton.armature, target)!.blendMode).toBe('add');
    expect(setSlotBlendMode(player, target, 1)).toBe(false);
    expect(setSlotBlendMode(player, 'missing', 1)).toBe(false);

    expect(setSlotDisplayIndex(player, target, 2)).toBe(true);
    expect(slotData(player.skeleton.armature, target)!.displayIndex).toBe(2);
    expect(setSlotDisplayIndex(player, target, 2)).toBe(false);
    expect(setSlotDisplayIndex(player, target, Number.NaN)).toBe(false);

    expect(isIdentityColor(readSlotColor(player, target))).toBe(true);
    expect(setSlotColor(player, target, { aM: 50, rM: 100, gM: 80, bM: 100 })).toBe(true);
    const color = readSlotColor(player, target)!;
    expect(color.aM).toBe(50);
    expect(color.gM).toBe(80);
    expect(color.rO).toBe(0);
    expect(isIdentityColor(color)).toBe(false);
    expect(setSlotColor(player, 'missing', { aM: 100 })).toBe(false);
    expect(readSlotColor(player, 'missing')).toBeNull();
  });

  it('keeps edits exportable (JSON round-trip)', () => {
    const player = makePlayer();
    const target = slotNames(player.skeleton.armature)[0];
    setSlotBlendMode(player, target, 'add');
    setSlotColor(player, target, { aM: 60, rM: 100, gM: 100, bM: 100 });
    // `serializeSkeletonData` writes `doc.raw` — the very object the skeleton edits
    const text = serializeSkeletonData(player.doc);
    expect(text).toContain('"blendMode":"add"');
    const parsed = JSON.parse(text) as { armature: Array<{ slot: Array<{ name: string; blendMode?: string; color?: { aM: number } }> }> };
    const written = parsed.armature[0].slot.find((s) => s.name === target)!;
    expect(written.blendMode).toBe('add');
    expect(written.color?.aM).toBe(60);
  });

  it('keeps edits through the .dbbin container as well', () => {
    const player = makePlayer();
    const target = slotNames(player.skeleton.armature)[0];
    setSlotBlendMode(player, target, 'add');
    const bytes = encodeDbbin({ armature: [player.skeleton.armature], frameRate: 24, name: 'slotRoundTrip' } as never);
    expect(bytes.length).toBeGreaterThan(0);
    const decoded = decodeDbbin(bytes);
    const armature = (decoded.json as { armature: Array<{ slot: Array<{ name: string; blendMode?: string }> }> }).armature[0];
    // the writer passes the authoring string through, matching the OSS Tools writer
    expect(armature.slot.find((s) => s.name === target)?.blendMode).toBe('add');
    // and the official parser accepts both forms
    expect(blendModeIndex('add')).toBe(blendModeIndex(1));
  });
});

describe('slot colour keyframes', () => {
  const red = { aM: 80, rM: 100, gM: 0, bM: 0, aO: 0, rO: 0, gO: 0, bO: 0 };

  function timelineOf(player: Player, name: string) {
    const animation = player.animation!;
    if (!animation.slot) animation.slot = [];
    let timeline = animation.slot.find((entry) => entry.name === name);
    if (!timeline) {
      timeline = { name, frame: [] };
      animation.slot.push(timeline);
    }
    timeline.displayFrame = undefined;
    timeline.colorFrame = undefined;
    return timeline;
  }

  it('maps multiply percent to bytes the same way as colorToTint', () => {
    expect(channelToByte(100)).toBe(255);
    expect(channelToByte(0)).toBe(0);
    expect(channelToByte(50)).toBe(128);
    expect(byteToChannel(255)).toBe(100);
    expect(byteToChannel(0)).toBe(0);
    expect(byteToChannel(128)).toBe(50);
  });

  it('splits a span so the new colour starts at the requested frame', () => {
    const player = makePlayer();
    const name = slotNames(player.skeleton.armature)[0];
    const timeline = timelineOf(player, name);
    timeline.frame = [{ duration: 10, color: { aM: 100, rM: 100, gM: 100, bM: 100 } }];
    expect(setSlotColorKeyframe(player, name, 4, red)).toBe(true);
    expect(timeline.frame?.map((frame) => frame.duration)).toEqual([4, 6]);
    expect(timeline.frame?.[0].color?.gM).toBe(100);
    expect(timeline.frame?.[1].color).toMatchObject({ aM: 80, gM: 0 });
    expect(timeline.frame?.[1].tweenEasing).toBe(0);
    expect(colorKeyAt(player, name, 0)).toBe(true);
    expect(colorKeyAt(player, name, 4)).toBe(true);
    expect(colorKeyAt(player, name, 2)).toBe(false);
    expect(slotColorAt(player, name, 4)?.gM).toBe(0);
    expect(slotColorAt(player, name, 0)?.aM).toBe(100);
  });

  it('updates a key on the same frame and refuses to insert when insert is false', () => {
    const player = makePlayer();
    const name = slotNames(player.skeleton.armature)[0];
    const timeline = timelineOf(player, name);
    timeline.frame = [];
    expect(setSlotColorKeyframe(player, name, 4, red, false)).toBe(false);
    expect(colorKeyAt(player, name, 4)).toBe(false);
    expect(setSlotColorKeyframe(player, name, 4, red)).toBe(true);
    const before = timeline.frame!.length;
    expect(setSlotColorKeyframe(player, name, 4, { ...red, aM: 10 })).toBe(true);
    expect(timeline.frame!.length).toBe(before);
    expect(slotColorAt(player, name, 4)?.aM).toBe(10);
    expect(colorKeyAt(player, name, 0)).toBe(false);
  });

  it('keeps displayIndex when the colour key is removed from a shared frame', () => {
    const player = makePlayer();
    const name = slotNames(player.skeleton.armature)[0];
    const timeline = timelineOf(player, name);
    timeline.frame = [];
    expect(setSlotDisplayKeyframe(player, name, 0, 2)).toBe(true);
    expect(setSlotColorKeyframe(player, name, 0, red)).toBe(true);
    expect(timeline.frame?.[0].displayIndex).toBe(2);
    expect(timeline.frame?.[0].color?.aM).toBe(80);
    expect(removeSlotColorKeyframe(player, name, 0)).toBe(true);
    expect(timeline.frame?.[0].displayIndex).toBe(2);
    expect(timeline.frame?.[0].color).toBeUndefined();
    expect(colorKeyAt(player, name, 0)).toBe(false);
  });

  it('drops a colour-only key and gives its duration to the neighbour', () => {
    const player = makePlayer();
    const name = slotNames(player.skeleton.armature)[0];
    const timeline = timelineOf(player, name);
    timeline.frame = [
      { duration: 4, color: { aM: 100, rM: 100, gM: 100, bM: 100 } },
      { duration: 6, color: red },
    ];
    expect(removeSlotColorKeyframe(player, name, 4)).toBe(true);
    expect(timeline.frame?.map((frame) => frame.duration)).toEqual([10]);
    expect(colorKeyAt(player, name, 4)).toBe(false);
  });

  it('writes colorFrame when the timeline is already in component form', () => {
    const player = makePlayer();
    const name = slotNames(player.skeleton.armature)[0];
    const timeline = timelineOf(player, name);
    timeline.frame = [{ duration: 8, displayIndex: 1, color: { aM: 1, rM: 1, gM: 1, bM: 1 } }];
    timeline.displayFrame = [{ duration: 8, value: 1 }];
    timeline.colorFrame = [{ duration: 8, value: { aM: 100, rM: 100, gM: 100, bM: 100 } }];
    expect(setSlotColorKeyframe(player, name, 3, red)).toBe(true);
    expect(timeline.frame?.[0].color?.aM).toBe(1);
    expect(timeline.colorFrame?.map((frame) => frame.duration)).toEqual([3, 5]);
    expect(timeline.colorFrame?.[1].value?.gM).toBe(0);
    expect(colorKeyAt(player, name, 3)).toBe(true);
    expect(slotColorAt(player, name, 3)?.aM).toBe(80);
    expect(removeSlotColorKeyframe(player, name, 3)).toBe(true);
    expect(colorKeyAt(player, name, 3)).toBe(false);
    expect(timeline.displayFrame?.[0].value).toBe(1);
  });
});
