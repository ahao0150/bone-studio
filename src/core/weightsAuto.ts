/**
 * 自动权重（官方 `_566.autoWeight` + `StageNotification.START_AUTO_WEIGHT` / `END_AUTO_WEIGHT`）。
 *
 * 格式规范中的语义（清洁室：只取行为规格，不搬实现；格式验证见 格式规范）：
 *  1. `meshRig.bones.length > 1` 才启动 —— 单骨无从"分配"；
 *  2. 骨骼原点被网格 `hitTest` 命中 = **内部骨骼**（参与权重），否则权重恒 0；
 *  3. 距离 = 顶点到**骨骼线段**（原点 → 沿骨骼方向 1×length）的距离；
 *  4. `w = clamp(全局最近距离, ≥ MIN_DISTANCE) / d`，`w < OVER_WEIGHT` 直接置 0；
 *  5. 若某顶点全部为 0 → 把距离最近的那根设为 1；
 *  6. 每顶点按权重降序只保留 `MAX_BONE_PRE_VERTEX` 根，再归一化到 1。
 *
 * 空间：顶点先经 `display.slotPose` 进 bindSpace，骨骼用 `bindWorlds` 的绑定世界矩阵 ——
 * 两者同一空间（`bonePose` 里存的就是这些矩阵），所以距离是可比的。
 */
import type { DbArmatureData, DbDisplayData } from './types';
import type { Player } from './player';
import { findMesh, isBakedMesh } from './meshEdit';
import { bindWorlds } from './editing';
import type { Mat2D } from './runtime/math';

const MIN_DISTANCE = 100;
const OVER_WEIGHT = 0.0025;
const MAX_BONE_PER_VERTEX = 4;

export interface AutoWeightResult {
  /** 重算过的顶点数 */
  vertices: number;
  /** 参与计算的内部骨骼数 */
  bones: number;
  /** 没有执行的原因（有值时 vertices 为 0） */
  skipped?: string;
  /** 走了官方兜底：没有骨骼原点落在网格内 → 第一根绑定骨骼权重 1（其余 0） */
  fallback?: boolean;
}

const IDENTITY: Mat2D = [1, 0, 0, 1, 0, 0];

function applyMatrix(m: Mat2D, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** 点到线段距离（官方 `_654._4273`）。 */
export function pointSegmentDistance(
  px: number, py: number, x0: number, y0: number, x1: number, y1: number,
): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 1e-12) return Math.hypot(px - x0, py - y0);
  let t = ((px - x0) * dx + (py - y0) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

/** 重心坐标法：点在三角形内（官方用 `mesh.hitTest` 判断骨骼原点是否落在网格覆盖区）。 */
function inTriangle(
  px: number, py: number,
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
): boolean {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function coversPoint(points: Array<[number, number]>, triangles: number[], x: number, y: number): boolean {
  const count = points.length;
  if (count < 3) return false;
  for (let i = 0; i + 2 < triangles.length; i += 3) {
    const a = triangles[i];
    const b = triangles[i + 1];
    const c = triangles[i + 2];
    if (a >= count || b >= count || c >= count) continue;
    if (inTriangle(x, y, points[a][0], points[a][1], points[b][0], points[b][1], points[c][0], points[c][1])) return true;
  }
  if (count < 3) return false;
  // 三角形没命中（或该网格本来就没有三角剖分 —— 样例里的 `mesh` 槽位就是只有轮廓）。
  // 官方 `hitTest` 判的是渲染形状，所以这里再按顶点顺序当多边形判一次。
  let inside = false;
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const xi = points[i][0];
    const yi = points[i][1];
    const xj = points[j][0];
    const yj = points[j][1];
    if (((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 参与权重的骨骼名（来自 `display.bonePose` / 权重对，见 `meshWeightBones`）。 */
function boundBones(armature: DbArmatureData, display: DbDisplayData): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  const pose = display.bonePose ?? [];
  for (let i = 0; i + 6 < pose.length; i += 7) {
    const index = pose[i];
    if (!seen.has(index) && armature.bone[index]) { seen.add(index); out.push(index); }
  }
  return out;
}

export function autoWeightMesh(player: Player | null, slotName: string): AutoWeightResult {
  const armature = player?.skeleton.armature;
  if (!armature) return { vertices: 0, bones: 0, skipped: '没有打开的工程' };
  const display = findMesh(armature, slotName);
  if (!display) return { vertices: 0, bones: 0, skipped: `${slotName} 不是网格` };
  if (isBakedMesh(display)) return { vertices: 0, bones: 0, skipped: 'dbbin 烘焙形态的网格不支持自动权重' };

  const indices = boundBones(armature, display);
  // 官方门槛：meshRig.bones.length > 1 才启动
  if (indices.length <= 1) return { vertices: 0, bones: indices.length, skipped: '至少需要绑定 2 根骨骼' };

  const verts = display.vertices ?? [];
  const vertexCount = Math.floor(verts.length / 2);
  if (vertexCount === 0) return { vertices: 0, bones: indices.length, skipped: '网格没有顶点' };

  const worlds = bindWorlds(armature.bone);
  const slotPose = display.slotPose && display.slotPose.length >= 6
    ? ([...display.slotPose.slice(0, 6)] as Mat2D)
    : IDENTITY;

  // 顶点 → bindSpace
  const bindPoints: Array<[number, number]> = [];
  for (let v = 0; v < vertexCount; v++) {
    bindPoints.push(applyMatrix(slotPose, verts[v * 2], verts[v * 2 + 1]));
  }

  // 骨骼线段（bindSpace）；原点不在网格内的算「外部骨骼」，权重恒 0
  const segments = new Map<number, { x0: number; y0: number; x1: number; y1: number }>();
  for (const index of indices) {
    const bone = armature.bone[index];
    const world = worlds.get(bone.name);
    if (!world) continue;
    const [x0, y0] = [world[4], world[5]];
    const [x1, y1] = applyMatrix(world, bone.length ?? 0, 0);
    // 顶点与骨骼原点都在 bindSpace 里比 —— 用 slot 空间的顶点会错（slotPose 非单位时尤其明显）。
    if (!coversPoint(bindPoints, display.triangles ?? [], x0, y0)) continue;   // 官方：骨骼原点不在网格内 → 不参与
    segments.set(index, { x0, y0, x1, y1 });
  }
  if (segments.size === 0) {
    // 官方兜底（`filterBone` 的 `_4284.length == 0` 分支）：没有骨骼原点落在网格内时，
    // 把**第一根绑定骨骼**的权重直接设为 1、其余 0（每个顶点都一样）。
    const first = indices[0];
    if (first === undefined) return { vertices: 0, bones: 0, skipped: '没有绑定骨骼' };
    const flat: number[] = [];
    for (let v = 0; v < vertexCount; v++) flat.push(1, first, 1);
    display.weights = flat;
    player!.rebuildSkeleton();
    return { vertices: vertexCount, bones: 0, fallback: true };
  }

  // ① 全部距离 + 全局最近距离（跨所有顶点，官方 `_4277`）
  const distances = new Map<number, number[]>();
  let globalMin = Number.POSITIVE_INFINITY;
  for (const [index, seg] of segments) {
    const list: number[] = [];
    for (let v = 0; v < vertexCount; v++) {
      const d = pointSegmentDistance(bindPoints[v][0], bindPoints[v][1], seg.x0, seg.y0, seg.x1, seg.y1);
      list.push(d);
      if (d < globalMin) globalMin = d;
    }
    distances.set(index, list);
  }
  if (!Number.isFinite(globalMin)) return { vertices: 0, bones: 0, skipped: '距离计算失败' };
  const reference = Math.max(globalMin, MIN_DISTANCE);   // 官方：clamp 到 ≥ MIN_DISTANCE

  // ② 每顶点：权重 → 阈值 → 保底 → 取前 4 → 归一化
  const rows: Array<Array<[number, number]>> = [];
  for (let v = 0; v < vertexCount; v++) {
    let pairs = [...segments.keys()].map((index) => {
      const d = distances.get(index)![v];
      const w = d > 0 ? reference / d : Number.POSITIVE_INFINITY;
      return { index, d, w: Number.isFinite(w) ? w : 1 };
    });
    for (const pair of pairs) if (pair.w < OVER_WEIGHT) pair.w = 0;
    if (pairs.every((pair) => pair.w === 0)) {
      const nearest = pairs.reduce((best, pair) => (pair.d < best.d ? pair : best), pairs[0]);
      nearest.w = 1;
    }
    pairs = pairs.sort((a, b) => b.w - a.w).slice(0, MAX_BONE_PER_VERTEX).filter((pair) => pair.w > 0);
    const sum = pairs.reduce((total, pair) => total + pair.w, 0);
    rows.push(pairs.map((pair) => [pair.index, sum > 0 ? pair.w / sum : 0] as [number, number]));
  }

  // ③ 写回平铺的 weights
  const flat: number[] = [];
  for (let v = 0; v < vertexCount; v++) {
    const pairs = rows[v];
    flat.push(pairs.length);
    for (const [index, weight] of pairs) flat.push(index, weight);
  }
  display.weights = flat;
  player!.rebuildSkeleton();
  return { vertices: vertexCount, bones: segments.size };
}