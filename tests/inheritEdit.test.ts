/**
 * 「子骨骼可控」的编辑期实现（官方 `StageFilterBar` 第三列 / `_1844._2969`）。
 *
 * 判据：开关为假时，改父级的当前帧关键帧之后，把反算出来的子级值写回**同一帧**，
 * 直属子骨骼（及其子孙）的**世界矩阵必须保持不变**。
 */
import { describe, expect, it } from 'vitest';
import { Player } from '../src/core/player';
import { childLocalValues, displayOverridesFor, shouldFreezeChildren, snapshotChildWorlds, snapshotSlotWorlds } from '../src/core/inheritEdit';
import { matFromTransform, multiply } from '../src/core/runtime/math';
import { setBoneTransform } from '../src/core/editing';
import { boneWorldMatrix } from '../src/core/runtime/skeleton';

function makeDoc() {
  return {
    name: 'inheritTest',
    version: '5.5',
    compatibleVersion: '5.5',
    frameRate: 24,
    armature: [{
      name: 'A',
      type: 'armature',
      frameRate: 24,
      aabb: { x: 0, y: 0, width: 100, height: 100 },
      bone: [
        { name: 'root' },
        { name: 'torso', parent: 'root', transform: { x: 50, y: 60 } },
        { name: 'arm', parent: 'torso', transform: { x: 20, y: -10, skX: 30, skY: 30 } },
        { name: 'hand', parent: 'arm', transform: { x: 40, y: 0 } },
      ],
      slot: [{ name: 'art', parent: 'torso', displayIndex: 0 }],
      skin: [{ name: 'default', slot: [{ name: 'art', display: [{ name: 'art', type: 'image', transform: { x: 10, y: 5 } }] }] }],
      animation: [{
        name: 'anim',
        duration: 10,
        bone: [
          { name: 'torso', frame: [{ duration: 10, tweenEasing: 0 }] },
          { name: 'arm', frame: [{ duration: 10, tweenEasing: 0 }] },
        ],
      }],
    }],
  };
}

const TEXTURE = { name: 'tex', imagePath: 'tex.png', width: 16, height: 16, SubTexture: [] };
const makePlayer = () => new Player(JSON.parse(JSON.stringify(makeDoc())), JSON.parse(JSON.stringify(TEXTURE)) as never);
const world = (player: Player, name: string) => [...(boneWorldMatrix(player.skeleton, name) ?? [])];
const sameWorld = (a: number[], b: number[], eps = 1e-6) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < eps);

describe('子骨骼可控（官方 _1844._2969）', () => {
  it('默认（可控 = 真）：改父级时子骨骼跟着动', () => {
    const player = makePlayer();
    const before = world(player, 'arm');
    setBoneTransform(player, 'torso', 0, { x: 140, y: 60 });
    player.rebuildSkeleton();
    expect(sameWorld(before, world(player, 'arm'))).toBe(false);
    expect(shouldFreezeChildren(true)).toBe(false);
  });

  it('可控 = 假：把反算值写回同一帧后，子级与孙级的世界矩阵都不变', () => {
    const player = makePlayer();
    const snapshot = snapshotChildWorlds(player, 'torso');
    expect(snapshot.map((entry) => entry.name)).toEqual(['arm']);
    const armBefore = world(player, 'arm');
    const handBefore = world(player, 'hand');
    expect(shouldFreezeChildren(false)).toBe(true);

    setBoneTransform(player, 'torso', 0, { x: 140, y: 90 });
    player.rebuildSkeleton();
    expect(sameWorld(armBefore, world(player, 'arm'))).toBe(false);   // 先确认真的动了

    const values = childLocalValues(player, snapshot);
    expect(values.map((entry) => entry.name)).toEqual(['arm']);
    for (const child of values) setBoneTransform(player, child.name, 0, child.values);
    player.rebuildSkeleton();

    expect(sameWorld(armBefore, world(player, 'arm'))).toBe(true);
    expect(sameWorld(handBefore, world(player, 'hand'))).toBe(true);
  });

  it('没有子骨骼时快照为空、反算结果为空', () => {
    const player = makePlayer();
    const snapshot = snapshotChildWorlds(player, 'hand');
    expect(snapshot).toEqual([]);
    expect(childLocalValues(player, snapshot)).toEqual([]);
  });

  it('反算结果可复算：同一份快照连续取两次完全一致', () => {
    const player = makePlayer();
    const snapshot = snapshotChildWorlds(player, 'torso');
    setBoneTransform(player, 'torso', 0, { x: 140 });
    player.rebuildSkeleton();
    const a = childLocalValues(player, snapshot);
    const b = childLocalValues(player, snapshot);
    expect(a).toEqual(b);
  });
});
describe('子图片可控（官方 _1844._2968）：编辑期显示补偿', () => {
  /** 槽位的显示对象世界矩阵 = 槽位世界（父骨骼）× (补偿 × display.transform)。 */
  const displayWorld = (player: Player, slotName: string) => {
    const skeleton = player.skeleton;
    const slot = skeleton.slots.find((entry) => entry.name === slotName)!;
    const slotWorld = skeleton.bones[slot.parentBone].world;
    const display = skeleton.armature.skin[0].slot.find((entry) => entry.name === slotName)!.display[0];
    let matrix = matFromTransform(display.transform);
    const override = skeleton.displayOverrides.get(slotName);
    if (override) matrix = multiply(override, matrix);
    return [...multiply(slotWorld, matrix)];
  };

  it('不加补偿时图片跟着骨骼动；加上补偿后回到原来的世界位置', () => {
    const player = makePlayer();
    const before = displayWorld(player, 'art');
    const snapshot = snapshotSlotWorlds(player, 'torso');
    expect(snapshot.map((entry) => entry.slot)).toEqual(['art']);

    setBoneTransform(player, 'torso', 0, { x: 140, y: 90 });
    player.rebuildSkeleton();
    expect(sameWorld(before, displayWorld(player, 'art'))).toBe(false);   // 基线：真的跟着动了

    for (const entry of displayOverridesFor(player, snapshot)) {
      player.skeleton.setDisplayOverride(entry.slot, entry.matrix);
    }
    expect(sameWorld(before, displayWorld(player, 'art'))).toBe(true);    // 补偿后保持不变

    player.skeleton.setDisplayOverride('art', null);                      // 关掉补偿 = 恢复跟随
    expect(sameWorld(before, displayWorld(player, 'art'))).toBe(false);
  });

  it('没有槽位挂在该骨骼下时快照为空', () => {
    const player = makePlayer();
    expect(snapshotSlotWorlds(player, 'hand')).toEqual([]);
    expect(displayOverridesFor(player, [])).toEqual([]);
  });
});