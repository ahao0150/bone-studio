/**
 * 「克隆」（官方 `MenuItem-duplicate`）：把一根骨骼连同它的子树、子树上的插槽、
 * 以及插槽的显示对象整份深拷贝，挂回原骨骼的父级下。
 */
import { describe, expect, it } from 'vitest';
import { Player } from '../src/core/player';
import { cloneBone } from '../src/core/boneEdit';

function makeDoc() {
  return {
    name: 'boneCloneTest',
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
        { name: 'torso', parent: 'root', transform: { x: 50, y: 60 }, length: 40 },
        { name: 'arm', parent: 'torso', transform: { x: 20, y: -10 }, length: 30 },
      ],
      slot: [{ name: 'art', parent: 'arm' }],
      skin: [{ name: 'default', slot: [{ name: 'art', display: [{ type: 'image', name: 'art', path: 'art' }] }] }],
      animation: [{ name: 'anim', duration: 5, bone: [{ name: 'arm', frame: [{ duration: 5, x: 0, y: 0 }] }] }],
    }],
  };
}

const TEXTURE = {
  name: 'tex', imagePath: 'tex.png', width: 16, height: 16,
  SubTexture: [{ name: 'art', x: 0, y: 0, width: 16, height: 16 }],
};

const makePlayer = () => new Player(JSON.parse(JSON.stringify(makeDoc())), JSON.parse(JSON.stringify(TEXTURE)) as never);
const armatureOf = (player: Player) => player.skeleton.armature;

describe('克隆骨骼（官方 MenuItem-duplicate）', () => {
  it('clones the whole subtree below the original parent', () => {
    const player = makePlayer();
    const created = cloneBone(player, 'torso');
    expect(created).toBe('torso_copy');
    const armature = armatureOf(player);
    expect(armature.bone.map((b) => b.name).sort()).toEqual(['arm', 'arm_copy', 'root', 'torso', 'torso_copy']);
    expect(armature.bone.find((b) => b.name === 'torso_copy')!.parent).toBe('root');
    expect(armature.bone.find((b) => b.name === 'arm_copy')!.parent).toBe('torso_copy');
    expect(player.skeleton.boneIndexByName.has('torso_copy')).toBe(true);
  });

  it('clones the slots and their displays so the copy is independent', () => {
    const player = makePlayer();
    cloneBone(player, 'torso');
    const armature = armatureOf(player);
    expect(armature.slot.find((s) => s.name === 'art_copy')?.parent).toBe('arm_copy');
    const skin = armature.skin[0];
    expect(skin.slot.find((s) => s.name === 'art_copy')?.display?.[0]?.path).toBe('art');
    // 深拷贝：改原来的显示对象不该动到克隆那份
    skin.slot.find((s) => s.name === 'art')!.display[0].path = 'changed';
    expect(skin.slot.find((s) => s.name === 'art_copy')!.display[0].path).toBe('art');
  });

  it('cloning a leaf adds exactly one bone and keeps its parent', () => {
    const player = makePlayer();
    const created = cloneBone(player, 'arm');
    expect(created).toBe('arm_copy');
    const armature = armatureOf(player);
    expect(armature.bone.length).toBe(4);
    expect(armature.bone.find((b) => b.name === 'arm_copy')!.parent).toBe('torso');
    expect(player.skeleton.bones.length).toBe(4);
  });

  it('returns null for an unknown bone', () => {
    expect(cloneBone(makePlayer(), 'nope')).toBeNull();
  });
});