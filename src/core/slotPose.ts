/**
 * 骨架装配模式下，选中插槽后 Z/X/C/V 改的是当前显示对象的 `display.transform`
 * （相对挂点骨骼的平移 / 旋转 / 缩放）。图片和网格都走这条；网格顶点编辑仍是另一套工具。
 */
import type { Player } from './player';
import type { BoneTransformValues } from './editing';
import type { DbDisplayData, DbTransform } from './types';
import { IDENTITY, apply, invert, matFromTransform, type Mat2D } from './runtime/math';
import { slotDisplayWorld, displayPivotOffset } from './runtime/skeleton';

const round = (value: number) => Math.round(value * 1000) / 1000;

export function currentSlotDisplay(player: Player, slotName: string): DbDisplayData | null {
  const slot = player.skeleton.slots.find((entry) => entry.name === slotName);
  if (!slot || slot.displayIndex < 0) return null;
  return player.skeleton.skinSlots.get(slotName)?.display?.[slot.displayIndex] ?? null;
}

function isMeshDisplay(display: DbDisplayData): boolean {
  return (display.type === 'mesh' || display.type === 2) && (display.vertices?.length ?? 0) > 0;
}

/** 图片，以及网格。边界框的顶点是形状本身，不在这里改。 */
export function slotPoseEditable(player: Player | null, slotName: string | null): boolean {
  if (!player || !slotName) return false;
  const display = currentSlotDisplay(player, slotName);
  if (!display) return false;
  if ((display.vertices?.length ?? 0) === 0) return true;
  return isMeshDisplay(display);
}

export function readSlotDisplayTransform(player: Player | null, slotName: string | null): BoneTransformValues | null {
  if (!player || !slotName) return null;
  const display = currentSlotDisplay(player, slotName);
  if (!display) return null;
  const transform = display.transform ?? {};
  return {
    x: transform.x ?? 0,
    y: transform.y ?? 0,
    skX: transform.skX ?? 0,
    skY: transform.skY ?? 0,
    scX: transform.scX ?? 1,
    scY: transform.scY ?? 1,
  };
}

export function setSlotDisplayTransform(player: Player, slotName: string, patch: Partial<BoneTransformValues>): boolean {
  const display = currentSlotDisplay(player, slotName);
  const prev = readSlotDisplayTransform(player, slotName);
  if (!display || !prev || !slotPoseEditable(player, slotName)) return false;
  const next: DbTransform = { ...(display.transform ?? {}) };
  let changed = false;
  (['x', 'y', 'skX', 'skY', 'scX', 'scY'] as const).forEach((key) => {
    if (patch[key] === undefined) return;
    const value = round(patch[key] as number);
    if (prev[key] === value) return;
    next[key] = value;
    changed = true;
  });
  if (!changed) return false;
  display.transform = next;
  player.skeleton.setDisplayOverride(slotName, null);
  return true;
}

export function slotParentWorld(player: Player, slotName: string): Mat2D {
  const slot = player.skeleton.slots.find((entry) => entry.name === slotName);
  if (!slot || slot.parentBone < 0) return IDENTITY;
  return player.skeleton.bones[slot.parentBone].world;
}

function applyLinear(matrix: Mat2D, x: number, y: number): [number, number] {
  return [matrix[0] * x + matrix[2] * y, matrix[1] * x + matrix[3] * y];
}

/**
 * 可见中心，在显示变换之前的局部。
 * 图片与图集四角同一套（宽高、轴心、frame 偏移、区域宽高）；没有区域时退回原点。
 * 网格是父骨骼局部里、套显示变换之前的包围盒中心。
 */
export function slotCenterLocal(player: Player, slotName: string): { x: number; y: number } | null {
  const display = currentSlotDisplay(player, slotName);
  if (!display) return null;
  if (isMeshDisplay(display)) return player.skeleton.meshParentLocalCenter(slotName);
  const regionName = display.path ?? display.name;
  const region = regionName ? player.atlas?.byName.get(regionName) : undefined;
  if (!region) return { x: 0, y: 0 };
  // 与渲染同一来源（官方 `Slot._pivotX/_pivotY`，spec §103）
  const pivot = displayPivotOffset(display, region);
  return { x: -pivot.x + region.width / 2, y: -pivot.y + region.height / 2 };
}

/** 上面那个局部中心乘上当前显示矩阵和父骨骼，得到舞台上的世界坐标。 */
export function slotVisualCenter(player: Player, slotName: string): { x: number; y: number } | null {
  const local = slotCenterLocal(player, slotName);
  const world = slotDisplayWorld(player.skeleton, slotName);
  if (!local || !world) return null;
  const [x, y] = apply(world, local.x, local.y);
  return { x, y };
}

/** 旋转 / 缩放后把平移补回去，让局部中心在父空间的位置保持拖动开始时的值。中心在原点时原样返回。 */
function pinDisplayCenter(
  next: BoneTransformValues,
  start: BoneTransformValues,
  center: { x: number; y: number } | null | undefined,
): BoneTransformValues {
  if (!center || (Math.abs(center.x) < 1e-6 && Math.abs(center.y) < 1e-6)) return next;
  const startMat = matFromTransform(start);
  const ax = startMat[0] * center.x + startMat[2] * center.y + startMat[4];
  const ay = startMat[1] * center.x + startMat[3] * center.y + startMat[5];
  const linear = matFromTransform({ ...next, x: 0, y: 0 });
  return {
    ...next,
    x: ax - (linear[0] * center.x + linear[2] * center.y),
    y: ay - (linear[1] * center.x + linear[3] * center.y),
  };
}

/** 舞台拨杆的一帧增量。平移按坐标系换到父骨骼局部；旋转 / 缩放改显示对象自己的数，并让可见中心停在原处。 */
export function poseFromGizmo(input: {
  gizmo: 'move' | 'move-x' | 'move-y' | 'rotate' | 'scale' | 'scale-free' | 'scale-x' | 'scale-y';
  clientX: number;
  clientY: number;
  dx: number;
  dy: number;
  stageScale: number;
  originScreenX: number;
  originScreenY: number;
  startAngle: number;
  startDistance: number;
  startAxis: number;
  startAxisY: number;
  startValues: BoneTransformValues;
  current: BoneTransformValues;
  parent: Mat2D;
  selfWorld: Mat2D;
  space: 'world' | 'parent' | 'local';
  /** 显示对象局部的可见中心。旋转 / 缩放绕它进行；缺省或原点则不补偿平移。 */
  centerLocal?: { x: number; y: number } | null;
}): Partial<BoneTransformValues> | null {
  const { gizmo, startValues } = input;
  const pin = (next: BoneTransformValues) => pinDisplayCenter(next, startValues, input.centerLocal);
  if (gizmo === 'rotate') {
    const angle = Math.atan2(input.clientY - input.originScreenY, input.clientX - input.originScreenX);
    const delta = ((angle - input.startAngle) * 180) / Math.PI;
    return pin({ ...startValues, skX: startValues.skX + delta, skY: startValues.skY + delta });
  }
  if (gizmo === 'scale') {
    const distance = Math.hypot(input.clientX - input.originScreenX, input.clientY - input.originScreenY);
    const ratio = Math.max(0.05, distance / (input.startDistance || 1));
    return pin({ ...startValues, scX: startValues.scX * ratio, scY: startValues.scY * ratio });
  }
  if (gizmo === 'scale-free') {
    const rx = (input.clientX - input.originScreenX) / (input.startAxis || 1);
    const ry = (input.clientY - input.originScreenY) / (input.startAxisY || 1);
    const scX = startValues.scX * rx;
    const scY = startValues.scY * ry;
    if (!Number.isFinite(scX) || !Number.isFinite(scY) || Math.abs(scX) < 0.05 || Math.abs(scY) < 0.05) return null;
    return pin({ ...startValues, scX, scY });
  }
  if (gizmo === 'scale-x' || gizmo === 'scale-y') {
    const origin = gizmo === 'scale-x' ? input.originScreenX : input.originScreenY;
    const now = gizmo === 'scale-x' ? input.clientX : input.clientY;
    const ratio = (now - origin) / (input.startAxis || 1);
    const base = gizmo === 'scale-x' ? startValues.scX : startValues.scY;
    const value = base * ratio;
    if (!Number.isFinite(value) || Math.abs(value) < 0.05) return null;
    return pin(gizmo === 'scale-x' ? { ...startValues, scX: value } : { ...startValues, scY: value });
  }
  let worldDx = input.dx / (input.stageScale || 1);
  let worldDy = input.dy / (input.stageScale || 1);
  if (gizmo === 'move-x') worldDy = 0;
  if (gizmo === 'move-y') worldDx = 0;
  const parent = input.parent;
  let lx: number;
  let ly: number;
  if (input.space === 'parent') {
    const sx = Math.hypot(parent[0], parent[1]) || 1;
    const sy = Math.hypot(parent[2], parent[3]) || 1;
    lx = worldDx / sx;
    ly = worldDy / sy;
  } else if (input.space === 'local') {
    [lx, ly] = applyLinear(invert(input.selfWorld), worldDx, worldDy);
  } else {
    [lx, ly] = applyLinear(invert(parent), worldDx, worldDy);
  }
  return { x: input.current.x + lx, y: input.current.y + ly };
}
