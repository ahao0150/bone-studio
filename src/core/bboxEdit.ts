/**
 * 边界框（官方 `BoundingBox` / `BoundingBoxPanel` / `ScenePanel.newBBoxBtn`）。
 *
 * 格式验证：
 * - 面板 `BoundingBoxPanel.title` = 「编辑边界框」，三个操作 `btn.create`「添加点」/ `btn.delete`「删除点」/
 *   `btn.new`「重新画」，另有 `BoundingBoxPanel.vertices` = 「顶点数：{0}」（`_11254/_11255.as` 是面板 UI，
 *   `_580.as` 在选中变化时刷新顶点数）。
 * - 场景树侧 `ScenePanel.newBBoxBtn.tooltip` = 「创建边界框」。
 * - 数据是 `type: 'boundingBox'` 的显示对象 + 平铺 `vertices`（slot 局部坐标，与网格 `vertices` 同空间）。
 *
 * **与 AABB 的区别**：`armature.aabb` 是导出用的矩形包围盒；这里是**可编辑的多边形**，两者不是一回事
 * （验收条目早先的描述有偏差，第 89 轮已更正）。
 */
import type { DbArmatureData, DbDisplayData } from './types';
import type { Player } from './player';
import { uniqueSlotName } from './slotEdit';

/** 取某个槽位上的边界框显示对象（JSON 里 `type: 'boundingBox'`，二进制里 `3`）。 */
export function boundingBoxOf(
  armature: DbArmatureData,
  slotName: string,
  displayIndex = 0,
): DbDisplayData | null {
  const display = armature.skin?.[0]?.slot.find((entry) => entry.name === slotName)?.display?.[displayIndex];
  if (!display) return null;
  return display.type === 'boundingBox' || display.type === 3 ? display : null;
}

/** 顶点（平铺 x,y）→ 点对，方便面板与前端的舞台叠加层。 */
export function boundingBoxPoints(display: DbDisplayData | null): Array<[number, number]> {
  const v = display?.vertices ?? [];
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < v.length; i += 2) out.push([v[i], v[i + 1]]);
  return out;
}

/** 创建边界框插槽（官方 `ScenePanel.newBBoxBtn`「创建边界框」）：挂在指定骨骼下，初始没有点。 */
export function addBoundingBoxSlot(player: Player | null, bone: string, wanted = 'bbox'): string | null {
  if (!player) return null;
  const armature = player.skeleton.armature;
  if (!armature.bone.some((entry) => entry.name === bone)) return null;
  const skin = armature.skin?.[0];
  if (!skin) return null;
  const name = uniqueSlotName(armature, wanted);
  armature.slot.push({ name, parent: bone });
  skin.slot.push({ name, display: [{ name, type: 'boundingBox', vertices: [] }] });
  player.rebuildSkeleton();
  return name;
}

/** 「重新画」：整块替换多边形（空数组 = 清空）。 */
export function writeBoundingBox(
  armature: DbArmatureData,
  slotName: string,
  points: number[],
  displayIndex = 0,
): boolean {
  const display = boundingBoxOf(armature, slotName, displayIndex);
  if (!display) return false;
  display.vertices = [...points];
  return true;
}

/** 「添加点」：在 a→b 这条边的中点插一个点（点对顺序保持不变）。 */
export function addBoundingBoxPointOnEdge(
  armature: DbArmatureData,
  slotName: string,
  a: number,
  b: number,
  displayIndex = 0,
): boolean {
  const display = boundingBoxOf(armature, slotName, displayIndex);
  if (!display) return false;
  const v = display.vertices ?? [];
  const count = Math.floor(v.length / 2);
  if (a < 0 || b < 0 || a >= count || b >= count || a === b) return false;
  const next = [...v];
  const mx = (v[a * 2] + v[b * 2]) / 2;
  const my = (v[a * 2 + 1] + v[b * 2 + 1]) / 2;
  next.splice(b * 2, 0, mx, my);
  display.vertices = next;
  return true;
}

/** 「删除点」：至少保留 3 个点，否则多边形不再是形状。 */
export function removeBoundingBoxPoint(
  armature: DbArmatureData,
  slotName: string,
  index: number,
  displayIndex = 0,
): boolean {
  const display = boundingBoxOf(armature, slotName, displayIndex);
  if (!display) return false;
  const v = display.vertices ?? [];
  const count = Math.floor(v.length / 2);
  if (index < 0 || index >= count || count <= 3) return false;
  const next = [...v];
  next.splice(index * 2, 2);
  display.vertices = next;
  return true;
}