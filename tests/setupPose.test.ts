/**
 * 骨架装配：不套动画。第 0 帧如果已经偏离绑定姿态，seek(0) 不够。
 */
import { describe, expect, it } from 'vitest';
import { Player } from '../src/core/player';
import { readBoneTransform, setBoneTransform } from '../src/core/editing';

const doc = {
  frameRate: 24,
  armature: [{
    name: 'a',
    bone: [{ name: 'root', transform: { x: 10 } }],
    slot: [{ name: 'body', parent: 'root', displayIndex: 0 }],
    skin: [{ name: '', slot: [] }],
    animation: [{
      duration: 10,
      name: 'idle',
      bone: [{ name: 'root', frame: [{ duration: 10, transform: { x: 30 } }] }],
      slot: [{ name: 'body', frame: [{ duration: 10, displayIndex: 1 }] }],
    }],
  }],
};

describe('setup pose', () => {
  it('drops the animation pose and keeps the animation data', () => {
    const player = new Player(doc);
    player.seek(0);
    expect(player.skeleton.bones[0].local[4]).toBe(40);
    expect(player.skeleton.slots[0].displayIndex).toBe(1);

    player.playing = true;
    player.setupPose = true;
    player.position = 0;
    player.applyPose();
    player.play();

    expect(player.playing).toBe(false);
    expect(player.skeleton.bones[0].local[4]).toBe(10);
    expect(player.skeleton.slots[0].displayIndex).toBe(0);
    expect(readBoneTransform(player, 'root')?.x).toBe(10);
    expect(player.animation?.bone?.[0].frame?.[0].transform?.x).toBe(30);

    player.renderItems();
    expect(player.skeleton.bones[0].local[4]).toBe(10);

    player.setupPose = false;
    player.applyPose();
    expect(player.skeleton.bones[0].local[4]).toBe(40);
    expect(player.skeleton.slots[0].displayIndex).toBe(1);
  });

  it('writes the bind transform while the animation is cleared', () => {
    const player = new Player(doc);
    player.setupPose = true;
    player.applyPose();
    expect(setBoneTransform(player, 'root', 0, { x: 12 })).toBe(true);
    player.applyPose();
    expect(player.skeleton.armature.bone[0].transform?.x).toBe(12);
    expect(player.skeleton.bones[0].local[4]).toBe(12);
    expect(player.animation?.bone?.[0].frame?.[0].transform?.x).toBe(30);
  });
});
