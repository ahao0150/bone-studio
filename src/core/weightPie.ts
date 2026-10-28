/**
 * 权重工具（R）把选中网格的顶点画成饼图。
 * 扇区颜色跟属性面板「权重骨骼列表」同一套顺序（绿 / 橙 / 红 / 蓝 / 紫 / 黄）。
 */
import type { DbArmatureData } from './types';
import { meshWeightBones } from './editing';
import { findMesh } from './meshEdit';

export const WEIGHT_HEX = ['#4ade80', '#fb923c', '#f87171', '#60a5fa', '#a78bfa', '#facc15'];
export const WEIGHT_COLORS = [0x4ade80, 0xfb923c, 0xf87171, 0x60a5fa, 0xa78bfa, 0xfacc15];

export interface WeightSlice {
  color: number;
  weight: number;
}

/** 每个顶点一组扇区，顺序与 `display.weights` 一致；没有权重的顶点是空数组。 */
export function vertexWeightPies(armature: DbArmatureData, slotName: string): WeightSlice[][] {
  const display = findMesh(armature, slotName);
  if (!display) return [];
  const colorByBone = new Map<number, number>();
  meshWeightBones(armature, slotName).forEach((name, index) => {
    const bone = armature.bone.findIndex((entry) => entry.name === name);
    if (bone >= 0) colorByBone.set(bone, WEIGHT_COLORS[index % WEIGHT_COLORS.length]);
  });
  const raw = display.weights ?? [];
  const vertexCount = Math.floor((display.vertices?.length ?? 0) / 2);
  const pies: WeightSlice[][] = [];
  let cursor = 0;
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const count = raw[cursor++] ?? 0;
    const slices: WeightSlice[] = [];
    for (let pair = 0; pair < count && cursor + 1 < raw.length; pair++) {
      const bone = raw[cursor];
      const weight = raw[cursor + 1];
      cursor += 2;
      if (weight > 1e-4) slices.push({ color: colorByBone.get(bone) ?? 0x9aa4b2, weight });
    }
    pies.push(slices);
  }
  return pies;
}

/** 某个顶点在每根绑定骨骼上的权重（0..1）。没分到的骨骼是 0。 */
export function vertexWeightByBone(armature: DbArmatureData, slotName: string, vertex: number): Record<string, number> {
  const shares: Record<string, number> = {};
  for (const name of meshWeightBones(armature, slotName)) shares[name] = 0;
  const display = findMesh(armature, slotName);
  if (!display || vertex < 0) return shares;
  const raw = display.weights ?? [];
  let cursor = 0;
  const vertexCount = Math.floor((display.vertices?.length ?? 0) / 2);
  for (let index = 0; index < vertexCount && cursor < raw.length; index++) {
    const count = raw[cursor++] ?? 0;
    for (let pair = 0; pair < count && cursor + 1 < raw.length; pair++) {
      const bone = raw[cursor];
      const weight = raw[cursor + 1];
      cursor += 2;
      if (index !== vertex) continue;
      const name = armature.bone[bone]?.name;
      if (name) shares[name] = (shares[name] ?? 0) + weight;
    }
  }
  return shares;
}
