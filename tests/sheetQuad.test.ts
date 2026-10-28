/**
 * 修剪图集的帧定位（spec §103）。
 *
 * 官方 `Slot._updateDisplayData`（dragonBones57.js:5735-5748）算的是
 * `_pivotX = pivot.x * frameWidth + frameX`，渲染器再把它当 `anchorOffsetX`（16065），
 * 所以顶点局部原点是 **`-pivot`** —— `frameX/frameY` 是**加**上去的。
 *
 * 下面 k = displayIndex 的期望值不是本地复算出来的：它们是官方运行时在
 * `FramesAnimation` 上逐 display 实测的 `_pivotX/_pivotY`
 * （`docs/evidence/closure-oracle.json` 的 `samples.sheet.officialSlots`，
 * 由 `tools/closure-oracle.ts` 的 `slotmode=indices` 探针采集）。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Player } from '../src/core/player';
import { displayPivotOffset } from '../src/core/runtime/skeleton';
import { slotCenterLocal } from '../src/core/slotPose';
import type { DbDisplayData } from '../src/core/types';
import type { TextureRegion } from '../src/core/parse/texture';

const SAMPLES = process.env.BONESTUDIO_SAMPLES
  ?? 'samples';
const SHEET = join(SAMPLES, 'FramesAnimation');
const ROOSTER = join(SAMPLES, 'Rooster_Ani');

function player(dir: string, stem: string, armature?: string): Player {
  const skeleton = JSON.parse(readFileSync(join(dir, `${stem}_ske.json`), 'utf8'));
  const texture = JSON.parse(readFileSync(join(dir, `${stem}_tex.json`), 'utf8'));
  const created = new Player(skeleton, texture);
  if (armature) created.setArmature(armature);
  created.setAnimation(created.animationNames()[0]);
  return created;
}

/** 当前 display 与其图集区域。 */
function current(instance: Player, index?: number): { display: DbDisplayData; region: TextureRegion } {
  const slot = instance.skeleton.slots[0];
  const display = instance.skeleton.skinSlots.get(slot.name)!.display![index ?? slot.displayIndex];
  return { display, region: instance.atlas!.byName.get(display.path ?? display.name!)! };
}

/** 渲染出来的 quad 左上角（`root` 骨骼是恒等，所以局部 = 舞台）。 */
function quadOrigin(instance: Player): [number, number] {
  const items = instance.skeleton.getRenderItems(instance.atlas, instance.animation, 0);
  expect(items).toHaveLength(1);
  const positions = items[0].positions;
  return [positions[0], positions[1]];
}

describe('修剪图集的帧定位：frameX/frameY 是加不是减（spec §103）', () => {
  const hasSheet = existsSync(join(SHEET, 'FramesAnimation_ske.json'));
  const hasRooster = existsSync(join(ROOSTER, 'Rooster_An_ske.json'));

  describe.skipIf(!hasSheet)('FramesAnimation（官方样例，58/58 个 SubTexture 都带修剪）', () => {
    // 官方 `_pivotX/_pivotY`，逐 displayIndex（`frameWidth = frameHeight = 150`，pivot 缺省 0.5）：
    //   k=0 4_fall_0 frameX -27 frameY -42 → 48 / 33
    //   k=3 4_fall_3 frameX -18 frameY -33 → 57 / 42
    //   k=6 4_fall_6 frameX -18 frameY -81 → 57 / -6   ← 与「减法」差 162px
    const OFFICIAL: Array<[number, number]> = [
      [48, 33], [51, 27], [63, 39], [57, 42], [57, 45], [57, 48], [57, -6],
    ];

    it('pivot 与官方运行时逐 display 一致', () => {
      const instance = player(SHEET, 'FramesAnimation', 'boy-fall');
      OFFICIAL.forEach(([x, y], k) => {
        const { display, region } = current(instance, k);
        const pivot = displayPivotOffset(display, region);
        expect(pivot.x).toBeCloseTo(x, 6);
        expect(pivot.y).toBeCloseTo(y, 6);
      });
    });

    it('渲染路径直接使用同一个 pivot（quad 左上角 = -pivot）', () => {
      const instance = player(SHEET, 'FramesAnimation', 'boy-fall');
      const slot = instance.skeleton.slots[0];
      OFFICIAL.forEach(([x, y], k) => {
        slot.displayIndex = k;
        const [ox, oy] = quadOrigin(instance);
        expect(ox).toBeCloseTo(-x, 6);
        expect(oy).toBeCloseTo(-y, 6);
      });
    });

    it('槽位中心 = 官方公式（第 0 帧落在 (-9, 13.5)）', () => {
      const instance = player(SHEET, 'FramesAnimation', 'boy-fall');
      instance.skeleton.slots[0].displayIndex = 0;
      const center = slotCenterLocal(instance, instance.skeleton.slots[0].name)!;
      expect(center.x).toBeCloseTo(-9, 6);
      expect(center.y).toBeCloseTo(13.5, 6);
    });

    it('显示索引由时间轴给出，第 0 帧的缺省 displayIndex 是 0 而不是绑定的 1', () => {
      // 官方 `_parseSlotDisplayFrame`：`_getNumber(rawData, DISPLAY_INDEX, 0)`（13207 行）
      const instance = player(SHEET, 'FramesAnimation', 'boy-fall');
      instance.setAnimation('boy-fall');
      instance.position = 0;
      instance.skeleton.update(instance.animation, 0);
      expect(instance.skeleton.slots[0].displayIndex).toBe(0);
      // 绑定的 slot.displayIndex 是 1（样例数据），两者不同才说明缺省值用对了
      expect(instance.skeleton.armature.slot[0].displayIndex).toBe(1);
    });
  });

  describe.skipIf(!hasRooster)('未修剪的图集不受影响', () => {
    it('frameX/frameY 为 0 时 pivot 仍是 width/2，quad 原点不变', () => {
      const instance = player(ROOSTER, 'Rooster_An');
      const slot = instance.skeleton.slots.find((entry) => entry.displayIndex >= 0)!;
      const display = instance.skeleton.skinSlots.get(slot.name)!.display![slot.displayIndex];
      const region = instance.atlas!.byName.get(display.path ?? display.name!)!;
      expect(region.frameX).toBe(0);
      expect(region.frameY).toBe(0);
      const expected = (display.width ?? region.frameWidth ?? region.width) * (display.pivot?.x ?? 0.5);
      expect(displayPivotOffset(display, region).x).toBeCloseTo(expected, 9);
    });
  });
});
