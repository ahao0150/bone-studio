import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSkeletonData, skeletonSummary } from '../src/core/parse/ske';
import { parseSpineAtlas, parseTextureAtlas } from '../src/core/parse/texture';
import { frameProgress, getCurveEasingValue, resolveTween, TweenType } from '../src/core/runtime/animation';
import { Player } from '../src/core/player';

const SAMPLES = process.env.BONESTUDIO_SAMPLES
  ?? 'samples';

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(join(SAMPLES, path), 'utf8'));
}

const frames = {
  skeleton: readJson('FramesAnimation/FramesAnimation_ske.json'),
  texture: readJson('FramesAnimation/FramesAnimation_tex.json'),
};
const rooster = {
  skeleton: readJson('Rooster_Ani/Rooster_An_ske.json'),
  texture: readJson('Rooster_Ani/Rooster_An_tex.json'),
};

describe('skeleton parsing', () => {
  it('reads the frame-animation sample', () => {
    const doc = parseSkeletonData(frames.skeleton);
    expect(doc.armatures.length).toBeGreaterThan(0);
    const summary = skeletonSummary(doc);
    expect(summary[0].slots).toBe(1);
    expect(summary[0].type).toBe('sheet');
    // sheet projects export one armature per animation
    expect(doc.armatures.length).toBeGreaterThan(1);
    expect(summary[0].animations.length).toBe(1);
  });

  it('reads the weighted-mesh sample', () => {
    const doc = parseSkeletonData(rooster.skeleton);
    const armature = doc.armatures[0];
    expect(armature.bone.length).toBe(63);
    expect(armature.animation?.length).toBe(5);
    const mesh = armature.skin[0].slot
      .flatMap((slot) => slot.display)
      .find((display) => (display.type === 'mesh' || display.type === 2) && display.weights);
    expect(mesh).toBeTruthy();
    // weighted meshes encode [boneIndex, a, b, c, d, tx, ty] records
    expect((mesh!.bonePose!.length % 7)).toBe(0);
    expect(mesh!.slotPose!.length).toBe(6);
  });

  it('rejects documents without armatures', () => {
    expect(() => parseSkeletonData({})).toThrow();
  });
});

describe('texture atlases', () => {
  it('parses a DragonBones texture atlas', () => {
    const atlas = parseTextureAtlas(frames.texture as never);
    expect(atlas.regions.length).toBeGreaterThan(0);
    expect(atlas.imagePath.endsWith('.png')).toBe(true);
    expect(atlas.byName.get(atlas.regions[0].name)).toBeTruthy();
  });

  it('parses a Spine .atlas page', () => {
    const pages = parseSpineAtlas([
      'sheet.png',
      'size: 1024,1024',
      'format: RGBA8888',
      'filter: Linear,Linear',
      'repeat: none',
      'head',
      '  rotate: false',
      '  xy: 10, 20',
      '  size: 30, 40',
      '  orig: 32, 42',
      '  offset: 1, 2',
      '  index: -1',
    ].join('\n'));
    expect(pages).toHaveLength(1);
    expect(pages[0].width).toBe(1024);
    const region = pages[0].regions[0];
    expect(region).toMatchObject({ name: 'head', x: 10, y: 20, width: 30, height: 40, frameX: 1, frameY: 2 });
  });
});

describe('tween sampling', () => {
  it('maps JSON tweenEasing values onto DragonBones tween types', () => {
    expect(resolveTween({ tweenEasing: null }).type).toBe(TweenType.Line);
    expect(resolveTween({ tweenEasing: Number.NaN }).type).toBe(TweenType.None);
    expect(resolveTween({ tweenEasing: 0 })).toEqual({ type: TweenType.Line, easing: 0 });
    expect(resolveTween({ tweenEasing: -0.5 })).toEqual({ type: TweenType.QuadIn, easing: 0.5 });
    expect(resolveTween({ tweenEasing: 0.5 })).toEqual({ type: TweenType.QuadOut, easing: 0.5 });
    expect(resolveTween({ tweenEasing: 1.5 })).toEqual({ type: TweenType.QuadInOut, easing: 0.5 });
    expect(resolveTween({ curve: [0, 0, 0.5, 0, 1, 1] }).type).toBe(TweenType.Curve);
  });

  it('keeps stepped frames frozen and passes linear frames through', () => {
    expect(frameProgress({ duration: 10, tweenEasing: Number.NaN }, 0.5)).toBe(0);
    expect(frameProgress({ duration: 10, tweenEasing: 0 }, 0.25)).toBeCloseTo(0.25, 6);
  });

  it('evaluates a bezier easing curve monotonically', () => {
    const curve = [0, 0, 0.42, 0, 0.58, 1, 1, 1];
    const a = getCurveEasingValue(0.25, curve);
    const b = getCurveEasingValue(0.75, curve);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThanOrEqual(1.001);
  });
});

describe('player', () => {
  it('plays the frame animation and cycles display indices', () => {
    const player = new Player(frames.skeleton, frames.texture as never);
    const seen = new Set<number>();
    for (let f = 0; f < player.duration; f += 0.5) {
      player.seek(f);
      const index = player.skeleton.slots[0].displayIndex;
      seen.add(index ?? -1);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('produces finite geometry for the weighted mesh sample', () => {
    const player = new Player(rooster.skeleton, rooster.texture as never);
    player.setAnimation(player.skeleton.animationNames()[0]);
    for (const frame of [0, 3, 9, 17]) {
      player.seek(frame);
      const items = player.renderItems();
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.positions.length).toBeGreaterThan(0);
        for (const value of item.positions) expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  it('renders weighted meshes and deforms them between two poses', () => {
    const player = new Player(rooster.skeleton, rooster.texture as never);
    const headAt = (frame: number) => {
      player.seek(frame);
      return player.renderItems().find((item) => item.kind === 'mesh' && item.slot === 'head');
    };
    const headA = headAt(0);
    const headB = headAt(12);
    expect(headA).toBeTruthy();
    expect(headB).toBeTruthy();
    expect(headA!.kind).toBe('mesh');
    let maxDelta = 0;
    for (let i = 0; i < headA!.positions.length; i++) {
      maxDelta = Math.max(maxDelta, Math.abs(headA!.positions[i] - headB!.positions[i]));
    }
    expect(maxDelta).toBeGreaterThan(0.01);
  });

  it('exposes every armature of a sheet project as an animation entry', () => {
    const player = new Player(frames.skeleton, frames.texture as never);
    const names = player.animationNames();
    expect(names.length).toBe(player.doc.armatures.length);
    player.setAnimation(names[1]);
    expect(player.currentAnimationName()).toBe(names[1]);
    expect(player.skeleton.armature.name).toBe(names[1]);
  });

  it('exposes a bone tree rooted at the armature root', () => {
    const player = new Player(rooster.skeleton, rooster.texture as never);
    const tree = player.boneTree();
    expect(tree.length).toBe(63);
    expect(tree[0].name).toBe('root');
    expect(tree[0].depth).toBe(0);
  });
});

