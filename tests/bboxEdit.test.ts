import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { Player } from '../src/core/player';
import {
  addBoundingBoxPointOnEdge, addBoundingBoxSlot, boundingBoxOf, boundingBoxPoints,
  removeBoundingBoxPoint, writeBoundingBox,
} from '../src/core/bboxEdit';

const HOME = '.';
const SKELETON = `${HOME}/samples/Rooster_Ani/Rooster_An_ske.json`;
const TEXTURE = `${HOME}/samples/Rooster_Ani/Rooster_An_tex.json`;
const hasFixture = existsSync(SKELETON) && existsSync(TEXTURE);

function openPlayer(): Player {
  return new Player(JSON.parse(readFileSync(SKELETON, 'utf8')), JSON.parse(readFileSync(TEXTURE, 'utf8')));
}

describe.skipIf(!hasFixture)('边界框编辑（官方 BoundingBoxPanel）', () => {
  it('creates a bounding-box slot under the given bone', () => {
    const player = openPlayer();
    const bone = player.skeleton.armature.bone[0].name;
    const name = addBoundingBoxSlot(player, bone, 'hit');
    expect(name).toBe('hit');
    expect(player.skeleton.armature.slot.some((s) => s.name === 'hit')).toBe(true);
    const display = boundingBoxOf(player.skeleton.armature, 'hit')!;
    expect(display.type).toBe('boundingBox');
    expect(boundingBoxPoints(display)).toEqual([]);
    // 挂在正确的骨骼下
    expect(player.skeleton.armature.slot.find((s) => s.name === 'hit')!.parent).toBe(bone);
  });

  it('writes, adds a midpoint and removes points', () => {
    const player = openPlayer();
    const armature = player.skeleton.armature;
    const name = addBoundingBoxSlot(player, armature.bone[0].name)!;
    // 重新画：一个 10×10 的正方形
    expect(writeBoundingBox(armature, name, [0, 0, 10, 0, 10, 10, 0, 10])).toBe(true);
    expect(boundingBoxPoints(boundingBoxOf(armature, name))).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]]);

    // 添加点：在 (0,0) → (10,0) 的中点插一个
    expect(addBoundingBoxPointOnEdge(armature, name, 0, 1)).toBe(true);
    const afterAdd = boundingBoxPoints(boundingBoxOf(armature, name));
    expect(afterAdd.length).toBe(5);
    expect(afterAdd[1]).toEqual([5, 0]);

    // 删除点：删掉刚加的那个
    expect(removeBoundingBoxPoint(armature, name, 1)).toBe(true);
    expect(boundingBoxPoints(boundingBoxOf(armature, name)).length).toBe(4);

    // 只剩 3 个点时不能再删
    writeBoundingBox(armature, name, [0, 0, 10, 0, 5, 10]);
    expect(removeBoundingBoxPoint(armature, name, 0)).toBe(false);
  });

  it('refuses to operate on slots without a bounding box', () => {
    const player = openPlayer();
    const armature = player.skeleton.armature;
    expect(boundingBoxOf(armature, '不存在的槽位')).toBeNull();
    expect(writeBoundingBox(armature, '不存在的槽位', [0, 0])).toBe(false);
    // 样例里的图片槽位不是边界框
    const imageSlot = armature.slot.find((s) => s.name === 'beak_lower')?.name;
    if (imageSlot) {
      expect(boundingBoxOf(armature, imageSlot)).toBeNull();
      expect(addBoundingBoxPointOnEdge(armature, imageSlot, 0, 1)).toBe(false);
    }
    expect(addBoundingBoxSlot(null, 'x')).toBeNull();
  });
});