/**
 * 网格三角化（官方 `_653._5674`）。
 *
 * **官方契约**（格式规范）：输入「全部顶点 + 轮廓边（成对）+ 手绘边（成对）」→ 输出三角形。
 * 官方实现是「先 `_3165` 做 Delaunay，再 `_5682` 逐条把约束边恢复回来」。清洁室不搬它的代码，
 * 但**契约必须一致**：
 *
 *  1. 每条 `outline` / `userEdges` 边都要真的出现在某个三角形里（否则边界会漏，权重也会飘）；
 *  2. 三角形只覆盖多边形内部，不跨到外面；
 *  3. 所有顶点（含自动布点塞进来的内部点）都要被用上。
 *
 * **为什么不能用耳切**：真实网格的顶点顺序是任意的（网格状排列 + 内部点），
 * 只有 Delaunay 才对顺序不敏感 —— 这一点被 `tests/meshTriangulate.test.ts` 用真实样例钉住了
 * （耳切版本在 `shin_01` 上只覆盖了 23.4 / 3955.0）。
 */
export type Point2 = [number, number];
export type IndexEdge = [number, number];
export type Tri = [number, number, number];

/** 有符号面积（正 = 逆时针）。 */
export function signedArea(points: Point2[]): number {
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    sum += (points[j][0] - points[i][0]) * (points[j][1] + points[i][1]);
  }
  return sum / 2;
}

function area2(a: Point2, b: Point2, c: Point2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
const edgeOf = (a: number, b: number): [number, number] => (a < b ? [a, b] : [b, a]);


/** 把三角形规范成逆时针（外接圆判定依赖朝向）。 */
function orient(points: Point2[], t: Tri): Tri {
  return area2(points[t[0]], points[t[1]], points[t[2]]) >= 0
    ? t
    : [t[0], t[2], t[1]];
}

/** 点是否在外接圆内（三角形必须已按逆时针给）。 */
function inCircumcircle(p: Point2, a: Point2, b: Point2, c: Point2): boolean {
  const ax = a[0] - p[0];
  const ay = a[1] - p[1];
  const bx = b[0] - p[0];
  const by = b[1] - p[1];
  const cx = c[0] - p[0];
  const cy = c[1] - p[1];
  const det = (ax * ax + ay * ay) * (bx * cy - by * cx)
    - (bx * bx + by * by) * (ax * cy - ay * cx)
    + (cx * cx + cy * cy) * (ax * by - ay * bx);
  return det > 0;
}

/** Bowyer–Watson 增量 Delaunay：结果只含真实顶点的三角形。 */
export function delaunay(points: Point2[]): Tri[] {
  if (points.length < 3) return [];
  let minX = points[0][0];
  let maxX = minX;
  let minY = points[0][1];
  let maxY = minY;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const span = Math.max(maxX - minX, maxY - minY, 1) * 20;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  const s0 = points.length;
  const s1 = s0 + 1;
  const s2 = s0 + 2;
  const all: Point2[] = [
    ...points,
    [midX - span, midY - span],
    [midX + span, midY - span],
    [midX, midY + span],
  ];
  let triangles: Tri[] = [orient(all, [s0, s1, s2])];

  for (let i = 0; i < points.length; i++) {
    const point = all[i];
    const bad = triangles.filter((t) =>
      inCircumcircle(point, all[t[0]], all[t[1]], all[t[2]]));
    if (bad.length === 0) continue;
    const border = new Map<string, [number, number]>();
    for (const t of bad) {
      for (const [x, y] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]] as IndexEdge[]) {
        const k = key(x, y);
        if (border.has(k)) border.delete(k); else border.set(k, edgeOf(x, y));
      }
    }
    const badKeys = new Set(bad.map((t) => `${t[0]},${t[1]},${t[2]}`));
    triangles = triangles.filter((t) => !badKeys.has(`${t[0]},${t[1]},${t[2]}`));
    for (const [x, y] of border.values()) triangles.push(orient(all, [x, y, i]));
  }
  return triangles.filter((t) => t[0] < points.length && t[1] < points.length && t[2] < points.length);
}
/** 线段真交叉（端点接触不算）。 */
function segmentsCross(p1: Point2, p2: Point2, p3: Point2, p4: Point2): boolean {
  const d1 = area2(p3, p4, p1);
  const d2 = area2(p3, p4, p2);
  const d3 = area2(p1, p2, p3);
  const d4 = area2(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))
    && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** 找一条与线段 (a,b) 真交叉的三角形边。 */
function findCrossingEdge(triangles: Tri[], points: Point2[], a: number, b: number): IndexEdge | null {
  for (const t of triangles) {
    for (const [u, v] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]] as IndexEdge[]) {
      if (u === a || u === b || v === a || v === b) continue;
      if (segmentsCross(points[a], points[b], points[u], points[v])) return edgeOf(u, v);
    }
  }
  return null;
}

/** 翻转一条共享边（四边形必须凸，否则会翻出重叠三角形）。 */
function flipEdge(points: Point2[], triangles: Tri[], u: number, v: number): boolean {
  const want = key(u, v);
  const sharing = triangles.filter((t) =>
    [key(t[0], t[1]), key(t[1], t[2]), key(t[2], t[0])].includes(want));
  if (sharing.length !== 2) return false;
  const opposite = sharing.map((t) => t.find((i) => i !== u && i !== v));
  const [x, y] = opposite;
  if (x === undefined || y === undefined || x === y) return false;
  if (Math.abs(area2(points[u], points[v], points[x])) < 1e-12) return false;
  if (Math.abs(area2(points[u], points[v], points[y])) < 1e-12) return false;
  // 凸性：x 与 y 必须落在 uv 的两侧
  if (area2(points[u], points[v], points[x]) * area2(points[u], points[v], points[y]) >= 0) return false;
  const at = triangles.indexOf(sharing[0]);
  const bt = triangles.indexOf(sharing[1]);
  triangles[at] = orient(points, [x, y, v]);
  triangles[bt] = orient(points, [y, x, u]);
  return true;
}

/** 把一条约束边恢复进三角化（官方 `_5682` 的等价物，靠反复翻边）。 */
export function restoreConstraint(points: Point2[], triangles: Tri[], a: number, b: number): void {
  for (let guard = 0; guard < 512; guard++) {
    if (hasEdge(triangles, a, b)) return;
    const crossing = findCrossingEdge(triangles, points, a, b);
    if (!crossing) return;
    if (!flipEdge(points, triangles, crossing[0], crossing[1])) return;
  }
}

/** 从边表走出一条闭环（只含轮廓顶点）。 */
function outlineLoop(outline: IndexEdge[], vertexCount: number): number[] {
  if (outline.length < 3) return [];
  const adj = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    const list = adj.get(a);
    if (list) list.push(b); else adj.set(a, [b]);
  };
  for (const [a, b] of outline) { link(a, b); link(b, a); }
  const start = outline[0][0];
  const loop = [start];
  let prev = -1;
  let cursor = start;
  for (let guard = 0; guard <= outline.length; guard++) {
    const neighbours = (adj.get(cursor) ?? []).filter((n) => n !== prev);
    const step = neighbours.find((n) => n === start && loop.length >= 3)
      ?? neighbours.find((n) => !loop.includes(n));
    if (step === undefined) break;
    if (step === start) return loop;
    loop.push(step);
    prev = cursor;
    cursor = step;
  }
  return loop.length >= 3 ? loop : [];
}

/** 射线法：点是否在多边形内。 */
function pointInPolygon(p: Point2, polygon: Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (((yi > p[1]) !== (yj > p[1])) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * 约束三角化。`outline` / `userEdges` 都是**顶点下标对**（与 `display.edges` / `display.userEdges` 同形）。
 * 有 `outline` 时会额外丢掉质心落在轮廓外的三角形 —— Delaunay 覆盖的是**凸包**，凹多边形必须裁。
 */
export function triangulateMesh(
  vertices: Point2[],
  outline: IndexEdge[] = [],
  userEdges: IndexEdge[] = [],
): Tri[] {
  if (vertices.length < 3) return [];
  const triangles = delaunay(vertices);
  if (triangles.length === 0) return [];
  const wanted = [...outline, ...userEdges]
    .map(([a, b]) => edgeOf(a, b))
    .filter(([a, b]) => a !== b && a < vertices.length && b < vertices.length);
  for (const [a, b] of wanted) restoreConstraint(vertices, triangles, a, b);

  const loop = outlineLoop(outline, vertices.length);
  const polygon = loop.map((index) => vertices[index]);
  return triangles.filter(([a, b, c]) => {
    if (Math.abs(area2(vertices[a], vertices[b], vertices[c])) <= 1e-9) return false;
    if (polygon.length < 3) return true;
    const cx = (vertices[a][0] + vertices[b][0] + vertices[c][0]) / 3;
    const cy = (vertices[a][1] + vertices[b][1] + vertices[c][1]) / 3;
    return pointInPolygon([cx, cy], polygon);
  });
}

/** 三角形面积和（测试用：判断有没有重叠 / 漏面）。 */
export function triangleAreaSum(vertices: Point2[], triangles: Tri[]): number {
  return triangles.reduce((total, [a, b, c]) =>
    total + Math.abs(area2(vertices[a], vertices[b], vertices[c])) / 2, 0);
}

/** 边是否出现在三角形集合里。 */
export function hasEdge(triangles: Tri[], a: number, b: number): boolean {
  const want = key(a, b);
  return triangles.some(([x, y, z]) => key(x, y) === want || key(y, z) === want || key(z, x) === want);
}