/**
 * 「相关 / 无关 / 其他」这三条定义（官方 MenuItem-hideOthers / hideIrrelevant / hideRelated 一组）。
 */
import { describe, expect, it } from 'vitest';
import { relatedBoneNames } from '../src/core/boneEdit';
import type { DbArmatureData } from '../src/core/types';

function makeArmature(): DbArmatureData {
  return {
    name: 'A',
    bone: [
      { name: 'root' },
      { name: 'torso', parent: 'root' },
      { name: 'arm', parent: 'torso' },
      { name: 'hand', parent: 'arm' },
      { name: 'leg', parent: 'root' },
    ],
    slot: [],
    skin: [],
  };
}

describe('相关骨骼（官方 lockRelated / hideRelated）', () => {
  it('is the bone itself plus its ancestors and its whole subtree', () => {
    const armature = makeArmature();
    expect(relatedBoneNames(armature, 'arm').sort()).toEqual(['arm', 'hand', 'root', 'torso']);
    expect(relatedBoneNames(armature, 'torso').sort()).toEqual(['arm', 'hand', 'root', 'torso']);
  });

  it('a leaf is just itself plus its ancestors', () => {
    expect(relatedBoneNames(makeArmature(), 'hand').sort()).toEqual(['arm', 'hand', 'root', 'torso']);
  });

  it('the root is related to everything', () => {
    expect(relatedBoneNames(makeArmature(), 'root').sort()).toEqual(['arm', 'hand', 'leg', 'root', 'torso']);
  });

  it('an unknown bone has no relation', () => {
    expect(relatedBoneNames(makeArmature(), 'nope')).toEqual([]);
  });

  it('does not loop forever on a parent cycle', () => {
    const armature = makeArmature();
    armature.bone = [{ name: 'a', parent: 'b' }, { name: 'b', parent: 'a' }];
    expect(relatedBoneNames(armature, 'a').sort()).toEqual(['a', 'b']);
  });
});