import type { DbTransform } from '../types';

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

/** 2D affine matrix: [a, b, c, d, tx, ty] (column-major semantics of DragonBones). */
export type Mat2D = [number, number, number, number, number, number];

export const IDENTITY: Mat2D = [1, 0, 0, 1, 0, 0];

export function matFromTransform(t: DbTransform | undefined): Mat2D {
  const x = t?.x ?? 0;
  const y = t?.y ?? 0;
  const skX = (t?.skX ?? 0) * DEG2RAD;
  const skY = (t?.skY ?? 0) * DEG2RAD;
  const scX = t?.scX === undefined ? 1 : t.scX;
  const scY = t?.scY === undefined ? 1 : t.scY;
  return [
    scX * Math.cos(skY),
    scX * Math.sin(skY),
    -scY * Math.sin(skX),
    scY * Math.cos(skX),
    x,
    y,
  ];
}

export function multiply(parent: Mat2D, child: Mat2D): Mat2D {
  return [
    parent[0] * child[0] + parent[2] * child[1],
    parent[1] * child[0] + parent[3] * child[1],
    parent[0] * child[2] + parent[2] * child[3],
    parent[1] * child[2] + parent[3] * child[3],
    parent[0] * child[4] + parent[2] * child[5] + parent[4],
    parent[1] * child[4] + parent[3] * child[5] + parent[5],
  ];
}

export function invert(m: Mat2D): Mat2D {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return [...IDENTITY];
  const id = 1 / det;
  return [
    m[3] * id,
    -m[1] * id,
    -m[2] * id,
    m[0] * id,
    (m[2] * m[5] - m[3] * m[4]) * id,
    (m[1] * m[4] - m[0] * m[5]) * id,
  ];
}

export function apply(m: Mat2D, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Shortest-path angle interpolation (used for bone rotation timelines). */
export function lerpAngle(a: number, b: number, t: number): number {
  let delta = (b - a) % 360;
  if (delta > 180) delta -= 360;
  else if (delta < -180) delta += 360;
  return a + delta * t;
}

/** Decomposed 2D transform, mirroring the runtime's \`Transform\` fields. */
export interface Mat2DTransform {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  skew: number;
}

/** Parent-inheritance flags from \`BoneData\` (all default to true). */
export interface InheritFlags {
  inheritTranslation?: InheritFlag;
  inheritRotation?: InheritFlag;
  inheritScale?: InheritFlag;
  inheritReflection?: InheritFlag;
}

/**
 * `inherit*` switches are **absent = true**; the switch is off when the data says so,
 * and the official writer spells "off" several ways. See `parseBoolean` for the exact
 * table (corpus census 2026-10-11: `inheritScale` 1298x false + 227x `0`,
 * `inheritRotation` 100x false + 22x `0`, translation/reflection never set).
 * Treating only boolean `false` as "off" silently inherits for 249 bones in the corpus.
 */
export type InheritFlag = boolean | number | string | null | undefined;

/** `0`, `"false"`, `"0"`, `"NaN"`, `""`, `"null"`, `"undefined"` all mean "off". */
export const inheritOn = (value: InheritFlag): boolean => parseBoolean(value, true);

/**
 * Official `ObjectDataParser._getBoolean`: the authoring JSON routinely carries
 * booleans as **strings** (`"false"`, `"0"`), so `value !== false` is not enough —
 * the string `"false"` is truthy in JS and would silently flip the flag.
 */
export function parseBoolean(value: unknown, defaultValue: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    switch (value) {
      case '0': case 'NaN': case '': case 'false': case 'null': case 'undefined': return false;
      default: return true;
    }
  }
  if (value === undefined || value === null) return defaultValue;
  return Boolean(value);
}

/** \`Transform.normalizeRadian\` — wrap an angle into (-PI, PI]. */
export function normalizeRadian(value: number): number {
  let a = (value + Math.PI) % (Math.PI * 2);
  a += a > 0 ? -Math.PI : Math.PI;
  return a;
}

/**
 * \`Transform.fromMatrix\` for non-reflected rigs: the runtime restores a
 * positive scale sign, which is the plain positive-scale decomposition.
 */
export function decomposeMatrix(m: Mat2D): Mat2DTransform {
  const rotation = Math.atan2(m[1], m[0]);
  const skX = Math.atan2(-m[2], m[3]);
  return {
    x: m[4],
    y: m[5],
    rotation,
    scaleX: Math.hypot(m[0], m[1]),
    scaleY: Math.hypot(m[2], m[3]),
    skew: skX - rotation,
  };
}

/** \`Transform.toMatrix\` (same convention as \`matFromTransform\`). */
export function composeMatrix(t: Mat2DTransform): Mat2D {
  const cos = Math.cos(t.rotation);
  const sin = Math.sin(t.rotation);
  const kx = t.rotation + t.skew;
  return [
    cos * t.scaleX,
    sin * t.scaleX,
    -Math.sin(kx) * t.scaleY,
    Math.cos(kx) * t.scaleY,
    t.x,
    t.y,
  ];
}

/**
 * Official \`Bone._updateGlobalTransformMatrix\` with both armature flips off.
 * \`local\` is the bone's local matrix; \`flags\` are its inherit* switches
 * (documented in 格式规范).
 */
export function composeInherited(
  parent: Mat2D,
  local: Mat2D,
  flags: InheritFlags,
  parentRotation?: number,
  parentScaleX?: number,
): Mat2D {
  const inheritTranslation = inheritOn(flags.inheritTranslation);
  const inheritRotation = inheritOn(flags.inheritRotation);
  const inheritScale = inheritOn(flags.inheritScale);
  // Fast path: with every flag on this is plain matrix composition, which is
  // both exact and what the official runtime ends up with for default bones.
  if (inheritTranslation && inheritRotation && inheritScale) return multiply(parent, local);

  const t = decomposeMatrix(local);
  const parentT = decomposeMatrix(parent);
  // Official 5.7 `Bone._updateGlobalTransformMatrix` reads `parent.global.rotation` /
  // `parent.global.scaleX` — the parent's angle state. IK writes that state from the
  // parent's world matrix (`updateByConstraint` → `Transform.fromMatrix`), and for a
  // non-IK bone it is the plain `origin + offset + animationPose` sum; both agree with a
  // world decomposition up to a whole turn, which does not change the matrix. §23.37.
  const parentAngle = parentRotation ?? parentT.rotation;
  const parentScale = parentScaleX ?? parentT.scaleX;

  if (inheritScale) {
    // Cancelling the parent rotation before composing is what makes
    // `inheritRotation:false` work for a child of a rotated bone.
    if (!inheritRotation) t.rotation -= parentAngle;
    const world = multiply(parent, composeMatrix(t));
    if (!inheritTranslation) return [world[0], world[1], world[2], world[3], local[4], local[5]];
    return world;
  }

  // Vendor else-branch (inheritScale === false). yDown is true for this runtime, so the
  // vendor's `if (!yDown) skew = -skew` correction does not apply here.
  let x = local[4];
  let y = local[5];
  if (inheritTranslation) {
    x = parent[0] * local[4] + parent[2] * local[5] + parent[4];
    y = parent[1] * local[4] + parent[3] * local[5] + parent[5];
  }
  let rotation = t.rotation;
  let skew = t.skew;
  if (inheritRotation) {
    rotation = t.rotation + parentAngle + (parentScale < 0 ? Math.PI : 0);
    if (parent[0] * parent[3] - parent[1] * parent[2] < 0) {
      rotation -= t.rotation * 2;
      if (inheritOn(flags.inheritReflection)) skew += Math.PI;
    }
  }
  return composeMatrix({ x, y, rotation, scaleX: t.scaleX, scaleY: t.scaleY, skew });
}
