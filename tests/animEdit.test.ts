/**
 * 动画面板 (official 动画 panel): 添加 / 克隆 / 删除.
 *
 * The vendor's panel keeps the armature playable at all times — a new animation is
 * empty, a clone is an independent deep copy, and the last animation cannot be
 * deleted. These assertions pin that contract so the panel can't regress.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Player } from '../src/core/player';
import {
  addAnimation, animationNames, cloneAnimation, removeAnimation, reorderAnimation, setAnimationDuration, uniqueAnimationName,
} from '../src/core/animEdit';

const SAMPLES = process.env.BONESTUDIO_SAMPLES
  ?? 'samples';
const readJson = (path: string): unknown => JSON.parse(readFileSync(join(SAMPLES, path), 'utf8'));

function makePlayer(): Player {
  const player = new Player(readJson('Rooster_Ani/Rooster_An_ske.json'), readJson('Rooster_Ani/Rooster_An_tex.json') as never);
  player.setAnimation(player.animationNames()[0]);
  return player;
}

const entryFor = (player: Player, name: string) =>
  (player.skeleton.armature.animation ?? []).find((entry) => entry.name === name)!;

describe('动画面板 operations', () => {
  it('lists the animations the armature declares', () => {
    const player = makePlayer();
    expect(animationNames(player)).toEqual(player.animationNames());
    expect(animationNames(player).length).toBeGreaterThan(1);
    expect(animationNames(null)).toEqual([]);
  });

  it('adds an empty animation and de-duplicates the name', () => {
    const player = makePlayer();
    const before = animationNames(player).length;
    expect(addAnimation(player, 'Blink')).toBe('Blink');
    expect(addAnimation(player, 'Blink')).toBe('Blink_1');
    expect(animationNames(player).length).toBe(before + 2);
    const added = entryFor(player, 'Blink');
    expect(added.bone ?? []).toEqual([]);
    expect(added.slot ?? []).toEqual([]);
    expect(added.duration).toBe(40);
    expect(added.playTimes).toBe(1);
    expect(addAnimation(null, 'x')).toBeNull();
  });

  it('resolves duplicate animation names', () => {
    const player = makePlayer();
    const existing = animationNames(player)[0];
    expect(uniqueAnimationName(player, 'BrandNew')).toBe('BrandNew');
    expect(uniqueAnimationName(player, existing)).toBe(`${existing}_1`);
    expect(uniqueAnimationName(null, 'x')).toBe('x');
  });

  it('clones an animation as an independent deep copy', () => {
    const player = makePlayer();
    const source = player.animationNames()[0];
    const original = JSON.stringify(entryFor(player, source));
    const copy = cloneAnimation(player, source);
    expect(copy).toBe(`${source}_copy`);
    expect(JSON.stringify(entryFor(player, copy!))).toBe(original.replace(`"name":"${source}"`, `"name":"${copy}"`));
    const cloned = entryFor(player, copy!);
    if (cloned.bone && cloned.bone.length > 0 && cloned.bone[0].frame && cloned.bone[0].frame.length > 0) {
      cloned.bone[0].frame[0].duration = 999;
      expect(entryFor(player, source).bone?.[0].frame?.[0].duration).not.toBe(999);
    }
    expect(cloneAnimation(player, 'does-not-exist')).toBeNull();
    expect(cloneAnimation(null, source)).toBeNull();
  });

  it('never deletes the last animation', () => {
    const player = makePlayer();
    for (const name of [...player.animationNames()]) {
      if (player.animationNames().length > 1) expect(removeAnimation(player, name)).toBe(true);
    }
    expect(animationNames(player).length).toBe(1);
    const survivor = animationNames(player)[0];
    expect(removeAnimation(player, survivor)).toBe(false);
    expect(animationNames(player)).toEqual([survivor]);
    expect(removeAnimation(player, 'missing')).toBe(false);
    expect(removeAnimation(null, survivor)).toBe(false);
  });

  it('reorders an animation and leaves its data in place', () => {
    const player = makePlayer();
    const names = animationNames(player);
    const moved = names[0];
    const payload = JSON.stringify(entryFor(player, moved));
    expect(reorderAnimation(player, moved, names.length - 1)).toBe(true);
    expect(animationNames(player).at(-1)).toBe(moved);
    expect(animationNames(player).slice(0, -1)).toEqual(names.slice(1));
    expect(JSON.stringify(entryFor(player, moved))).toBe(payload);
    expect(reorderAnimation(player, moved, names.length - 1)).toBe(false);
    expect(reorderAnimation(player, 'missing', 0)).toBe(false);
    expect(reorderAnimation(null, moved, 0)).toBe(false);
  });

  it('retargets an animation duration in place', () => {
    const player = makePlayer();
    const name = player.animationNames()[0];
    expect(setAnimationDuration(player, name, 12.6)).toBe(true);
    expect(entryFor(player, name).duration).toBe(13);
    expect(setAnimationDuration(player, name, 0)).toBe(false);
    expect(setAnimationDuration(player, name, Number.NaN)).toBe(false);
    expect(setAnimationDuration(player, 'missing', 10)).toBe(false);
  });
});
