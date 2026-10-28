/**
 * 部件吸附拼接的编排层（纯数据，编辑器与 MCP 共用）：
 * 把插槽的当前显示对象单独画到参考图坐标系 → 去掉被上层挡住的轮廓 → snapFit 搜索 → 套回显示对象。
 * 参考图坐标：world = (refPx - origin) / scale。
 */
import type { Player } from './player';
import type { RasterImage } from './raster';
import type { DbArmatureData, DbDisplayData } from './types';
import type { RenderItem } from './runtime/skeleton';
import { Skeleton } from './runtime/skeleton';
import { apply, invert, matFromTransform, multiply, type Mat2D } from './runtime/math';
import { renderItems } from './render/softRaster';
import { applyWorldDelta, boneJoints, dropOccluded, maskIoU, poseToWorld, snapSearch, spriteFromRaster, type SnapReference } from './snapFit';
import { weldMeshWeights } from './jointWeld';

export interface RefFrame { origin: [number, number]; scale: number }

export function setupItems(p: Player): RenderItem[] {
  const was = p.setupPose; const pos = p.position;
  p.setupPose = true; p.seek(0);
  const items = p.renderItems();
  p.setupPose = was; p.seek(pos);
  return items;
}

export function renderToRef(page: RasterImage, items: RenderItem[], size: { width: number; height: number }, f: RefFrame): RasterImage {
  const { origin, scale } = f;
  return renderItems(items, [page], {
    width: size.width, height: size.height, padding: 0,
    bounds: { minX: -origin[0] / scale, minY: -origin[1] / scale, maxX: (size.width - origin[0]) / scale, maxY: (size.height - origin[1]) / scale },
  });
}

export function currentDisplay(arm: DbArmatureData, slotName: string): DbDisplayData | null {
  const slot = arm.slot.find((x) => x.name === slotName);
  return arm.skin?.[0]?.slot.find((x) => x.name === slotName)?.display?.[Math.max(0, slot?.displayIndex ?? 0)] ?? null;
}

export function referenceIoU(p: Player, page: RasterImage, ref: SnapReference, f: RefFrame): number {
  return +maskIoU(renderToRef(page, setupItems(p), ref, f), ref).toFixed(4);
}

export interface SnapSlotOptions {
  radius?: number; strength?: number; rotRange?: number; scaleRange?: number;
  /** 关节约束（默认开） */
  joints?: boolean; minVisible?: number; prior?: number; apply?: boolean;
}

export interface SnapSlotResult {
  slot: string; applied: boolean; skipped?: string; visible?: number;
  dx?: number; dy?: number; rot?: number; scale?: number; score?: [number, number]; joints?: number;
}

/** 单个部件吸到参考图上（会改显示对象；调用方随后 `p.rebuildSkeleton()`） */
export function snapSlot(p: Player, page: RasterImage, ref: SnapReference, f: RefFrame, name: string, o: SnapSlotOptions = {}): SnapSlotResult {
  const arm = p.skeleton.armature;
  const slot = arm.slot.find((x) => x.name === name);
  const d = currentDisplay(arm, name);
  if (!slot || !d || (slot.displayIndex ?? 0) < 0) return { slot: name, applied: false, skipped: '没有显示对象' };
  const items = setupItems(p);
  const sprite = spriteFromRaster(renderToRef(page, items.filter((it) => it.slot === name), ref, f));
  if (!sprite) return { slot: name, applied: false, skipped: '部件不在参考图范围内' };
  const z = arm.slot.indexOf(slot);
  const above = new Set(arm.slot.slice(z + 1).map((x) => x.name));
  const visible = dropOccluded(sprite, renderToRef(page, items.filter((it) => above.has(it.slot)), ref, f));
  if (visible < (o.minVisible ?? 0.35) || sprite.edgeW.length < 20) return { slot: name, applied: false, visible, skipped: `可见轮廓仅 ${(visible * 100).toFixed(0)}%，保持原位置` };
  const W = new Skeleton(arm).bindWorld;
  const bi = arm.bone.findIndex((b) => b.name === slot.parent);
  const toRef = (m: Mat2D) => ({ x: m[4] * f.scale + f.origin[0], y: m[5] * f.scale + f.origin[1] });
  let joints: Array<{ x: number; y: number }> = [];
  if (o.joints !== false && bi >= 0) {
    const cand = [W[bi], ...arm.bone.map((b, i) => (b.parent === slot.parent ? W[i] : null)).filter((m): m is Mat2D => !!m)].map(toRef);
    // 只约束「本来就盖住」的关节（配件不强拉）
    joints = cand.filter((j) => {
      for (let k = 0; k < sprite.inner.length; k += 2) if (Math.hypot(sprite.cx + sprite.inner[k] - j.x, sprite.cy + sprite.inner[k + 1] - j.y) < 8) return true;
      return false;
    });
  }
  const r = snapSearch(ref, sprite, { radius: o.radius, strength: o.strength, rotRange: o.rotRange, scaleRange: o.scaleRange, joints, priorWeight: o.prior });
  const applied = r.improved && o.apply !== false;
  if (applied) applyWorldDelta(d, bi >= 0 ? W[bi] : [1, 0, 0, 1, 0, 0], poseToWorld(r.pose, sprite.cx, sprite.cy, f.origin, f.scale));
  const n2 = (v: number) => +v.toFixed(2);
  return { slot: name, applied, visible: n2(visible), dx: n2(r.pose.dx), dy: n2(r.pose.dy), rot: n2(r.pose.rot), scale: +r.pose.scale.toFixed(4), score: [+r.before.toFixed(4), +r.after.toFixed(4)], joints: joints.length };
}

/** 父骨骼先、子部件后的顺序 */
export function snapOrder(arm: DbArmatureData, names: string[]): string[] {
  const depth = (b: string): number => { let k = 0, cur = arm.bone.find((x) => x.name === b); while (cur?.parent && k < 64) { k++; cur = arm.bone.find((x) => x.name === cur!.parent); } return k; };
  return [...names].sort((a, b) => depth(arm.slot.find((x) => x.name === a)?.parent ?? '') - depth(arm.slot.find((x) => x.name === b)?.parent ?? ''));
}

/**
 * 关节吸附（不需要参考图）：部件的不透明区域没盖住自己骨骼的关节点时，
 * 把部件沿最短方向平移过去并多压 `overlap` 像素，保证切口和父部件接上。
 */
export function jointCoverSnap(p: Player, page: RasterImage, name: string, o: { radius?: number; overlap?: number } = {}): { slot: string; moved: boolean; dx?: number; dy?: number } {
  const arm = p.skeleton.armature;
  const slot = arm.slot.find((x) => x.name === name);
  const d = currentDisplay(arm, name);
  if (!slot || !d || (slot.displayIndex ?? 0) < 0) return { slot: name, moved: false };
  const W = new Skeleton(arm).bindWorld;
  const bi = arm.bone.findIndex((b) => b.name === slot.parent);
  const bone = arm.bone[bi];
  if (bi < 0 || !bone?.parent) return { slot: name, moved: false };
  const jx = W[bi][4], jy = W[bi][5], R = o.radius ?? 30, ov = o.overlap ?? 4;
  const size = Math.ceil(R * 2 + 2 * ov + 4);
  const f: RefFrame = { origin: [size / 2 - jx, size / 2 - jy], scale: 1 };
  const img = renderToRef(page, setupItems(p).filter((it) => it.slot === name), { width: size, height: size }, f);
  let best = Infinity, bx = 0, by = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (img.rgba[(y * size + x) * 4 + 3] <= 128) continue;
    const dd = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2);
    if (dd < best) { best = dd; bx = x + 0.5 - size / 2; by = y + 0.5 - size / 2; }
  }
  if (best === Infinity || best <= 1.5 || best > R) return { slot: name, moved: false };
  const k = (best + ov) / best;
  const dx = -bx * k, dy = -by * k;
  applyWorldDelta(d, W[bi], [1, 0, 0, 1, dx, dy]);
  return { slot: name, moved: true, dx: +dx.toFixed(2), dy: +dy.toFixed(2) };
}

/** 骨骼关节吸附：子骨骼起点离父骨骼末端 ≤ radius 时吸到末端，返回新的局部 x/y（父空间），否则 null */
export function boneTipSnap(arm: DbArmatureData, boneName: string, radius = 10): { x: number; y: number } | null {
  const bi = arm.bone.findIndex((b) => b.name === boneName);
  const bone = arm.bone[bi];
  const pi = bone?.parent ? arm.bone.findIndex((b) => b.name === bone.parent) : -1;
  if (pi < 0) return null;
  const len = arm.bone[pi].length ?? 0;
  if (len <= 0) return null;
  const W = new Skeleton(arm).bindWorld;
  const tip = apply(W[pi], len, 0);
  if (Math.hypot(W[bi][4] - tip[0], W[bi][5] - tip[1]) > radius) return null;
  return { x: len, y: 0 };
}

/** 权重焊接：所有关节两侧的加权网格做统一平滑权重。返回 {slot: 改动顶点数} */
export function weldAllWeights(arm: DbArmatureData, o: { band?: number; lateral?: number; slots?: string[]; exclude?: string[] } = {}): Record<string, number> {
  const W = new Skeleton(arm).bindWorld;
  const out: Record<string, number> = {};
  for (const j of boneJoints(arm, W)) {
    const P = arm.bone[j.parent].name, C = arm.bone[j.child].name;
    for (const sl of arm.slot.filter((x) => (x.parent === P || x.parent === C) && (!o.slots || o.slots.includes(x.name)) && !o.exclude?.includes(x.name))) {
      const d = currentDisplay(arm, sl.name);
      if (!d?.weights?.length) continue;
      const n = weldMeshWeights(arm, W, d, j, o.band ?? 16, o.lateral ?? 60);
      if (n) out[sl.name] = (out[sl.name] ?? 0) + n;
    }
  }
  return out;
}

export { invert, matFromTransform, multiply };

/**
 * 轮廓双向贴合（网格变形）：部件剪影边界上逐点沿法线找参考图轮廓 ——
 * 青色（部件盖住、原图是背景）向内收；红色（原图有、谁都没盖住）向外拉。
 * 被上层部件挡住的位置不算青色；关节 `jointKeep` 半径内的边界（切口重叠 / 延伸）不动，避免重新断开。
 * 修正量用高斯核摊到网格顶点上（uv 不变 → 贴图跟着拉伸）。返回移动的顶点数和平均修正。
 */
export function fitMeshContour(p: Player, page: RasterImage, ref: SnapReference, f: RefFrame, name: string,
  o: { maxShift?: number; jointKeep?: number; sigma?: number; maxMove?: number } = {}): { slot: string; vertices: number; corrections: number; meanShift: number; skipped?: string } {
  const arm = p.skeleton.armature;
  const slot = arm.slot.find((x) => x.name === name);
  const d = currentDisplay(arm, name);
  if (!slot || !d || d.type !== 'mesh' || !d.vertices) return { slot: name, vertices: 0, corrections: 0, meanShift: 0, skipped: '不是网格（先 mesh_create）' };
  const maxShift = o.maxShift ?? 12, keep = o.jointKeep ?? 22, sigma = o.sigma ?? 10, maxMove = o.maxMove ?? maxShift;
  const items = setupItems(p);
  const W = ref.width, H = ref.height;
  const mine = renderToRef(page, items.filter((it) => it.slot === name), ref, f);
  const z = arm.slot.indexOf(slot);
  const above = new Set(arm.slot.slice(z + 1).map((x) => x.name));
  const up = renderToRef(page, items.filter((it) => above.has(it.slot)), ref, f);
  const others = renderToRef(page, items.filter((it) => it.slot !== name), ref, f);
  const A = (img: RasterImage, x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && img.rgba[(y * W + x) * 4 + 3] > 128;
  const FG = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && ref.fg[y * W + x] === 1;
  // 关节点：本骨骼起点 + 子骨骼起点 + 本骨骼末端（参考图像素）
  const Wb = new Skeleton(arm).bindWorld;
  const bi = arm.bone.findIndex((b) => b.name === slot.parent);
  const joints: Array<[number, number]> = [];
  const toRef = (x: number, y: number): [number, number] => [x * f.scale + f.origin[0], y * f.scale + f.origin[1]];
  if (bi >= 0) {
    if (arm.bone[bi].parent) joints.push(toRef(Wb[bi][4], Wb[bi][5]));
    arm.bone.forEach((b, i) => { if (b.parent === slot.parent) joints.push(toRef(Wb[i][4], Wb[i][5])); });
    const len = arm.bone[bi].length ?? 0;
    if (len > 0) { const t = apply(Wb[bi], len, 0); joints.push(toRef(t[0], t[1])); }
  }
  const nearJoint = (x: number, y: number) => joints.some(([jx, jy]) => Math.hypot(x - jx, y - jy) < keep);
  const cor: number[] = []; // x, y, cx, cy
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (!A(mine, x, y)) continue;
    if (A(mine, x - 1, y) && A(mine, x + 1, y) && A(mine, x, y - 1) && A(mine, x, y + 1)) continue;
    if ((x + y) % 2) continue; // 采样一半边界点
    if (nearJoint(x, y)) continue;
    // 外法线：alpha 梯度反方向
    let gx = 0, gy = 0;
    for (let k = -2; k <= 2; k++) for (let l = -2; l <= 2; l++) if (A(mine, x + k, y + l)) { gx -= k; gy -= l; }
    const gl = Math.hypot(gx, gy); if (gl < 1e-6) continue;
    const nx = gx / gl, ny = gy / gl;
    let c = 0;
    if (!FG(x, y)) {
      if (A(up, x, y)) continue; // 被遮挡：不算青色
      for (let t = 1; t <= maxShift; t++) if (FG(Math.round(x - nx * t), Math.round(y - ny * t))) { c = -t; break; }
    } else {
      let t = 1;
      for (; t <= maxShift; t++) {
        const px = Math.round(x + nx * t), py = Math.round(y + ny * t);
        if (A(mine, px, py)) continue;
        if (!FG(px, py) || A(others, px, py)) break;
      }
      const px = Math.round(x + nx * t), py = Math.round(y + ny * t);
      // 只有一路都是红色、尽头是背景才往外拉（别人盖着的地方不抢）
      if (t > 1 && t <= maxShift && !FG(px, py)) c = t - 1;
    }
    if (c) cor.push(x, y, nx * c, ny * c);
  }
  if (!cor.length) return { slot: name, vertices: 0, corrections: 0, meanShift: 0 };
  const weighted = !!d.weights?.length;
  const sp = weighted && d.slotPose?.length === 6 ? (d.slotPose as unknown as Mat2D) : null;
  const boneW = bi >= 0 ? Wb[bi] : ([1, 0, 0, 1, 0, 0] as Mat2D);
  const toWorld: Mat2D = weighted ? (sp ?? [1, 0, 0, 1, 0, 0]) : boneW;
  const inv = invert(toWorld);
  const v = d.vertices;
  let moved = 0, sum = 0;
  const s2 = 2 * sigma * sigma;
  for (let k = 0; k + 1 < v.length; k += 2) {
    const [wx, wy] = apply(toWorld, v[k], v[k + 1]);
    const [rx, ry] = toRef(wx, wy);
    if (nearJoint(rx, ry)) continue;
    let ax = 0, ay = 0, ws = 0;
    for (let i = 0; i < cor.length; i += 4) {
      const dd = (cor[i] - rx) ** 2 + (cor[i + 1] - ry) ** 2;
      if (dd > 9 * sigma * sigma) continue;
      const w = Math.exp(-dd / s2); ax += w * cor[i + 2]; ay += w * cor[i + 3]; ws += w;
    }
    if (ws < 0.3) continue; // 附近没有修正点（内部顶点）不动
    let dx = ax / (ws + 0.5), dy = ay / (ws + 0.5);
    const m = Math.hypot(dx, dy); if (m < 0.25) continue;
    if (m > maxMove) { dx *= maxMove / m; dy *= maxMove / m; }
    const [nx2, ny2] = apply(inv, wx + dx / f.scale, wy + dy / f.scale);
    v[k] = +nx2.toFixed(3); v[k + 1] = +ny2.toFixed(3);
    moved++; sum += Math.hypot(dx, dy);
  }
  return { slot: name, vertices: moved, corrections: cor.length / 4, meanShift: moved ? +(sum / moved).toFixed(2) : 0 };
}
