/**
 * Spine JSON → DB 转换（纯逻辑）：
 * - 结构识别、最小文档转换
 * - 真实 spineboy-pro 样本：骨骼/插槽/动画/贴图数量、mesh UV 归一化、atlas scale 尺寸修正
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import * as spine42 from '@esotericsoftware/spine-core';
import { parseSpineAtlas } from '../src/core/parse/texture';
import { classifyJsonFile, convertSpineRuntime } from '../src/core/import/spineConvert';
import { collectTextureAttachments, synthAtlasText, type SpineJson } from '../src/core/import/spineCommon';
import { regionMapFromPages } from '../src/core/import/spineAtlasImage';

const SAMPLE = 'D:/前端测试/spine-samples/spineboy-pro.json';
const ATLAS = 'D:/前端测试/spine-samples/spineboy.atlas';
const hasSample = existsSync(SAMPLE) && existsSync(ATLAS);

const MINIMAL: SpineJson = {
  skeleton: { width: 100, height: 120 },
  bones: [{ name: 'root' }, { name: 'arm', parent: 'root', x: 10, y: 5, length: 50 }],
  slots: [{ name: 'body', bone: 'root', attachment: 'body' }],
  skins: [{ name: 'default', attachments: { body: { body: { type: 'region', width: 50, height: 50 } } } }],
  animations: { idle: { bones: { arm: { rotate: [{ time: 0, value: 0 }, { time: 0.1, value: 90 }] } } } } as never,
};

describe('classifyJsonFile', () => {
  it('distinguishes DragonBones / texture atlas / Spine / unknown', () => {
    expect(classifyJsonFile({ armature: [] })).toBe('dragonbones');
    expect(classifyJsonFile({ SubTexture: [] })).toBe('texture');
    expect(classifyJsonFile({ skeleton: { spine: '4.2' }, bones: [], skins: [] })).toBe('spine');
    expect(classifyJsonFile({ bones: [] })).toBe('unknown');
    expect(classifyJsonFile(null)).toBe('unknown');
  });
});

describe('convertSpineRuntime', () => {
  it('converts a minimal skeleton into a DB armature', () => {
    const atlas = 'body.png\nsize:50,50\nfilter:Linear,Linear\nbody\nbounds:0,0,50,50\n';
    const result = convertSpineRuntime(spine42, MINIMAL, atlas, { name: 'mini' });
    const arm = (result.ske.armature as unknown as Array<Record<string, unknown>>)[0];
    expect(result.ske.name).toBe('mini');
    expect(result.ske.frameRate).toBe(24);
    expect(arm.bone).toHaveLength(2);
    expect(arm.slot).toHaveLength(1);
    const skinSlot = (arm.skin as Array<{ slot: Array<{ name: string; display: unknown[] }> }>)[0].slot[0];
    expect(skinSlot.name).toBe('body');
    expect(skinSlot.display).toHaveLength(1);
    expect((arm.animation as Array<{ name: string }>)[0].name).toBe('idle');
    expect(result.textures).toEqual(['body']);
    expect(result.animations).toBe(1);
    expect(arm.defaultActions).toEqual([{ gotoAndPlay: 'idle' }]);
  });

  it.skipIf(!hasSample)('imports the real spineboy-pro sample with atlas metadata', () => {
    const sk = JSON.parse(readFileSync(SAMPLE, 'utf8')) as SpineJson;
    const pages = parseSpineAtlas(readFileSync(ATLAS, 'utf8'));
    const regions = regionMapFromPages(pages);
    const paths = collectTextureAttachments(sk).map((t) => t.path);
    const atlasText = synthAtlasText(paths.map((p) => ({ path: p, width: regions.get(p)?.frameWidth ?? 4, height: regions.get(p)?.frameHeight ?? 4 })));
    const result = convertSpineRuntime(spine42, sk, atlasText, { name: 'spineboy-pro', regions });
    const arm = (result.ske.armature as unknown as Array<Record<string, unknown>>)[0];
    expect((arm.bone as unknown[]).length).toBe(67);
    expect((arm.slot as unknown[]).length).toBe(52);
    expect(result.animations).toBe(11);
    expect(result.textures.length).toBe(40);
    expect(result.frames).toBe(369);

    // mesh UV 必须换算成区域相对坐标
    const skin = (arm.skin as Array<{ slot: Array<{ name: string; display: Array<Record<string, unknown>> }> }>)[0];
    const head = skin.slot.find((s) => s.name === 'head')?.display.find((d) => d.type === 'mesh');
    expect(head).toBeTruthy();
    for (const v of head!.uvs as number[]) expect(v).toBeGreaterThanOrEqual(-0.01), expect(v).toBeLessThanOrEqual(1.01);

    // atlas scale 0.5 → region 显示对象要放大 2 倍
    const fist = skin.slot.find((s) => s.name === 'front-fist')?.display.find((d) => d.name === 'front-fist-open') as { transform?: { scX?: number } };
    expect(fist.transform?.scX).toBeCloseTo(2, 1);
  });
});
