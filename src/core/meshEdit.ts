/**
 * Mesh geometry editing (M4): move / remove vertices while keeping the skin arrays consistent.
 *
 * Semantics recovered from the runtime (`Skeleton.buildMesh`) and the official format:
 *   - `display.vertices` is the **authoritative** geometry, in slot-local space;
 *   - the JSON form derives the bind-space point as `slotPose * vertex`, so moving a vertex
 *     only has to rewrite `vertices`;
 *   - the `*_ske.dbbin` form bakes that point per (vertex, bone) into `display.bindOffsets`,
 *     so the same move would also need each bone's bind matrix. That form is refused here
 *     rather than half-updated (格式规范);
 *   - `triangles` indexes `vertices`; removing a vertex drops every triangle that used it
 *     and renumbers the survivors.
 */

import type { DbArmatureData, DbDisplayData } from './types';
import { invert, type Mat2D } from './runtime/math';

/** Positions are rounded to 1/1000 to keep exports byte-stable. */
const ROUND = 1000;

/**
 * dbbin 形态把「绑定空间坐标」烘进了 `display.bindOffsets`，所以移动顶点时还必须同步平移它们，
 * 否则运行时读的还是旧坐标（渲染不动）。位移量是 `inverse(bindWorld_k) · slotPose · localDelta`，
 * 其中 `bindWorld_k` 是第 k 根骨骼的绑定世界矩阵（`Skeleton.bindWorld`）。
 */
export interface MeshEditContext {
  bindWorld?: (boneIndex: number) => Mat2D | null;
}

/** Resolve the mesh display a geometry edit targets. */
export function findMesh(armature: DbArmatureData, slotName: string): DbDisplayData | null {
  for (const skin of armature.skin ?? []) {
    for (const slot of skin.slot ?? []) {
      if (slot.name !== slotName) continue;
      for (const display of slot.display ?? []) {
        if ((display.type === 'mesh' || display.type === 2) && (display.vertices?.length ?? 0) >= 6) return display;
      }
    }
  }
  return null;
}

export function meshVertexCount(display: DbDisplayData): number {
  return Math.floor((display.vertices?.length ?? 0) / 2);
}

/** `*_ske.dbbin` meshes bake bind-space points per vertex; editing them needs bind matrices. */
export function isBakedMesh(display: DbDisplayData): boolean {
  return (display.bindOffsets?.length ?? 0) > 0;
}

/** 该显示对象在图集里的像素区域（官方 `mesh.maxWidth/maxHeight` 的来源）。 */
export interface MeshRegionRect { x: number; y: number; width: number; height: number }

/**
 * 官方 `RESET_ORIGIN` → `Mesh._3196()` → `_2092(w,h)`（`_658/Mesh.as:206-243`）：
 * 把网格重建成覆盖整张图片的 **4 角点矩形**（2 个三角形），并清空绑定骨骼 / 权重 / 手绘边。
 * 宽高取自该显示对象的图集区域 —— 官方 `_2092` 用的是 `mesh.maxWidth/maxHeight`（位图尺寸）。
 *
 * 顶点顺序与官方一致：(-w/2,-h/2) (w/2,-h/2) (-w/2,h/2) (w/2,h/2)；
 * 三角形 `[0,1,2, 1,3,2]`、轮廓 `edges` 为矩形闭环。dbbin 烘焙形态按既有约定拒绝。
 */
export function resetMeshGeometry(
  armature: DbArmatureData, slotName: string, region: MeshRegionRect,
): boolean {
  const display = findMesh(armature, slotName);
  if (!display || isBakedMesh(display)) return false;
  const halfW = region.width / 2;
  const halfH = region.height / 2;
  display.type = 'mesh';
  display.vertices = [
    -halfW, -halfH,
    halfW, -halfH,
    -halfW, halfH,
    halfW, halfH,
  ].map((value) => Math.round(value * ROUND) / ROUND);
  display.uvs = [
    region.x, region.y,
    region.x + region.width, region.y,
    region.x, region.y + region.height,
    region.x + region.width, region.y + region.height,
  ].map((value) => Math.round(value * ROUND) / ROUND);
  display.triangles = [0, 1, 2, 1, 3, 2];
  // 官方 `_2092` 的 outline 闭环：[3,4, 4,6, 6,5, 5,3]（下标 0..3）
  display.edges = [0, 1, 1, 3, 3, 2, 2, 0];
  // 官方命令 `_330` 紧随其后清掉 meshRig（`mesh.meshRig = null`）
  display.userEdges = [];
  delete display.weights;
  delete display.bindOffsets;
  delete display.bonePose;
  delete display.weightBones;
  delete display.slotPose;
  delete display.offset;
  return true;
}

/**
 * 官方 `Mesh._4326()`（`_658/Mesh.as:245-253`）：4 顶点且恰为 `(±w/2, ±h/2)` 时返回 true。
 * 「重置网格」用它做 no-op 守卫 —— 已是默认矩形就不发命令（不产生空的撤销步）。
 */
export function isDefaultRectMesh(display: DbDisplayData, region: MeshRegionRect): boolean {
  const vertices = display.vertices ?? [];
  if (vertices.length !== 8) return false;
  const halfW = region.width / 2;
  const halfH = region.height / 2;
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-3;
  return near(vertices[0], -halfW) && near(vertices[1], -halfH)
    && near(vertices[2], halfW) && near(vertices[3], -halfH)
    && near(vertices[4], -halfW) && near(vertices[5], halfH)
    && near(vertices[6], halfW) && near(vertices[7], halfH);
}

/** Vertex positions in slot-local space, plus the triangle list that indexes them. */
export function readMesh(display: DbDisplayData): { vertices: Array<[number, number]>; triangles: number[] } {
  const raw = display.vertices ?? [];
  const vertices: Array<[number, number]> = [];
  for (let i = 0; i + 1 < raw.length; i += 2) vertices.push([raw[i], raw[i + 1]]);
  return { vertices, triangles: [...(display.triangles ?? [])] };
}

export function writeMesh(display: DbDisplayData, vertices: Array<[number, number]>, triangles: number[]): void {
  display.vertices = vertices.flat();
  display.triangles = triangles;
}

/** Unique undirected edges of the mesh, for the editor's edge overlay. */
export function meshEdges(display: DbDisplayData): Array<[number, number]> {
  const triangles = display.triangles ?? [];
  const seen = new Set<string>();
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 2 < triangles.length; i += 3) {
    const tri = [triangles[i], triangles[i + 1], triangles[i + 2]];
    for (let k = 0; k < 3; k++) {
      const a = tri[k];
      const b = tri[(k + 1) % 3];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([a, b]);
    }
  }
  return out;
}

/** Set one vertex to an absolute slot-local position. */
export function setMeshVertex(
  armature: DbArmatureData, slotName: string, vertex: number, x: number, y: number,
  context?: MeshEditContext,
): boolean {
  const display = findMesh(armature, slotName);
  if (!display) return false;
  const count = meshVertexCount(display);
  if (vertex < 0 || vertex >= count) return false;
  const vertices = display.vertices as number[];
  if (isBakedMesh(display)) {
    const dx = x - vertices[vertex * 2];
    const dy = y - vertices[vertex * 2 + 1];
    if (!shiftBakedPoints(display, vertex, dx, dy, context?.bindWorld)) return false;
  }
  vertices[vertex * 2] = Math.round(x * ROUND) / ROUND;
  vertices[vertex * 2 + 1] = Math.round(y * ROUND) / ROUND;
  return true;
}

/**
 * 同步平移某个顶点的烘焙绑定点。没有可用的绑定矩阵时返回 false（宁可拒绝，也不做出
 * 「vertices 改了但渲染没动」的半更新）。
 */
function shiftBakedPoints(
  display: DbDisplayData, vertex: number, dx: number, dy: number,
  bindWorldOf?: (boneIndex: number) => Mat2D | null,
): boolean {
  const offsets = display.bindOffsets;
  if (!offsets || offsets.length === 0) return true;
  if (!bindWorldOf) return false;
  if (dx === 0 && dy === 0) return true;
  const pose = display.slotPose;
  const a = pose?.[0] ?? 1;
  const b = pose?.[1] ?? 0;
  const c = pose?.[2] ?? 0;
  const d = pose?.[3] ?? 1;
  // slotPose 的线性部分先作用在局部位移上，得到「绑定空间」的位移
  const px = a * dx + c * dy;
  const py = b * dx + d * dy;

  // weights 与 bindOffsets 是两条按顶点对齐的记录流：第 k 个烘焙点属于 weights 里第 k 根骨骼
  const weights = display.weights ?? [];
  let wo = 0;
  let bo = 0;
  for (let v = 0; ; v++) {
    const weightCount = weights[wo++] ?? 0;
    const bakedCount = offsets[bo++] ?? 0;
    if (v === vertex) {
      if (weightCount !== bakedCount) return false;
      for (let k = 0; k < bakedCount; k++) {
        const boneIndex = weights[wo + k * 2];
        const bind = bindWorldOf(boneIndex);
        if (!bind) return false;
        const inv = invert(bind);
        offsets[bo + k * 2] += inv[0] * px + inv[2] * py;
        offsets[bo + k * 2 + 1] += inv[1] * px + inv[3] * py;
      }
      return true;
    }
    wo += weightCount * 2;
    bo += bakedCount * 2;
    if (bo >= offsets.length) return false;
  }
}

/** Move one vertex by `(dx, dy)` in slot-local space. */
export function moveMeshVertex(
  armature: DbArmatureData, slotName: string, vertex: number, dx: number, dy: number,
  context?: MeshEditContext,
): boolean {
  const display = findMesh(armature, slotName);
  if (!display) return false;
  const count = meshVertexCount(display);
  if (vertex < 0 || vertex >= count) return false;
  const vertices = display.vertices as number[];
  return setMeshVertex(
    armature, slotName, vertex,
    vertices[vertex * 2] + dx, vertices[vertex * 2 + 1] + dy,
    context,
  );
}

/** Drop a vertex: every triangle that used it goes away and survivors are renumbered. */
export function removeMeshVertex(armature: DbArmatureData, slotName: string, vertex: number): boolean {
  const display = findMesh(armature, slotName);
  if (!display) return false;
  const count = meshVertexCount(display);
  if (vertex < 0 || vertex >= count || count <= 3) return false;

  const { vertices, triangles } = readMesh(display);
  vertices.splice(vertex, 1);
  const remapped: number[] = [];
  for (let i = 0; i + 2 < triangles.length; i += 3) {
    const tri = [triangles[i], triangles[i + 1], triangles[i + 2]];
    if (tri.includes(vertex)) continue;
    for (const index of tri) remapped.push(index > vertex ? index - 1 : index);
  }
  writeMesh(display, vertices, remapped);

  // `uvs` is a parallel per-vertex array; `weights` is a per-vertex record stream
  if (display.uvs && display.uvs.length >= count * 2) display.uvs.splice(vertex * 2, 2);
  dropVertexWeights(display, vertex);
  dropVertexBaked(display, vertex);
  dropVertexUserEdges(display, vertex);
  return true;
}

/**
 * Remove one vertex's baked bind points (dbbin: per-vertex `[count, bx, by, ...]` stream).
 * 与 weights 一样是「按顶点一条记录」的流，删点必须同步，否则后面的顶点会错位读别人的烘焙点。
 */
function dropVertexBaked(display: DbDisplayData, vertex: number): void {
  const offsets = display.bindOffsets;
  if (!offsets || offsets.length === 0) return;
  let at = 0;
  for (let v = 0; ; v++) {
    const start = at;
    const count = offsets[at++] ?? 0;
    at += count * 2;
    if (v === vertex) {
      offsets.splice(start, at - start);
      return;
    }
    if (at >= offsets.length) return;
  }
}

/** Remove one vertex's weight record (per-vertex `[count, bone, weight, ...]` stream). */
function dropVertexWeights(display: DbDisplayData, vertex: number): void {
  const weights = display.weights;
  if (!weights || weights.length === 0) return;
  let at = 0;
  for (let v = 0; ; v++) {
    const start = at;
    const entries = weights[at++] ?? 0;
    at += entries * 2;
    if (v === vertex) {
      weights.splice(start, at - start);
      return;
    }
    if (at >= weights.length) return;
  }
}

/** Position of the edge `(a, b)` inside `meshEdges(display)`, or -1. */
export function findEdgeIndex(display: DbDisplayData, a: number, b: number): number {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return meshEdges(display).findIndex(([x, y]) => Math.min(x, y) === lo && Math.max(x, y) === hi);
}

/** Per-vertex `[count, bone, weight, ...]` record of one vertex. */
function readWeightRecord(flat: number[], vertex: number): Array<[number, number]> {
  let at = 0;
  for (let v = 0; ; v++) {
    const count = flat[at++] ?? 0;
    if (v === vertex) {
      const pairs: Array<[number, number]> = [];
      for (let k = 0; k < count && at + 1 < flat.length; k++) {
        pairs.push([flat[at], flat[at + 1]]);
        at += 2;
      }
      return pairs;
    }
    at += count * 2;
    if (at >= flat.length) return [];
  }
}

/**
 * 纯计算：把两端点的权重记录按 `t` 混合、重新归一化，返回 `(骨骼, 权重)` 列表（**不写入**）。
 * 两端点都没有记录时退回复制 `a`，避免新顶点因无权重而在 `buildMesh` 里塌到原点。
 * 拆成「算」与「写」两步，是为了让 dbbin 形态能在**任何写入之前**先确认烘焙点算得出来。
 */
function blendWeightEntries(display: DbDisplayData, a: number, b: number, t: number): Array<[number, number]> {
  const weights = display.weights;
  if (!weights || weights.length === 0) return [];
  const merged = new Map<number, number>();
  for (const [bone, w] of readWeightRecord(weights, a)) merged.set(bone, (merged.get(bone) ?? 0) + w * (1 - t));
  for (const [bone, w] of readWeightRecord(weights, b)) merged.set(bone, (merged.get(bone) ?? 0) + w * t);
  let entries = [...merged.entries()].filter(([, w]) => w > 1e-4).sort((x, y) => y[1] - x[1]);
  if (entries.length === 0) entries = readWeightRecord(weights, a);
  const total = entries.reduce((sum, [, w]) => sum + w, 0) || 1;
  return entries.map(([bone, w]) => [bone, Math.round((w / total) * 1000) / 1000] as [number, number]);
}

/** 把一条权重记录追加到末尾（新顶点永远是最后一个）。 */
function appendBlendedWeights(display: DbDisplayData, entries: Array<[number, number]>): void {
  const weights = display.weights;
  if (!weights || weights.length === 0) return;
  weights.push(entries.length);
  for (const [bone, w] of entries) weights.push(bone, w);
}

/**
 * Insert a vertex on the edge `(a, b)` at parameter `t` (0 = a, 1 = b), splitting every
 * triangle that used that edge into two. Returns the new vertex index, or null when the pair
 * is not a shared triangle edge or the mesh is the baked (dbbin) form.
 */
export function addMeshVertexOnEdge(
  armature: DbArmatureData, slotName: string, a: number, b: number, t: number,
  context?: MeshEditContext,
): number | null {
  const display = findMesh(armature, slotName);
  if (!display) return null;
  const count = meshVertexCount(display);
  if (a < 0 || b < 0 || a >= count || b >= count || a === b) return null;
  const { vertices, triangles } = readMesh(display);
  const uses = (tri: number[]) => tri.includes(a) && tri.includes(b);
  if (!tris(triangles).some(uses)) return null;

  const clamped = Math.min(1, Math.max(0, t));
  const nx = vertices[a][0] + (vertices[b][0] - vertices[a][0]) * clamped;
  const ny = vertices[a][1] + (vertices[b][1] - vertices[a][1]) * clamped;
  const index = count;

  // —— 先把依赖外部信息的部分全部算完：任何失败都发生在写入之前 ——
  const entries = blendWeightEntries(display, a, b, clamped);
  let bakedPoints: Array<[number, number]> | null = null;
  if (isBakedMesh(display)) {
    if (entries.length === 0) return null;
    const pose = display.slotPose;
    const pa = pose?.[0] ?? 1;
    const pb = pose?.[1] ?? 0;
    const pc = pose?.[2] ?? 0;
    const pd = pose?.[3] ?? 1;
    const bx = pa * nx + pc * ny + (pose?.[4] ?? 0);
    const by = pb * nx + pd * ny + (pose?.[5] ?? 0);
    bakedPoints = [];
    for (const [bone] of entries) {
      const bind = context?.bindWorld?.(bone);
      if (!bind) return null;
      const inv = invert(bind);
      bakedPoints.push([inv[0] * bx + inv[2] * by, inv[1] * bx + inv[3] * by]);
    }
  }

  // —— 写入 ——
  vertices.push([nx, ny]);

  const out: number[] = [];
  for (let i = 0; i + 2 < triangles.length; i += 3) {
    const tri = [triangles[i], triangles[i + 1], triangles[i + 2]];
    if (!uses(tri)) { out.push(tri[0], tri[1], tri[2]); continue; }
    // keep the winding: split the directed edge a->b (or b->a) and keep the third corner
    for (let k = 0; k < 3; k++) {
      const v0 = tri[k];
      const v1 = tri[(k + 1) % 3];
      const v2 = tri[(k + 2) % 3];
      if (v0 === a && v1 === b) out.push(a, index, v2, index, b, v2);
      else if (v0 === b && v1 === a) out.push(b, index, v2, index, a, v2);
    }
  }
  writeMesh(display, vertices, out);

  const uvs = display.uvs;
  if (uvs && uvs.length >= count * 2) {
    uvs.splice(index * 2, 0,
      uvs[a * 2] + (uvs[b * 2] - uvs[a * 2]) * clamped,
      uvs[a * 2 + 1] + (uvs[b * 2 + 1] - uvs[a * 2 + 1]) * clamped);
  }
  appendBlendedWeights(display, entries);
  if (bakedPoints) {
    if (!display.bindOffsets) display.bindOffsets = [];
    display.bindOffsets.push(bakedPoints.length);
    for (const [x, y] of bakedPoints) display.bindOffsets.push(x, y);
  }
  return index;
}

/** Triangles of a flat index list, as triples. */
function tris(flat: number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i + 2 < flat.length; i += 3) out.push([flat[i], flat[i + 1], flat[i + 2]]);
  return out;
}

/** A vertex is gone: drop the drawn edges that used it and renumber the survivors. */
function dropVertexUserEdges(display: DbDisplayData, vertex: number): void {
  const flat = display.userEdges;
  if (!flat || flat.length === 0) return;
  const out: number[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const a = flat[i];
    const b = flat[i + 1];
    if (a === vertex || b === vertex) continue;
    out.push(a > vertex ? a - 1 : a, b > vertex ? b - 1 : b);
  }
  display.userEdges = out;
}

/**
 * User-drawn edges (`Mesh.tool.outline` in the official mesh editor), as index pairs.
 * Stored flat in `display.userEdges`; the vendor's binary writer drops the whole array
 * (`MeshDisplay.clearToBinary`, oss/Tools/out/format/dragonBonesFormat.js L1005-1016),
 * so this data only survives in `*_ske.json` and `.dbproj`.
 */
export function readUserEdges(display: DbDisplayData): Array<[number, number]> {
  const flat = display.userEdges ?? [];
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
}

/** Index of the drawn edge `(a, b)` in `readUserEdges(display)`, or -1 (order-insensitive). */
export function findUserEdgeIndex(display: DbDisplayData, a: number, b: number): number {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return readUserEdges(display).findIndex(([x, y]) => Math.min(x, y) === lo && Math.max(x, y) === hi);
}

/** Draw one edge between two existing vertices; false when it already exists or is invalid. */
export function addUserEdge(armature: DbArmatureData, slotName: string, a: number, b: number): boolean {
  const display = findMesh(armature, slotName);
  if (!display || isBakedMesh(display)) return false;
  const count = meshVertexCount(display);
  if (a < 0 || b < 0 || a >= count || b >= count || a === b) return false;
  if (findUserEdgeIndex(display, a, b) >= 0) return false;
  if (!display.userEdges) display.userEdges = [];
  display.userEdges.push(a, b);
  return true;
}

/** Erase one drawn edge; false when it was not drawn. */
export function removeUserEdge(armature: DbArmatureData, slotName: string, a: number, b: number): boolean {
  const display = findMesh(armature, slotName);
  if (!display || isBakedMesh(display)) return false;
  const index = findUserEdgeIndex(display, a, b);
  if (index < 0) return false;
  display.userEdges!.splice(index * 2, 2);
  return true;
}

/**
 * The outline (`display.edges`): every edge used by exactly one triangle, i.e. the mesh border.
 * Recovered from oss/Tools/out/format/dragonBonesFormat.js `getEdgeFormTriangles`; the *set* is
 * verified element-for-element against the official Rooster/Bicycle samples, while the vendor's
 * storage order differs (documented in 格式规范). Returned sorted by (a, b).
 */
export function outlineEdges(display: DbDisplayData): Array<[number, number]> {
  const seen = new Map<string, [number, number] | null>();
  const add = (a: number, b: number) => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = `${lo}_${hi}`;
    if (seen.has(key)) seen.set(key, null);
    else seen.set(key, [lo, hi]);
  };
  const triangles = display.triangles ?? [];
  for (let i = 0; i + 2 < triangles.length; i += 3) {
    add(triangles[i], triangles[i + 1]);
    add(triangles[i + 1], triangles[i + 2]);
    add(triangles[i + 2], triangles[i]);
  }
  const out: Array<[number, number]> = [];
  for (const value of seen.values()) if (value) out.push(value);
  out.sort((x, y) => (x[0] === y[0] ? x[1] - y[1] : x[0] - y[0]));
  return out;
}

/** 网格显示对象判定（官方 `MenuItem-convertToImage` 的可用条件）。 */
export function isMeshDisplay(display: DbDisplayData | null | undefined): boolean {
  return !!display && (display.type === 'mesh' || display.type === 2);
}

/**
 * 网格 → 图片（官方 `MenuItem-convertToImage`「转换为图片」）：丢掉顶点 / 三角 / 权重 / 绑定等网格数据，
 * 只留图片显示对象。返回是否真的转了。
 */
export function convertMeshToImage(display: DbDisplayData | null | undefined): boolean {
  if (!isMeshDisplay(display) || !display) return false;
  display.type = 'image';
  delete display.vertices;
  delete display.uvs;
  delete display.triangles;
  delete display.edges;
  delete display.userEdges;
  delete display.weights;
  delete display.bonePose;
  delete display.bindOffsets;
  delete display.weightBones;
  delete display.slotPose;
  delete display.offset;
  return true;
}
