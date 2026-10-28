/**
 * `.dbproj` flavours.
 *
 * The shipped decoder (`_97._104.decode`) has two branches:
 *   bytes[0] == 0x6F  -> AMF3 behind a cyclic key
 *   otherwise         -> JSON.parse(utf8)
 *
 * 三个 AMF3 规则修正后（traits 引用的位、空串不入引用表 —— 见 格式规范），
 * 官方 AMF3 样例已能 100% 解码；本工程写出的是 JSON 形态（官方解码器的另一分支）。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  detectDbprojFormat, parseDbproj, serializeDbproj, unwrapDbproj, unwrapProjectSkeleton, wrapDbproj,
} from '../src/core/project/dbproj';
import { Player } from '../src/core/player';

// Local fixtures are not shipped. Point these env vars at your own copies to enable the suites;
// when the files are absent the tests skip instead of failing.
const REAL = process.env.BONESTUDIO_DBPROJ ?? 'samples/NewProject/NewProject.dbproj';
const TEMPLATE = process.env.BONESTUDIO_DBPROJ_TEMPLATE ?? 'samples/ProjectDataTemplate.bin';
const hasReal = existsSync(REAL);
const hasTemplate = existsSync(TEMPLATE);

describe.skipIf(!hasReal)('.dbproj container', () => {
  it('unwraps and rewraps a real project byte for byte', () => {
    const bytes = readFileSync(REAL);
    expect(detectDbprojFormat(bytes)).toBe('amf3');
    const payload = unwrapDbproj(bytes);
    expect(payload[0]).toBe(0x0a);
    expect(Buffer.from(payload).includes(Buffer.from('dragonBones'))).toBe(true);
    expect(Buffer.from(wrapDbproj(payload)).equals(bytes)).toBe(true);
  });

  it('decodes the AMF3 payload completely', () => {
    const parsed = parseDbproj(readFileSync(REAL));
    expect(parsed.complete).toBe(true);
    const data = parsed.data as Record<string, unknown>;
    // the file order matches the shipped writer: dragonBones first, library later
    // 完整解码后连 stage 与那些混淆名段都在（此前提前停止时根本读不到它们）
    expect(Object.keys(data)).toEqual([
      'dragonBones', '_14621', 'currentArmatureName', 'timeline', 'libraryVitualFolderObj', 'library',
      '_10703', 'stage', '_2865', '_3536', '_13344',
    ]);
    const dragonBones = data.dragonBones as Record<string, unknown>;
    expect(Object.keys(dragonBones).sort()).toEqual(['armature', 'frameRate', 'version']);
    expect((data.timeline as Record<string, unknown>).autoTween).toBeDefined();
    // 这是官方的「新建空工程」：1 根 root 骨骼、0 槽位、0 动画
    const armature = (dragonBones.armature as Array<Record<string, unknown>>)[0];
    expect(armature.name).toBe('Armature');
    expect(armature.type).toBe('Armature');
    expect(armature.frameRate).toBe(24);
    expect((armature.bone as unknown[]).length).toBe(1);
    expect((armature.slot as unknown[]).length).toBe(0);
    expect((armature.animation as unknown[]).length).toBe(0);
    // 解出的骨架要能被运行时消费（否则「打开工程」没有意义）
    const skeleton = unwrapProjectSkeleton(data);
    expect(skeleton).not.toBeNull();
    const player = new Player(skeleton as never, null);
    expect(player.skeleton.bones.length).toBe(1);
  });
});

describe('.dbproj JSON flavour', () => {
  it('round-trips a project document', () => {
    const doc = { library: [], projectType: '', isNew: 'true', stage: { cX: 0, cY: 0, zoom: 1 } };
    const bytes = serializeDbproj(doc);
    expect(detectDbprojFormat(bytes)).toBe('json');
    expect(bytes[0]).not.toBe(0x6f);
    expect(parseDbproj(bytes).data).toEqual(doc);
  });

  it('parses nothing that the shipped reader would reject', () => {
    const bytes = serializeDbproj({ name: 'test' }, true);
    const text = new TextDecoder().decode(bytes);
    expect(text.startsWith('{')).toBe(true);
    expect(() => JSON.parse(text)).not.toThrow();
  });
});

describe.skipIf(!hasTemplate)('shipped new-project template', () => {
  it('is plain JSON and survives a save/load cycle', () => {
    const template = JSON.parse(readFileSync(TEMPLATE, 'utf8'));
    const bytes = serializeDbproj(template, true);
    const parsed = parseDbproj(bytes);
    expect(parsed.format).toBe('json');
    expect(parsed.data).toEqual(template);
  });
});
