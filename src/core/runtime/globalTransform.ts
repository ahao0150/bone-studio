/**
 * 官方 `dragonBones.Transform`（父空间变换）的复刻。
 *
 * 与 math.ts 的 `Mat2DTransform` 的差别是：`globalFromMatrix` 是**有状态**的 ——
 * 官方 `Transform.fromMatrix` 用 `this.scaleX/scaleY` 的**上一次值**做 `backupScale` 符号
 * 修正，同一个矩阵在不同历史下会落到不同的 `rotation/skew` 分支。IK 写入世界矩阵后由
 * `updateByConstraint` → `fromMatrix` 回写，这个历史依赖正是 §101 里 `bikeik` 逐帧漂移的来源。
 */
import type { Mat2D } from './math';

export interface GlobalTransform {
  x: number;
  y: number;
  rotation: number;
  skew: number;
  scaleX: number;
  scaleY: number;
}

export function identityGlobal(): GlobalTransform {
  return { x: 0, y: 0, rotation: 0, skew: 0, scaleX: 1, scaleY: 1 };
}

export function copyGlobal(from: GlobalTransform, to: GlobalTransform): GlobalTransform {
  to.x = from.x; to.y = from.y;
  to.rotation = from.rotation; to.skew = from.skew;
  to.scaleX = from.scaleX; to.scaleY = from.scaleY;
  return to;
}

/** 官方 `Transform.toMatrix`：`rotation === 0` / `skew === 0` 的特判逐条对应。 */
export function globalToMatrix(t: GlobalTransform, out?: Mat2D): Mat2D {
  const m = out ?? ([0, 0, 0, 0, 0, 0] as Mat2D);
  if (t.rotation === 0) { m[0] = 1; m[1] = 0; }
  else { m[0] = Math.cos(t.rotation); m[1] = Math.sin(t.rotation); }
  if (t.skew === 0) { m[2] = -m[1]; m[3] = m[0]; }
  else { m[2] = -Math.sin(t.skew + t.rotation); m[3] = Math.cos(t.skew + t.rotation); }
  if (t.scaleX !== 1) { m[0] *= t.scaleX; m[1] *= t.scaleX; }
  if (t.scaleY !== 1) { m[2] *= t.scaleY; m[3] *= t.scaleY; }
  m[4] = t.x;
  m[5] = t.y;
  return m;
}

/**
 * 官方 `Transform.fromMatrix`。`t` 传入前应当仍持有**上一帧**的 `scaleX/scaleY`，
 * 函数内部把它们当作 `backupScaleX/backupScaleY`（这是行为的一部分，勿先清零）。
 */
export function globalFromMatrix(t: GlobalTransform, m: Mat2D): GlobalTransform {
  const PI_Q = Math.PI * 0.25;
  const backupScaleX = t.scaleX;
  const backupScaleY = t.scaleY;
  t.x = m[4];
  t.y = m[5];
  t.rotation = Math.atan(m[1] / m[0]);
  let skewX = Math.atan(-m[2] / m[3]);
  t.scaleX = (t.rotation > -PI_Q && t.rotation < PI_Q) ? m[0] / Math.cos(t.rotation) : m[1] / Math.sin(t.rotation);
  t.scaleY = (skewX > -PI_Q && skewX < PI_Q) ? m[3] / Math.cos(skewX) : -m[2] / Math.sin(skewX);
  if (backupScaleX >= 0 && t.scaleX < 0) {
    t.scaleX = -t.scaleX;
    t.rotation -= Math.PI;
  }
  if (backupScaleY >= 0 && t.scaleY < 0) {
    t.scaleY = -t.scaleY;
    skewX -= Math.PI;
  }
  t.skew = skewX - t.rotation;
  return t;
}
