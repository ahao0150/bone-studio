/**
 * MCP「工作室」工具：工程生命周期、素材导入、插槽/网格/权重、通道关键帧、预览渲染、导出、编辑器联动。
 * Studio tools for the MCP server: project lifecycle, pipeline import, slots/meshes/weights, channel keys,
 * headless preview rendering, Spine 4.x / DragonBones export and live editor sync.
 *
 * 所有写工具都先 `checkpoint`（与 tools.ts 共用撤销栈），成功后若工程在工作区里则自动同步（编辑器 live 重载）。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Player } from '../core/player';
import { serializeSkeletonData } from '../core/parse/ske';
import { packAtlas, serializeTextureAtlas } from '../core/export/atlas';
import { exportSpine4 } from '../core/export/spine4';
import { serializeSpineSkeleton } from '../core/export/spine';
import { addAnimation, cloneAnimation, removeAnimation, setAnimationDuration } from '../core/animEdit';
import { addSlot, setSlotColorKeyframe, setSlotDisplayKeyframe } from '../core/slotEdit';
import { addEventFrame } from '../core/eventEdit';
import { removeZOrderKeyframe, setZOrderKeyframe } from '../core/zorderEdit';
import { emptySkeleton } from '../core/project/newProject';
import { Skeleton } from '../core/runtime/skeleton';
import { apply, invert, matFromTransform, multiply, type Mat2D } from '../core/runtime/math';
import { animationBounds, animationContentBounds, drawBoneOverlay, renderPlayer, type Bounds } from '../core/render/softRaster';
import type { DbArmatureData, DbBoneTimeline, DbDisplayData, DbSkeletonData, DbTextureAtlasData } from '../core/types';
import { blitRaster, cropRaster, decodePng, encodePng, type RasterImage } from '../tools/png';
import { importCharacter } from '../tools/pipelineImport';
import { validateSpineExport } from '../tools/spineValidate';
import { findEditorUrl, loadFromWorkspace, projectsDir, readManifest, saveToWorkspace } from './workspace';
import type { EditorState } from './tools';
import { capture, pushUndo, restore, stacksOf, type HistEntry } from './history';
import { rebaseSlotDisplays } from '../core/bindCompensate';
import { addIkConstraint, removeIkConstraint, setIkConstraint, validateIkConstraint } from '../core/ikEdit';

export interface StudioState extends EditorState {
  name?: string;
  tex?: DbTextureAtlasData | null;
  page?: RasterImage | null;
  /** 工程在工作区：每次写入后自动保存（编辑器 live 重载） */
  autoSync?: boolean;
  lastSync?: { dir: string; rev?: number } | null;
}

const need = (s: StudioState): Player => { if (!s.player) throw new Error('no project open — call project_new / project_import / project_open first'); return s.player; };
const armatureOf = (s: StudioState): DbArmatureData => need(s).skeleton.armature;

function snapshot(s: StudioState): HistEntry | null {
  const snap = capture(s);
  if (!snap) return null;
  pushUndo(s, snap);
  stacksOf(s).redo.length = 0;
  return snap;
}
function undoLast(s: StudioState, snap: HistEntry | null): void {
  if (snap && s.player) restore(s, snap);
  s.undo?.pop();
}

/** 写操作包装：checkpoint → 执行 → 失败回滚 → 成功则自动同步 */
export function write<T>(s: StudioState, fn: () => T, opts: { rebuild?: boolean } = {}): T & { synced?: string | null } {
  const snap = snapshot(s);
  try {
    const out = fn();
    if (opts.rebuild !== false) s.player?.rebuildSkeleton();
    const synced = s.autoSync ? sync(s).dir : null;
    return { ...(out as object), synced, undoDepth: s.undo?.length ?? 0 } as unknown as T & { synced?: string | null };
  } catch (e) {
    undoLast(s, snap);
    throw e;
  }
}

function sync(s: StudioState): { dir: string; rev?: number } {
  const p = need(s);
  if (!s.tex || !s.page) throw new Error('project has no texture atlas yet');
  const entry = saveToWorkspace(s.name ?? p.doc.name ?? 'project', serializeSkeletonData(p.doc), s.tex, encodePng(s.page));
  s.lastSync = { dir: entry.dir, rev: entry.rev };
  s.path = join(entry.dir, `${entry.name}_ske.json`);
  return s.lastSync;
}

function setProject(s: StudioState, name: string, ske: unknown, tex: DbTextureAtlasData | null, page: RasterImage | null): void {
  s.player = new Player(ske, tex);
  s.name = name; s.tex = tex; s.page = page;
  s.undo = []; s.redo = []; s.undoDropped = 0;
}

/** 用新的图集重建 Player（保持当前动画名和位置） */
function rebuildPlayer(s: StudioState): void {
  const p = need(s);
  const anim = p.animation?.name;
  const pos = p.position;
  const setup = p.setupPose;
  const next = new Player(JSON.parse(serializeSkeletonData(p.doc)), s.tex ?? null);
  if (anim) next.setAnimation(anim);
  next.setupPose = setup;
  next.seek(pos);
  s.player = next;
}

function summary(s: StudioState): Record<string, unknown> {
  const p = need(s);
  const a = p.skeleton.armature;
  return {
    name: s.name, bones: a.bone.length, slots: a.slot?.length ?? 0,
    animations: (a.animation ?? []).map((x) => ({ name: x.name, duration: x.duration, playTimes: x.playTimes })),
    frameRate: p.frameRate, regions: s.tex?.SubTexture?.length ?? 0,
    workspace: s.autoSync ? s.lastSync?.dir ?? null : null,
  };
}

/* ---------------- 工程 ---------------- */

export function projectNew(s: StudioState, args: { name: string; frameRate?: number }): unknown {
  const ske = emptySkeleton({ name: args.name, frameRate: args.frameRate ?? 24 } as never) as unknown as DbSkeletonData;
  const arm = ske.armature?.[0];
  if (arm) {
    if (!arm.bone?.length) arm.bone = [{ name: 'root', transform: {} } as never];
    if (!arm.animation?.length) arm.animation = [{ name: 'idle', duration: 24, playTimes: 0, bone: [], slot: [] } as never];
    arm.skin ??= [{ name: '', slot: [] } as never];
    arm.slot ??= [];
  }
  const page: RasterImage = { width: 4, height: 4, rgba: new Uint8Array(64) };
  const tex = { name: args.name, imagePath: `${args.name}_tex.png`, width: 4, height: 4, SubTexture: [] } as DbTextureAtlasData;
  setProject(s, args.name, ske, tex, page);
  s.autoSync = true;
  sync(s);
  return summary(s);
}

export function projectImport(s: StudioState, args: { path: string; name?: string; prefer?: 'dragonbones' | 'spine' | 'layers'; sync?: boolean }): unknown {
  const pkg = importCharacter(args.path, { name: args.name, prefer: args.prefer });
  setProject(s, pkg.name, JSON.parse(JSON.stringify(pkg.ske)), pkg.tex, decodePng(pkg.png));
  s.autoSync = args.sync !== false;
  if (s.autoSync) sync(s);
  return { ...summary(s), source: pkg.source, from: pkg.from };
}

export function projectOpen(s: StudioState, args: { name?: string; file?: string; texture?: string; image?: string }): unknown {
  if (args.name) {
    const w = loadFromWorkspace(args.name);
    setProject(s, args.name, w.ske, w.tex, decodePng(w.png));
    s.autoSync = true; s.lastSync = { dir: w.dir };
    s.path = join(w.dir, `${args.name}_ske.json`);
    return summary(s);
  }
  if (!args.file) throw new Error('give name (workspace project) or file');
  const tex = args.texture ? JSON.parse(readFileSync(args.texture, 'utf8')) as DbTextureAtlasData : null;
  const img = args.image ?? (tex && args.texture ? join(dirname(args.texture), tex.imagePath) : undefined);
  const page = img && existsSync(img) ? decodePng(readFileSync(img)) : null;
  const doc = JSON.parse(readFileSync(args.file, 'utf8'));
  setProject(s, String(doc.name ?? 'project'), doc, tex, page);
  s.autoSync = false; s.path = args.file;
  return summary(s);
}

export function projectSave(s: StudioState, args: { name?: string }): unknown {
  if (args.name) s.name = args.name;
  s.autoSync = true;
  const r = sync(s);
  return { ...summary(s), dir: r.dir, rev: r.rev };
}

export function projectList(): unknown {
  return { dir: projectsDir(), projects: readManifest().samples };
}

/* ---------------- 素材 / 插槽 ---------------- */

function boneWorlds(arm: DbArmatureData): Mat2D[] { return new Skeleton(arm).bindWorld; }

/** 把一张 PNG 放进图集（整页重排），返回区域名 */
function addRegion(s: StudioState, name: string, img: RasterImage): string {
  const tex = s.tex ?? ({ name: s.name, imagePath: `${s.name}_tex.png`, SubTexture: [] } as DbTextureAtlasData);
  const page = s.page ?? { width: 1, height: 1, rgba: new Uint8Array(4) };
  const existing = (tex.SubTexture ?? []).filter((t) => t.name !== name).map((t) => ({ meta: t, img: cropRaster(page, t.x, t.y, t.width, t.height) }));
  const sources = [...existing.map((e) => ({ name: e.meta.name, width: e.meta.width, height: e.meta.height, frameX: e.meta.frameX, frameY: e.meta.frameY, frameWidth: e.meta.frameWidth, frameHeight: e.meta.frameHeight })), { name, width: img.width, height: img.height }];
  const packed = packAtlas(sources, { padding: 2, maxWidth: 2048 });
  const out: RasterImage = { width: packed.width, height: packed.height, rgba: new Uint8Array(packed.width * packed.height * 4) };
  packed.placements.forEach((p, i) => blitRaster(out, i < existing.length ? existing[i].img : img, p.x, p.y));
  s.tex = serializeTextureAtlas(packed, { imagePath: `${s.name}_tex.png`, name: s.name });
  s.page = out;
  return name;
}

export function imageAdd(s: StudioState, args: { file: string; slot?: string; bone?: string; x?: number; y?: number; rotation?: number; region?: string; scale?: number; scaleX?: number; scaleY?: number }): unknown {
  const arm = armatureOf(s);
  const img = decodePng(readFileSync(args.file));
  const region = args.region ?? args.file.replace(/^.*[/\\]/, '').replace(/\.png$/i, '');
  return write(s, () => {
    addRegion(s, region, img);
    const bone = args.bone ?? arm.bone[0]?.name;
    let slotName = args.slot ?? region;
    let slot = arm.slot.find((x) => x.name === slotName);
    if (!slot) { const made = addSlot(need(s), bone, slotName); if (!made) throw new Error(`unknown bone: ${bone}`); slotName = made; slot = arm.slot.find((x) => x.name === slotName)!; }
    const skin = arm.skin?.[0] ?? (arm.skin = [{ name: '', slot: [] } as never])[0];
    let ss = skin.slot.find((x) => x.name === slotName);
    if (!ss) { ss = { name: slotName, display: [] }; skin.slot.push(ss); }
    const scX = args.scaleX ?? args.scale, scY = args.scaleY ?? args.scale;
    for (const [k, v] of [['scale', scX], ['scaleY', scY]] as const) if (v !== undefined && (!Number.isFinite(v) || v === 0)) throw new Error(`bad ${k}: ${v}`);
    ss.display.push({ name: region, transform: { x: args.x ?? 0, y: args.y ?? 0, ...(args.rotation ? { skX: args.rotation, skY: args.rotation } : {}), ...(scX !== undefined && scX !== 1 ? { scX } : {}), ...(scY !== undefined && scY !== 1 ? { scY } : {}) } });
    if ((slot.displayIndex ?? 0) < 0) slot.displayIndex = ss.display.length - 1;
    rebuildPlayer(s);
    return { slot: slotName, bone, region, size: [img.width, img.height], displayIndex: ss.display.length - 1, transform: ss.display[ss.display.length - 1].transform };
  });
}

/** 一次导入多层：`layers.json` 风格 [{file, name, left, top}]，坐标以画布底边中点为原点 */
export function layersAdd(s: StudioState, args: { layers: Array<{ file: string; name?: string; bone?: string; left: number; top: number }>; canvasWidth: number; canvasHeight: number }): unknown {
  const out: unknown[] = [];
  for (const l of args.layers) {
    const img = decodePng(readFileSync(l.file));
    out.push(imageAdd(s, { file: l.file, slot: l.name, bone: l.bone, x: l.left + img.width / 2 - args.canvasWidth / 2, y: l.top + img.height / 2 - args.canvasHeight }));
  }
  return { added: out.length, layers: out };
}

export function slotCreate(s: StudioState, args: { name: string; bone: string }): unknown {
  return write(s, () => { const n = addSlot(need(s), args.bone, args.name); if (!n) throw new Error(`unknown bone: ${args.bone}`); return { slot: n }; });
}

export interface DisplayTransformArgs { x?: number; y?: number; rotation?: number; skX?: number; skY?: number; scaleX?: number; scaleY?: number; scale?: number; pivotX?: number; pivotY?: number }

export function slotUpdate(s: StudioState, args: { slot: string; bone?: string; displayIndex?: number; attachment?: string; color?: Record<string, number>; blendMode?: string; zIndex?: number; transform?: DisplayTransformArgs; display?: number | string; mode?: 'set' | 'offset' }): unknown {
  const arm = armatureOf(s);
  return write(s, () => {
    const i = arm.slot.findIndex((x) => x.name === args.slot);
    if (i < 0) throw new Error(`unknown slot: ${args.slot}`);
    const slot = arm.slot[i];
    if (args.bone) {
      if (!arm.bone.some((b) => b.name === args.bone)) throw new Error(`unknown bone: ${args.bone}`);
      // 保持世界位置：把显示对象（所有 skin、含缩放/斜切）的局部变换换算到新骨骼
      const W = boneWorlds(arm);
      rebaseSlotDisplays(arm, slot.name, W[arm.bone.findIndex((b) => b.name === slot.parent)], W[arm.bone.findIndex((b) => b.name === args.bone)]);
      slot.parent = args.bone;
    }
    if (args.attachment !== undefined) {
      const list = arm.skin?.[0]?.slot.find((x) => x.name === slot.name)?.display ?? [];
      const k = args.attachment === '' ? -1 : list.findIndex((d) => (d.name ?? d.path) === args.attachment);
      if (args.attachment !== '' && k < 0) throw new Error(`slot ${slot.name} has no display ${args.attachment}`);
      slot.displayIndex = k;
    }
    if (args.displayIndex !== undefined) slot.displayIndex = args.displayIndex;
    if (args.color) slot.color = { ...(slot.color ?? {}), ...args.color };
    if (args.blendMode) slot.blendMode = args.blendMode;
    if (args.zIndex !== undefined) {
      arm.slot.splice(i, 1);
      arm.slot.splice(Math.max(0, Math.min(arm.slot.length, args.zIndex)), 0, slot);
      arm.slot.forEach((x) => { if (x.z !== undefined) delete x.z; });
    }
    let display: unknown;
    if (args.transform && Object.keys(args.transform).length) display = setDisplayTransform(arm, slot.name, args.display, args.transform, args.mode ?? 'set');
    return { slot: slot.name, bone: slot.parent, displayIndex: slot.displayIndex ?? 0, zIndex: arm.slot.indexOf(slot), ...(display ? { display } : {}) };
  });
}

/**
 * 改槽位显示对象的变换（相对父骨骼）。display = 显示索引或名字（默认当前显示，隐藏时用 0）。
 * mode set：给出的分量直接覆盖；offset：x/y/rotation 为增量、scale* 为倍率。
 * 未加权网格：顶点整体做同样的仿射变化；加权网格不支持（顶点在绑定空间）。
 */
function setDisplayTransform(arm: DbArmatureData, slotName: string, which: number | string | undefined, t: DisplayTransformArgs, mode: 'set' | 'offset'): unknown {
  for (const [k, v] of Object.entries(t)) if (v !== undefined && !Number.isFinite(v)) throw new Error(`bad transform.${k}: ${v}`);
  const slot = arm.slot.find((x) => x.name === slotName)!;
  const list = arm.skin?.[0]?.slot.find((x) => x.name === slotName)?.display ?? [];
  const idx = typeof which === 'string' ? list.findIndex((d) => (d.name ?? d.path) === which) : which ?? Math.max(0, slot.displayIndex ?? 0);
  const d = list[idx];
  if (!d) throw new Error(`slot ${slotName} has no display ${which ?? idx}`);
  if (d.weights?.length) throw new Error(`${slotName} 是加权网格，显示变换无意义（改骨骼或用 mesh_stretch）`);
  const sx = t.scaleX ?? t.scale, sy = t.scaleY ?? t.scale;
  const old = { ...(d.transform ?? {}) };
  const next = { ...old };
  if (mode === 'offset') {
    if (t.x !== undefined) next.x = (old.x ?? 0) + t.x;
    if (t.y !== undefined) next.y = (old.y ?? 0) + t.y;
    if (t.rotation !== undefined) { next.skX = (old.skX ?? 0) + t.rotation; next.skY = (old.skY ?? 0) + t.rotation; }
    if (t.skX !== undefined) next.skX = (next.skX ?? 0) + t.skX;
    if (t.skY !== undefined) next.skY = (next.skY ?? 0) + t.skY;
    if (sx !== undefined) next.scX = (old.scX ?? 1) * sx;
    if (sy !== undefined) next.scY = (old.scY ?? 1) * sy;
  } else {
    if (t.x !== undefined) next.x = t.x;
    if (t.y !== undefined) next.y = t.y;
    if (t.rotation !== undefined) { const skew = (old.skX ?? 0) - (old.skY ?? 0); next.skY = t.rotation; next.skX = t.rotation + skew; }
    if (t.skX !== undefined) next.skX = t.skX;
    if (t.skY !== undefined) next.skY = t.skY;
    if (sx !== undefined) next.scX = sx;
    if (sy !== undefined) next.scY = sy;
  }
  for (const k of ['x', 'y', 'skX', 'skY', 'scX', 'scY'] as const) if (next[k] !== undefined) next[k] = +next[k]!.toFixed(4);
  if (d.type === 'mesh' && d.vertices) {
    // 未加权网格：顶点在父骨骼空间，按 新矩阵·旧矩阵⁻¹ 变换
    const M = multiply(matFromTransform(next), invert(matFromTransform(old)));
    for (let k = 0; k + 1 < d.vertices.length; k += 2) { const [x, y] = apply(M, d.vertices[k], d.vertices[k + 1]); d.vertices[k] = +x.toFixed(3); d.vertices[k + 1] = +y.toFixed(3); }
  }
  d.transform = next;
  if (t.pivotX !== undefined || t.pivotY !== undefined) d.pivot = { x: t.pivotX ?? d.pivot?.x ?? 0.5, y: t.pivotY ?? d.pivot?.y ?? 0.5 };
  return { index: idx, name: d.name ?? d.path, transform: d.transform, ...(d.pivot ? { pivot: d.pivot } : {}) };
}

/** 图片显示对象 → 网格（cols×rows 网格，轮廓顶点在前 → Spine hull 正确） */
export function meshCreate(s: StudioState, args: { slot: string; cols?: number; rows?: number; display?: number }): unknown {
  const arm = armatureOf(s);
  return write(s, () => {
    const ss = arm.skin?.[0]?.slot.find((x) => x.name === args.slot);
    const slot = arm.slot.find((x) => x.name === args.slot);
    const d = ss?.display?.[args.display ?? Math.max(0, slot?.displayIndex ?? 0)];
    if (!d) throw new Error(`slot ${args.slot} has no display`);
    if (d.type === 'mesh') throw new Error('already a mesh');
    const sub = s.tex?.SubTexture.find((t) => t.name === (d.path ?? d.name));
    if (!sub) throw new Error(`region not found: ${d.path ?? d.name}`);
    const w = d.width ?? sub.frameWidth ?? sub.width, h = d.height ?? sub.frameHeight ?? sub.height;
    const cols = Math.max(1, Math.round(args.cols ?? 2)), rows = Math.max(1, Math.round(args.rows ?? 2));
    const px = w * (d.pivot?.x ?? 0.5), py = h * (d.pivot?.y ?? 0.5);
    const M = matFromTransform(d.transform);
    const grid: Array<[number, number]> = [];
    for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) grid.push([c / cols, r / rows]);
    const gi = (c: number, r: number) => r * (cols + 1) + c;
    const ring: number[] = [];
    for (let c = 0; c < cols; c++) ring.push(gi(c, 0));
    for (let r = 0; r < rows; r++) ring.push(gi(cols, r));
    for (let c = cols; c > 0; c--) ring.push(gi(c, rows));
    for (let r = rows; r > 0; r--) ring.push(gi(0, r));
    const order = [...ring, ...grid.map((_, i) => i).filter((i) => !ring.includes(i))];
    const remap = new Map(order.map((g, i) => [g, i]));
    const vertices: number[] = [], uvs: number[] = [];
    for (const g of order) {
      const [u, v] = grid[g];
      // 网格顶点 uv 是相对区域（裁切后）矩形；这里区域未裁切时两者一致
      const [x, y] = apply(M, u * w - px, v * h - py);
      vertices.push(+x.toFixed(3), +y.toFixed(3)); uvs.push(+u.toFixed(6), +v.toFixed(6));
    }
    const triangles: number[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const a = remap.get(gi(c, r))!, b = remap.get(gi(c + 1, r))!, cc = remap.get(gi(c + 1, r + 1))!, dd = remap.get(gi(c, r + 1))!;
      triangles.push(a, b, cc, a, cc, dd);
    }
    const edges: number[] = [];
    for (let i = 0; i < ring.length; i++) edges.push(i, (i + 1) % ring.length);
    const mesh: DbDisplayData = { type: 'mesh', name: d.name, ...(d.path ? { path: d.path } : {}), width: w, height: h, vertices, uvs, triangles, edges, userEdges: [] };
    Object.keys(d).forEach((k) => delete (d as Record<string, unknown>)[k]);
    Object.assign(d, mesh);
    return { slot: args.slot, vertices: vertices.length / 2, triangles: triangles.length / 3, hull: ring.length };
  });
}

/** 自动权重：按顶点到骨骼线段的距离（反距离平方），每顶点最多 `maxInfluences` 根骨骼 */
export function weightsAuto(s: StudioState, args: { slot: string; bones: string[]; maxInfluences?: number; falloff?: number }): unknown {
  const arm = armatureOf(s);
  return write(s, () => {
    const slot = arm.slot.find((x) => x.name === args.slot);
    const d = arm.skin?.[0]?.slot.find((x) => x.name === args.slot)?.display?.[Math.max(0, slot?.displayIndex ?? 0)];
    if (!slot || !d || d.type !== 'mesh' || !d.vertices) throw new Error(`${args.slot} is not a mesh (call mesh_create first)`);
    const W = boneWorlds(arm);
    const idx = args.bones.map((n) => { const i = arm.bone.findIndex((b) => b.name === n); if (i < 0) throw new Error(`unknown bone: ${n}`); return i; });
    const slotW = W[arm.bone.findIndex((b) => b.name === slot.parent)];
    const sp = d.slotPose && d.slotPose.length >= 6 ? d.slotPose as unknown as Mat2D : null;
    const worldPts: Array<[number, number]> = [];
    const vc = d.vertices.length / 2;
    let wk = 0;
    for (let v = 0; v < vc; v++) {
      const x = d.vertices[v * 2], y = d.vertices[v * 2 + 1];
      if (d.weights?.length) { // 已加权：顶点已在 bind 空间
        worldPts.push(sp ? apply(sp, x, y) : [x, y]);
        wk += 1 + 2 * d.weights[wk];
      } else worldPts.push(apply(slotW, x, y));
    }
    const segs = idx.map((i) => {
      const m = W[i];
      const len = arm.bone[i].length ?? 0;
      return { a: [m[4], m[5]] as [number, number], b: [m[4] + m[0] * len, m[5] + m[1] * len] as [number, number] };
    });
    const dist = (p: [number, number], sg: { a: [number, number]; b: [number, number] }) => {
      const dx = sg.b[0] - sg.a[0], dy = sg.b[1] - sg.a[1];
      const l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - sg.a[0]) * dx + (p[1] - sg.a[1]) * dy) / l2)) : 0;
      return Math.hypot(p[0] - sg.a[0] - t * dx, p[1] - sg.a[1] - t * dy);
    };
    const maxN = Math.max(1, args.maxInfluences ?? 2), pw = args.falloff ?? 2;
    const weights: number[] = [];
    for (const p of worldPts) {
      const ws = segs.map((sg, k) => ({ k, w: 1 / Math.pow(dist(p, sg) + 1, pw) })).sort((a, b) => b.w - a.w).slice(0, maxN);
      const sum = ws.reduce((t, x) => t + x.w, 0);
      weights.push(ws.length, ...ws.flatMap((x) => [idx[x.k], +(x.w / sum).toFixed(4)]));
    }
    const verts: number[] = [];
    worldPts.forEach(([x, y]) => verts.push(+x.toFixed(3), +y.toFixed(3)));
    d.vertices = verts;
    d.weights = weights;
    d.slotPose = [1, 0, 0, 1, 0, 0];
    d.bonePose = [...new Set(idx)].sort((a, b) => a - b).flatMap((i) => [i, ...W[i]]);
    return { slot: args.slot, vertices: vc, bones: args.bones };
  });
}

/** 精确设置某顶点的权重 {bone: weight}（会归一化） */
export function weightsSet(s: StudioState, args: { slot: string; vertex: number; weights: Record<string, number> }): unknown {
  const arm = armatureOf(s);
  return write(s, () => {
    const slot = arm.slot.find((x) => x.name === args.slot);
    const d = arm.skin?.[0]?.slot.find((x) => x.name === args.slot)?.display?.[Math.max(0, slot?.displayIndex ?? 0)];
    if (!d?.weights?.length || !d.vertices) throw new Error(`${args.slot} has no weights (call weights_auto first)`);
    const rows: number[][] = [];
    let k = 0;
    for (let v = 0; v < d.vertices.length / 2; v++) { const n = d.weights[k]; rows.push(d.weights.slice(k, k + 1 + 2 * n)); k += 1 + 2 * n; }
    const entries = Object.entries(args.weights).map(([n, w]) => { const i = arm.bone.findIndex((b) => b.name === n); if (i < 0) throw new Error(`unknown bone: ${n}`); return [i, w] as [number, number]; });
    const sum = entries.reduce((t, e) => t + e[1], 0) || 1;
    if (args.vertex < 0 || args.vertex >= rows.length) throw new Error('vertex out of range');
    rows[args.vertex] = [entries.length, ...entries.flatMap(([i, w]) => [i, +(w / sum).toFixed(4)])];
    d.weights = rows.flat();
    const W = boneWorlds(arm);
    const pose = new Map<number, number[]>();
    for (let i = 0; i + 6 < (d.bonePose ?? []).length; i += 7) pose.set(d.bonePose![i], d.bonePose!.slice(i + 1, i + 7));
    for (const [i] of entries) if (!pose.has(i)) pose.set(i, [...W[i]]);
    d.bonePose = [...pose.entries()].sort((a, b) => a[0] - b[0]).flatMap(([i, m]) => [i, ...m]);
    return { slot: args.slot, vertex: args.vertex, weights: rows[args.vertex] };
  });
}

/* ---------------- 动画 / 关键帧 ---------------- */

export function animationCreate(s: StudioState, args: { name: string; duration?: number; playTimes?: number; from?: string }): unknown {
  const p = need(s);
  return write(s, () => {
    const made = args.from ? cloneAnimation(p, args.from) : addAnimation(p, args.name);
    if (!made) throw new Error('could not create animation');
    const anim = p.skeleton.armature.animation!.find((a) => a.name === made)!;
    if (args.from && made !== args.name && !p.skeleton.armature.animation!.some((a) => a.name === args.name)) anim.name = args.name;
    if (args.duration) setAnimationDuration(p, anim.name, args.duration);
    if (args.playTimes !== undefined) anim.playTimes = args.playTimes;
    return { animation: anim.name, duration: anim.duration, playTimes: anim.playTimes ?? 0 };
  });
}

export function animationUpdate(s: StudioState, args: { animation: string; duration?: number; playTimes?: number; rename?: string; remove?: boolean }): unknown {
  const p = need(s);
  return write(s, () => {
    if (args.remove) { if (!removeAnimation(p, args.animation)) throw new Error('remove failed'); return { removed: args.animation }; }
    const anim = p.skeleton.armature.animation?.find((a) => a.name === args.animation);
    if (!anim) throw new Error(`unknown animation: ${args.animation}`);
    if (args.duration) setAnimationDuration(p, anim.name, args.duration);
    if (args.playTimes !== undefined) anim.playTimes = args.playTimes;
    if (args.rename) anim.name = args.rename;
    return { animation: anim.name, duration: anim.duration, playTimes: anim.playTimes ?? 0 };
  });
}

function useAnimation(p: Player, name?: string) {
  if (name && p.animation?.name !== name) {
    if (!p.animationNames().includes(name)) throw new Error(`unknown animation: ${name}`);
    p.setAnimation(name);
  }
  if (!p.animation) throw new Error('no animation — call animation_create first');
  p.setupPose = false;
  return p.animation;
}

type CF = { duration: number; tweenEasing?: number | null; curve?: number[]; x?: number; y?: number; rotate?: number; skew?: number };

/** 返回**新数组**：运行时按数组身份缓存展开后的旋转值（rotationCache），原地改会读到旧缓存 → NaN */
function putKey(list: CF[], at: number, total: number, values: Partial<CF>, tween: { tweenEasing?: number | null; curve?: number[] }, identity: Partial<CF>): CF[] {
  const items: Array<{ at: number; f: CF }> = [];
  let t = 0;
  for (const f of list) { items.push({ at: t, f: { ...f } }); t += f.duration ?? 0; }
  if (items.length === 0 && at > 0) items.push({ at: 0, f: { duration: 0, tweenEasing: 0, ...identity } });
  const hit = items.find((i) => Math.abs(i.at - at) < 1e-6);
  if (hit) {
    Object.assign(hit.f, values, tween.tweenEasing !== undefined ? { tweenEasing: tween.tweenEasing } : {}, tween.curve ? { curve: tween.curve } : {});
    // 显式给了非 bezier 补间（linear / stepped / 数字）时清掉旧 curve，否则旧曲线会一直残留
    if (tween.tweenEasing !== undefined && !tween.curve) delete (hit.f as { curve?: number[] }).curve;
  }
  else {
    // 新键的初值：前一键值（保持未给出的分量）
    const prev = [...items].reverse().find((i) => i.at < at)?.f ?? identity;
    const base: CF = { duration: 0, tweenEasing: tween.tweenEasing === undefined ? 0 : tween.tweenEasing, ...(tween.curve ? { curve: tween.curve } : {}) };
    for (const k of Object.keys(identity) as Array<keyof CF>) (base as Record<string, unknown>)[k] = (prev as Record<string, unknown>)[k] ?? identity[k];
    items.push({ at, f: Object.assign(base, values) });
  }
  items.sort((a, b) => a.at - b.at);
  const out = items.map((it, i) => ({ ...it.f, duration: i < items.length - 1 ? items[i + 1].at - it.at : Math.max(0, total - it.at) }));
  for (const f of out) { if (f.tweenEasing === null) delete f.tweenEasing; }
  return out;
}

/**
 * 通道关键帧（**相对绑定姿态**的增量，与 DragonBones 5.x / Spine 时间轴语义一致）：
 * rotate=角度（顺时针为正，y 向下）、x/y=位移、scaleX/scaleY=缩放倍率。
 * easing: 'linear' | 'stepped' | 数字（DB tweenEasing）| [x1,y1,x2,y2] bezier。
 */
export function boneKey(s: StudioState, args: { bone: string; frame: number; animation?: string; rotate?: number; shear?: number; x?: number; y?: number; scaleX?: number; scaleY?: number; easing?: unknown; remove?: boolean }): unknown {
  const p = need(s);
  return write(s, () => {
    const anim = useAnimation(p, args.animation);
    if (!p.skeleton.armature.bone.some((b) => b.name === args.bone)) throw new Error(`unknown bone: ${args.bone}`);
    anim.bone ??= [];
    let tl = anim.bone.find((t) => t.name === args.bone) as DbBoneTimeline | undefined;
    if (!tl) { tl = { name: args.bone } as DbBoneTimeline; anim.bone.push(tl); }
    if ((tl.frame?.length ?? 0) > 0) throw new Error(`${args.bone} uses the merged 4.x frame[] form; use bone_keyframe_set (absolute) instead`);
    const at = Math.max(0, Math.min(anim.duration, Math.round(args.frame)));
    const tween: { tweenEasing?: number | null; curve?: number[] } = {};
    if (args.easing === 'stepped') tween.tweenEasing = NaN;
    else if (args.easing === 'linear') tween.tweenEasing = 0;
    else if (typeof args.easing === 'number') tween.tweenEasing = args.easing;
    else if (Array.isArray(args.easing)) { tween.curve = args.easing as number[]; tween.tweenEasing = 0; }
    const t = tl as DbBoneTimeline & { translateFrame?: CF[]; rotateFrame?: CF[]; scaleFrame?: CF[] };
    if (args.remove) {
      for (const key of ['translateFrame', 'rotateFrame', 'scaleFrame'] as const) {
        const list = t[key] ? t[key]!.map((f) => ({ ...f })) : null; if (!list?.length) continue;
        t[key] = list;
        let pos = 0; const idx = list.findIndex((f) => { const hit = Math.abs(pos - at) < 1e-6; pos += f.duration ?? 0; return hit; });
        if (idx > 0) { list[idx - 1].duration += list[idx].duration; list.splice(idx, 1); }
      }
    } else {
      if (args.x !== undefined || args.y !== undefined) t.translateFrame = putKey(t.translateFrame ?? [], at, anim.duration, { ...(args.x !== undefined ? { x: args.x } : {}), ...(args.y !== undefined ? { y: args.y } : {}) }, tween, { x: 0, y: 0 });
      if (args.rotate !== undefined || args.shear !== undefined) t.rotateFrame = putKey(t.rotateFrame ?? [], at, anim.duration, { ...(args.rotate !== undefined ? { rotate: args.rotate } : {}), ...(args.shear !== undefined ? { skew: args.shear } : {}) }, tween, { rotate: 0, ...(args.shear !== undefined || (t.rotateFrame ?? []).some((f) => f.skew !== undefined) ? { skew: 0 } : {}) });
      if (args.scaleX !== undefined || args.scaleY !== undefined) t.scaleFrame = putKey(t.scaleFrame ?? [], at, anim.duration, { ...(args.scaleX !== undefined ? { x: args.scaleX } : {}), ...(args.scaleY !== undefined ? { y: args.scaleY } : {}) }, tween, { x: 1, y: 1 });
    }
    const keysOf = (l?: CF[]) => { let q = 0; return (l ?? []).map((f) => { const at0 = q; q += f.duration; return at0; }); };
    return { bone: args.bone, animation: anim.name, frame: at, keys: { translate: keysOf(t.translateFrame), rotate: keysOf(t.rotateFrame), scale: keysOf(t.scaleFrame) } };
  });
}

/** 一次写多帧：keys=[{bone, frame, rotate?, x?, y?, scaleX?, scaleY?, easing?}] */
export function boneKeys(s: StudioState, args: { animation?: string; keys: Array<Parameters<typeof boneKey>[1]> }): unknown {
  const auto = s.autoSync; s.autoSync = false;
  let n = 0;
  try { for (const k of args.keys) { boneKey(s, { animation: args.animation, ...k }); n++; } } finally { s.autoSync = auto; }
  const synced = s.autoSync ? sync(s).dir : null;
  return { written: n, synced };
}

/** 组件形式（5.x displayFrame / colorFrame）的插槽键：按帧位置插入或覆盖，返回新数组 */
function putSlotFrame<T extends { duration?: number }>(list: T[], at: number, total: number, patch: Partial<T>, initial: T): T[] {
  const items: Array<{ at: number; f: T }> = [];
  let t = 0;
  for (const f of list) { items.push({ at: t, f: { ...f } }); t += f.duration ?? 1; }
  if (items.length === 0 && at > 0) items.push({ at: 0, f: { ...initial } });
  const hit = items.find((i) => i.at === at);
  if (hit) Object.assign(hit.f, patch);
  else {
    const prev = [...items].reverse().find((i) => i.at < at)?.f ?? initial;
    items.push({ at, f: { ...prev, ...patch } });
  }
  items.sort((a, b) => a.at - b.at);
  return items.map((it, i) => ({ ...it.f, duration: i < items.length - 1 ? items[i + 1].at - it.at : Math.max(0, total - it.at) }));
}

/**
 * 插槽关键帧。注：编辑器原有的 `setSlotDisplayKeyframe` 在空时间轴上追加时会把值写给「该帧之前」的区间
 * （见 docs/MCP.md「已知问题」），所以 MCP 这里直接写 5.x 组件时间轴。
 */
export function slotKey(s: StudioState, args: { slot: string; frame: number; animation?: string; color?: Record<string, number>; attachment?: string; displayIndex?: number; easing?: unknown }): unknown {
  const p = need(s);
  return write(s, () => {
    const anim = useAnimation(p, args.animation);
    const arm = p.skeleton.armature;
    const slot = arm.slot.find((x) => x.name === args.slot);
    if (!slot) throw new Error(`unknown slot: ${args.slot}`);
    anim.slot ??= [];
    let tl = anim.slot.find((x) => x.name === args.slot);
    if (!tl) { tl = { name: args.slot }; anim.slot.push(tl); }
    const at = Math.max(0, Math.min(anim.duration, Math.round(args.frame)));
    const out: Record<string, unknown> = { slot: args.slot, frame: at };
    if ((tl.frame?.length ?? 0) > 0) {
      // 4.x 合并帧形态：交给编辑器原有函数
      if (args.color && !setSlotColorKeyframe(p, args.slot, at, { aM: 100, rM: 100, gM: 100, bM: 100, ...args.color })) throw new Error('color key failed');
      const idx = resolveDisplay(arm, args);
      if (idx !== undefined && !setSlotDisplayKeyframe(p, args.slot, at, idx)) throw new Error('display key failed');
      return { ...out, form: 'merged' };
    }
    if (args.color) {
      const tween = args.easing === 'stepped' ? { tweenEasing: NaN } : Array.isArray(args.easing) ? { tweenEasing: 0, curve: args.easing as number[] } : { tweenEasing: typeof args.easing === 'number' ? args.easing : 0 };
      const base = { aM: 100, rM: 100, gM: 100, bM: 100, ...(slot.color ?? {}) };
      type ColorKey = { duration?: number; tweenEasing?: number; curve?: number[]; value?: Record<string, number> };
      tl.colorFrame = putSlotFrame<ColorKey>((tl.colorFrame ?? []) as ColorKey[], at, anim.duration, { ...tween, value: { ...base, ...args.color } }, { duration: 0, tweenEasing: 0, value: base }) as never;
      out.color = args.color;
    }
    const idx = resolveDisplay(arm, args);
    if (idx !== undefined) {
      type DisplayKey = { duration?: number; value?: number };
      tl.displayFrame = putSlotFrame<DisplayKey>((tl.displayFrame ?? []) as DisplayKey[], at, anim.duration, { value: idx }, { duration: 0, value: slot.displayIndex ?? 0 }) as never;
      out.displayIndex = idx;
    }
    return out;
  });
}

function resolveDisplay(arm: DbArmatureData, args: { slot: string; attachment?: string; displayIndex?: number }): number | undefined {
  if (args.attachment === undefined) return args.displayIndex;
  if (args.attachment === '') return -1;
  const list = arm.skin?.[0]?.slot.find((x) => x.name === args.slot)?.display ?? [];
  const idx = list.findIndex((d) => (d.name ?? d.path) === args.attachment);
  if (idx < 0) throw new Error(`no display ${args.attachment} on ${args.slot}`);
  return idx;
}

/** 绘制顺序关键帧：order = 插槽名（底→顶）；给子集时其余插槽按原相对顺序填进剩下的位置 */
export function drawOrderKey(s: StudioState, args: { frame: number; animation?: string; order?: string[]; remove?: boolean }): unknown {
  const p = need(s);
  return write(s, () => {
    const anim = useAnimation(p, args.animation);
    const at = Math.max(0, Math.min(anim.duration, Math.round(args.frame)));
    p.seek(at);
    if (args.remove) { if (!removeZOrderKeyframe(p, at)) throw new Error(`no draw-order key at frame ${at}`); return { frame: at, removed: true }; }
    const slots = p.skeleton.armature.slot.map((x) => x.name);
    const names = args.order ?? [];
    if (!names.length) throw new Error('order required (slot names, bottom → top)');
    for (const n of names) if (!slots.includes(n)) throw new Error(`unknown slot: ${n}`);
    if (new Set(names).size !== names.length) throw new Error('order has duplicates');
    let full: string[];
    if (names.length === slots.length) full = names;
    else {
      // 子集：这些插槽占据它们原来位置的集合，按给定顺序重排
      const pos = names.map((n) => slots.indexOf(n)).sort((a, b) => a - b);
      full = [...slots]; pos.forEach((q, i) => { full[q] = names[i]; });
    }
    // 时间轴第一帧之前运行时会沿用第一帧 → 在 0 帧补一个「绑定顺序」键，键前保持原顺序
    if (at > 0 && !(anim.zOrder?.frame?.length)) { p.seek(0); if (!setZOrderKeyframe(p, slots.map((_, i) => i))) throw new Error('draw-order key failed'); p.seek(at); }
    if (!setZOrderKeyframe(p, full.map((n) => slots.indexOf(n)))) throw new Error('draw-order key failed');
    return { frame: at, animation: anim.name, order: full };
  });
}

export function eventKey(s: StudioState, args: { frame: number; name: string; animation?: string; kind?: 'event' | 'sound' | 'action' }): unknown {
  const p = need(s);
  return write(s, () => {
    useAnimation(p, args.animation);
    if (!addEventFrame(p, args.frame, args.kind === 'sound' || args.kind === 'action' ? args.kind : 'custom', args.name)) throw new Error('event add failed');
    return { frame: args.frame, name: args.name };
  });
}

/* ---------------- 预览 ---------------- */

function renderSetup(s: StudioState, animation?: string): { p: Player; pages: RasterImage[] } {
  const p = need(s);
  if (!s.page) throw new Error('project has no atlas image');
  if (animation) useAnimation(p, animation); else if (p.animation) p.setupPose = false;
  return { p, pages: [s.page] };
}

const BG: Record<string, [number, number, number, number]> = { transparent: [0, 0, 0, 0], light: [232, 232, 232, 255], dark: [40, 42, 48, 255], white: [255, 255, 255, 255] };

type RenderView = { fit?: 'geometry' | 'content'; bounds?: [number, number, number, number]; bones?: 'off' | 'on' | 'only' | boolean; showBones?: boolean };

/** 取景：显式 bounds > fit:'content'（按不透明像素，图集重排/透明边不影响）> 'geometry'（默认，四边形几何，旧行为） */
function viewBounds(p: Player, page: RasterImage, args: RenderView, frames?: number[]): Bounds {
  if (args.bounds) {
    const [minX, minY, maxX, maxY] = args.bounds;
    if (![minX, minY, maxX, maxY].every(Number.isFinite) || maxX <= minX || maxY <= minY) throw new Error('bounds must be [minX,minY,maxX,maxY] with max>min');
    return { minX, minY, maxX, maxY };
  }
  return args.fit === 'content' ? animationContentBounds(p, page, frames) : animationBounds(p, frames);
}
function bonesMode(args: RenderView): 'off' | 'on' | 'only' {
  if (args.bones === true || args.showBones === true) return 'on';
  return args.bones === 'on' || args.bones === 'only' ? args.bones : 'off';
}
function renderWithBones(p: Player, pages: RasterImage[], opts: { width: number; height: number; bounds: Bounds; background: [number, number, number, number] }, mode: 'off' | 'on' | 'only'): RasterImage {
  if (mode === 'only') {
    const img: RasterImage = { width: opts.width, height: opts.height, rgba: new Uint8Array(opts.width * opts.height * 4) };
    for (let i = 0; i < opts.width * opts.height; i++) img.rgba.set(opts.background, i * 4);
    drawBoneOverlay(img, p, opts.bounds);
    return img;
  }
  const img = renderPlayer(p, pages, opts);
  if (mode === 'on') drawBoneOverlay(img, p, opts.bounds);
  return img;
}
const roundBounds = (b: Bounds) => [b.minX, b.minY, b.maxX, b.maxY].map((v) => +v.toFixed(3));

/**
 * bones：'off'（默认，只画部件像素）/ 'on'（部件 + 骨骼叠加层）/ 'only'（只画骨骼，同取景，可透明底）。
 * 返回实际用的 bounds，下次传回去即可得到完全相同取景的图。
 */
export function renderFrame(s: StudioState, args: { out: string; animation?: string; frame?: number; width?: number; height?: number; background?: string; setup?: boolean; trim?: number } & RenderView): unknown {
  const { p, pages } = renderSetup(s, args.animation);
  if (args.setup) p.setupPose = true;
  const bounds: Bounds = args.setup ? (p.seek(0), viewBounds(p, pages[0], args, [0])) : viewBounds(p, pages[0], args);
  p.seek(args.frame ?? 0);
  const mode = bonesMode(args);
  let img = renderWithBones(p, pages, { width: args.width ?? 512, height: args.height ?? 512, bounds, background: BG[args.background ?? 'light'] ?? BG.light }, mode);
  let crop: number[] | undefined;
  if (typeof args.trim === 'number' && args.trim >= 0) {
    // 按内容裁剪：透明底看 alpha，不透明底看与背景色不同的像素
    const bg = BG[args.background ?? 'light'] ?? BG.light;
    let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      const fg = bg[3] === 0 ? img.rgba[i + 3] > 0 : (img.rgba[i] !== bg[0] || img.rgba[i + 1] !== bg[1] || img.rgba[i + 2] !== bg[2]);
      if (fg) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 >= 0) {
      const m = Math.round(args.trim);
      x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(img.width - 1, x1 + m); y1 = Math.min(img.height - 1, y1 + m);
      crop = [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
      img = cropRaster(img, x0, y0, crop[2], crop[3]);
    }
  }
  mkdirSync(dirname(resolve(args.out)), { recursive: true });
  writeFileSync(args.out, encodePng(img));
  p.setupPose = false;
  return { out: resolve(args.out), animation: p.animation?.name, frame: args.frame ?? 0, size: [img.width, img.height], bounds: roundBounds(bounds), fit: args.bounds ? 'explicit' : args.fit ?? 'geometry', bones: mode, ...(crop ? { crop } : {}) };
}

/** 渲染整段动画：frames(png 序列) / sheet(联系表) / gif / mp4（gif/mp4 需要 ffmpeg） */
export function renderAnimation(s: StudioState, args: { out: string; animation?: string; format?: 'frames' | 'sheet' | 'gif' | 'mp4'; width?: number; height?: number; step?: number; columns?: number; background?: string } & RenderView): unknown {
  const { p, pages } = renderSetup(s, args.animation);
  const fmt = args.format ?? 'sheet';
  const W = args.width ?? (fmt === 'sheet' ? 200 : 400), H = args.height ?? W;
  const bounds = viewBounds(p, pages[0], args);
  const mode = bonesMode(args);
  const step = Math.max(1, Math.round(args.step ?? (fmt === 'sheet' ? Math.max(1, Math.ceil(p.duration / 12)) : 1)));
  const frames: number[] = [];
  for (let f = 0; f < Math.max(1, p.duration); f += step) frames.push(f);
  const bg = BG[args.background ?? (fmt === 'mp4' ? 'light' : fmt === 'gif' ? 'light' : 'light')] ?? BG.light;
  const imgs = frames.map((f) => { p.seek(f); return renderWithBones(p, pages, { width: W, height: H, bounds, background: bg }, mode); });
  const out = resolve(args.out);
  if (fmt === 'sheet') {
    const cols = Math.max(1, Math.min(imgs.length, args.columns ?? 6));
    const rowsN = Math.ceil(imgs.length / cols);
    const sheet: RasterImage = { width: cols * W, height: rowsN * H, rgba: new Uint8Array(cols * W * rowsN * H * 4) };
    for (let i = 0; i < sheet.width * sheet.height; i++) sheet.rgba.set(bg, i * 4);
    imgs.forEach((im, i) => blitRaster(sheet, im, (i % cols) * W, Math.floor(i / cols) * H));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, encodePng(sheet));
    return { out, format: fmt, animation: p.animation?.name, frames, size: [sheet.width, sheet.height], bounds: roundBounds(bounds) };
  }
  const dir = fmt === 'frames' ? out : join(tmpdir(), `bs-frames-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  imgs.forEach((im, i) => writeFileSync(join(dir, `f_${String(i).padStart(4, '0')}.png`), encodePng(im)));
  if (fmt === 'frames') return { out: dir, format: fmt, animation: p.animation?.name, frames: frames.length };
  const fps = String(p.frameRate / step);
  mkdirSync(dirname(out), { recursive: true });
  const common = ['-y', '-loglevel', 'error', '-framerate', fps, '-i', join(dir, 'f_%04d.png')];
  if (fmt === 'gif') execFileSync('ffmpeg', [...common, '-vf', 'split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse', '-loop', '0', out]);
  else execFileSync('ffmpeg', [...common, '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', out]);
  rmSync(dir, { recursive: true, force: true });
  return { out, format: fmt, animation: p.animation?.name, frames: frames.length, fps: Number(fps) };
}

/* ---------------- 导出 ---------------- */

export function spineExport(s: StudioState, args: { outDir: string; version?: '4.2' | '4.1' | '3.6'; validate?: boolean; name?: string; curves?: 'auto' | 'bezier' | 'bake' }): unknown {
  const p = need(s);
  const name = args.name ?? s.name ?? 'skeleton';
  const outDir = resolve(args.outDir);
  mkdirSync(outDir, { recursive: true });
  const doc = JSON.parse(serializeSkeletonData(p.doc)) as DbSkeletonData;
  const version = args.version ?? '4.2';
  if (version === '3.6') {
    const legacy = serializeSpineSkeleton(doc, {});
    const file = join(outDir, `${name}.json`);
    writeFileSync(file, JSON.stringify(legacy.spines[0], null, 1));
    return { version, json: file, note: 'legacy 3.6 writer (no weighted meshes, no atlas)' };
  }
  const tex = s.tex ? { ...s.tex, imagePath: `${name}.png` } : null;
  const r = exportSpine4(doc, { version, texture: tex, images: './', curves: args.curves });
  const json = join(outDir, `${name}.json`);
  writeFileSync(json, JSON.stringify(r.json, null, 1));
  let atlas: string | null = null, png: string | null = null;
  if (tex && s.page) {
    atlas = join(outDir, `${name}.atlas`); writeFileSync(atlas, r.atlas);
    png = join(outDir, `${name}.png`); writeFileSync(png, encodePng(s.page));
  }
  const validation = args.validate === false || !tex ? null : summarizeValidation(validateSpineExport(r.json, r.atlas, doc, tex));
  return { version, spine: (r.json.skeleton as { spine: string }).spine, json, atlas, png, validation };
}

function summarizeValidation(v: ReturnType<typeof validateSpineExport>) {
  return { ok: v.ok, runtime: `@esotericsoftware/spine-core ${v.spineRuntime}`, bones: v.bones, slots: v.slots, maxBoneErrorPx: +v.maxBoneError.toFixed(4), maxVertexErrorPx: +v.maxVertexError.toFixed(4), animations: v.animations };
}

export function dragonbonesExport(s: StudioState, args: { outDir: string; name?: string }): unknown {
  const p = need(s);
  const name = args.name ?? s.name ?? 'skeleton';
  const outDir = resolve(args.outDir);
  mkdirSync(outDir, { recursive: true });
  const ske = join(outDir, `${name}_ske.json`);
  writeFileSync(ske, serializeSkeletonData(p.doc));
  const out: Record<string, string> = { ske };
  if (s.tex && s.page) {
    out.tex = join(outDir, `${name}_tex.json`); writeFileSync(out.tex, JSON.stringify({ ...s.tex, name, imagePath: `${name}_tex.png` }, null, 1));
    out.png = join(outDir, `${name}_tex.png`); writeFileSync(out.png, encodePng(s.page));
  }
  return out;
}

/* ---------------- 编辑器联动 ---------------- */

export async function editorUrl(s: StudioState, args: { animation?: string; frame?: number; play?: boolean }): Promise<unknown> {
  const base = await findEditorUrl();
  const name = s.name;
  const q = new URLSearchParams();
  if (name) q.set('aiproject', name);
  q.set('live', '1');
  if (args.animation) q.set('anim', args.animation);
  if (args.frame) q.set('frame', String(args.frame));
  if (args.play) q.set('play', '1');
  return {
    running: Boolean(base),
    url: base ? `${base}/?${q}` : null,
    hint: base ? 'live=1: the page updates in place (SSE) whenever the MCP writes the project' : 'start the editor: npm run dev (serves the AI workspace at /aiprojects; BONESTUDIO_PROJECTS overrides the dir)',
    workspace: projectsDir(),
  };
}

export async function editorScreenshot(s: StudioState, args: { out: string; animation?: string; frame?: number; width?: number; height?: number; waitMs?: number }): Promise<unknown> {
  if (s.autoSync && s.player) sync(s);
  const info = await editorUrl(s, args) as { url: string | null };
  if (!info.url) throw new Error('editor dev server not found (run npm run dev in the repo, or set BONESTUDIO_EDITOR_URL)');
  const chrome = process.env.CHROME_PATH ?? ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find((c) => existsSync(c));
  if (!chrome) throw new Error('no Chrome found (set CHROME_PATH)');
  const puppeteer = (await import('puppeteer-core')).default;
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: args.width ?? 1440, height: args.height ?? 900 });
    // dev server 有 HMR websocket，networkidle 永远等不到 → 等 DOM + canvas 出现
    await page.goto(info.url.replace('live=1', 'live=0'), { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('canvas', { timeout: 20000 }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, args.waitMs ?? 2500));
    mkdirSync(dirname(resolve(args.out)), { recursive: true });
    await page.screenshot({ path: resolve(args.out) as `${string}.png` });
  } finally { await browser.close(); }
  return { out: resolve(args.out), url: info.url };
}

/* ---------------- IK 约束 ---------------- */

/** 新建 / 修改 / 删除 IK 约束（DragonBones 约定：bone = 链末端，chain 1 = 双骨）。 */
export function ikSet(s: StudioState, args: { name?: string; bone?: string; target?: string; chain?: number; bendPositive?: boolean; weight?: number; remove?: boolean }): unknown {
  const arm = armatureOf(s);
  return write(s, () => {
    const existing = args.name ? (arm.ik ?? []).find((c) => c.name === args.name) : undefined;
    if (args.remove) {
      if (!args.name || !removeIkConstraint(arm, args.name)) throw new Error(`unknown ik: ${args.name}`);
      return { removed: args.name };
    }
    if (existing) {
      if (!setIkConstraint(arm, existing.name!, { bone: args.bone, target: args.target, chain: args.chain, bendPositive: args.bendPositive, weight: args.weight })) throw new Error('ik update rejected');
      // setIkConstraint 把 chain 夹到 1..2；保持 DB 约定 0/1
      existing.chain = Math.max(0, Math.min(1, Math.round(args.chain ?? existing.chain ?? 1)));
      return { ik: existing };
    }
    if (!args.bone || !args.target) throw new Error('bone and target required');
    const spec = { name: args.name, bone: args.bone, target: args.target, chain: args.chain ?? 1, bendPositive: args.bendPositive, weight: args.weight };
    const check = validateIkConstraint(arm, spec);
    if (!check.ok) throw new Error(check.reason);
    const name = addIkConstraint(arm, spec);
    if (!name) throw new Error('ik add failed');
    return { ik: (arm.ik ?? []).find((c) => c.name === name) };
  });
}

export function ikList(s: StudioState): unknown {
  return { ik: armatureOf(s).ik ?? [] };
}

/* ---------------- 吸附拼接 / 关节焊接 ---------------- */

import { boneJoints, prepareReference, type SnapReference } from '../core/snapFit';
import { currentDisplay, fitMeshContour, referenceIoU, renderToRef as renderToRefCore, setupItems, snapOrder, snapSlot } from '../core/snapAssemble';
import { extendRegion, weldMeshWeights } from '../core/jointWeld';

const refCache = new Map<string, { mtime: number; ref: SnapReference }>();
function loadReference(file: string): SnapReference {
  const st = statSync(file).mtimeMs;
  const hit = refCache.get(file);
  if (hit && hit.mtime === st) return hit.ref;
  const ref = prepareReference(decodePng(readFileSync(file)));
  refCache.set(file, { mtime: st, ref });
  return ref;
}

export function snapToReference(s: StudioState, args: { reference: string; origin?: [number, number]; scale?: number; slots?: string[]; exclude?: string[]; radius?: number; strength?: number; rotRange?: number; scaleRange?: number; joints?: boolean; apply?: boolean; passes?: number; minVisible?: number; prior?: number; overlayOut?: string }): unknown {
  const p = need(s);
  if (!s.page) throw new Error('project has no atlas image');
  const ref = loadReference(args.reference);
  const f = { origin: args.origin ?? [ref.width / 2, ref.height] as [number, number], scale: args.scale ?? 1 };
  const arm = armatureOf(s);
  const iouOf = () => { p.rebuildSkeleton(); return referenceIoU(p, s.page!, ref, f); };
  const iouBefore = iouOf();
  if (args.apply === false && !args.slots) {
    if (args.overlayOut) {
      // 叠图：参考图 50% + 当前绑定姿态 50%，红 = 只有参考有、青 = 只有部件有
      const src = decodePng(readFileSync(args.reference));
      const mine = renderToRefCore(s.page!, setupItems(p), ref, f);
      const out: RasterImage = { width: ref.width, height: ref.height, rgba: new Uint8Array(ref.width * ref.height * 4) };
      for (let i = 0; i < ref.width * ref.height; i++) {
        const a = mine.rgba[i * 4 + 3] / 255, fgm = ref.fg[i], hm = a > 0.5;
        for (let c = 0; c < 3; c++) {
          const r = src.rgba[i * 4 + c] * (src.rgba[i * 4 + 3] / 255) + 255 * (1 - src.rgba[i * 4 + 3] / 255);
          const m = mine.rgba[i * 4 + c] * a + 255 * (1 - a);
          out.rgba[i * 4 + c] = Math.round(0.5 * r + 0.5 * m);
        }
        if (fgm && !hm) out.rgba.set([230, 40, 40], i * 4); else if (hm && !fgm) out.rgba.set([0, 190, 210], i * 4);
        out.rgba[i * 4 + 3] = 255;
      }
      mkdirSync(dirname(resolve(args.overlayOut)), { recursive: true });
      writeFileSync(args.overlayOut, encodePng(out));
      // 同时输出参考图坐标系下的纯渲染（白底），方便和原图逐像素对比
      const plain: RasterImage = { width: ref.width, height: ref.height, rgba: new Uint8Array(ref.width * ref.height * 4) };
      for (let i = 0; i < ref.width * ref.height; i++) { const a = mine.rgba[i * 4 + 3] / 255; for (let c = 0; c < 3; c++) plain.rgba[i * 4 + c] = Math.round(mine.rgba[i * 4 + c] * a + 255 * (1 - a)); plain.rgba[i * 4 + 3] = 255; }
      writeFileSync(args.overlayOut.replace(/\.png$/i, '') + '_plain.png', encodePng(plain));
    }
    return { iou: iouBefore, reference: args.reference, size: [ref.width, ref.height], overlay: args.overlayOut ? resolve(args.overlayOut) : undefined };
  }
  const run = () => {
    const parts: unknown[] = [];
    const names = snapOrder(arm, (args.slots ?? arm.slot.map((x) => x.name)).filter((n) => !args.exclude?.includes(n)));
    for (let pass = 0; pass < Math.max(1, args.passes ?? 1); pass++) for (const name of names) {
      p.rebuildSkeleton();
      parts.push({ pass, ...snapSlot(p, s.page!, ref, f, name, args) });
    }
    return { iouBefore, iouAfter: iouOf(), parts };
  };
  return args.apply === false ? run() : write(s, run);
}

export function weldJoints(s: StudioState, args: { mode?: 'texture' | 'weights' | 'both'; overlap?: number; radius?: number; band?: number; lateral?: number; slots?: string[]; exclude?: string[] }): unknown {
  const p = need(s);
  if (!s.page || !s.tex) throw new Error('project has no atlas image');
  const arm = armatureOf(s);
  const mode = args.mode ?? 'both', overlap = args.overlap ?? 6, radius = args.radius ?? 18, band = args.band ?? 16, lateral = args.lateral ?? 60;
  return write(s, () => {
    const W = boneWorlds(arm);
    const joints = boneJoints(arm, W);
    const ok = (n: string) => (!args.slots || args.slots.includes(n)) && !args.exclude?.includes(n);
    const pairs: unknown[] = [];
    const extended: Record<string, number> = {}, welded: Record<string, number> = {}, skipped: string[] = [];
    // 世界坐标下各插槽的不透明区域（用来判断关节是否落在部件上）
    p.rebuildSkeleton();
    const items = setupItems(p);
    const b = animationBounds(p, [0]);
    const pad = radius + 4, org: [number, number] = [-b.minX + pad, -b.minY + pad];
    const box = { width: Math.ceil(b.maxX - b.minX + 2 * pad), height: Math.ceil(b.maxY - b.minY + 2 * pad) };
    const alphaOf = new Map<string, RasterImage>();
    const covers = (slot: string, x: number, y: number, r: number) => {
      let im = alphaOf.get(slot);
      if (!im) { im = renderToRefCore(s.page!, items.filter((it) => it.slot === slot), box, { origin: org, scale: 1 }); alphaOf.set(slot, im); }
      const cx = Math.round(x + org[0]), cy = Math.round(y + org[1]);
      for (let yy = cy - r; yy <= cy + r; yy++) for (let xx = cx - r; xx <= cx + r; xx++) {
        if (xx < 0 || yy < 0 || xx >= im.width || yy >= im.height || (xx - cx) ** 2 + (yy - cy) ** 2 > r * r) continue;
        if (im.rgba[(yy * im.width + xx) * 4 + 3] > 128) return true;
      }
      return false;
    };
    const texJoints = new Map<string, Array<{ x: number; y: number }>>();
    for (const j of joints) {
      const P = arm.bone[j.parent].name, C = arm.bone[j.child].name;
      const side = (bone: string) => arm.slot.filter((x) => x.parent === bone && ok(x.name) && (x.displayIndex ?? 0) >= 0 && covers(x.name, j.x, j.y, Math.round(radius / 2)));
      const ps = side(P), cs = side(C);
      if (!ps.length || !cs.length) continue;
      pairs.push(`${C}: ${ps.map((x) => x.name).join('+')} ↔ ${cs.map((x) => x.name).join('+')}`);
      for (const sl of [...ps, ...cs]) {
        const d = currentDisplay(arm, sl.name)!;
        if (d.type === 'mesh') {
          if (mode !== 'texture' && d.weights?.length) welded[sl.name] = (welded[sl.name] ?? 0) + weldMeshWeights(arm, W, d, j, band, lateral);
          else if (mode !== 'weights' && !d.weights?.length) skipped.push(`${sl.name}: 网格未加权，跳过`);
        } else if (mode !== 'weights') {
          const list = texJoints.get(sl.name) ?? []; list.push({ x: j.x, y: j.y }); texJoints.set(sl.name, list);
        }
      }
    }
    if (mode !== 'weights') for (const [slotName, js] of texJoints) {
      const slot = arm.slot.find((x) => x.name === slotName)!;
      const d = currentDisplay(arm, slotName)!;
      const region = d.path ?? d.name!;
      const sub = s.tex!.SubTexture.find((t) => t.name === region);
      if (!sub) continue;
      const shared = (arm.skin?.[0]?.slot ?? []).some((ss) => ss.display.some((x) => x !== d && (x.path ?? x.name) === region));
      if (shared) { skipped.push(`${slotName}: 区域 ${region} 被多个显示对象共用，跳过延伸`); continue; }
      const M = multiply(W[arm.bone.findIndex((bb) => bb.name === slot.parent)], matFromTransform(d.transform));
      const inv = invert(M);
      const local = js.map((j) => { const [lx, ly] = apply(inv, j.x, j.y); return { x: lx + sub.width * (d.pivot?.x ?? 0.5), y: ly + sub.height * (d.pivot?.y ?? 0.5) }; });
      const res = extendRegion(cropRaster(s.page!, sub.x, sub.y, sub.width, sub.height), local, overlap, radius);
      if (!res.filled) continue;
      // extendRegion 四周各补 overlap 像素；把没填到的透明边裁掉，并平移显示变换保证原像素世界位置不变
      // （否则四边多出的透明边让四边形变大 → 渲染自动取景变化 → setup 与原图 IoU 掉到 ~0.95）
      const P = Math.max(0, Math.round(overlap));
      const trimmed = trimExtended(res.image, P, sub.width, sub.height);
      const px = d.pivot?.x ?? 0.5, py = d.pivot?.y ?? 0.5;
      const ox = trimmed.x0 + px * trimmed.image.width - (P + px * sub.width), oy = trimmed.y0 + py * trimmed.image.height - (P + py * sub.height);
      if (Math.abs(ox) > 1e-9 || Math.abs(oy) > 1e-9) {
        const L = matFromTransform(d.transform);
        d.transform = { ...(d.transform ?? {}), x: +((d.transform?.x ?? 0) + L[0] * ox + L[2] * oy).toFixed(3), y: +((d.transform?.y ?? 0) + L[1] * ox + L[3] * oy).toFixed(3) };
      }
      addRegion(s, region, trimmed.image);
      extended[slotName] = res.filled;
    }
    if (Object.keys(extended).length) rebuildPlayer(s);
    return { pairs, extended, welded, skipped };
  });
}

/** 把 extendRegion 的结果裁到「原矩形 ∪ 新填像素」的包围盒；返回裁剪起点 */
export function trimExtended(img: RasterImage, P: number, w: number, h: number): { image: RasterImage; x0: number; y0: number } {
  let x0 = P, y0 = P, x1 = P + w, y1 = P + h;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    if (img.rgba[(y * img.width + x) * 4 + 3] === 0) continue;
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (x + 1 > x1) x1 = x + 1; if (y + 1 > y1) y1 = y + 1;
  }
  const image = cropRaster(img, x0, y0, x1 - x0, y1 - y0);
  return { image, x0, y0 };
}

/** 轮廓双向贴合：网格部件边界向参考图轮廓收 / 拉（被遮挡不算、关节重叠区保留） */
export function fitContour(s: StudioState, args: { reference: string; origin?: [number, number]; scale?: number; slots?: string[]; exclude?: string[]; maxShift?: number; jointKeep?: number; sigma?: number; iterations?: number }): unknown {
  const p = need(s);
  if (!s.page) throw new Error('project has no atlas image');
  const ref = loadReference(args.reference);
  const f = { origin: args.origin ?? [ref.width / 2, ref.height] as [number, number], scale: args.scale ?? 1 };
  const arm = armatureOf(s);
  return write(s, () => {
    p.rebuildSkeleton();
    const iouBefore = referenceIoU(p, s.page!, ref, f);
    const names = (args.slots ?? arm.slot.map((x) => x.name)).filter((n) => !args.exclude?.includes(n) && currentDisplay(arm, n)?.type === 'mesh');
    const parts: unknown[] = [];
    for (let it = 0; it < Math.max(1, args.iterations ?? 2); it++) for (const n of names) {
      p.rebuildSkeleton();
      parts.push({ it, ...fitMeshContour(p, s.page!, ref, f, n, args) });
    }
    p.rebuildSkeleton();
    return { iouBefore, iouAfter: referenceIoU(p, s.page!, ref, f), parts };
  });
}

/**
 * 网格单边拉伸：把网格靠某一边（世界坐标包围盒的 top/bottom/left/right）的顶点沿该方向推 amount 像素，
 * 往对边线性衰减到 0（对边不动）。用于把脖子下端伸进领口、袖口伸进手套等「补洞 / 做重叠」。
 */
export function meshStretch(s: StudioState, args: { slot: string; edge: 'top' | 'bottom' | 'left' | 'right'; amount: number; span?: number; from?: 'top' | 'bottom' | 'left' | 'right'; fromSpan?: number }): unknown {
  const arm = armatureOf(s);
  return write(s, () => {
    const slot = arm.slot.find((x) => x.name === args.slot);
    const d = currentDisplay(arm, args.slot);
    if (!slot || !d || d.type !== 'mesh' || !d.vertices) throw new Error(`${args.slot} is not a mesh (call mesh_create first)`);
    const W = boneWorlds(arm);
    const weighted = !!d.weights?.length;
    const M: Mat2D = weighted ? ((d.slotPose?.length === 6 ? d.slotPose : [1, 0, 0, 1, 0, 0]) as unknown as Mat2D) : W[arm.bone.findIndex((b) => b.name === slot.parent)];
    const inv = invert(M);
    const v = d.vertices;
    const pts: Array<[number, number]> = [];
    for (let k = 0; k + 1 < v.length; k += 2) pts.push(apply(M, v[k], v[k + 1]));
    const horiz = args.edge === 'left' || args.edge === 'right';
    const vals = pts.map((q) => (horiz ? q[0] : q[1]));
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const toward = args.edge === 'bottom' || args.edge === 'right';
    const span = Math.max(1e-6, args.span ?? hi - lo);
    let moved = 0;
    // from：另一条边的就近权重（如 edge=left, from=bottom → 只把下端往左撑开，上端不动）
    const fromW = (x: number, y: number) => {
      if (!args.from || args.from === args.edge) return 1;
      const fh = args.from === 'left' || args.from === 'right';
      const fv = pts.map((q) => (fh ? q[0] : q[1]));
      const flo = Math.min(...fv), fhi = Math.max(...fv);
      const ft = args.from === 'bottom' || args.from === 'right';
      const fd = ft ? fhi - (fh ? x : y) : (fh ? x : y) - flo;
      return Math.max(0, 1 - fd / Math.max(1e-6, args.fromSpan ?? fhi - flo));
    };
    pts.forEach(([x, y], i) => {
      const dist = toward ? hi - (horiz ? x : y) : (horiz ? x : y) - lo;
      const w = Math.max(0, 1 - dist / span) * fromW(x, y);
      if (w <= 0) return;
      const delta = args.amount * w * (toward ? 1 : -1);
      const [lx, ly] = apply(inv, horiz ? x + delta : x, horiz ? y : y + delta);
      v[i * 2] = +lx.toFixed(3); v[i * 2 + 1] = +ly.toFixed(3); moved++;
    });
    return { slot: args.slot, edge: args.edge, amount: args.amount, moved };
  });
}

/**
 * 擦掉部件贴图里的一块（椭圆，区域像素坐标，带羽化）：例如把衣服领口里面那块深色「洞」挖空，
 * 让下层的脖子从领口里露出来、和领口重叠。只支持图片显示对象（要在 mesh_create 之前或网格 uv 不依赖这块时用）。
 */
export function regionErase(s: StudioState, args: { slot: string; ellipse: [number, number, number, number]; feather?: number }): unknown {
  const arm = armatureOf(s);
  return write(s, () => {
    const d = currentDisplay(arm, args.slot);
    const region = d?.path ?? d?.name;
    const sub = s.tex?.SubTexture.find((t) => t.name === region);
    if (!d || !region || !sub || !s.page) throw new Error(`slot ${args.slot} has no region`);
    const img = cropRaster(s.page, sub.x, sub.y, sub.width, sub.height);
    const [cx, cy, rx, ry] = args.ellipse, fe = Math.max(0.01, args.feather ?? 2);
    let erased = 0;
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
      const r = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry);
      const k = Math.max(0, Math.min(1, (r - 1) * Math.min(rx, ry) / fe + 1)); // 1=保留 0=擦掉
      if (k >= 1) continue;
      const i = (y * img.width + x) * 4 + 3;
      const a = Math.round(img.rgba[i] * k);
      if (a !== img.rgba[i]) { img.rgba[i] = a; erased++; }
    }
    addRegion(s, region, img);
    rebuildPlayer(s);
    return { slot: args.slot, region, erased };
  });
}
