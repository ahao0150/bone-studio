/**
 * 位图轮廓追踪 + 重采样（官方 `_654.outline(bitmapData, tolerance, threshold)`）。
 *
 * 格式验证（`格式规范`）：
 *  1. `_13917` 二值化：`(pixel32 >> 24 & 0xFF) <= tolerance ? 0 : 1` —— **alpha 大于容差即实心**；
 *     `Mesh._13924` 传的 `tolerance = 1`，所以"不是全透明"就算实体。
 *  2. `_13918` 提取所有连通轮廓，`outline()` 里**只取最长的一条**（`length` 最大）。
 *  3. `_13919(contour, threshold)` 按阈值重采样；`threshold` 来自
 *     `densityNumArr = [0.3, 0.4, 0.5, 0.6, 0.7]`（密度 1~5），**越大点越多**
 *     —— 与 `Mesh.tool.autoOutline`「密度范围1~5，数值越大边线点越多」一致。
 *
 * 本文件只做「像素 → 轮廓点」这半段（纯函数、可单测）；三角化在 `triangulate.ts`。
 */
import { triangulateMesh, type IndexEdge, type Point2 } from './triangulate';

export type OutlinePoint = [number, number];

/** 二值化：alpha > tolerance 记 1。 */
export function binarizeAlpha(
  alpha: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  tolerance = 1,
): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = (alpha[i] ?? 0) > tolerance ? 1 : 0;
  return out;
}

const N8: Array<[number, number]> = [
  [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0],
];

/**
 * Moore 邻域边界跟踪：返回**有序**的边界像素坐标（取最长的那条轮廓）。
 * 起点按扫描顺序取「实心且上方是背景」的像素，保证从轮廓的左上角开始。
 */
export function traceLongestOutline(
  binary: Uint8Array,
  width: number,
  height: number,
): OutlinePoint[] {
  const at = (x: number, y: number) =>
    (x < 0 || y < 0 || x >= width || y >= height) ? 0 : binary[y * width + x];

  let sx = -1;
  let sy = -1;
  for (let y = 0; y < height && sx < 0; y++) {
    for (let x = 0; x < width; x++) {
      if (at(x, y) === 1 && at(x, y - 1) === 0) { sx = x; sy = y; break; }
    }
  }
  if (sx < 0) return [];

  const contour: OutlinePoint[] = [];
  let cx = sx;
  let cy = sy;
  let dir = 7;                                   // 上一步在"左"，从它开始逆时针找
  const guard = width * height * 8 + 16;
  for (let step = 0; step < guard; step++) {
    contour.push([cx, cy]);
    let moved = false;
    for (let k = 1; k <= 8; k++) {
      const d = (dir + k) % 8;
      const nx = cx + N8[d][0];
      const ny = cy + N8[d][1];
      if (at(nx, ny) === 1) {
        cx = nx;
        cy = ny;
        dir = (d + 6) % 8;                       // 背对来路，下一轮从这里继续
        moved = true;
        break;
      }
    }
    if (!moved) break;                            // 孤点
    if (cx === sx && cy === sy && contour.length > 2) break;
  }
  return contour;
}

/**
 * 按弧长等距重采样（官方 `_13919` 的同语义等价物：阈值越大点越多）。
 * 阈值来自 `densityNumArr`（0.3 ~ 0.7），这里把它映射成"沿周长取多少个点"。
 */
export function resampleOutline(points: OutlinePoint[], threshold: number): OutlinePoint[] {
  if (points.length <= 3) return points.map((p) => [...p] as OutlinePoint);
  const closed = [...points, points[0]];
  const lengths: number[] = [0];
  let total = 0;
  for (let i = 1; i < closed.length; i++) {
    total += Math.hypot(closed[i][0] - closed[i - 1][0], closed[i][1] - closed[i - 1][1]);
    lengths.push(total);
  }
  if (total <= 0) return points.map((p) => [...p] as OutlinePoint);

  const clamped = Math.max(0.05, Math.min(0.95, threshold));
  const wanted = Math.max(6, Math.round(24 * (clamped / 0.5)));
  const step = total / wanted;
  const out: OutlinePoint[] = [];
  let cursor = 1;
  for (let i = 0; i < wanted; i++) {
    const target = i * step;
    while (cursor < lengths.length - 1 && lengths[cursor] < target) cursor++;
    const prev = lengths[cursor - 1];
    const span = Math.max(1e-9, lengths[cursor] - prev);
    const t = (target - prev) / span;
    const a = closed[cursor - 1];
    const b = closed[cursor];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

/** 位图 → 轮廓点（二值化 + 追踪 + 重采样一条链）。 */
export function outlineFromAlpha(
  alpha: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number,
  tolerance = 1,
): OutlinePoint[] {
  const binary = binarizeAlpha(alpha, width, height, tolerance);
  return resampleOutline(traceLongestOutline(binary, width, height), threshold);
}
/** 轮廓点 → 可直接写进 `DbDisplayData` 的网格数据。 */
export interface OutlineMeshData {
  /** 平铺的 slot 局部顶点（官方 `_13924`：像素坐标减去图片宽高的一半，做居中） */
  vertices: number[];
  /** 平铺的图集像素 UV（`getRenderItems` 会再除以图集宽高） */
  uvs: number[];
  triangles: number[];
  /** 轮廓边（下标对，闭环） */
  edges: number[];
}

export interface AtlasRegionRect { x: number; y: number; width: number; height: number }

export function buildMeshFromOutline(points: OutlinePoint[], region: AtlasRegionRect): OutlineMeshData {
  const halfW = region.width / 2;
  const halfH = region.height / 2;
  const local: Point2[] = points.map(([px, py]) => [px - halfW, py - halfH]);
  const vertices: number[] = [];
  const uvs: number[] = [];
  for (let i = 0; i < points.length; i++) {
    vertices.push(local[i][0], local[i][1]);
    uvs.push(region.x + points[i][0], region.y + points[i][1]);
  }
  const outlineEdges: IndexEdge[] = points.map((_, i) => [i, (i + 1) % points.length] as IndexEdge);
  const triangles: number[] = [];
  for (const [a, b, c] of triangulateMesh(local, outlineEdges)) triangles.push(a, b, c);
  const edges: number[] = [];
  for (const [a, b] of outlineEdges) edges.push(a, b);
  return { vertices, uvs, triangles, edges };
}