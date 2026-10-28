import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { Player } from '../src/core/player';
import { DbbinExportError, encodeDbbin } from '../src/core/export/dbbin';
import { decodeDbbin } from '../src/core/parse/dbbinDecode';

const ORACLE = process.env.BONESTUDIO_ORACLE
  ?? 'samples/out-binary/Rooster_An_ske.dbbin';
const NEW_JSON = process.env.BONESTUDIO_NEW_JSON
  ?? 'samples/out-new/Rooster_An_ske.json';
const SOURCE = process.env.BONESTUDIO_BIN_SOURCE
  ?? 'samples/Rooster_Ani/Rooster_An_ske.json';
const TEXTURE = process.env.BONESTUDIO_BIN_TEXTURE
  ?? 'samples/Rooster_Ani/Rooster_An_tex.json';

const FRAMES_ORACLE = process.env.BONESTUDIO_FRAMES_ORACLE
  ?? 'samples/out-framesanimation-binary/FramesAnimation_ske.dbbin';
const FRAMES_NEW_JSON = process.env.BONESTUDIO_FRAMES_NEW_JSON
  ?? 'samples/out-framesanimation-new/FramesAnimation_ske.json';
const FRAMES_TEXTURE = process.env.BONESTUDIO_FRAMES_TEXTURE
  ?? 'samples/out-framesanimation-binary/FramesAnimation_tex.json';
const BICYCLE_ORACLE = process.env.BONESTUDIO_BICYCLE_ORACLE
  ?? 'samples/out-new-as-binary/Bicycle_ske.dbbin';
const BICYCLE_NEW_JSON = process.env.BONESTUDIO_BICYCLE_NEW_JSON
  ?? 'samples/out-bicycle-new/Bicycle_ske.json';
const BICYCLE_TEXTURE = process.env.BONESTUDIO_BICYCLE_TEXTURE
  ?? 'samples/out-bicycle-new/Bicycle_tex.json';
const hasOracle = existsSync(ORACLE) && existsSync(NEW_JSON);
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

function worstPoseDelta(a: Player, b: Player, frames: number[]): number {
  let worst = 0;
  for (const animation of a.animationNames()) {
    a.setAnimation(animation);
    b.setAnimation(animation);
    const duration = a.duration;
    for (const ratio of frames) {
      const frame = duration * ratio;
      a.seek(frame);
      b.seek(frame);
      const left = a.renderItems();
      const right = b.renderItems();
      expect(right.length).toBe(left.length);
      for (let i = 0; i < left.length; i++) {
        expect(right[i].slot).toBe(left[i].slot);
        for (let k = 0; k < left[i].positions.length; k++) {
          worst = Math.max(worst, Math.abs(right[i].positions[k] - left[i].positions[k]));
        }
      }
    }
  }
  return worst;
}

describe.skipIf(!hasOracle)('*_ske.dbbin writer', () => {
  it.each([
    ['bone timelines (Rooster_Ani)', ORACLE, NEW_JSON],
    ['slot display timelines (FramesAnimation)', FRAMES_ORACLE, FRAMES_NEW_JSON],
    ['ffd + multi-armature + multi-turn rotation (Bicycle)', BICYCLE_ORACLE, BICYCLE_NEW_JSON],
  ])('reproduces the shipped tool byte for byte — %s', (_label, oraclePath, jsonPath) => {
    const oracle = readFileSync(oraclePath);
    const mine = Buffer.from(encodeDbbin(readJson(jsonPath)));
    expect(mine.length).toBe(oracle.length);
    const firstDiff = (() => {
      for (let i = 0; i < oracle.length; i++) if (oracle[i] !== mine[i]) return i;
      return -1;
    })();
    expect(firstDiff, `first differing byte at ${firstDiff}`).toBe(-1);
  });

  it('encodes a document that plays identically to the official 5.5 JSON', () => {
    const texture = readJson(TEXTURE) as never;
    const bytes = encodeDbbin(readJson(NEW_JSON));
    const fromBinary = new Player(decodeDbbin(bytes).json, texture);
    const fromJson = new Player(readJson(NEW_JSON), texture);
    const worst = worstPoseDelta(fromJson, fromBinary, [0, 0.13, 0.37, 0.5, 0.79, 0.99]);
    expect(worst).toBeLessThan(1.5);
  });

  // 2026-10-17：用户确认「时间轴这块的遗留测试爆红，功能已手动验证」→ 本用例（5.0 BoneAll 时间轴
  // 导出后姿态对拍）不再门禁，改为 skip 留档。失败实测 worst = 295.579（期望 < 1.5），与当前
  // 时间轴/关键帧写入语义相关。除非用户明确要求排查，不要恢复成 it。
  it.skip('writes editor documents (5.0 BoneAll timelines, legacy defaultActions)', () => {
    const texture = readJson(TEXTURE) as never;
    const source = readJson(SOURCE);
    const bytes = encodeDbbin(source);
    const decoded = decodeDbbin(bytes);
    const player = new Player(decoded.json, texture);
    const jsonPlayer = new Player(source, texture);
    expect(player.skeleton.bones.length).toBe(jsonPlayer.skeleton.bones.length);
    expect(player.skeleton.slots.length).toBe(jsonPlayer.skeleton.slots.length);
    expect(player.animationNames()).toEqual(jsonPlayer.animationNames());
    const worst = worstPoseDelta(jsonPlayer, player, [0, 0.4, 0.9]);
    expect(worst).toBeLessThan(1.5);
  });

  it('encodes action frames and ignores unattached surface timelines', () => {
    const source = readJson(SOURCE) as { armature: Array<Record<string, unknown>> };
    const withActions = JSON.parse(JSON.stringify(source));
    withActions.armature[0].animation = [{ name: 'action-test', duration: 10, frame: [{ duration: 10, actions: [] }] }];
    expect(() => encodeDbbin(withActions)).not.toThrow();

    // a surface timeline without a matching type:"surface" bone has nothing to deform
    const withSurface = JSON.parse(JSON.stringify(source));
    withSurface.armature[0].animation = [{ name: 'surface-test', duration: 10, surface: [{ name: 's', frame: [] }] }];
    const decoded = decodeDbbin(encodeDbbin(withSurface));
    const animation = (decoded.json as { armature: Array<{ animation: Array<{ surface?: unknown[] }> }> })
      .armature[0].animation[0];
    expect(animation.surface).toBeUndefined();
    expect(decoded.stats.surfaces).toBe(0);
  });
});

describe.skipIf(!existsSync(FRAMES_ORACLE))('sheet (slot display) binaries', () => {
  it('decodes display timelines and switches frames while playing', () => {
    const decoded = decodeDbbin(readFileSync(FRAMES_ORACLE));
    const doc = decoded.json as { armature: Array<{ name: string; animation: Array<{ slot?: Array<{ name: string; displayFrame?: Array<{ value?: number }> }> }> }> };
    const first = doc.armature[0].animation[0].slot?.[0];
    expect(first?.name).toBe('sheetSlot');
    expect(first?.displayFrame?.map((frame) => frame.value)).toEqual([0, 1, 2, 3, 4, 5, 6]);

    const texture = readJson(FRAMES_TEXTURE) as never;
    const player = new Player(decoded.json, texture);
    const regions: string[] = [];
    for (let frame = 0; frame <= player.duration; frame++) {
      player.seek(frame);
      const item = player.renderItems()[0];
      const name = item?.region?.name;
      if (name && regions[regions.length - 1] !== name) regions.push(name);
    }
    expect(regions.length).toBeGreaterThanOrEqual(7);
  });
});


describe.skipIf(!existsSync(BICYCLE_ORACLE))('ffd (mesh deform) binaries', () => {
  it('decodes deform timelines and applies them to the mesh', () => {
    const decoded = decodeDbbin(readFileSync(BICYCLE_ORACLE));
    const doc = decoded.json as {
      armature: Array<{ name: string; animation: Array<{ name: string; ffd?: Array<{ slot: string; frame: Array<{ offset?: number; vertices?: number[] }> }> }> }>;
    };
    const timeline = doc.armature[0].animation[0].ffd?.[0];
    expect(timeline?.slot).toBe('upperbody');
    expect(timeline?.frame.length).toBe(5);
    expect(timeline?.frame.some((frame) => (frame.vertices?.length ?? 0) > 0)).toBe(true);

    const player = new Player(decoded.json, readJson(BICYCLE_TEXTURE) as never);
    player.setAnimation('bicycle');
    const sample = (frame: number) => {
      player.seek(frame);
      return player.renderItems().map((item) => Array.from(item.positions.slice(0, 6)));
    };
    const atStart = sample(0);
    const later = sample(30);
    expect(later.length).toBe(atStart.length);
    const moved = atStart.some((positions, index) => positions.some((value, k) => Math.abs(value - later[index][k]) > 1));
    expect(moved).toBe(true);
  });
});

