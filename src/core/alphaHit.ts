/**
 * 舞台拾取的 alpha 通道判定：点在显示对象的透明像素上时按「没命中」处理。
 *
 * 格式验证（清洁室，见 `格式规范` §106）：
 *  - 官方舞台命中 `格式规范` 第 113-215 行 `_5068(point)`：
 *    点先 `globalToLocal` 到显示对象局部 —— 网格走 `Mesh.hitTest`
 *    （`_658/Mesh.as` 第 1107 行 → `_652/_654.as` 第 121-152 行 `_4252`，射线法点内多边形），
 *    图片退化成局部裁剪矩形 `|x| < width/2 && |y| < height/2`。
 *  - `_654._13917` 二值化：`(pixel32 >> 24 & 0xFF) <= tolerance ? 0 : 1`；`Mesh._13924` 传
 *    `tolerance = 1`。`Mesh.update`（第 1136-1140 行）把网格栅格化进 `BitmapData`，alpha 即判据来源。
 *  - 本实现按用户要求把**图片**也收紧到逐像素 alpha（官方图片只看矩形），阈值取 `alpha > 0`。
 *
 * 纯函数、不依赖 Pixi / DOM，便于单测。
 */
import type { RenderItem } from './runtime/skeleton';

export interface AlphaMask {
  width: number;
  height: number;
  /** 逐像素 alpha（0-255），行优先 */
  alpha: Uint8Array;
}

/** `alpha > 0` 即实心（官方 `_13917` 的 `tolerance = 0` 等价物）。 */
export const ALPHA_TOLERANCE = 0;

/** 取某个图集像素的 alpha；越界当全透明。 */
export function sampleAlpha(mask: AlphaMask, px: number, py: number): number {
  const x = Math.floor(px);
  const y = Math.floor(py);
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return 0;
  return mask.alpha[y * mask.width + x] ?? 0;
}

/** 解 `s*e1 + t*e2 = p - p0`（Cramer 法则）；退化（面积为 0）返回 null。 */
function solveST(
  x0: number, y0: number, x1: number, y1: number, x3: number, y3: number, x: number, y: number,
): [number, number] | null {
  const ax = x1 - x0;
  const ay = y1 - y0;
  const bx = x3 - x0;
  const by = y3 - y0;
  const det = ax * by - ay * bx;
  if (Math.abs(det) < 1e-9) return null;
  const dx = x - x0;
  const dy = y - y0;
  return [(dx * by - dy * bx) / det, (ax * dy - ay * dx) / det];
}

/**
 * 图片显示对象：四角 `[TL, TR, BR, BL]` 与 UV 一一对应，世界坐标 → UV 是仿射映射，
 * 用 TL / TR / BL 三个角求逆即可（对旋转、缩放、斜切都成立）。
 * 点在四边形外返回 null。
 */
export function uvAtQuad(
  positions: Float32Array, uvs: Float32Array, x: number, y: number,
): [number, number] | null {
  if (positions.length < 8 || uvs.length < 8) return null;
  const st = solveST(
    positions[0], positions[1], positions[2], positions[3], positions[6], positions[7], x, y,
  );
  if (!st) return null;
  const [s, t] = st;
  if (s < 0 || s > 1 || t < 0 || t > 1) return null;
  return [
    uvs[0] + s * (uvs[2] - uvs[0]) + t * (uvs[6] - uvs[0]),
    uvs[1] + s * (uvs[3] - uvs[1]) + t * (uvs[7] - uvs[1]),
  ];
}

/** 网格显示对象：落在某个三角形内时按重心坐标插值 UV（每个三角形上的映射是仿射的）。 */
export function uvAtMesh(
  positions: Float32Array, uvs: Float32Array, triangles: ArrayLike<number>, x: number, y: number,
): [number, number] | null {
  const epsilon = -1e-9;
  for (let i = 0; i + 2 < triangles.length; i += 3) {
    const a = triangles[i];
    const b = triangles[i + 1];
    const c = triangles[i + 2];
    if (a * 2 + 1 >= positions.length || b * 2 + 1 >= positions.length || c * 2 + 1 >= positions.length) continue;
    const x0 = positions[a * 2];
    const y0 = positions[a * 2 + 1];
    const x1 = positions[b * 2];
    const y1 = positions[b * 2 + 1];
    const x2 = positions[c * 2];
    const y2 = positions[c * 2 + 1];
    const det = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (Math.abs(det) < 1e-9) continue;
    const l0 = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / det;
    const l1 = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / det;
    const l2 = 1 - l0 - l1;
    if (l0 < epsilon || l1 < epsilon || l2 < epsilon) continue;
    return [
      uvs[a * 2] * l0 + uvs[b * 2] * l1 + uvs[c * 2] * l2,
      uvs[a * 2 + 1] * l0 + uvs[b * 2 + 1] * l1 + uvs[c * 2 + 1] * l2,
    ];
  }
  return null;
}

/** 世界坐标 → 图集像素 UV；点不在这个显示对象的几何范围内时返回 null。 */
export function itemUvAt(item: RenderItem, x: number, y: number): [number, number] | null {
  return item.kind === 'image'
    ? uvAtQuad(item.positions, item.uvs, x, y)
    : uvAtMesh(item.positions, item.uvs, item.triangles, x, y);
}

/**
 * 世界坐标点上这个显示对象是否「实心」。
 * `mask` 为 null（图集还没解码 / 解码失败）时回落到几何判定，保证不会因为异步加载而点不动。
 */
export function itemOpaqueAt(
  item: RenderItem, mask: AlphaMask | null, x: number, y: number, tolerance = ALPHA_TOLERANCE,
): boolean {
  const uv = itemUvAt(item, x, y);
  if (!uv) return false;
  if (!mask) return true;
  return sampleAlpha(mask, uv[0], uv[1]) > tolerance;
}
