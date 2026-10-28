/**
 * 复制 / 粘贴 / 选择性粘贴（官方 `MenuItem-copyBone` / `pasteBone` / `selectivePaste`）。
 * 选择性粘贴的两个开关就是官方对话框那两个勾选项：子骨骼、动画关键帧。
 */
import { describe, expect, it } from 'vitest';
import { Player } from '../src/core/player';
import { copyBoneSubtree, pasteBoneSubtree, subtreeBoneNames } from '../src/core/boneClipboard';

function makeDoc() {
  return {
    name: 'boneClipboardTest',
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
      animation: [{
        name: 'anim',
        duration: 5,
        bone: [{ name: 'arm', frame: [{ duration: 5, x: 0, y: 0 }] }],
        slot: [{ name: 'art', displayFrame: [{ duration: 5, value: 0 }] }],
      }],
    }],
  };
}

const TEXTURE = {
  name: 'tex', imagePath: 'tex.png', width: 16, height: 16,
  SubTexture: [{ name: 'art', x: 0, y: 0, width: 16, height: 16 }],
};

const makePlayer = () => new Player(JSON.parse(JSON.stringify(makeDoc())), JSON.parse(JSON.stringify(TEXTURE)) as never);
const armatureOf = (player: Player) => player.skeleton.armature;
const animOf = (player: Player) => (player.animation ?? null) as { bone?: Array<{ name: string }>; slot?: Array<{ name: string }> } | null;

describe('复制骨骼子树（官方 MenuItem-copyBone）', () => {
  it('collects the subtree bones, their slots and the current animation tracks', () => {
    const player = makePlayer();
    expect(subtreeBoneNames(armatureOf(player), 'torso')).toEqual(['torso', 'arm']);
    expect(subtreeBoneNames(armatureOf(player), 'nope')).toEqual([]);
    const clip = copyBoneSubtree(player, 'torso')!;
    expect(clip.root).toBe('torso');
    expect(clip.bones.map((b) => b.name)).toEqual(['torso', 'arm']);
    expect(clip.slots.map((s) => s.name)).toEqual(['art']);
    expect(clip.skinSlots.map((s) => s.name)).toEqual(['art']);
    expect(clip.boneTracks.map((t) => t.name)).toEqual(['arm']);
    expect(clip.slotTracks.map((t) => t.name)).toEqual(['art']);
  });
});

describe('粘贴 / 选择性粘贴（官方 MenuItem-pasteBone / selectivePaste）', () => {
  it('pastes the whole subtree below the target bone, tracks included', () => {
    const player = makePlayer();
    const clip = copyBoneSubtree(player, 'torso')!;
    const created = pasteBoneSubtree(player, 'root', clip);
    expect(created).toBe('torso_copy');
    const armature = armatureOf(player);
    expect(armature.bone.map((b) => b.name).sort()).toEqual(['arm', 'arm_copy', 'root', 'torso', 'torso_copy']);
    expect(armature.bone.find((b) => b.name === 'torso_copy')!.parent).toBe('root');
    expect(armature.bone.find((b) => b.name === 'arm_copy')!.parent).toBe('torso_copy');
    expect(armature.slot.find((s) => s.name === 'art_copy')?.parent).toBe('arm_copy');
    const anim = animOf(player)!;
    expect(anim.bone?.map((t) => t.name).sort()).toEqual(['arm', 'arm_copy']);
    expect(anim.slot?.map((t) => t.name).sort()).toEqual(['art', 'art_copy']);
  });

  it('「子骨骼」关掉时只粘根骨骼、不粘子树里的插槽', () => {
    const player = makePlayer();
    const clip = copyBoneSubtree(player, 'torso')!;
    const created = pasteBoneSubtree(player, 'root', clip, { children: false });
    expect(created).toBe('torso_copy');
    const armature = armatureOf(player);
    expect(armature.bone.map((b) => b.name).sort()).toEqual(['arm', 'root', 'torso', 'torso_copy']);
    expect(armature.slot.map((s) => s.name)).toEqual(['art']);
  });

  it('「动画关键帧」关掉时不追加轨道', () => {
    const player = makePlayer();
    const clip = copyBoneSubtree(player, 'torso')!;
    pasteBoneSubtree(player, 'root', clip, { keyFrames: false });
    const anim = animOf(player)!;
    expect(anim.bone?.map((t) => t.name)).toEqual(['arm']);
    expect(anim.slot?.map((t) => t.name)).toEqual(['art']);
  });

  it('returns null without a clipboard', () => {
    expect(pasteBoneSubtree(makePlayer(), 'root', null)).toBeNull();
    expect(copyBoneSubtree(makePlayer(), 'missing')).toBeNull();
  });
});