/**
 * IK constraint solver — specification in 格式规范
 *
 * Evidence: the official runtime shipped with DragonBones, used purely as a
 * behavioural oracle (controlled replay). No runtime code is copied here.
 */
import type { DbIkConstraintData } from '../types';
import {
  composeMatrix, decomposeMatrix, normalizeRadian, parseBoolean, type Mat2D,
} from './math';

/** Bone view the solver mutates (structurally satisfied by `Skeleton.bones`). */
/** Rotate a matrix's linear part about the origin of its own coordinate frame. */
function rotateWorld(m: Mat2D, angle: number): Mat2D {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const [a, b, c, d] = [m[0], m[1], m[2], m[3]];
  return [cos * a - sin * b, sin * a + cos * b, cos * c - sin * d, sin * c + cos * d, m[4], m[5]];
}

export interface IkBone {
  name: string;
  parent: number;
  length: number;
  local: Mat2D;
  world: Mat2D;
  /**
   * Set when an IK solve wrote the world matrix directly (official `_computeA`/`_computeB`);
   * `resolveWorlds` honours this instead of recomposing the bone from `local`.
   */
  worldOverride?: Mat2D;
}

/**
 * Solve every IK constraint in data order (the official update order).
 * `bones` are mutated in place; `recompute` re-derives every world matrix from
 * the local transforms so the solved rotations reach all descendants.
 */
/** Per-frame values from an `IKConstraint(30)` timeline. */
export interface IkOverride {
  bendPositive?: boolean;
  weight?: number;
}

export function solveIk(
  bones: IkBone[],
  ik: readonly DbIkConstraintData[],
  indexByName: Map<string, number>,
  recompute: () => void,
  overrides?: Map<string, IkOverride>,
): void {
  for (const constraint of ik) {
    const boneIndex = indexByName.get(constraint.bone);
    const targetIndex = indexByName.get(constraint.target);
    if (boneIndex === undefined || targetIndex === undefined) continue;

    const parentIndex = bones[boneIndex].parent;
    // `chain` only distinguishes single-bone (<=0) from two-bone (>0) IK.
    const twoBone = (constraint.chain ?? 0) > 0 && parentIndex >= 0;
    const rootIndex = twoBone ? parentIndex : boneIndex;
    const override = overrides?.get(constraint.name);
    const weight = override?.weight ?? constraint.weight ?? 1;
    const bendPositive = parseBoolean(override?.bendPositive ?? constraint.bendPositive, true);

    const root = decomposeMatrix(bones[rootIndex].world);
    const target = decomposeMatrix(bones[targetIndex].world);

    if (!twoBone) {
      let aim = Math.atan2(target.y - root.y, target.x - root.x);
      if (root.scaleX < 0) aim += Math.PI;
      const world0 = bones[rootIndex].world;
      const delta = normalizeRadian(aim - Math.atan2(world0[1], world0[0])) * weight;
      // Official `IKConstraint._computeA`: it rotates the bone's **global** angle and then
      // runs `global.toMatrix(globalTransformMatrix)` — the solved angle lands straight in
      // the **world** matrix and the local transform is left alone. Rotating the local
      // linear part instead lands on a different world facing whenever the bone has
      // `inheritScale: false` (measured 120–144° off on Bicycle's arm chain — §23.30).
      const solved = rotateWorld(world0, delta);
      bones[rootIndex].world = solved;
      bones[rootIndex].worldOverride = solved;
      continue;
    }

    const bone = decomposeMatrix(bones[boneIndex].world);
    const world = bones[boneIndex].world;
    const boneLength = Math.abs(bones[boneIndex].length) * Math.hypot(world[0], world[1]);
    const dx = bone.x - root.x;
    const dy = bone.y - root.y;
    const reach = Math.hypot(dx, dy);
    const toX = target.x - root.x;
    const toY = target.y - root.y;
    const distance = Math.hypot(toX, toY);
    const baseAngle = Math.atan2(dy, dx);
    const oldRootRotation = root.rotation;
    const oldBoneRotation = bone.rotation;

    let solvedAngle: number;
    if (boneLength + reach <= distance || distance + boneLength <= reach || distance + reach <= boneLength) {
      // Unreachable or collinear: the runtime simply aims the root at the target.
      solvedAngle = Math.atan2(toY, toX);
      if (!(boneLength + reach <= distance) && reach < boneLength) solvedAngle += Math.PI;
    } else {
      const along = (reach * reach - boneLength * boneLength + distance * distance) / (2 * distance * distance);
      const perp = Math.sqrt(Math.max(0, reach * reach - along * along * distance * distance)) / distance;
      const ax = root.x + toX * along;
      const ay = root.y + toY * along;
      const px = -toY * perp;
      const py = toX * perp;
      const rootParent = bones[rootIndex].parent;
      let flipped = false;
      if (rootParent >= 0) {
        const p = bones[rootParent].world;
        flipped = p[0] * p[3] - p[1] * p[2] < 0;
      }
      if (flipped !== bendPositive) {
        bone.x = ax - px;
        bone.y = ay - py;
      } else {
        bone.x = ax + px;
        bone.y = ay + py;
      }
      solvedAngle = Math.atan2(bone.y - root.y, bone.x - root.x);
    }

    const delta = normalizeRadian(solvedAngle - baseAngle);
    root.rotation = oldRootRotation + delta * weight;
    const rootWorld = composeMatrix(root);

    const swing = baseAngle + delta * weight;
    bone.x = root.x + Math.cos(swing) * reach;
    bone.y = root.y + Math.sin(swing) * reach;
    let aim = Math.atan2(target.y - bone.y, target.x - bone.x);
    if (bone.scaleX < 0) aim += Math.PI;
    bone.rotation = root.rotation + oldBoneRotation - oldRootRotation
      + normalizeRadian(aim - delta - oldBoneRotation) * weight;

    // Same contract as the single-bone path: the vendor writes the solved matrices into
    // the world slot (`global.toMatrix(globalTransformMatrix)`) instead of round-tripping
    // them through a parent-relative local matrix — that round trip is lossy for
    // `inheritScale: false` bones, whose local scale is absolute.
    bones[rootIndex].world = rootWorld;
    bones[rootIndex].worldOverride = rootWorld;
    const boneWorld = composeMatrix(bone);
    bones[boneIndex].world = boneWorld;
    bones[boneIndex].worldOverride = boneWorld;
    recompute();
  }
}
