/**
 * 绑定姿态补偿：改骨骼绑定变换 / 删骨骼 / 换父级时，让子骨骼和槽位显示对象的**世界位置保持不变**。
 * Bind-pose compensation helpers shared by bone_update / bone_delete / slot_update (MCP) and tests.
 */
import type { DbArmatureData, DbTransform } from './types';
import { apply, decomposeMatrix, invert, matFromTransform, multiply, RAD2DEG, type Mat2D } from './runtime/math';
import { bindWorlds } from './editing';

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** 矩阵 → DragonBones 局部变换（skX = 旋转+斜切，skY = 旋转；默认值省略） */
export function transformFromMatrix(m: Mat2D, keep?: DbTransform): DbTransform {
  const d = decomposeMatrix(m);
  const out: DbTransform = { ...(keep ?? {}) };
  const set = (k: keyof DbTransform, v: number, def: number) => { const x = r3(v); if (Math.abs(x - def) < 1e-9) delete (out as Record<string, unknown>)[k]; else (out as Record<string, number>)[k] = x; };
  set('x', d.x, 0); set('y', d.y, 0);
  set('skX', (d.rotation + d.skew) * RAD2DEG, 0); set('skY', d.rotation * RAD2DEG, 0);
  set('scX', d.scaleX, 1); set('scY', d.scaleY, 1);
  return out;
}

/** 把挂在某槽位上的所有（非加权）显示对象，从世界矩阵 oldW 换算到 newW 下，世界位置不变。所有 skin 都处理。 */
export function rebaseSlotDisplays(arm: DbArmatureData, slotName: string, oldW: Mat2D, newW: Mat2D): number {
  const M = multiply(invert(newW), oldW);
  let n = 0;
  for (const skin of arm.skin ?? []) {
    for (const d of skin.slot?.find((x) => x.name === slotName)?.display ?? []) {
      if (d.weights?.length) continue; // 加权网格的顶点在绑定空间（bonePose），与父骨无关
      if (d.type === 'mesh' && d.vertices) {
        for (let k = 0; k + 1 < d.vertices.length; k += 2) { const [x, y] = apply(M, d.vertices[k], d.vertices[k + 1]); d.vertices[k] = r3(x); d.vertices[k + 1] = r3(y); }
      } else {
        const { x: _x, y: _y, skX: _a, skY: _b, scX: _c, scY: _d, ...rest } = (d.transform ?? {}) as Record<string, number>;
        d.transform = transformFromMatrix(multiply(M, matFromTransform(d.transform)), rest as DbTransform);
      }
      n++;
    }
  }
  return n;
}

export interface BindPatch { x?: number; y?: number; rotation?: number; skX?: number; skY?: number; scX?: number; scY?: number }

/**
 * 改骨骼绑定变换（相对父级）。rotation 同时设 skX/skY（无斜切）。
 * keepChildren=true：直接子骨骼与挂在它上的槽位显示对象做反向补偿，世界位置不变（只有这根骨骼自己动）。
 */
export function setBoneBind(arm: DbArmatureData, name: string, patch: BindPatch, keepChildren = false): DbTransform {
  const bone = arm.bone.find((b) => b.name === name);
  if (!bone) throw new Error(`unknown bone: ${name}`);
  for (const [k, v] of Object.entries(patch)) if (v !== undefined && !Number.isFinite(v)) throw new Error(`bad ${k}: ${v}`);
  const before = bindWorlds(arm.bone);
  const t: DbTransform = { ...(bone.transform ?? {}) };
  if (patch.rotation !== undefined) { const skew = (t.skX ?? 0) - (t.skY ?? 0); t.skY = patch.rotation; t.skX = patch.rotation + skew; }
  for (const k of ['x', 'y', 'skX', 'skY', 'scX', 'scY'] as const) if (patch[k] !== undefined) t[k] = patch[k];
  bone.transform = t;
  if (keepChildren) {
    const after = bindWorlds(arm.bone);
    const newW = after.get(name)!;
    for (const child of arm.bone) if (child.parent === name) {
      child.transform = transformFromMatrix(multiply(invert(newW), before.get(child.name)!), keepInherit(child.transform));
    }
    for (const slot of arm.slot ?? []) if (slot.parent === name) rebaseSlotDisplays(arm, slot.name, before.get(name)!, newW);
    // 加权网格：把这根骨骼在 bonePose 里的绑定矩阵改成新的世界矩阵 → 绑定姿态下顶点不动
    const bi = arm.bone.findIndex((b) => b.name === name);
    for (const skin of arm.skin ?? []) for (const ss of skin.slot ?? []) for (const d of ss.display ?? []) {
      const bp = d.bonePose;
      if (!d.weights?.length || !bp) continue;
      for (let i = 0; i + 6 < bp.length; i += 7) if (bp[i] === bi) for (let k = 0; k < 6; k++) bp[i + 1 + k] = +newW[k].toFixed(6);
    }
  }
  return bone.transform;
}

/** 删除骨骼前调用：把它的直接子骨骼与槽位改挂到 newParent（'' = 根），世界位置不变 */
export function reparentKeepingWorld(arm: DbArmatureData, name: string, newParent: string, slotParent: string): void {
  const W = bindWorlds(arm.bone);
  const I: Mat2D = [1, 0, 0, 1, 0, 0];
  const pW = newParent ? W.get(newParent) ?? I : I;
  for (const child of arm.bone) if (child.parent === name) {
    child.transform = transformFromMatrix(multiply(invert(pW), W.get(child.name)!), keepInherit(child.transform));
    child.parent = newParent || undefined;
  }
  const sW = slotParent ? W.get(slotParent) ?? I : I;
  for (const slot of arm.slot ?? []) if (slot.parent === name) { rebaseSlotDisplays(arm, slot.name, W.get(name)!, sW); slot.parent = slotParent; }
}

function keepInherit(t: DbTransform | undefined): DbTransform {
  const { x: _x, y: _y, skX: _a, skY: _b, scX: _c, scY: _d, ...rest } = (t ?? {}) as Record<string, number>;
  return rest as DbTransform;
}
