/**
 * 软件光栅化预览（无 GPU / 无浏览器）：把 `Player.renderItems()` 画进 RGBA 位图。
 * Software rasteriser for headless previews (MCP `render_frame` / `render_animation`).
 *
 * 纯数据模块（不依赖 Node）。输入的图集页是 straight RGBA；输出也是 straight RGBA。
 * 采样：双线性；混合：source-over（`add` 槽位走加色）；tint 为 0xRRGGBB 乘色。
 */
import type { Player } from '../player';
import type { RasterImage } from '../raster';
import type { RenderItem } from '../runtime/skeleton';

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

export interface SoftRenderOptions {
  /** 输出宽高（像素） */
  width: number;
  height: number;
  /** stage → 像素：px = (x - bounds.minX) * scale + pad */
  bounds: Bounds;
  padding?: number;
  /** 背景色 RGBA（默认透明） */
  background?: [number, number, number, number];
}

export function itemsBounds(items: RenderItem[], into?: Bounds): Bounds {
  const b = into ?? { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const item of items) {
    const p = item.positions;
    for (let i = 0; i < p.length; i += 2) {
      if (p[i] < b.minX) b.minX = p[i];
      if (p[i] > b.maxX) b.maxX = p[i];
      if (p[i + 1] < b.minY) b.minY = p[i + 1];
      if (p[i + 1] > b.maxY) b.maxY = p[i + 1];
    }
  }
  return b;
}

/** 扫一遍动画所有帧取并集包围盒（同一动画的帧序列用同一取景，不会抖）。 */
export function animationBounds(player: Player, frames?: number[]): Bounds {
  const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const list = frames ?? Array.from({ length: Math.max(1, player.duration) }, (_, i) => i);
  for (const f of list) {
    player.seek(f);
    itemsBounds(player.renderItems(), b);
  }
  if (!Number.isFinite(b.minX)) return { minX: -50, minY: -50, maxX: 50, maxY: 50 };
  return b;
}

function sample(page: RasterImage, u: number, v: number, out: Float32Array): void {
  const w = page.width, h = page.height, d = page.rgba;
  let x = u - 0.5, y = v - 0.5;
  if (x < 0) x = 0; if (y < 0) y = 0;
  if (x > w - 1) x = w - 1; if (y > h - 1) y = h - 1;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4, i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
  // 预乘后插值，避免透明边缘发黑
  const a00 = d[i00 + 3], a10 = d[i10 + 3], a01 = d[i01 + 3], a11 = d[i11 + 3];
  const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
  const a = a00 * w00 + a10 * w10 + a01 * w01 + a11 * w11;
  out[3] = a;
  for (let c = 0; c < 3; c++) {
    out[c] = (d[i00 + c] * a00 * w00 + d[i10 + c] * a10 * w10 + d[i01 + c] * a01 * w01 + d[i11 + c] * a11 * w11) / 255;
  }
}

/** 渲染一帧（当前 player 姿态）。 */
export function renderPlayer(player: Player, pages: RasterImage[], options: SoftRenderOptions): RasterImage {
  return renderItems(player.renderItems(), pages, options);
}

export function renderItems(items: RenderItem[], pages: RasterImage[], options: SoftRenderOptions): RasterImage {
  const { width, height, bounds } = options;
  const pad = options.padding ?? 8;
  const bw = Math.max(1e-6, bounds.maxX - bounds.minX), bh = Math.max(1e-6, bounds.maxY - bounds.minY);
  const scale = Math.min((width - pad * 2) / bw, (height - pad * 2) / bh);
  const ox = (width - bw * scale) / 2 - bounds.minX * scale;
  const oy = (height - bh * scale) / 2 - bounds.minY * scale;
  // 预乘浮点缓冲
  const acc = new Float32Array(width * height * 4);
  const bg = options.background;
  if (bg) {
    const ba = bg[3] / 255;
    for (let i = 0; i < width * height; i++) {
      acc[i * 4] = bg[0] * ba; acc[i * 4 + 1] = bg[1] * ba; acc[i * 4 + 2] = bg[2] * ba; acc[i * 4 + 3] = bg[3];
    }
  }
  const texel = new Float32Array(4);
  for (const item of items) {
    const page = pages[0];
    if (!page) break;
    const tris = item.kind === 'mesh' ? item.triangles : [0, 1, 2, 0, 2, 3];
    const P = item.positions, U = item.uvs;
    const tr = ((item.tint >> 16) & 255) / 255, tg = ((item.tint >> 8) & 255) / 255, tb = (item.tint & 255) / 255;
    const alpha = item.alpha;
    const additive = item.blend === 'add';
    if (alpha <= 0) continue;
    for (let t = 0; t + 2 < tris.length; t += 3) {
      const ia = tris[t], ib = tris[t + 1], ic = tris[t + 2];
      const ax = P[ia * 2] * scale + ox, ay = P[ia * 2 + 1] * scale + oy;
      const bx = P[ib * 2] * scale + ox, by = P[ib * 2 + 1] * scale + oy;
      const cx = P[ic * 2] * scale + ox, cy = P[ic * 2 + 1] * scale + oy;
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(area) < 1e-9) continue;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)));
      const eps = -1e-4 * Math.abs(area);
      for (let y = y0; y <= y1; y++) {
        const py = y + 0.5;
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5;
          let w0 = (bx - px) * (cy - py) - (by - py) * (cx - px);
          let w1 = (cx - px) * (ay - py) - (cy - py) * (ax - px);
          let w2 = (ax - px) * (by - py) - (ay - py) * (bx - px);
          if (area < 0) { w0 = -w0; w1 = -w1; w2 = -w2; }
          if (w0 < eps || w1 < eps || w2 < eps) continue;
          const A = Math.abs(area);
          w0 /= A; w1 /= A; w2 /= A;
          const u = U[ia * 2] * w0 + U[ib * 2] * w1 + U[ic * 2] * w2;
          const v = U[ia * 2 + 1] * w0 + U[ib * 2 + 1] * w1 + U[ic * 2 + 1] * w2;
          sample(page, u, v, texel);
          const sa = (texel[3] / 255) * alpha;
          if (sa <= 0.001) continue;
          const o = (y * width + x) * 4;
          const sr = texel[0] * tr * alpha, sg = texel[1] * tg * alpha, sb = texel[2] * tb * alpha;
          if (additive) {
            acc[o] += sr; acc[o + 1] += sg; acc[o + 2] += sb;
          } else {
            const k = 1 - sa;
            acc[o] = sr + acc[o] * k; acc[o + 1] = sg + acc[o + 1] * k; acc[o + 2] = sb + acc[o + 2] * k;
            acc[o + 3] = sa * 255 + acc[o + 3] * k;
          }
        }
      }
    }
  }
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const a = acc[i * 4 + 3];
    out[i * 4 + 3] = Math.min(255, Math.round(a));
    if (a > 0) {
      const inv = 255 / a;
      out[i * 4] = Math.min(255, Math.round(acc[i * 4] * inv));
      out[i * 4 + 1] = Math.min(255, Math.round(acc[i * 4 + 1] * inv));
      out[i * 4 + 2] = Math.min(255, Math.round(acc[i * 4 + 2] * inv));
    }
  }
  return { width, height, rgba: out };
}

/** 取景映射（与 renderItems 完全一致）：px = x * scale + ox */
export function frameMapping(bounds: Bounds, width: number, height: number, padding = 8): { scale: number; ox: number; oy: number } {
  const bw = Math.max(1e-6, bounds.maxX - bounds.minX), bh = Math.max(1e-6, bounds.maxY - bounds.minY);
  const scale = Math.min((width - padding * 2) / bw, (height - padding * 2) / bh);
  return { scale, ox: (width - bw * scale) / 2 - bounds.minX * scale, oy: (height - bh * scale) / 2 - bounds.minY * scale };
}

/**
 * 按**不透明像素**取包围盒（而不是四边形几何）：图集区域四周的透明边不再影响取景，
 * 所以焊接/重排让区域变大时，渲染取景不变、可复现。网格项仍按顶点。
 */
export function contentBounds(items: RenderItem[], page: RasterImage | undefined, into?: Bounds, alphaMin = 1): Bounds {
  const b = into ?? { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const item of items) {
    if (item.alpha <= 0) continue;
    const P = item.positions, U = item.uvs;
    if (item.kind === 'mesh' || !page || P.length < 6) { itemsBounds([item], b); continue; }
    let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
    for (let i = 0; i < U.length; i += 2) { u0 = Math.min(u0, U[i]); u1 = Math.max(u1, U[i]); v0 = Math.min(v0, U[i + 1]); v1 = Math.max(v1, U[i + 1]); }
    let a0 = Infinity, b0 = Infinity, a1 = -Infinity, b1 = -Infinity;
    const X0 = Math.max(0, Math.floor(u0)), X1 = Math.min(page.width, Math.ceil(u1)), Y0 = Math.max(0, Math.floor(v0)), Y1 = Math.min(page.height, Math.ceil(v1));
    for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
      if (page.rgba[(y * page.width + x) * 4 + 3] < alphaMin) continue;
      if (x < a0) a0 = x; if (x + 1 > a1) a1 = x + 1; if (y < b0) b0 = y; if (y + 1 > b1) b1 = y + 1;
    }
    if (!Number.isFinite(a0)) continue; // 全透明
    // uv → 位置的仿射（取前三个顶点）
    const [ua, va, ub, vb, uc, vc] = [U[0], U[1], U[2], U[3], U[4], U[5]];
    const det = (ub - ua) * (vc - va) - (uc - ua) * (vb - va);
    if (Math.abs(det) < 1e-12) { itemsBounds([item], b); continue; }
    const map = (u: number, v: number): [number, number] => {
      const s = ((u - ua) * (vc - va) - (uc - ua) * (v - va)) / det;
      const t = ((ub - ua) * (v - va) - (u - ua) * (vb - va)) / det;
      return [P[0] + s * (P[2] - P[0]) + t * (P[4] - P[0]), P[1] + s * (P[3] - P[1]) + t * (P[5] - P[1])];
    };
    for (const [u, v] of [[a0, b0], [a1, b0], [a1, b1], [a0, b1]]) {
      const [x, y] = map(u, v);
      if (x < b.minX) b.minX = x; if (x > b.maxX) b.maxX = x; if (y < b.minY) b.minY = y; if (y > b.maxY) b.maxY = y;
    }
  }
  return b;
}

/** 按内容取景的动画包围盒（所有帧并集） */
export function animationContentBounds(player: Player, page: RasterImage | undefined, frames?: number[]): Bounds {
  const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const list = frames ?? Array.from({ length: Math.max(1, player.duration) }, (_, i) => i);
  for (const f of list) { player.seek(f); contentBounds(player.renderItems(), page, b); }
  if (!Number.isFinite(b.minX)) return { minX: -50, minY: -50, maxX: 50, maxY: 50 };
  return b;
}

/**
 * 骨骼叠加层：在位图上画骨骼（从世界原点沿 +x 轴 length 长的锥形线 + 关节圆点），与编辑器 overlay 同色系。
 * 直接改写 img（straight RGBA，source-over）。
 */
export function drawBoneOverlay(img: RasterImage, player: Player, bounds: Bounds, padding = 8, color: [number, number, number] = [255, 170, 0]): number {
  const { scale, ox, oy } = frameMapping(bounds, img.width, img.height, padding);
  const W = img.width, H = img.height, d = img.rgba;
  const blend = (x: number, y: number, a: number, c: [number, number, number]) => {
    if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
    const i = (y * W + x) * 4, da = d[i + 3] / 255, oa = a + da * (1 - a);
    for (let k = 0; k < 3; k++) d[i + k] = Math.round((c[k] * a + d[i + k] * da * (1 - a)) / Math.max(1e-6, oa));
    d[i + 3] = Math.round(oa * 255);
  };
  const seg = (x0: number, y0: number, x1: number, y1: number, r0: number, r1: number, c: [number, number, number]) => {
    const minX = Math.floor(Math.min(x0, x1) - r0 - 1), maxX = Math.ceil(Math.max(x0, x1) + r0 + 1);
    const minY = Math.floor(Math.min(y0, y1) - r0 - 1), maxY = Math.ceil(Math.max(y0, y1) + r0 + 1);
    const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy;
    for (let y = Math.max(0, minY); y <= Math.min(H - 1, maxY); y++) for (let x = Math.max(0, minX); x <= Math.min(W - 1, maxX); x++) {
      const px = x + 0.5, py = y + 0.5;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / l2)) : 0;
      const dist = Math.hypot(px - x0 - t * dx, py - y0 - t * dy), r = r0 + (r1 - r0) * t;
      blend(x, y, Math.max(0, Math.min(1, r + 0.5 - dist)) * 0.9, c);
    }
  };
  let n = 0;
  for (const bone of player.skeleton.bones) {
    const m = bone.world;
    const x0 = m[4] * scale + ox, y0 = m[5] * scale + oy;
    const len = bone.length ?? 0;
    if (len > 0) seg(x0, y0, (m[4] + m[0] * len) * scale + ox, (m[5] + m[1] * len) * scale + oy, 3, 1, color);
    seg(x0, y0, x0, y0, 3.5, 3.5, [255, 255, 255]);
    seg(x0, y0, x0, y0, 2.2, 2.2, color);
    n++;
  }
  return n;
}
