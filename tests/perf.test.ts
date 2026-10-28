/**
 * 性能预算（M6 DoD：大骨架 ≥ 60fps）。
 *
 * 测的是**编辑器每帧真正要做的 CPU 工作**：`Skeleton.update()` 采样 + `getRenderItems()`
 * 组网格，不含 GPU 提交。两份负载：
 *   1. 真实素材 `you_xin/body`（官方示例里带图集的最大骨架：70 骨骼 / 10 动画 / 540 帧）；
 *   2. 合成压力骨架（200 骨骼链 + 200 槽位，240 帧），用来验证随骨骼数**线性**扩展。
 *
 * 预算取 60fps（16.7 ms）的 2 倍余量 = 8 ms：不会因为机器抖动而失败，
 * 但能挡住数量级回归（每帧重建 geometry、把 O(n) 写成 O(n²) 之类）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Player } from '../src/core/player';

const PERF_SAMPLES = process.env.BONESTUDIO_PERF_SAMPLES
  ?? 'work/dragonbones-src/Cocos/Demos/assets/resources';
const BUDGET_MS = 8;

interface Measurement {
  name: string; bones: number; slots: number; animations: number;
  frames: number; items: number; avg: number; p95: number; worst: number;
}

const ATLAS = {
  name: 'stress', imagePath: 'stress.png', width: 8, height: 8,
  SubTexture: [{ name: 'tile', x: 0, y: 0, width: 8, height: 8 }],
};

/** A 200-bone chain where every bone also carries a displayed slot. */
function stressArmature(boneCount: number, duration: number): unknown {
  const half = Math.round(duration / 2);
  return {
    name: 'stressAtlas',
    armature: [{
      name: 'stress', type: 'armature', frameRate: 24,
      bone: Array.from({ length: boneCount }, (_, i) => ({
        name: `b${i}`,
        ...(i === 0 ? {} : { parent: `b${i - 1}`, transform: { x: 6, y: 0 } }),
        length: 6,
      })),
      slot: Array.from({ length: boneCount }, (_, i) => ({
        name: `s${i}`, parent: `b${i}`, displayIndex: 0, blendMode: 'normal',
      })),
      skin: [{
        name: 'default',
        slot: Array.from({ length: boneCount }, (_, i) => ({
          name: `s${i}`, display: [{ name: 'tile', type: 'image', transform: { x: 0, y: 0 } }],
        })),
      }],
      animation: [{
        name: 'spin', duration, playTimes: 1,
        bone: Array.from({ length: boneCount }, (_, i) => ({
          name: `b${i}`,
          frame: [
            { duration: half, tweenEasing: 0, rotate: 0 },
            { duration: duration - half, rotate: 20 },
          ],
        })),
      }],
    }],
  };
}

function sweep(player: Player, collect: boolean): { frames: number; items: number; samples: number[] } {
  const samples: number[] = [];
  let frames = 0;
  let items = 0;
  for (const name of player.animationNames()) {
    player.setAnimation(name);
    const duration = Math.max(1, Math.round(player.duration));
    for (let frame = 0; frame < duration; frame++) {
      player.position = frame;
      const started = performance.now();
      const rendered = player.renderItems();
      const elapsed = performance.now() - started;
      if (collect) samples.push(elapsed);
      frames++;
      items += rendered.length;
    }
  }
  return { frames, items, samples };
}

function measure(name: string, build: () => Player): Measurement {
  const player = build();
  sweep(player, false); // warm-up so V8 optimises the hot path first
  const { frames, items, samples } = sweep(player, true);
  const sorted = samples.slice().sort((a, b) => a - b);
  const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0;
  return {
    name,
    bones: player.skeleton.bones.length,
    slots: player.skeleton.slots.length,
    animations: player.animationNames().length,
    frames, items,
    avg: samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length),
    p95,
    worst: sorted.length ? sorted[sorted.length - 1] : 0,
  };
}

const fixtures = [
  {
    name: 'you_xin/body (real asset)',
    build: () => {
      const dir = join(PERF_SAMPLES, 'you_xin', 'body');
      return new Player(
        JSON.parse(readFileSync(join(dir, 'body_ske.json'), 'utf8')),
        JSON.parse(readFileSync(join(dir, 'body_tex.json'), 'utf8')) as never,
      );
    },
  },
  {
    name: 'stress 200 bones',
    build: () => new Player(stressArmature(200, 240), ATLAS as never),
  },
];

describe('perf budget (M6: large skeletons ≥ 60fps)', () => {
  const results: Measurement[] = [];

  for (const fixture of fixtures) {
    it(`${fixture.name}: every animation frame stays inside the budget`, () => {
      const m = measure(fixture.name, fixture.build);
      results.push(m);
      console.log(`${m.name}: bones=${m.bones} slots=${m.slots} anims=${m.animations} `
        + `frames=${m.frames} items=${m.items} avg=${m.avg.toFixed(3)}ms p95=${m.p95.toFixed(3)}ms worst=${m.worst.toFixed(3)}ms`);
      expect(m.frames).toBeGreaterThan(100);
      expect(m.items).toBeGreaterThan(m.frames * 10);
      expect(m.avg).toBeLessThan(BUDGET_MS);
      expect(m.p95).toBeLessThan(BUDGET_MS * 2);
    });
  }

  it('keeps scaling linear: 200 bones still fit in the 60fps budget', () => {
    const stress = results.find((m) => m.name === 'stress 200 bones');
    expect(stress).toBeDefined();
    expect(stress!.bones).toBe(200);
    console.log(`worst avg frame cost = ${Math.max(...results.map((m) => m.avg)).toFixed(3)}ms `
      + `(budget ${BUDGET_MS}ms, 60fps = 16.67ms)`);
    expect(Math.max(...results.map((m) => m.avg))).toBeLessThan(BUDGET_MS);
  });
});
