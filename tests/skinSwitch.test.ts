import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { Player } from '../src/core/player';

const HOME = '.';
const SKELETON = `${HOME}/samples/out-new/Rooster_An_ske.json`;
const TEXTURE = `${HOME}/samples/out-new/Rooster_An_tex.json`;
const hasFixture = existsSync(SKELETON) && existsSync(TEXTURE);

/** 从官方 Rooster 样例派生一个两皮肤的文档（官方格式 `Armature.skin[]`）。 */
function multiSkinDoc(): unknown {
  const doc = JSON.parse(readFileSync(SKELETON, 'utf8'));
  const armature = doc.armature[0];
  const base = (armature.skin ?? [])[0] ?? { slot: [] };
  const alt = JSON.parse(JSON.stringify(base));
  alt.name = 'alt';
  armature.skin = [base, alt];
  return doc;
}

function openPlayer(): Player {
  return new Player(multiSkinDoc(), JSON.parse(readFileSync(TEXTURE, 'utf8')));
}

describe.skipIf(!hasFixture)('多皮肤切换（Armature.skin[]）', () => {
  it('lists the armature skins and marks the current one', () => {
    const player = openPlayer();
    const skins = player.skeleton.skins();
    expect(skins.length).toBe(2);
    expect(skins[0].current).toBe(true);
    expect(skins[1].name).toBe('alt');
    expect(skins[1].current).toBe(false);
  });

  it('swaps the display mapping without touching bones or the animation', () => {
    const player = openPlayer();
    const bonesBefore = player.skeleton.bones.map((bone) => bone.name);
    const animationBefore = player.animation?.name ?? null;
    // 把 alt 的图片全部换成别的区域，切换后渲染条目必须不同
    const regions = player.atlas!.regions.map((r) => r.name);
    const alt = player.skeleton.armature.skin![1];
    let n = 0;
    for (const slot of alt.slot) {
      for (const display of slot.display) {
        if (display.triangles || !display.name) continue;
        display.name = regions[n++ % regions.length];
        delete display.path;
      }
    }
    const before = player.renderItems().map((item) => item.region.name).join(',');
    expect(player.setSkin('alt')).toBe(true);
    expect(player.skeleton.skinName).toBe('alt');
    const after = player.renderItems().map((item) => item.region.name).join(',');
    expect(after).not.toBe(before);
    expect(player.skeleton.bones.map((bone) => bone.name)).toEqual(bonesBefore);
    expect(player.animation?.name ?? null).toBe(animationBefore);
  });

  it('keeps the chosen skin across rebuildSkeleton() and rejects unknown names', () => {
    const player = openPlayer();
    expect(player.setSkin('alt')).toBe(true);
    player.rebuildSkeleton();
    expect(player.skeleton.skinName).toBe('alt');
    expect(player.setSkin('不存在的皮肤')).toBe(false);
    expect(player.skeleton.skinName).toBe('alt');
    expect(player.setSkin('')).toBe(true);            // 空串 = 默认皮肤
    expect(player.skeleton.skinName ?? '').toBe('');
  });
});