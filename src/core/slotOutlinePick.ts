/**
 * 插槽轮廓的命中测试：官方选中插槽后，轮廓的每个**连接点**和**每条边**都能点。
 * 纯函数、只吃屏幕坐标（渲染项 positions 已是世界坐标，乘缩放加平移即屏幕），便于单测。
 *
 * 格式验证：`格式规范` §74（选中插槽画轮廓）+ 用户对官方操作的描述
 *       「外部轮廓的连接处提供小点和线条可以点击，点击后出现调节位移的拨杆」。
 */

export interface ScreenView {
  scale: number;
  panX: number;
  panY: number;
}

/** 轮廓里出现过的顶点索引（按边顺序去重 —— 与舞台画白点的顺序一致）。 */
export function outlineVertexIndices(outline: ReadonlyArray<readonly [number, number]>): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const [a, b] of outline) {
    for (const v of [a, b]) {
      if (seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

function screenX(positions: ArrayLike<number>, v: number, view: ScreenView): number {
  return positions[v * 2] * view.scale + view.panX;
}

function screenY(positions: ArrayLike<number>, v: number, view: ScreenView): number {
  return positions[v * 2 + 1] * view.scale + view.panY;
}

/** 最近的一个**轮廓顶点**（返回 mesh 顶点索引）；比阈值远就返回 null。 */
export function pickOutlineVertex(
  positions: ArrayLike<number>,
  outline: ReadonlyArray<readonly [number, number]>,
  px: number,
  py: number,
  view: ScreenView,
  threshold = 8,
): number | null {
  let best: number | null = null;
  let bestDistance = threshold;
  for (const v of outlineVertexIndices(outline)) {
    if (v * 2 + 1 >= positions.length) continue;
    const d = Math.hypot(screenX(positions, v, view) - px, screenY(positions, v, view) - py);
    if (d < bestDistance) {
      bestDistance = d;
      best = v;
    }
  }
  return best;
}

/** 最近的一条**轮廓边**（返回两端点索引与线段参数 t）；比阈值远就返回 null。 */
export function pickOutlineEdge(
  positions: ArrayLike<number>,
  outline: ReadonlyArray<readonly [number, number]>,
  px: number,
  py: number,
  view: ScreenView,
  threshold = 6,
): { a: number; b: number; t: number } | null {
  let best: { a: number; b: number; t: number } | null = null;
  let bestDistance = threshold;
  for (const [a, b] of outline) {
    if (a * 2 + 1 >= positions.length || b * 2 + 1 >= positions.length) continue;
    const ax = screenX(positions, a, view);
    const ay = screenY(positions, a, view);
    const bx = screenX(positions, b, view);
    const by = screenY(positions, b, view);
    const vx = bx - ax;
    const vy = by - ay;
    const len2 = vx * vx + vy * vy;
    if (len2 < 1e-9) continue;
    const t = Math.min(1, Math.max(0, ((px - ax) * vx + (py - ay) * vy) / len2));
    const d = Math.hypot(ax + vx * t - px, ay + vy * t - py);
    if (d < bestDistance) {
      bestDistance = d;
      best = { a, b, t };
    }
  }
  return best;
}