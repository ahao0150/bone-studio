import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { Player } from '../src/core/player';
import { applyAiCommands } from '../src/ai/pluginApi';
import { LIP_SYNC, MOTION_TRANSFER, registerBuiltinCapabilities } from '../src/ai/capabilities';
import { listAiCapabilities } from '../src/ai/pluginApi';

const HOME = '.';
const SKELETON = `${HOME}/samples/Rooster_Ani/Rooster_An_ske.json`;
const TEXTURE = `${HOME}/samples/Rooster_Ani/Rooster_An_tex.json`;
const hasFixture = existsSync(SKELETON) && existsSync(TEXTURE);

function openPlayer(): Player {
  return new Player(JSON.parse(readFileSync(SKELETON, 'utf8')), JSON.parse(readFileSync(TEXTURE, 'utf8')));
}

/** 样例里每个槽位只有 1 个显示对象 —— 口型要"可切换"，所以先补一个。 */
function withSecondDisplay(player: Player, slotName: string): void {
  const skin = player.skeleton.armature.skin![0];
  const slot = skin.slot.find((entry) => entry.name === slotName)!;
  slot.display.push({ ...slot.display[0] });
  player.rebuildSkeleton();
}

describe('capability 注册', () => {
  it('registers the built-ins exactly once (idempotent)', () => {
    registerBuiltinCapabilities();
    registerBuiltinCapabilities();
    const ids = listAiCapabilities().map((entry) => entry.id);
    expect(ids).toContain('lip-sync');
    expect(ids).toContain('motion-transfer');
    expect(ids.filter((id) => id === 'lip-sync').length).toBe(1);
  });
});

describe.skipIf(!hasFixture)('内置 AI capability（M6）', () => {
  it('turns a phrase into slot display keyframes (lip-sync)', async () => {
    const player = openPlayer();
    withSecondDisplay(player, 'beak_lower');
    const commands = await LIP_SYNC.plan(player, '口型 slot=beak_lower: 你好');
    expect(commands.length).toBe(2);
    expect(commands[0].label).toContain('第 0 帧');
    expect(commands[1].label).toContain('第 2 帧');   // 每字 2 帧
    expect(applyAiCommands(player, commands)).toBe(2);
    const timeline = player.animation?.slot?.find((entry) => entry.name === 'beak_lower');
    expect(timeline, '口型应写出 slot 时间轴').toBeTruthy();
    expect((timeline?.frame ?? []).length).toBeGreaterThan(0);
  });

  it('is a no-op when the slot cannot switch displays', async () => {
    const player = openPlayer();
    // 样例槽位只有 1 个显示对象 → 没有"切换"可言
    expect(await LIP_SYNC.plan(player, '口型 slot=beak_lower: 你好')).toEqual([]);
    expect(await LIP_SYNC.plan(player, '口型: ')).toEqual([]);
  });

  it('copies the source animation bone timelines into a target (motion-transfer)', async () => {
    const player = openPlayer();
    const source = player.animation!.name;
    const commands = await MOTION_TRANSFER.plan(player, `动作迁移 from=${source} to=copy-test`);
    expect(commands.length).toBe(2);          // 先建动画，再复制时间轴
    expect(commands[0].label).toContain('新建动画 copy-test');
    expect(applyAiCommands(player, commands)).toBe(2);
    const target = player.skeleton.armature.animation?.find((entry) => entry.name === 'copy-test');
    expect(target, '应新建目标动画').toBeTruthy();
    const srcBones = (player.skeleton.armature.animation?.find((entry) => entry.name === source)?.bone ?? []).length;
    expect((target?.bone ?? []).length).toBe(srcBones);
  });

  it('filters motion transfer by bone name', async () => {
    const player = openPlayer();
    const source = player.animation!.name;
    const firstBone = player.skeleton.armature.animation!.find((a) => a.name === source)!.bone![0].name;
    const commands = await MOTION_TRANSFER.plan(player, `动作迁移 from=${source} to=one-bone bone=${firstBone}`);
    expect(commands.length).toBe(2);
    applyAiCommands(player, commands);
    const target = player.skeleton.armature.animation?.find((entry) => entry.name === 'one-bone');
    expect((target?.bone ?? []).map((entry) => entry.name)).toEqual([firstBone]);
  });
});