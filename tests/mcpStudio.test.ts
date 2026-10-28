/**
 * MCP 工作室工具 + Spine 4.x 导出的端到端单测（不依赖外部样例）：
 * 新建工程 → 加图 → 建骨骼 → 网格 + 自动权重 → 通道关键帧 / 插槽颜色 / 附件 / 事件 → 渲染 → 导出 Spine 4.2/4.1，
 * 并用官方 spine-core 4.2 与 4.1 运行时加载、逐帧对拍世界坐标。
 */
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import * as spine41 from 'spine-core-41';
import { encodePng, decodePng } from '../src/tools/png';
import * as studio from '../src/mcp/studio';
import { boneCreate } from '../src/mcp/tools';
import { validateSpineExport } from '../src/tools/spineValidate';
import { exportSpine4 } from '../src/core/export/spine4';
import { serializeSkeletonData } from '../src/core/parse/ske';

const dir = mkdtempSync(join(tmpdir(), 'bs-studio-'));
process.env.BONESTUDIO_PROJECTS = join(dir, 'projects');

function square(w: number, h: number, rgb: [number, number, number]): string {
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) rgba.set([...rgb, 255], i * 4);
  const file = join(dir, `sq_${w}x${h}_${rgb.join('_')}.png`);
  writeFileSync(file, encodePng({ width: w, height: h, rgba }));
  return file;
}

const s: studio.StudioState = { player: null, path: '' };

beforeAll(() => {
  studio.projectNew(s, { name: 'unit' });
  boneCreate(s, { name: 'body', parent: 'root', length: 80, transform: { y: -20, skX: -90, skY: -90 } });
  boneCreate(s, { name: 'arm', parent: 'body', length: 60, transform: { x: 80 } });
  s.player!.rebuildSkeleton();
  studio.imageAdd(s, { file: square(40, 100, [200, 40, 40]), slot: 'torso', bone: 'body', x: 40, y: 0, rotation: 90 });
  studio.imageAdd(s, { file: square(20, 120, [40, 40, 200]), slot: 'limb', bone: 'body', x: 110, y: 0, rotation: 90 });
  studio.imageAdd(s, { file: square(20, 20, [40, 200, 40]), slot: 'eye', bone: 'body', x: 70, y: 0 });
  studio.imageAdd(s, { file: square(20, 4, [10, 10, 10]), slot: 'eye', region: 'eye_closed', x: 70, y: 0 });
});

describe('MCP studio tools', () => {
  it('creates a project in the workspace with slots and a packed atlas', () => {
    const list = studio.projectList() as { projects: Array<{ name: string }> };
    expect(list.projects.some((p) => p.name === 'unit')).toBe(true);
    expect(s.tex!.SubTexture.map((t) => t.name).sort()).toEqual(['eye_closed', 'sq_20x120_40_40_200', 'sq_20x20_40_200_40', 'sq_40x100_200_40_40'].sort());
    expect(existsSync(join(process.env.BONESTUDIO_PROJECTS!, 'unit', 'unit_tex.png'))).toBe(true);
  });

  it('turns an image into a weighted mesh', () => {
    const m = studio.meshCreate(s, { slot: 'limb', cols: 1, rows: 4 }) as { vertices: number; hull: number };
    expect(m.vertices).toBe(10);
    expect(m.hull).toBe(10);
    const w = studio.weightsAuto(s, { slot: 'limb', bones: ['body', 'arm'] }) as { vertices: number };
    expect(w.vertices).toBe(10);
    const d = s.player!.skeleton.armature.skin![0].slot.find((x) => x.name === 'limb')!.display[0];
    expect(d.weights!.length).toBeGreaterThan(10);
  });

  it('keys channels, slot colour / attachment and events, and undoes', () => {
    studio.animationCreate(s, { name: 'swing', duration: 24, playTimes: 0 });
    studio.boneKeys(s, { animation: 'swing', keys: [
      { bone: 'arm', frame: 0, rotate: 0 }, { bone: 'arm', frame: 12, rotate: 60, easing: [0.25, 0, 0.75, 1] }, { bone: 'arm', frame: 24, rotate: 0 },
      { bone: 'body', frame: 0, x: 0, y: 0 }, { bone: 'body', frame: 12, x: 10, y: -8, scaleX: 1.1, scaleY: 0.9 }, { bone: 'body', frame: 24, x: 0, y: 0, scaleX: 1, scaleY: 1 },
    ] });
    studio.slotKey(s, { slot: 'torso', frame: 0, color: { rM: 100, gM: 100, bM: 100 } });
    studio.slotKey(s, { slot: 'torso', frame: 6, color: { rM: 100, gM: 30, bM: 30 } });
    studio.slotKey(s, { slot: 'eye', frame: 10, attachment: 'eye_closed' });
    studio.slotKey(s, { slot: 'eye', frame: 13, attachment: 'sq_20x20_40_200_40' });
    studio.eventKey(s, { frame: 12, name: 'hit' });
    const p = s.player!;
    p.setAnimation('swing'); p.setupPose = false; p.seek(12);
    const arm = p.skeleton.bones[p.skeleton.boneIndexByName.get('arm')!];
    p.seek(0);
    const arm0 = Array.from(p.skeleton.bones[p.skeleton.boneIndexByName.get('arm')!].world);
    p.seek(12);
    expect(Math.abs(arm.world[0] - arm0[0])).toBeGreaterThan(0.1);
    const depth = s.undo!.length;
    studio.boneKey(s, { bone: 'arm', frame: 6, rotate: 99 });
    expect(s.undo!.length).toBe(depth + 1);
  });

  it('renders frames and contact sheets headlessly', () => {
    const out = join(dir, 'f.png');
    studio.renderFrame(s, { out, animation: 'swing', frame: 12, width: 128, height: 128 });
    const img = decodePng(readFileSync(out));
    expect(img.width).toBe(128);
    let red = 0;
    for (let i = 0; i < img.rgba.length; i += 4) if (img.rgba[i] > 150 && img.rgba[i + 1] < 120) red++;
    expect(red).toBeGreaterThan(50);
    const sheet = studio.renderAnimation(s, { out: join(dir, 'sheet.png'), animation: 'swing', format: 'sheet', width: 64, step: 6 }) as { frames: number[] };
    expect(sheet.frames).toEqual([0, 6, 12, 18]);
  });

  it('exports Spine 4.2 that the official 4.2 runtime loads and matches', () => {
    const r = studio.spineExport(s, { outDir: join(dir, 'sp42'), version: '4.2' }) as { spine: string; json: string; validation: { ok: boolean; maxBoneErrorPx: number; maxVertexErrorPx: number } };
    expect(r.spine).toMatch(/^4\.2\./);
    if (!r.validation.ok) console.log(JSON.stringify(r.validation));
    expect(r.validation.ok).toBe(true);
    expect(r.validation.maxVertexErrorPx).toBeLessThan(0.5); // DB 曲线走预采样表，Spine 走解析 bezier
    const json = JSON.parse(readFileSync(r.json, 'utf8'));
    expect(Array.isArray(json.skins)).toBe(true);
    expect(json.skins[0].name).toBe('default');
    const limb = json.skins[0].attachments.limb[Object.keys(json.skins[0].attachments.limb)[0]];
    expect(limb.type).toBe('mesh');
    expect(limb.vertices.length).toBeGreaterThan(limb.uvs.length); // 加权展开
    const swing = json.animations.swing;
    // curves:'auto'：这条陡峭曲线与编辑器采样表偏差 >0.002 → 逐帧烘焙（0.5s 处仍有键）；curves:'bezier' 保留单段 bezier
    expect(swing.bones.arm.rotate.some((k: { time?: number }) => Math.abs((k.time ?? 0) - 0.5) < 1e-9)).toBe(true);
    const legacy = JSON.parse(readFileSync((studio.spineExport(s, { outDir: join(dir, 'sp42b'), version: '4.2', curves: 'bezier', validate: false }) as { json: string }).json, 'utf8'));
    expect(legacy.animations.swing.bones.arm.rotate.find((k: { time?: number }) => Math.abs((k.time ?? 0) - 0.5) < 1e-9).curve).toHaveLength(4);
    expect(swing.slots.torso.rgba.length).toBe(2);
    expect(swing.slots.eye.attachment.map((k: { name: string }) => k.name)).toContain('eye_closed');
    expect(swing.events[0].name).toBe('hit');
    expect(json.events.hit).toBeDefined();
    expect(readFileSync(join(dir, 'sp42', 'unit.atlas'), 'utf8')).toMatch(/^unit\.png\nsize:/);
  });

  it('exports Spine 4.1 (transform key) that the official 4.1 runtime loads and matches', () => {
    const doc = JSON.parse(serializeSkeletonData(s.player!.doc));
    doc.armature[0].bone.find((b: { name: string }) => b.name === 'arm').inheritScale = false;
    // 父骨骼非等比缩放 + noScale 在两边的定义不同（Spine 会额外去掉切变），对拍时去掉缩放键
    for (const a of doc.armature[0].animation) for (const t of a.bone ?? []) delete t.scaleFrame;
    const r41 = exportSpine4(doc, { version: '4.1', texture: s.tex });
    expect((r41.json.skeleton as { spine: string }).spine).toMatch(/^4\.1\./);
    expect((r41.json.bones as Array<Record<string, unknown>>).find((b) => b.name === 'arm')!.transform).toBe('noScale');
    const v = validateSpineExport(r41.json, r41.atlas, doc, s.tex!, { runtime: spine41, runtimeName: '4.1' });
    if (!v.ok) console.log('41', JSON.stringify(v));
    expect(v.ok).toBe(true);
    const r42 = exportSpine4(doc, { version: '4.2', texture: s.tex });
    expect((r42.json.bones as Array<Record<string, unknown>>).find((b) => b.name === 'arm')!.inherit).toBe('noScale');
    expect(validateSpineExport(r42.json, r42.atlas, doc, s.tex!).ok).toBe(true);
  });

  it('keeps 3.6 as a legacy option', () => {
    const r = studio.spineExport(s, { outDir: join(dir, 'sp36'), version: '3.6' }) as { json: string };
    expect(JSON.parse(readFileSync(r.json, 'utf8')).skeleton.spine).toBe('3.6.52');
  });
});

const LUBU = '/workspace/asset-canvas/chars/lubu_q34';
describe.skipIf(!existsSync(LUBU))('pipeline import (asset-canvas lubu_q34)', () => {
  it('imports the DragonBones package and validates a Spine 4.2 round trip', () => {
    const st: studio.StudioState = { player: null, path: '' };
    studio.projectImport(st, { path: LUBU, sync: false });
    const r = studio.spineExport(st, { outDir: join(dir, 'lubu42') }) as { validation: { ok: boolean; animations: unknown[] } };
    expect(r.validation.ok).toBe(true);
    expect(r.validation.animations.length).toBe(6);
  });
  it('imports the Spine package by baking it through spine-core', () => {
    const st: studio.StudioState = { player: null, path: '' };
    const out = studio.projectImport(st, { path: LUBU, prefer: 'spine', sync: false }) as { source: string; bones: number };
    expect(out.source).toBe('spine');
    expect(out.bones).toBeGreaterThan(10);
  });
});
