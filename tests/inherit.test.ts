/**
 * Bone inheritance flags — 官方 `BoneData.inherit*` 语义。
 *
 * 关键证据（2026-10-11 全语料普查，177 份 `*_ske.json`）：开关为“关”有两种写法——
 * 布尔 `false`（`inheritScale` 1298 次 / `inheritRotation` 100 次）**和数字 `0`**
 * （`inheritScale` 227 次 / `inheritRotation` 22 次）。只认 `false` 的实现会让这 249
 * 根骨骼静默继承父级，进而把整条子链的姿势带偏（Rooster 的 `foot_lt` 就是这么错的）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { composeInherited, inheritOn } from '../src/core/runtime/math';
import { Skeleton } from '../src/core/runtime/skeleton';

const SAMPLES = process.env.BONESTUDIO_SAMPLES
  ?? 'samples';
const readJson = (path: string): never => JSON.parse(readFileSync(join(SAMPLES, path), 'utf8')) as never;

const ROT90 = [0, 1, -1, 0, 0, 0] as unknown as import('../src/core/runtime/math').Mat2D;
const TRANSLATED = [1, 0, 0, 1, 10, 5] as unknown as import('../src/core/runtime/math').Mat2D;

describe('inherit flags', () => {
  it('treats both `false` and numeric 0 as "off"', () => {
    expect(inheritOn(false)).toBe(false);
    expect(inheritOn(0)).toBe(false);
    expect(inheritOn(true)).toBe(true);
    expect(inheritOn(1)).toBe(true);
    expect(inheritOn(undefined)).toBe(true);
  });

  it('composes identically for false and 0', () => {
    for (const flag of [false, 0] as const) {
      expect(Array.from(composeInherited(ROT90, TRANSLATED, { inheritRotation: flag })))
        .toEqual(Array.from(composeInherited(ROT90, TRANSLATED, { inheritRotation: false })));
    }
  });

  it('also accepts the string spellings the writer emits', () => {
    expect(inheritOn('false')).toBe(false);
    expect(inheritOn('0')).toBe(false);
    expect(inheritOn('true')).toBe(true);
    const world = composeInherited(ROT90, TRANSLATED, { inheritRotation: 'false' });
    expect(Math.atan2(world[1], world[0])).toBeCloseTo(0, 9);
  });

  it('does not inherit rotation when the flag is numeric 0', () => {
    // parent rotated 90°, child authored at 0° must stay at 0° in world space
    const world = composeInherited(ROT90, TRANSLATED, { inheritRotation: 0 });
    expect(Math.atan2(world[1], world[0])).toBeCloseTo(0, 9);
    // …while the default inherits it
    const inherited = composeInherited(ROT90, TRANSLATED, {});
    expect(Math.atan2(inherited[1], inherited[0])).toBeCloseTo(Math.PI / 2, 9);
  });

  it('keeps Rooster `foot_lt` at its own rotation (inheritRotation: 0 in the shipped data)', () => {
    const armature = (readJson('Rooster_Ani/Rooster_An_ske.json') as unknown as {
      armature: Array<{ bone: Array<{ name: string; inheritRotation?: number | boolean }>; animation: Array<{ name: string }> }>;
    }).armature[0];
    const foot = armature.bone.find((b) => b.name === 'foot_lt');
    expect(foot?.inheritRotation).toBe(0);
    const skeleton = new Skeleton(armature as never);
    skeleton.update(skeleton.getAnimation('rooster_idle_anim') as never, 0);
    const index = skeleton.boneIndexByName.get('foot_lt') ?? -1;
    expect(index).toBeGreaterThanOrEqual(0);
    const parent = skeleton.bones[index].parent;
    const parentAngle = Math.atan2(skeleton.bones[parent].world[1], skeleton.bones[parent].world[0]);
    const footAngle = Math.atan2(skeleton.bones[index].world[1], skeleton.bones[index].world[0]);
    // the parent is rotated well away from the bind orientation, the child is not
    expect(Math.abs(parentAngle)).toBeGreaterThan(0.2);
    expect(footAngle).toBeCloseTo((158 * Math.PI) / 180, 6);
  });
});
