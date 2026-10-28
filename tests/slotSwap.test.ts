import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { Player } from '../src/core/player';
import { swapDisplayImage } from '../src/core/slotEdit';

const HOME = '.';
const SKELETON = `${HOME}/samples/out-new/Rooster_An_ske.json`;
const TEXTURE = `${HOME}/samples/out-new/Rooster_An_tex.json`;
const hasFixture = existsSync(SKELETON) && existsSync(TEXTURE);

function openPlayer(): Player {
  const doc = JSON.parse(readFileSync(SKELETON, 'utf8'));
  const texture = JSON.parse(readFileSync(TEXTURE, 'utf8'));
  return new Player(doc, texture);
}

/** 样例里既有网格也有图片，挑一个真正的图片显示对象（带 name、没有三角形）。 */
function findImageDisplay(player: Player) {
  for (const skinSlot of player.skeleton.armature.skin[0].slot) {
    const index = skinSlot.display.findIndex((entry) => entry.name && !entry.triangles);
    if (index >= 0) return { skinSlot, index, display: skinSlot.display[index] };
  }
  throw new Error('fixture 里没有图片类型的显示对象');
}

describe.skipIf(!hasFixture)('替换图片（SwapImageWindow）', () => {
  it('swaps a display onto another atlas region and records it in `path`', () => {
    const player = openPlayer();
    const { skinSlot, index, display } = findImageDisplay(player);
    const target = player.atlas!.regions.map((r) => r.name).find((name) => name !== display.name)!;

    expect(swapDisplayImage(player, skinSlot.name, index, target)).toBe(true);
    expect(display.path).toBe(target);
    // 运行时确实还渲染得出来（渲染条目数不为 0）
    expect(player.skeleton.getRenderItems(player.atlas, player.animation, 0).length).toBeGreaterThan(0);
  });

  it('drops `path` again when swapping back to the display own name', () => {
    const player = openPlayer();
    const { skinSlot, index, display } = findImageDisplay(player);
    const other = player.atlas!.regions.map((r) => r.name).find((name) => name !== display.name)!;

    expect(swapDisplayImage(player, skinSlot.name, index, other)).toBe(true);
    expect(display.path).toBe(other);
    expect(swapDisplayImage(player, skinSlot.name, index, display.name!)).toBe(true);
    expect(display.path).toBeUndefined();
  });

  it('is a no-op for the same region and for unknown targets', () => {
    const player = openPlayer();
    const { skinSlot, index, display } = findImageDisplay(player);
    expect(swapDisplayImage(player, skinSlot.name, index, display.path ?? display.name!)).toBe(false);
    expect(swapDisplayImage(player, '不存在的槽位', index, 'x')).toBe(false);
    expect(swapDisplayImage(player, skinSlot.name, 999, 'x')).toBe(false);
    expect(swapDisplayImage(null, skinSlot.name, index, 'x')).toBe(false);
  });
});