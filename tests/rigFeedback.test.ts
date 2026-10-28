/**
 * rig-bot 反馈修复（fix/rig-feedback）：
 * 1 bone_update 改绑定变换 + keepChildren；2 slot_update 显示变换；3 image_add scale；4 bone_delete 世界补偿；
 * 5 图集重排 / 焊接后渲染可复现（fit:content、固定 bounds、焊接裁边）；6 render_frame 骨骼叠加层开关；
 * 7 Spine 导出 bezier（多段 / 余弦 / 陡峭曲线）与编辑器一致；8 撤销栈上限 1000 + 内存预算 + 图集也能撤销。
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { decodePng, encodePng, type RasterImage } from '../src/tools/png';
import * as studio from '../src/mcp/studio';
import { boneCreate, boneDelete, boneUpdate, historyStatus, historyUndo, historyRedo } from '../src/mcp/tools';
import { exportSpine4 } from '../src/core/export/spine4';
import { validateSpineExport } from '../src/tools/spineValidate';
import { serializeSkeletonData } from '../src/core/parse/ske';
import type { DbSkeletonData } from '../src/core/types';

const dir = mkdtempSync(join(tmpdir(), 'bs-rigfb-'));
process.env.BONESTUDIO_PROJECTS = join(dir, 'projects');

function png(name: string, w: number, h: number, fill: (x: number, y: number) => [number, number, number, number]): string {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgba.set(fill(x, y), (y * w + x) * 4);
  const file = join(dir, `${name}.png`);
  writeFileSync(file, encodePng({ width: w, height: h, rgba }));
  return file;
}
const solid = (name: string, w: number, h: number, c: [number, number, number]) => png(name, w, h, () => [...c, 255]);

let s: studio.StudioState;
let n = 0;
function fresh(): void {
  s = { player: null, path: '' };
  studio.projectNew(s, { name: `fb${n++}` });
  boneCreate(s, { name: 'body', parent: 'root', length: 80, transform: { y: -20, skX: -90, skY: -90 } });
  boneCreate(s, { name: 'arm', parent: 'body', length: 60, transform: { x: 80, skX: 30, skY: 30 } });
  boneCreate(s, { name: 'hand', parent: 'arm', length: 20, transform: { x: 60 } });
  s.player!.rebuildSkeleton();
  studio.imageAdd(s, { file: solid('torso', 40, 100, [200, 40, 40]), slot: 'torso', bone: 'body', x: 40, rotation: 90 });
  studio.imageAdd(s, { file: solid('limb', 20, 60, [40, 40, 200]), slot: 'limb', bone: 'arm', x: 30, rotation: 90 });
  studio.imageAdd(s, { file: solid('fist', 16, 16, [40, 200, 40]), slot: 'fist', bone: 'hand', x: 5 });
}
beforeEach(fresh);

const worldOfBone = (name: string) => { s.player!.rebuildSkeleton(); const i = s.player!.skeleton.boneIndexByName.get(name)!; return Array.from(s.player!.skeleton.bones[i].world); };
const slotPositions = (): Record<string, number[]> => {
  const p = s.player!; p.rebuildSkeleton(); p.setupPose = true; p.seek(0);
  const out: Record<string, number[]> = {};
  for (const it of p.renderItems()) out[(it as { slot?: string }).slot ?? '?'] = Array.from(it.positions);
  p.setupPose = false;
  return out;
};
const expectClose = (a: number[], b: number[], tol = 0.02) => { expect(a.length).toBe(b.length); a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(tol)); };
const iou = (a: RasterImage, b: RasterImage) => { let i = 0, u = 0; for (let k = 3; k < a.rgba.length; k += 4) { const x = a.rgba[k] > 0, y = b.rgba[k] > 0; if (x && y) i++; if (x || y) u++; } return i / u; };
const render = (args: Record<string, unknown> = {}) => { const out = join(dir, `r_${Math.random().toString(36).slice(2)}.png`); const r = studio.renderFrame(s, { out, setup: true, width: 300, height: 300, background: 'transparent', ...args }) as { bounds: number[] }; return { img: decodePng(readFileSync(out)), bounds: r.bounds }; };

describe('1 bone_update 绑定变换', () => {
  it('moves only the bone with keepChildren:true (children + slots keep world)', () => {
    const before = slotPositions();
    const hand = worldOfBone('hand');
    const r = boneUpdate(s, { bone: 'arm', transform: { x: 90, y: 5, rotation: 75 }, keepChildren: true }) as { changed: { transform: Record<string, number> } };
    expect(r.changed.transform).toMatchObject({ x: 90, y: 5, skX: 75, skY: 75 });
    const arm = worldOfBone('arm');
    expect(Math.atan2(arm[1], arm[0]) * 180 / Math.PI).toBeCloseTo(-15, 3); // body -90 + 75
    expectClose(worldOfBone('hand'), hand, 0.01);
    const after = slotPositions();
    expectClose(after.limb, before.limb); expectClose(after.fist, before.fist); expectClose(after.torso, before.torso);
  });
  it('keepChildren also keeps weighted meshes bound to the bone in place', () => {
    studio.meshCreate(s, { slot: 'limb', cols: 1, rows: 3 });
    studio.weightsAuto(s, { slot: 'limb', bones: ['arm', 'hand'] });
    const before = slotPositions().limb;
    boneUpdate(s, { bone: 'arm', transform: { rotation: 60, x: 85 }, keepChildren: true });
    expectClose(slotPositions().limb, before, 0.05);
  });
  it('without keepChildren children follow; undo restores', () => {
    const hand = worldOfBone('hand');
    boneUpdate(s, { bone: 'arm', transform: { rotation: 0 } });
    expect(Math.abs(worldOfBone('hand')[4] - hand[4]) + Math.abs(worldOfBone('hand')[5] - hand[5])).toBeGreaterThan(1);
    historyUndo(s);
    expectClose(worldOfBone('hand'), hand, 1e-6);
  });
  it('rejects non-finite values without changing anything', () => {
    const t = JSON.stringify(s.player!.skeleton.armature.bone);
    expect(() => boneUpdate(s, { bone: 'arm', transform: { x: Number.NaN } })).toThrow();
    expect(JSON.stringify(s.player!.skeleton.armature.bone)).toBe(t);
  });
});

describe('2 slot_update 显示变换', () => {
  it('sets / offsets the display transform of the current display', () => {
    const r = studio.slotUpdate(s, { slot: 'fist', transform: { x: 12, y: -3, rotation: 45, scale: 2 } }) as { display: { transform: Record<string, number> } };
    expect(r.display.transform).toMatchObject({ x: 12, y: -3, skX: 45, skY: 45, scX: 2, scY: 2 });
    studio.slotUpdate(s, { slot: 'fist', transform: { x: 1, rotation: 5, scaleX: 0.5 }, mode: 'offset' });
    const d = s.player!.skeleton.armature.skin![0].slot.find((x) => x.name === 'fist')!.display[0];
    expect(d.transform).toMatchObject({ x: 13, y: -3, skX: 50, skY: 50, scX: 1, scY: 2 });
    const quad = slotPositions().fist; // 16*1 x 16*2 → 32 tall
    const xs = [quad[0], quad[2], quad[4], quad[6]], ys = [quad[1], quad[3], quad[5], quad[7]];
    expect(Math.hypot(xs[1] - xs[0], ys[1] - ys[0]) * Math.hypot(xs[2] - xs[1], ys[2] - ys[1])).toBeCloseTo(16 * 32, 0);
  });
  it('moves an unweighted mesh with its display transform; refuses weighted meshes', () => {
    studio.meshCreate(s, { slot: 'limb', cols: 1, rows: 2 });
    const before = slotPositions().limb;
    studio.slotUpdate(s, { slot: 'limb', transform: { x: 10 }, mode: 'offset' });
    const after = slotPositions().limb;
    expect(after.length).toBe(before.length);
    studio.weightsAuto(s, { slot: 'limb', bones: ['arm', 'hand'] });
    expect(() => studio.slotUpdate(s, { slot: 'limb', transform: { x: 1 } })).toThrow(/加权/);
  });
});

describe('3 image_add scale', () => {
  it('writes scale into the display transform and renders at that size', () => {
    const r = studio.imageAdd(s, { file: solid('badge', 10, 10, [9, 9, 9]), slot: 'badge', bone: 'root', scale: 3 }) as { transform: Record<string, number> };
    expect(r.transform).toMatchObject({ scX: 3, scY: 3 });
    studio.imageAdd(s, { file: solid('badge2', 10, 10, [9, 9, 9]), slot: 'badge2', bone: 'root', scaleX: 2, scaleY: 0.5 });
    const q = slotPositions();
    const w = (p: number[]) => Math.hypot(p[2] - p[0], p[3] - p[1]), h = (p: number[]) => Math.hypot(p[4] - p[2], p[5] - p[3]);
    expect(w(q.badge)).toBeCloseTo(30, 3); expect(h(q.badge)).toBeCloseTo(30, 3);
    expect(w(q.badge2)).toBeCloseTo(20, 3); expect(h(q.badge2)).toBeCloseTo(5, 3);
    expect(() => studio.imageAdd(s, { file: solid('bad', 4, 4, [1, 1, 1]), slot: 'bad', scale: 0 })).toThrow();
  });
});

describe('4 bone_delete 世界补偿', () => {
  it('re-parents child bones and slots to the parent without moving them', () => {
    const before = slotPositions();
    const hand = worldOfBone('hand');
    boneDelete(s, { bone: 'arm' });
    const arm = s.player!.skeleton.armature;
    expect(arm.slot.find((x) => x.name === 'limb')!.parent).toBe('body');
    expect(arm.bone.find((b) => b.name === 'hand')!.parent).toBe('body');
    expectClose(worldOfBone('hand'), hand, 0.01);
    const after = slotPositions();
    expectClose(after.limb, before.limb); expectClose(after.fist, before.fist);
  });
});

describe('5 图集重排后渲染可复现', () => {
  it('repacking (larger page) does not change a fixed-bounds or content-fit render', () => {
    const a = render({ fit: 'content' });
    // 一张带大片透明边的新图 → 整页重排、几何包围盒变大
    studio.imageAdd(s, { file: png('halo', 200, 200, (x, y) => (x >= 95 && x < 105 && y >= 95 && y < 105 ? [1, 2, 3, 255] : [0, 0, 0, 0])), slot: 'halo', bone: 'root', x: 0, y: -40 });
    studio.slotUpdate(s, { slot: 'halo', displayIndex: -1 });
    const fixed = render({ bounds: a.bounds });
    expect(iou(a.img, fixed.img)).toBeGreaterThan(0.999);
    expect(iou(a.img, render({ fit: 'content' }).img)).toBeGreaterThan(0.999);
    studio.slotUpdate(s, { slot: 'halo', displayIndex: 0 });
    // 透明边不再撑大取景：content 取景只多了中间 10×10 的不透明块（在原包围盒内）
    expect(iou(a.img, render({ fit: 'content' }).img)).toBeGreaterThan(0.99);
    expect(iou(a.img, render().img)).toBeLessThan(0.9); // 旧的 geometry 取景会被透明边撑大（行为保留，默认值不变）
  });
  it('weld_joints texture keeps the geometry tight (setup render stays put)', () => {
    const a = render();
    const r = studio.weldJoints(s, { mode: 'texture', overlap: 6, radius: 18 }) as { extended: Record<string, number> };
    expect(Object.keys(r.extended).length).toBeGreaterThan(0);
    const b = render({ bounds: a.bounds });
    // 原来的像素一个不少（焊接只往外加重叠，不挪部件）
    let kept = 0, orig = 0; for (let k = 3; k < a.img.rgba.length; k += 4) if (a.img.rgba[k] > 128) { orig++; if (b.img.rgba[k] > 0) kept++; }
    expect(kept / orig).toBeGreaterThan(0.995);
    // 焊接后不留透明边：几何取景 == 按不透明像素取景（以前四周各多 overlap 像素的透明边，取景被撑大 → 整图缩放，IoU 掉到 ~0.95）
    expectClose(render().bounds, render({ fit: 'content' }).bounds, 0.6);
  });
});

describe('6 render_frame 骨骼叠加层', () => {
  it('bones off by default, on draws overlay, only draws just bones on the same framing', () => {
    const off = render();
    const on = render({ bones: 'on', bounds: off.bounds });
    const only = render({ bones: 'only', bounds: off.bounds });
    let diff = 0; for (let k = 0; k < off.img.rgba.length; k++) if (off.img.rgba[k] !== on.img.rgba[k]) diff++;
    expect(diff).toBeGreaterThan(50);
    let opaque = 0; for (let k = 3; k < only.img.rgba.length; k += 4) if (only.img.rgba[k] > 0) opaque++;
    expect(opaque).toBeGreaterThan(50);
    expect(opaque).toBeLessThan(off.img.width * off.img.height * 0.2);
    const anim = studio.renderAnimation(s, { out: join(dir, 'sheet.png'), bones: 'on', width: 64 }) as { bounds: number[] };
    expect(anim.bounds.length).toBe(4);
  });
});

describe('7 Spine 导出 bezier 与编辑器一致', () => {
  for (const [label, easing] of [['steep single bezier', [0.1, 0.8, 0.3, 1]], ['multi-segment bezier', [0.2, 0, 0.3, 0.6, 0.5, 0.5, 0.7, 0.4, 0.8, 1]], ['cosine in-out (tweenEasing 1.6)', 1.6]] as const) {
    it(label, () => {
      studio.boneKey(s, { bone: 'arm', frame: 0, rotate: 0, x: 0, easing });
      studio.boneKey(s, { bone: 'arm', frame: 10, rotate: 90, x: 40, easing });
      studio.boneKey(s, { bone: 'arm', frame: 20, rotate: 0, x: 0 });
      const doc = JSON.parse(serializeSkeletonData(s.player!.doc)) as DbSkeletonData;
      const r = exportSpine4(doc, { version: '4.2', texture: s.tex!, images: './' });
      const v = validateSpineExport(r.json, r.atlas, doc, s.tex!);
      expect(v.ok).toBe(true);
      expect(v.maxVertexError).toBeLessThan(0.05); // 修复前：0.44 / 6.7 / 0.49 px
    });
  }
  it('keeps a plain bezier when it is exactly representable (QuadOut)', () => {
    studio.boneKey(s, { bone: 'arm', frame: 0, rotate: 0, easing: 1 });
    studio.boneKey(s, { bone: 'arm', frame: 10, rotate: 90 });
    const doc = JSON.parse(serializeSkeletonData(s.player!.doc)) as DbSkeletonData;
    const r = exportSpine4(doc, { version: '4.2', texture: s.tex!, images: './' });
    const anim = (r.json.animations as Record<string, { bones: Record<string, { rotate: Array<{ curve?: unknown }> }> }>);
    const rot = Object.values(anim).find((a) => a.bones?.arm)!.bones.arm.rotate;
    expect(rot.length).toBe(2);
    expect(Array.isArray(rot[0].curve)).toBe(true);
  });
});

describe('8 撤销栈', () => {
  it('keeps 1000 steps by default, reports dropped steps, honours BONESTUDIO_UNDO_LIMIT', () => {
    for (let i = 0; i < 150; i++) boneUpdate(s, { bone: 'arm', length: 10 + i });
    const st = historyStatus(s) as { undoDepth: number; undoLimit: number; undoDropped: number };
    expect(st.undoLimit).toBe(1000);
    expect(st.undoDepth).toBeGreaterThan(150);
    expect(st.undoDropped).toBe(0);
    for (let i = 0; i < 150; i++) historyUndo(s);
    expect(s.player!.skeleton.armature.bone.find((b) => b.name === 'arm')!.length).toBe(60);
    process.env.BONESTUDIO_UNDO_LIMIT = '5';
    try {
      for (let i = 0; i < 9; i++) boneUpdate(s, { bone: 'arm', length: 1 + i });
      const st2 = historyStatus(s) as { undoDepth: number; undoDropped: number };
      expect(st2.undoDepth).toBe(5);
      expect(st2.undoDropped).toBeGreaterThan(0);
    } finally { delete process.env.BONESTUDIO_UNDO_LIMIT; }
  });
  it('undo / redo also restore the atlas (image_add)', () => {
    const regions = s.tex!.SubTexture.length, page = s.page;
    studio.imageAdd(s, { file: solid('extra', 30, 30, [1, 1, 1]), slot: 'extra', bone: 'root' });
    expect(s.tex!.SubTexture.length).toBe(regions + 1);
    historyUndo(s);
    expect(s.tex!.SubTexture.length).toBe(regions);
    expect(s.page).toBe(page);
    expect(s.player!.skeleton.armature.slot.some((x) => x.name === 'extra')).toBe(false);
    historyRedo(s);
    expect(s.tex!.SubTexture.length).toBe(regions + 1);
    expect(slotPositions().extra).toBeDefined();
  });
});

describe('§10.3 追加：继承开关 / 斜切键 / 绘制顺序键 / 渲染裁剪', () => {
  it('bone_update inherit flags (10.3-8)', () => {
    boneUpdate(s, { bone: 'hand', inherit: { rotation: false } });
    const b = s.player!.skeleton.armature.bone.find((x) => x.name === 'hand')!;
    expect(b.inheritRotation).toBe(false);
    boneUpdate(s, { bone: 'hand', inherit: { rotation: true } });
    expect(b.inheritRotation).toBeUndefined();
  });
  it('bone_key shear (10.3-9) exports as Spine shear and validates', () => {
    studio.boneKey(s, { bone: 'arm', frame: 0, shear: 0 });
    studio.boneKey(s, { bone: 'arm', frame: 12, shear: 20, rotate: 10 });
    const doc = JSON.parse(serializeSkeletonData(s.player!.doc)) as DbSkeletonData;
    const r = exportSpine4(doc, { version: '4.2', texture: s.tex!, images: './' });
    const anims = r.json.animations as Record<string, { bones?: Record<string, Record<string, unknown>> }>;
    expect(Object.values(anims).some((a) => a.bones?.arm?.sheary)).toBe(true);
    expect(validateSpineExport(r.json, r.atlas, doc, s.tex!).ok).toBe(true);
  });
  it('draw_order_key (10.3-10) reorders slots at a frame and exports drawOrder', () => {
    const order0 = s.player!.skeleton.armature.slot.map((x) => x.name);
    expect(order0).toEqual(['torso', 'limb', 'fist']);
    studio.drawOrderKey(s, { frame: 6, order: ['fist', 'torso'] });
    const p = s.player!;
    const drawn = (f: number) => { p.seek(f); return p.renderItems().map((it) => (it as { slot: string }).slot); };
    expect(drawn(0)).toEqual(['torso', 'limb', 'fist']);
    expect(drawn(6)).toEqual(['fist', 'limb', 'torso']);
    const doc = JSON.parse(serializeSkeletonData(p.doc)) as DbSkeletonData;
    const r = exportSpine4(doc, { version: '4.2', texture: s.tex!, images: './' });
    expect(Object.values(r.json.animations as Record<string, { drawOrder?: unknown[] }>).some((a) => (a.drawOrder?.length ?? 0) > 0)).toBe(true);
    studio.drawOrderKey(s, { frame: 6, remove: true });
    expect(drawn(6)).toEqual(['torso', 'limb', 'fist']);
    expect(() => studio.drawOrderKey(s, { frame: 3, order: ['nope'] })).toThrow();
  });
  it('render_frame trim (10.3-12) crops to content', () => {
    const out = join(dir, 'trim.png');
    const r = studio.renderFrame(s, { out, setup: true, width: 300, height: 300, background: 'transparent', trim: 2 }) as { crop: number[]; size: number[] };
    const img = decodePng(readFileSync(out));
    expect(img.width).toBe(r.crop[2]); expect(img.width).toBeLessThan(300);
    expect(r.size).toEqual([img.width, img.height]);
    let edge = 0; for (let x = 0; x < img.width; x++) if (img.rgba[x * 4 + 3] > 0) edge++;
    expect(edge).toBe(0); // 外扩 2px 的边是空的
  });
});
