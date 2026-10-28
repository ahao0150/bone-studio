/**
 * 关节缝隙闭合（纯数据）。
 *
 * - `extendRegion`：在切口（关节附近）把部件的不透明像素向外延伸 `overlap` 像素（最近色填充），
 *   位图四周补 `overlap` 透明边，图片中心不变 → 显示对象变换不用改。弯曲时两块之间有重叠，不露缝。
 * - `weldMeshWeights`：关节两侧的网格在关节带内用**同一个**沿骨骼方向的平滑权重函数
 *   （父→子 0→1），两块网格在关节处跟随完全一致的骨骼混合，切口边缘像焊在一起一样同步变形。
 */
import type { RasterImage } from './raster';
import type { DbArmatureData, DbDisplayData } from './types';
import { apply, type Mat2D } from './runtime/math';

export function extendRegion(img: RasterImage, joints: Array<{ x: number; y: number }>, overlap: number, radius: number): { image: RasterImage; filled: number } {
  const P = Math.max(0, Math.round(overlap));
  const W = img.width + 2 * P, H = img.height + 2 * P;
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < img.height; y++) out.set(img.rgba.subarray(y * img.width * 4, (y + 1) * img.width * 4), ((y + P) * W + P) * 4);
  const near = new Uint8Array(W * H);
  for (const j of joints) {
    const jx = j.x + P, jy = j.y + P, r = radius + P;
    for (let y = Math.max(0, Math.floor(jy - r)); y < Math.min(H, Math.ceil(jy + r)); y++)
      for (let x = Math.max(0, Math.floor(jx - r)); x < Math.min(W, Math.ceil(jx + r)); x++)
        if ((x - jx) ** 2 + (y - jy) ** 2 <= r * r) near[y * W + x] = 1;
  }
  let filled = 0;
  for (let it = 0; it < P; it++) {
    const add: number[] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!near[i] || out[i * 4 + 3] > 200) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + ox, yy = y + oy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const k = (yy * W + xx) * 4; if (out[k + 3] > 200) { r += out[k]; g += out[k + 1]; b += out[k + 2]; n++; }
      }
      if (n) add.push(i, r / n, g / n, b / n);
    }
    if (!add.length) break;
    for (let k = 0; k < add.length; k += 4) { const i = add[k] * 4; out[i] = add[k + 1]; out[i + 1] = add[k + 2]; out[i + 2] = add[k + 3]; out[i + 3] = 255; filled++; }
  }
  return { image: { width: W, height: H, rgba: out }, filled };
}

const smooth = (t: number) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };

/**
 * 加权网格（顶点在绑定世界空间）里落在关节带内的顶点改成父/子骨骼平滑混合。
 * band：沿子骨骼方向 ±band 像素内过渡；lateral：离关节的横向最大距离。
 */
export function weldMeshWeights(arm: DbArmatureData, bindWorld: Mat2D[], d: DbDisplayData,
  joint: { parent: number; child: number; x: number; y: number; ux: number; uy: number }, band: number, lateral: number): number {
  if (d.type !== 'mesh' || !d.vertices || !d.weights?.length) return 0;
  const sp = d.slotPose?.length === 6 ? (d.slotPose as unknown as Mat2D) : null;
  const rows: number[][] = [];
  let k = 0;
  for (let v = 0; v < d.vertices.length / 2; v++) { const n = d.weights[k]; rows.push(d.weights.slice(k, k + 1 + 2 * n)); k += 1 + 2 * n; }
  let changed = 0;
  rows.forEach((row, v) => {
    const [x, y] = sp ? apply(sp, d.vertices![v * 2], d.vertices![v * 2 + 1]) : [d.vertices![v * 2], d.vertices![v * 2 + 1]];
    const dx = x - joint.x, dy = y - joint.y;
    const t = dx * joint.ux + dy * joint.uy, lat = Math.abs(-dx * joint.uy + dy * joint.ux);
    if (Math.abs(t) > band * 1.5 || lat > lateral) return;
    // 只改本来就挂在这两根骨骼上的顶点（避免把别处顶点拉过来）
    const bones = new Set<number>(); for (let j = 1; j < row.length; j += 2) bones.add(row[j]);
    if (!bones.has(joint.parent) && !bones.has(joint.child)) return;
    const wc = +smooth((t / band + 1) / 2).toFixed(4);
    rows[v] = wc <= 0 ? [1, joint.parent, 1] : wc >= 1 ? [1, joint.child, 1] : [2, joint.parent, +(1 - wc).toFixed(4), joint.child, wc];
    changed++;
  });
  if (!changed) return 0;
  d.weights = rows.flat();
  const pose = new Map<number, number[]>();
  for (let i = 0; i + 6 < (d.bonePose ?? []).length; i += 7) pose.set(d.bonePose![i], d.bonePose!.slice(i + 1, i + 7));
  for (const b of [joint.parent, joint.child]) if (!pose.has(b)) pose.set(b, [...bindWorld[b]]);
  d.bonePose = [...pose.entries()].sort((a, b) => a[0] - b[0]).flatMap(([i, m]) => [i, ...m]);
  void arm;
  return changed;
}
