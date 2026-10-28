/**
 * Spine 导出（P1 P-06）— 与官方工具链 `Tools/out/action/toSpine.js` 的输出对拍。
 *
 * oracle 的生成方式见 `work/_toSpine-oracle.cjs`：把官方 DragonBones 导出喂给官方转换器
 * （输入按 DragonBones 的缺省语义补齐 `blendMode/color/curve` 等被省略的字段），版本串 3.6.52。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { serializeSpineSkeleton, spineColor, spineCurve, spineTransformName } from '../src/core/export/spine';
import type { DbSkeletonData } from '../src/core/types';

const BASE = '.';
const SRC = `${BASE}/work/cli-test/Bicycle_ske.json`;
const ORACLE = `${BASE}/samples/spine-bicycle.json`;
const has = existsSync(SRC) && existsSync(ORACLE);

type Any = Record<string, any>;
const load = () => {
  // 官方转换器吃的就是导出的 JSON 形态（rmature 复数在解析后才出现），这里保持同一形态对拍
  const raw = JSON.parse(readFileSync(SRC, 'utf8')) as DbSkeletonData;
  const mine = serializeSpineSkeleton(raw) as unknown as { spines: Any[] };
  const oracle = JSON.parse(readFileSync(ORACLE, 'utf8')) as { spines: Any[] };
  return { mine, oracle };
};

describe('Spine 导出的纯映射', () => {
  it('颜色：0-100 通道 → 8 位 hex（官方 seq 是 RGBA 大写）', () => {
    expect(spineColor({ rM: 100, gM: 100, bM: 100, aM: 100 })).toBe('FFFFFFFF');
    expect(spineColor(undefined)).toBe('FFFFFFFF');
    // 注意 50*2.55 = 127.49999999999999，官方同样 Math.round → 127（0x7F）
    expect(spineColor({ rM: 50, gM: 0, bM: 100, aM: 80 })).toBe('7F00FFCC');
  });

  it('inherit 组合 → Spine 的 transform 名', () => {
    expect(spineTransformName(true, true)).toBe('normal');
    expect(spineTransformName(true, false)).toBe('noScale');
    expect(spineTransformName(false, true)).toBe('noRotationOrReflection');
    expect(spineTransformName(false, false)).toBe('onlyTranslation');
    expect(spineTransformName(undefined, undefined)).toBe('onlyTranslation');
  });

  it('曲线：末帧不写；有 curve 取首尾；NaN → stepped；否则 linear', () => {
    expect(spineCurve({ tweenEasing: 0 }, true)).toBeUndefined();
    expect(spineCurve({ curve: [0.1, 0.2, 0.3, 0.4], tweenEasing: 0 }, false)).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(spineCurve({ curve: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7], tweenEasing: 0 }, false)).toEqual([0.1, 0.2, 0.6, 0.7]);
    expect(spineCurve({ tweenEasing: Number.NaN }, false)).toBe('stepped');
    expect(spineCurve({ tweenEasing: 0 }, false)).toBe('linear');
    expect(spineCurve({}, false)).toBe('linear');
  });
});

describe('Spine 导出 vs 官方 toSpine', () => {
  it.skipIf(!has)('骨架元数据与骨骼 / 插槽结构逐项一致', () => {
    const { mine, oracle } = load();
    expect(mine.spines.length).toBe(oracle.spines.length);
    const a = mine.spines[0];
    const b = oracle.spines[0];
    expect(a.skeleton).toEqual(b.skeleton);
    expect(a.bones.map((x: Any) => x.name)).toEqual(b.bones.map((x: Any) => x.name));
    expect(a.bones.map((x: Any) => x.parent ?? null)).toEqual(b.bones.map((x: Any) => x.parent ?? null));
    expect(a.bones.map((x: Any) => x.transform)).toEqual(b.bones.map((x: Any) => x.transform));
    expect(a.slots.map((x: Any) => x.name)).toEqual(b.slots.map((x: Any) => x.name));
    expect(a.slots.map((x: Any) => x.bone)).toEqual(b.slots.map((x: Any) => x.bone));
    expect(a.slots.map((x: Any) => x.blend)).toEqual(b.slots.map((x: Any) => x.blend));
    expect(a.slots.map((x: Any) => x.color)).toEqual(b.slots.map((x: Any) => x.color));
    expect(Object.keys(a.animations)).toEqual(Object.keys(b.animations));
  });

  it.skipIf(!has)('骨骼绑定变换数值一致（Y 取反 / rotation 取反 / shearY = -(skX-skY)）', () => {
    const { mine, oracle } = load();
    const a = mine.spines[0].bones as Any[];
    const b = oracle.spines[0].bones as Any[];
    const num = (v: unknown) => (typeof v === 'number' ? v : null);
    for (let i = 0; i < a.length; i++) {
      for (const key of ['x', 'y', 'rotation', 'shearX', 'shearY', 'scaleX', 'scaleY', 'length']) {
        const left = num(a[i][key]);
        const right = num(b[i][key]);
        if (left === null && right === null) continue;
        expect(Math.abs((left ?? 0) - (right ?? 0)), `bone[${i}].${key} (${a[i].name})`).toBeLessThan(1e-6);
      }
    }
  });

  it.skipIf(!has)('骨骼时间轴的关键帧时间与位移一致', () => {
    const { mine, oracle } = load();
    const animName = Object.keys(oracle.spines[0].animations)[0];
    const a = mine.spines[0].animations[animName].bones as Any;
    const b = oracle.spines[0].animations[animName].bones as Any;
    const channels = ['translate', 'rotate', 'scale'] as const;
    const names = Object.keys(b).filter((name) => channels.some((ch) => (b[name][ch] ?? []).length > 0));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names.slice(0, 5)) {
      for (const ch of channels) {
        const left = (a[name]?.[ch] ?? []) as Any[];
        const right = (b[name][ch] ?? []) as Any[];
        expect(left.length, `${name}.${ch} 帧数`).toBe(right.length);
        for (let i = 0; i < right.length; i++) {
          expect(left[i].time, `${name}.${ch}[${i}].time`).toBeCloseTo(right[i].time, 6);
          if (ch === 'translate') {
            expect(left[i].x, `${name}.translate[${i}].x`).toBeCloseTo(right[i].x ?? 0, 6);
            expect(left[i].y, `${name}.translate[${i}].y`).toBeCloseTo(right[i].y ?? 0, 6);
          }
          if (ch === 'scale') {
            expect(left[i].x, `${name}.scale[${i}].x`).toBeCloseTo(right[i].x ?? 1, 6);
            expect(left[i].y, `${name}.scale[${i}].y`).toBeCloseTo(right[i].y ?? 1, 6);
          }
        }
      }
    }
  });
});