/**
 * `type: "surface"` runtime: a deformable vertex grid that warps the space its
 * child bones live in.
 *
 * Re-implemented from the published DragonBones runtime (`armature/Surface.ts`,
 * MIT) — see docs/OSS-REFERENCES.md and 格式规范 Each grid quad
 * becomes an affine map; outside the grid a "hull" fan keeps the space continuous,
 * and every derived matrix is memoised in a 7-float slot per quad/diagonal.
 */
import { inheritOn, type InheritFlags, type Mat2D, composeMatrix, decomposeMatrix, multiply, type Mat2DTransform } from './math';

/** official `lA` / `lB` bounds: the grid spans [-lA, lA]^2, the hull reaches ±lB */
const L_A = 200;
const L_B = 1000;

/** Result of the official `Surface._getAffineTransform`. */
function affine(
  x: number, y: number, lX: number, lY: number,
  aX: number, aY: number, bX: number, bY: number, cX: number, cY: number,
  out: Mat2D, isDown: boolean, transform?: Mat2DTransform,
): void {
  const dabX = bX - aX;
  const dabY = bY - aY;
  const dacX = cX - aX;
  const dacY = cY - aY;

  let rotation = Math.atan2(dabY, dabX);
  const skew = Math.atan2(dacY, dacX) - Math.PI * 0.5 - rotation;

  if (isDown) rotation += Math.PI;

  const scaleX = Math.sqrt(dabX * dabX + dabY * dabY) / lX;
  const scaleY = Math.sqrt(dacX * dacX + dacY * dacY) / lY;

  // official \`Transform.toMatrix\`: a/b follow \`rotation\` (skY) and c/d follow
  // \`skew + rotation\` (skX) — and when \`skew === 0\` the runtime derives c/d from the
  // *already scaled* a/b (an upstream quirk that the undeformed grid hits, so it
  // must be mirrored for parity).
  let a = rotation === 0 ? 1 : Math.cos(rotation);
  let b = rotation === 0 ? 0 : Math.sin(rotation);
  let c: number;
  let d: number;
  if (skew === 0) {
    c = -b;
    d = a;
  } else {
    c = -Math.sin(skew + rotation);
    d = Math.cos(skew + rotation);
  }
  // scale is applied *after* the c/d shortcut in the runtime, so a
  // \`skew === 0\` transform carries the y-axis through scaleY only
  if (scaleX !== 1) { a *= scaleX; b *= scaleX; }
  if (scaleY !== 1) { c *= scaleY; d *= scaleY; }
  out[0] = a;
  out[1] = b;
  out[2] = c;
  out[3] = d;
  out[4] = aX - (a * x + c * y);
  out[5] = aY - (b * x + d * y);

  if (transform) {
    transform.rotation = rotation;
    transform.skew = skew;
    transform.scaleX = scaleX;
    transform.scaleY = scaleY;
    transform.x = out[4];
    transform.y = out[5];
  }
}

/**
 * Runtime state of one surface bone: the deformed grid plus the caches the
 * official class keeps (`_matrixCahce`, `_hullCache`).
 */
export class SurfaceRuntime {
  readonly segmentX: number;
  readonly segmentY: number;
  /** bind grid from the data (`bone.vertices`), two floats per vertex */
  readonly base: number[];
  /** current deform offsets fed by the `Surface(50)` timeline */
  readonly deform: number[];
  /** deformed grid, expressed in the parent's space (armature space by default) */
  readonly vertices: number[];
  /** official `Surface.global`: the fitted transform of the deformed grid */
  readonly global: Mat2DTransform = { x: 0, y: 0, rotation: 0, skew: 0, scaleX: 1, scaleY: 1 };
  /** official `Surface.globalTransformMatrix` */
  readonly matrix: Mat2D = [1, 0, 0, 1, 0, 0];
  /** official `Surface._bone`: index of the plain bone this surface hangs from (-1 = detached) */
  anchor = -1;
  /** world scale of that anchor bone (`surfaceBone.global.scaleX/Y`) */
  anchorScaleX = 1;
  anchorScaleY = 1;

  private readonly matrices: number[];
  private readonly hull: number[] = new Array<number>(12).fill(0);
  private readonly help: Mat2D = [1, 0, 0, 1, 0, 0];
  private readonly dX: number;
  private readonly dY: number;
  private readonly k: number;
  private readonly kX: number;
  private readonly kY: number;

  constructor(segmentX: number, segmentY: number, vertices: number[]) {
    this.segmentX = Math.max(1, segmentX);
    this.segmentY = Math.max(1, segmentY);
    this.base = vertices.slice();
    this.deform = new Array<number>(vertices.length).fill(0);
    this.vertices = new Array<number>(vertices.length).fill(0);
    this.dX = (L_A * 2) / this.segmentX;
    this.dY = (L_A * 2) / this.segmentY;
    this.k = -this.dY / this.dX;
    this.kX = -this.dY / (L_B - L_A);
    this.kY = -(L_B - L_A) / this.dX;
    this.matrices = new Array<number>(
      (this.segmentX * this.segmentY + this.segmentX * 2 + this.segmentY * 2) * 2 * 7,
    ).fill(0);
  }

  /** official `_updateVertices`: place the grid through the parent space */
  updateVertices(parentWorld: Mat2D | null, parentSurface: SurfaceRuntime | null): void {
    const { base, deform, vertices } = this;
    const count = Math.floor(base.length / 2);
    for (let i = 0; i < count; i++) {
      const at = i * 2;
      const x = base[at] + deform[at];
      const y = base[at + 1] + deform[at + 1];
      if (parentSurface) {
        const m = parentSurface.getGlobalTransformMatrix(x, y);
        vertices[at] = m[0] * x + m[2] * y + m[4];
        vertices[at + 1] = m[1] * x + m[3] * y + m[5];
      } else if (parentWorld) {
        vertices[at] = parentWorld[0] * x + parentWorld[2] * y + parentWorld[4];
        vertices[at + 1] = parentWorld[1] * x + parentWorld[3] * y + parentWorld[5];
      } else {
        vertices[at] = x;
        vertices[at + 1] = y;
      }
    }
  }

  /** official `_updateGlobalTransformMatrix`: fit a matrix through three grid midpoints */
  updateMatrix(): void {
    const segmentXD = this.segmentX * 2;
    const lastIndex = this.vertices.length - 2;
    const v = this.vertices;

    const raX = v[0];
    const raY = v[1];
    const rbX = v[segmentXD];
    const rbY = v[segmentXD + 1];
    const rcX = v[lastIndex];
    const rcY = v[lastIndex + 1];
    const rdX = v[lastIndex - segmentXD];
    const rdY = v[lastIndex - segmentXD + 1];

    const dacX = raX + (rcX - raX) * 0.5;
    const dacY = raY + (rcY - raY) * 0.5;
    const dbdX = rbX + (rdX - rbX) * 0.5;
    const dbdY = rbY + (rdY - rbY) * 0.5;
    const aX = dacX + (dbdX - dacX) * 0.5;
    const aY = dacY + (dbdY - dacY) * 0.5;
    const bX = rbX + (rcX - rbX) * 0.5;
    const bY = rbY + (rcY - rbY) * 0.5;
    const cX = rdX + (rcX - rdX) * 0.5;
    const cY = rdY + (rcY - rdY) * 0.5;

    affine(0, 0, L_A, L_A, aX, aY, bX, bY, cX, cY, this.matrix, false, this.global);
    // any grid change invalidates every memoised quad matrix
    for (let i = 0; i < this.matrices.length; i += 7) this.matrices[i] = -1;
  }

  /** official `Surface.update` tail: the hull fan used outside the grid */
  updateHull(): void {
    const m = this.matrix;
    const ddX = 2 * this.global.x;
    const ddY = 2 * this.global.y;

    let hx = m[0] * L_B + m[2] * -L_A + m[4];
    let hy = m[1] * L_B + m[3] * -L_A + m[5];
    this.hull[0] = hx;
    this.hull[1] = hy;
    this.hull[2] = ddX - hx;
    this.hull[3] = ddY - hy;

    // delta=true: linear part only
    this.hull[4] = m[2] * this.dY;
    this.hull[5] = m[3] * this.dY;

    hx = m[0] * L_A + m[2] * L_B + m[4];
    hy = m[1] * L_A + m[3] * L_B + m[5];
    this.hull[6] = hx;
    this.hull[7] = hy;
    this.hull[8] = ddX - hx;
    this.hull[9] = ddY - hy;

    this.hull[10] = m[0] * this.dX;
    this.hull[11] = m[1] * this.dX;
  }

  /** official `Surface._getGlobalTransformMatrix(x, y)` */
  getGlobalTransformMatrix(x: number, y: number): Mat2D {
    if (x < -L_B || L_B < x || y < -L_B || L_B < y) return this.matrix;

    let isDown = false;
    const { segmentX, segmentY, dX, dY, matrices, hull, vertices } = this;
    const segmentXD = segmentX * 2;
    const indexX = Math.floor((x + L_A) / dX);
    const indexY = Math.floor((y + L_A) / dY);
    const pX = indexX * dX - L_A;
    const pY = indexY * dY - L_A;
    let matrixIndex = 0;

    if (x < -L_A) {
      if (y < -L_A || y >= L_A) return this.matrix;
      // Left
      isDown = y > this.kX * (x + L_A) + pY;
      matrixIndex = ((segmentX * segmentY + segmentX + segmentY + segmentY + indexY) * 2 + (isDown ? 1 : 0)) * 7;
      if (matrices[matrixIndex] > 0) copyFromArray(this.help, matrices, matrixIndex + 1);
      else {
        const vertexIndex = indexY * (segmentXD + 2);
        const ddX = hull[4];
        const ddY = hull[5];
        const sX = hull[2] - (segmentY - indexY) * ddX;
        const sY = hull[3] - (segmentY - indexY) * ddY;
        if (isDown) {
          affine(-L_A, pY + dY, L_B - L_A, dY,
            vertices[vertexIndex + segmentXD + 2], vertices[vertexIndex + segmentXD + 3],
            sX + ddX, sY + ddY, vertices[vertexIndex], vertices[vertexIndex + 1],
            this.help, true);
        } else {
          affine(-L_B, pY, L_B - L_A, dY,
            sX, sY, vertices[vertexIndex], vertices[vertexIndex + 1], sX + ddX, sY + ddY,
            this.help, false);
        }
        store(matrices, matrixIndex, this.help);
      }
    } else if (x >= L_A) {
      if (y < -L_A || y >= L_A) return this.matrix;
      // Right
      isDown = y > this.kX * (x - L_B) + pY;
      matrixIndex = ((segmentX * segmentY + segmentX + indexY) * 2 + (isDown ? 1 : 0)) * 7;
      if (matrices[matrixIndex] > 0) copyFromArray(this.help, matrices, matrixIndex + 1);
      else {
        const vertexIndex = (indexY + 1) * (segmentXD + 2) - 2;
        const ddX = hull[4];
        const ddY = hull[5];
        const sX = hull[0] + indexY * ddX;
        const sY = hull[1] + indexY * ddY;
        if (isDown) {
          affine(L_B, pY + dY, L_B - L_A, dY,
            sX + ddX, sY + ddY,
            vertices[vertexIndex + segmentXD + 2], vertices[vertexIndex + segmentXD + 3],
            sX, sY, this.help, true);
        } else {
          affine(L_A, pY, L_B - L_A, dY,
            vertices[vertexIndex], vertices[vertexIndex + 1],
            sX, sY, vertices[vertexIndex + segmentXD + 2], vertices[vertexIndex + segmentXD + 3],
            this.help, false);
        }
        store(matrices, matrixIndex, this.help);
      }
    } else if (y < -L_A) {
      if (x < -L_A || x >= L_A) return this.matrix;
      // Up
      isDown = y > this.kY * (x - pX - dX) - L_B;
      matrixIndex = ((segmentX * segmentY + indexX) * 2 + (isDown ? 1 : 0)) * 7;
      if (matrices[matrixIndex] > 0) copyFromArray(this.help, matrices, matrixIndex + 1);
      else {
        const vertexIndex = indexX * 2;
        const ddX = hull[10];
        const ddY = hull[11];
        const sX = hull[8] + indexX * ddX;
        const sY = hull[9] + indexX * ddY;
        if (isDown) {
          affine(pX + dX, -L_A, dX, L_B - L_A,
            vertices[vertexIndex + 2], vertices[vertexIndex + 3],
            vertices[vertexIndex], vertices[vertexIndex + 1],
            sX + ddX, sY + ddY, this.help, true);
        } else {
          affine(pX, -L_B, dX, L_B - L_A,
            sX, sY, sX + ddX, sY + ddY,
            vertices[vertexIndex], vertices[vertexIndex + 1], this.help, false);
        }
        store(matrices, matrixIndex, this.help);
      }
    } else if (y >= L_A) {
      if (x < -L_A || x >= L_A) return this.matrix;
      // Down
      isDown = y > this.kY * (x - pX - dX) + L_A;
      matrixIndex = ((segmentX * segmentY + segmentX + segmentY + indexX) * 2 + (isDown ? 1 : 0)) * 7;
      if (matrices[matrixIndex] > 0) copyFromArray(this.help, matrices, matrixIndex + 1);
      else {
        const vertexIndex = segmentY * (segmentXD + 2) + indexX * 2;
        const ddX = hull[10];
        const ddY = hull[11];
        const sX = hull[6] - (segmentX - indexX) * ddX;
        const sY = hull[7] - (segmentX - indexX) * ddY;
        if (isDown) {
          affine(pX + dX, L_B, dX, L_B - L_A,
            sX + ddX, sY + ddY, sX, sY,
            vertices[vertexIndex + 2], vertices[vertexIndex + 3], this.help, true);
        } else {
          affine(pX, L_A, dX, L_B - L_A,
            vertices[vertexIndex], vertices[vertexIndex + 1],
            vertices[vertexIndex + 2], vertices[vertexIndex + 3],
            sX, sY, this.help, false);
        }
        store(matrices, matrixIndex, this.help);
      }
    } else {
      // Center
      isDown = y > this.k * (x - pX - dX) + pY;
      matrixIndex = ((segmentX * indexY + indexX) * 2 + (isDown ? 1 : 0)) * 7;
      if (matrices[matrixIndex] > 0) copyFromArray(this.help, matrices, matrixIndex + 1);
      else {
        const vertexIndex = indexX * 2 + indexY * (segmentXD + 2);
        if (isDown) {
          affine(pX + dX, pY + dY, dX, dY,
            vertices[vertexIndex + segmentXD + 4], vertices[vertexIndex + segmentXD + 5],
            vertices[vertexIndex + segmentXD + 2], vertices[vertexIndex + segmentXD + 3],
            vertices[vertexIndex + 2], vertices[vertexIndex + 3], this.help, true);
        } else {
          affine(pX, pY, dX, dY,
            vertices[vertexIndex], vertices[vertexIndex + 1],
            vertices[vertexIndex + 2], vertices[vertexIndex + 3],
            vertices[vertexIndex + segmentXD + 2], vertices[vertexIndex + segmentXD + 3],
            this.help, false);
        }
        store(matrices, matrixIndex, this.help);
      }
    }

    return this.help;
  }
}

function copyFromArray(out: Mat2D, values: number[], offset: number): void {
  out[0] = values[offset];
  out[1] = values[offset + 1];
  out[2] = values[offset + 2];
  out[3] = values[offset + 3];
  out[4] = values[offset + 4];
  out[5] = values[offset + 5];
}

function store(values: number[], offset: number, m: Mat2D): void {
  values[offset] = 1;
  values[offset + 1] = m[0];
  values[offset + 2] = m[1];
  values[offset + 3] = m[2];
  values[offset + 4] = m[3];
  values[offset + 5] = m[4];
  values[offset + 6] = m[5];
}

/**
 * official `Bone._updateGlobalTransformMatrix` when the parent is a surface:
 * the child's position is warped by the grid, its rotation/scale follow the
 * anchor bone (`surfaceBone`) instead of the surface itself.
 */
export function composeSurfaceChild(
  surface: SurfaceRuntime, local: Mat2D, flags: InheritFlags,
): Mat2D {
  const inheritTranslation = inheritOn(flags.inheritTranslation);
  const inheritRotation = inheritOn(flags.inheritRotation);
  const inheritScale = inheritOn(flags.inheritScale);
  const t = decomposeMatrix(local);
  const parentMatrix = surface.getGlobalTransformMatrix(t.x, t.y);

  if (inheritScale && surface.anchor >= 0) {
    const mapped = parentMatrix;
    const x = mapped[0] * t.x + mapped[2] * t.y + mapped[4];
    const y = mapped[1] * t.x + mapped[3] * t.y + mapped[5];
    return composeMatrix({
      x,
      y,
      rotation: t.rotation + (inheritRotation ? surface.global.rotation : 0),
      skew: t.skew,
      scaleX: t.scaleX * surface.anchorScaleX,
      scaleY: t.scaleY * surface.anchorScaleY,
    });
  }

  const world = multiply(parentMatrix, local);
  if (!inheritTranslation) return [world[0], world[1], world[2], world[3], local[4], local[5]];
  return world;
}
