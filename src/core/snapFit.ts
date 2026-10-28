/**
 * 部件吸附拼接（纯数据，浏览器 / Node 通用）。
 *
 * 1. 参考垫图吸附：把单个部件在「附近的小范围」里搜索平移 / 旋转 / 少量缩放，
 *    用轮廓与边缘（截断倒角距离 + 剪影落在前景外的比例）打分，而不是比颜色 —— AI 重绘的部件颜色/细节
 *    与原图对不上，但外轮廓和主要结构线基本一致。
 * 2. 关节约束：可传入若干关节点（参考图像素坐标），部件必须盖住它们，否则加罚分，避免吸附把关键处拉断。
 *
 * 结果是一个世界空间的增量刚体变换（绕部件质心），由调用方套到显示对象 / 网格顶点上。
 */
import type { RasterImage } from './raster';
import type { DbArmatureData, DbDisplayData } from './types';
import { apply, invert, matFromTransform, multiply, type Mat2D } from './runtime/math';

export interface SnapReference {
  width: number;
  height: number;
  /** 前景掩码 0/1 */
  fg: Uint8Array;
  /** 到最近边缘像素的距离（像素，截断） */
  edgeDist: Float32Array;
}

const TRUNC = 12;

function lumaOf(img: RasterImage): Float32Array {
  const n = img.width * img.height, out = new Float32Array(n), d = img.rgba;
  for (let i = 0; i < n; i++) out[i] = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) * (d[i * 4 + 3] / 255);
  return out;
}

function sobel(l: Float32Array, w: number, h: number): Float32Array {
  const g = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = l[i - w + 1] + 2 * l[i + 1] + l[i + w + 1] - l[i - w - 1] - 2 * l[i - 1] - l[i + w - 1];
    const gy = l[i + w - 1] + 2 * l[i + w] + l[i + w + 1] - l[i - w - 1] - 2 * l[i - w] - l[i - w + 1];
    g[i] = Math.hypot(gx, gy);
  }
  return g;
}

/** 两遍 3-4 倒角距离变换；src=1 的像素距离为 0 */
export function distanceTransform(src: Uint8Array, w: number, h: number, cap = 255): Float32Array {
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = src[i] ? 0 : cap * 3;
  const upd = (i: number, j: number, c: number) => { if (d[j] + c < d[i]) d[i] = d[j] + c; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (x > 0) upd(i, i - 1, 3);
    if (y > 0) { upd(i, i - w, 3); if (x > 0) upd(i, i - w - 1, 4); if (x < w - 1) upd(i, i - w + 1, 4); }
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x;
    if (x < w - 1) upd(i, i + 1, 3);
    if (y < h - 1) { upd(i, i + w, 3); if (x < w - 1) upd(i, i + w + 1, 4); if (x > 0) upd(i, i + w - 1, 4); }
  }
  for (let i = 0; i < d.length; i++) d[i] = Math.min(cap, d[i] / 3);
  return d;
}

/** 参考垫图 → 前景掩码 + 边缘距离场。背景色取四角中位数（有 alpha 时按 alpha）。 */
export function prepareReference(img: RasterImage, opts: { bgThreshold?: number; edgeThreshold?: number } = {}): SnapReference {
  const { width: w, height: h, rgba: d } = img, n = w * h;
  const fg = new Uint8Array(n);
  let hasAlpha = false;
  for (let i = 0; i < n; i++) if (d[i * 4 + 3] < 250) { hasAlpha = true; break; }
  if (hasAlpha) for (let i = 0; i < n; i++) fg[i] = d[i * 4 + 3] > 128 ? 1 : 0;
  else {
    const corners = [0, w - 1, (h - 1) * w, n - 1];
    const bg = [0, 1, 2].map((c) => corners.map((k) => d[k * 4 + c]).sort((a, b) => a - b)[1]);
    const t = opts.bgThreshold ?? 28;
    for (let i = 0; i < n; i++) fg[i] = Math.max(Math.abs(d[i * 4] - bg[0]), Math.abs(d[i * 4 + 1] - bg[1]), Math.abs(d[i * 4 + 2] - bg[2])) > t ? 1 : 0;
  }
  const g = sobel(lumaOf(img), w, h);
  const et = opts.edgeThreshold ?? 160;
  const edge = new Uint8Array(n);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    if (g[i] > et && fg[i]) edge[i] = 1;
    if (fg[i] && (!fg[i - 1] || !fg[i + 1] || !fg[i - w] || !fg[i + w])) edge[i] = 1; // 剪影外轮廓
  }
  return { width: w, height: h, fg, edgeDist: distanceTransform(edge, w, h, TRUNC) };
}

export interface SnapSprite {
  /** 质心（参考图像素） */
  cx: number; cy: number;
  /** 轮廓点（相对质心）与权重 */
  edges: Float32Array; edgeW: Float32Array;
  /** 内部采样点（相对质心） */
  inner: Float32Array;
  area: number;
}

/** 去掉被上层部件挡住的轮廓点（原图里看不到它们，拿去比边缘只会把部件拉偏）。返回可见比例。 */
export function dropOccluded(sp: SnapSprite, above: RasterImage): number {
  const keep: number[] = [], kw: number[] = [];
  let vis = 0, tot = 0;
  for (let k = 0; k < sp.edgeW.length; k++) {
    const x = Math.round(sp.cx + sp.edges[k * 2]), y = Math.round(sp.cy + sp.edges[k * 2 + 1]);
    const hidden = x >= 0 && y >= 0 && x < above.width && y < above.height && above.rgba[(y * above.width + x) * 4 + 3] > 128;
    if (sp.edgeW[k] === 1) { tot++; if (!hidden) vis++; }
    if (!hidden) { keep.push(sp.edges[k * 2], sp.edges[k * 2 + 1]); kw.push(sp.edgeW[k]); }
  }
  sp.edges = new Float32Array(keep); sp.edgeW = new Float32Array(kw);
  return tot ? vis / tot : 0;
}

/** 从「已画到参考图坐标系里」的单部件位图提取轮廓 / 内部采样点 */
export function spriteFromRaster(img: RasterImage, maxEdges = 900, maxInner = 700): SnapSprite | null {
  const { width: w, height: h, rgba: d } = img;
  const a = (i: number) => d[i * 4 + 3];
  let sx = 0, sy = 0, cnt = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (a(y * w + x) > 128) { sx += x; sy += y; cnt++; }
  if (cnt < 16) return null;
  const cx = sx / cnt, cy = sy / cnt;
  const g = sobel(lumaOf(img), w, h);
  const bnd: number[] = [], inn: number[] = [], inr: number[] = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    if (a(i) <= 128) continue;
    inr.push(x - cx, y - cy);
    const border = a(i - 1) <= 128 || a(i + 1) <= 128 || a(i - w) <= 128 || a(i + w) <= 128;
    if (border) bnd.push(x - cx, y - cy);
    else if (a(i - w - 1) > 250 && a(i + w + 1) > 250 && a(i - w + 1) > 250 && a(i + w - 1) > 250 && g[i] > 220) inn.push(x - cx, y - cy);
  }
  const pick = (arr: number[], max: number): number[] => {
    const m = arr.length / 2; if (m <= max) return arr;
    const out: number[] = []; const step = m / max;
    for (let k = 0; k < max; k++) { const j = Math.floor(k * step) * 2; out.push(arr[j], arr[j + 1]); }
    return out;
  };
  const b = pick(bnd, Math.round(maxEdges * 0.65)), e = pick(inn, Math.round(maxEdges * 0.35));
  const edges = new Float32Array([...b, ...e]);
  const edgeW = new Float32Array(edges.length / 2);
  edgeW.fill(1, 0, b.length / 2); edgeW.fill(0.5, b.length / 2);
  return { cx, cy, edges, edgeW, inner: new Float32Array(pick(inr, maxInner)), area: cnt };
}

export interface SnapPose { dx: number; dy: number; rot: number; scale: number }
export interface SnapOptions {
  /** 平移搜索半径（像素），默认 24 */
  radius?: number;
  /** 旋转搜索范围 ±度，默认 8 */
  rotRange?: number;
  /** 缩放搜索范围 ±比例，默认 0.06 */
  scaleRange?: number;
  /** 0–1：1 = 完全吸到最佳位置，0.5 = 走一半 */
  strength?: number;
  /** 必须盖住的关节点（参考图像素） */
  joints?: Array<{ x: number; y: number }>;
  jointWeight?: number;
  outsideWeight?: number;
  /** 位移先验：离初始位置越远罚分越高（手拼的位置大体是对的），默认 0.15 */
  priorWeight?: number;
}

export function scorePose(ref: SnapReference, sp: SnapSprite, pose: SnapPose, opts: SnapOptions = {}): number {
  const rad = pose.rot * Math.PI / 180, c = Math.cos(rad) * pose.scale, s = Math.sin(rad) * pose.scale;
  const ox = sp.cx + pose.dx, oy = sp.cy + pose.dy, W = ref.width, H = ref.height;
  let es = 0, ew = 0;
  for (let k = 0; k < sp.edgeW.length; k++) {
    const x = sp.edges[k * 2], y = sp.edges[k * 2 + 1];
    const px = Math.round(ox + c * x - s * y), py = Math.round(oy + s * x + c * y);
    const dd = px < 0 || py < 0 || px >= W || py >= H ? TRUNC : ref.edgeDist[py * W + px];
    es += sp.edgeW[k] * dd; ew += sp.edgeW[k];
  }
  let out = 0;
  const ni = sp.inner.length / 2;
  for (let k = 0; k < ni; k++) {
    const x = sp.inner[k * 2], y = sp.inner[k * 2 + 1];
    const px = Math.round(ox + c * x - s * y), py = Math.round(oy + s * x + c * y);
    if (px < 0 || py < 0 || px >= W || py >= H || !ref.fg[py * W + px]) out++;
  }
  let jp = 0;
  if (opts.joints?.length) {
    for (const j of opts.joints) {
      let best = Infinity;
      for (let k = 0; k < ni; k++) {
        const x = sp.inner[k * 2], y = sp.inner[k * 2 + 1];
        const dd = Math.hypot(ox + c * x - s * y - j.x, oy + s * x + c * y - j.y);
        if (dd < best) best = dd;
      }
      jp += Math.min(1, Math.max(0, best - 3) / TRUNC);
    }
    jp /= opts.joints.length;
  }
  const R = opts.radius ?? 24;
  const prior = (opts.priorWeight ?? 0.15) * (Math.hypot(pose.dx, pose.dy) / R + Math.abs(pose.rot) / (opts.rotRange ?? 8) * 0.5 + Math.abs(pose.scale - 1) / (opts.scaleRange ?? 0.06) * 0.5);
  return prior + es / Math.max(1e-6, ew) / TRUNC + (opts.outsideWeight ?? 1.2) * out / Math.max(1, ni) + (opts.jointWeight ?? 2) * jp;
}

/** 粗到细搜索；返回最佳增量（已按 strength 混合）与分数 */
export function snapSearch(ref: SnapReference, sp: SnapSprite, opts: SnapOptions = {}): { pose: SnapPose; before: number; after: number; improved: boolean } {
  const R = opts.radius ?? 24, RR = opts.rotRange ?? 8, SR = opts.scaleRange ?? 0.06;
  const id: SnapPose = { dx: 0, dy: 0, rot: 0, scale: 1 };
  const before = scorePose(ref, sp, id, opts);
  let best = id, bestS = before;
  const tryP = (p: SnapPose) => {
    if (Math.hypot(p.dx, p.dy) > R + 1e-6 || Math.abs(p.rot) > RR + 1e-6 || Math.abs(p.scale - 1) > SR + 1e-6) return;
    const v = scorePose(ref, sp, p, opts); if (v < bestS - 1e-9) { bestS = v; best = p; }
  };
  const ts = Math.max(2, Math.round(R / 6));
  for (let dx = -R; dx <= R; dx += ts) for (let dy = -R; dy <= R; dy += ts)
    for (let r = -RR; r <= RR; r += Math.max(1, RR / 4)) for (let k = -SR; k <= SR + 1e-9; k += Math.max(0.01, SR / 2))
      tryP({ dx, dy, rot: r, scale: 1 + k });
  for (const [t, r, k] of [[ts / 2, 1, 0.01], [1, 0.5, 0.005], [0.5, 0.25, 0.0025]]) {
    let moved = true, guard = 0;
    while (moved && guard++ < 30) {
      moved = false; const b = best;
      for (const p of [
        { ...b, dx: b.dx + t }, { ...b, dx: b.dx - t }, { ...b, dy: b.dy + t }, { ...b, dy: b.dy - t },
        { ...b, rot: b.rot + r }, { ...b, rot: b.rot - r }, { ...b, scale: b.scale + k }, { ...b, scale: b.scale - k },
      ]) tryP(p);
      if (best !== b) moved = true;
    }
  }
  const st = Math.max(0, Math.min(1, opts.strength ?? 1));
  const pose = { dx: best.dx * st, dy: best.dy * st, rot: best.rot * st, scale: 1 + (best.scale - 1) * st };
  const after = st === 1 ? bestS : scorePose(ref, sp, pose, opts);
  return { pose, before, after, improved: after < before - 1e-6 };
}

/** 增量（参考图像素，绕 sprite 质心）→ 世界矩阵。refToWorld: world = (ref - origin) / scale */
export function poseToWorld(pose: SnapPose, cxRef: number, cyRef: number, origin: [number, number], scale: number): Mat2D {
  const rad = pose.rot * Math.PI / 180, c = Math.cos(rad) * pose.scale, s = Math.sin(rad) * pose.scale;
  const cx = (cxRef - origin[0]) / scale, cy = (cyRef - origin[1]) / scale;
  const tx = cx + pose.dx / scale, ty = cy + pose.dy / scale;
  return [c, s, -s, c, tx - (c * cx - s * cy), ty - (s * cx + c * cy)];
}

function toTransform(m: Mat2D): Record<string, number> {
  const r = (v: number) => +v.toFixed(4);
  const scX = Math.hypot(m[0], m[1]), scY = Math.hypot(m[2], m[3]);
  const skY = Math.atan2(m[1], m[0]) * 180 / Math.PI, skX = Math.atan2(-m[2], m[3]) * 180 / Math.PI;
  const t: Record<string, number> = { x: r(m[4]), y: r(m[5]) };
  if (Math.abs(skX) > 1e-4) t.skX = r(skX);
  if (Math.abs(skY) > 1e-4) t.skY = r(skY);
  if (Math.abs(scX - 1) > 1e-5) t.scX = r(scX);
  if (Math.abs(scY - 1) > 1e-5) t.scY = r(scY);
  return t;
}

/** 把世界空间增量 T 套到显示对象上（图片：改 transform；网格：改顶点，加权网格的顶点本就在绑定世界空间） */
export function applyWorldDelta(display: DbDisplayData, boneWorld: Mat2D, T: Mat2D): void {
  if (display.type === 'mesh' && display.vertices) {
    const v = display.vertices;
    const M = display.weights?.length ? T : multiply(invert(boneWorld), multiply(T, boneWorld));
    const sp = display.weights?.length && display.slotPose?.length === 6 ? (display.slotPose as unknown as Mat2D) : null;
    const MM = sp ? multiply(invert(sp), multiply(T, sp)) : M;
    for (let k = 0; k + 1 < v.length; k += 2) { const [x, y] = apply(MM, v[k], v[k + 1]); v[k] = +x.toFixed(3); v[k + 1] = +y.toFixed(3); }
    return;
  }
  const local = multiply(invert(boneWorld), multiply(T, multiply(boneWorld, matFromTransform(display.transform))));
  display.transform = { ...(display.transform ?? {}), skX: 0, skY: 0, scX: 1, scY: 1, ...toTransform(local) } as never;
  for (const k of ['skX', 'skY'] as const) if (!(display.transform as Record<string, number>)[k]) delete (display.transform as Record<string, number>)[k];
  for (const k of ['scX', 'scY'] as const) if ((display.transform as Record<string, number>)[k] === 1) delete (display.transform as Record<string, number>)[k];
}

/** 掩码 IoU：sprite 合成 alpha 与参考前景 */
export function maskIoU(alpha: RasterImage, ref: SnapReference): number {
  let i = 0, u = 0;
  for (let k = 0; k < ref.fg.length; k++) { const a = alpha.rgba[k * 4 + 3] > 128 ? 1 : 0, b = ref.fg[k]; if (a && b) i++; if (a || b) u++; }
  return u ? i / u : 0;
}

/** 关节：子骨骼起点（绑定世界）。返回 {parentBone, childBone, x, y, dir} */
export function boneJoints(arm: DbArmatureData, bindWorld: Mat2D[]): Array<{ parent: number; child: number; x: number; y: number; ux: number; uy: number }> {
  const out: Array<{ parent: number; child: number; x: number; y: number; ux: number; uy: number }> = [];
  arm.bone.forEach((b, i) => {
    const p = b.parent ? arm.bone.findIndex((x) => x.name === b.parent) : -1;
    if (p < 0) return;
    const m = bindWorld[i], l = Math.hypot(m[0], m[1]) || 1;
    out.push({ parent: p, child: i, x: m[4], y: m[5], ux: m[0] / l, uy: m[1] / l });
  });
  return out;
}
