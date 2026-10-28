/**
 * 元件（armature）级别的编辑：新建元件 / 把外部数据并入项目。
 *
 * 官方入口：`NewSymbolWindow.*`（「新建元件」，类型有 主舞台 / 骨架 / 影片剪辑 / 序列帧）与
 * `Menu.File.Import`「导入数据到项目...」（`界面文案表` 第 89、1135-1145 行）。
 *
 * `Player` 早就支持多 armature（`armatureNames()` / `setArmature()`），这里只补数据侧：
 * 往 `doc.armatures` 里加元件、以及把外部文件的 armature 并进来（重名自动加后缀）。
 * `SkeletonDoc.armatures` 与 `raw.armature` 是同一个数组，所以 push 之后导出的 JSON 自然包含新元件。
 */
import type { DbArmatureData, DbSkeletonData } from './types';
import type { SkeletonDoc } from './parse/ske';
import { emptySkeleton, emptySheetSkeleton } from './project/newProject';

/** 新建元件时可用的类型。官方还有「主舞台 / 影片剪辑」，那两个依赖 舞台工程，不在本仓库范围。 */
export type SymbolKind = 'armature' | 'sheet';

/** 元件名不能和已有 armature 重名。 */
export function uniqueArmatureName(doc: SkeletonDoc, wanted: string): string {
  const base = (wanted || 'symbol').trim() || 'symbol';
  const used = new Set(doc.armatures.map((armature) => armature.name));
  if (!used.has(base)) return base;
  for (let i = 1; i < 1000; i++) {
    const candidate = `${base}_${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}_${Date.now()}`;
}

/** 按类型取空元件模板（骨架 / 序列帧，两种模板都已有单测对拍）。 */
function templateArmature(kind: SymbolKind, name: string): DbArmatureData {
  const skeleton = kind === 'sheet' ? emptySheetSkeleton({ name }) : emptySkeleton({ name });
  return (skeleton.armature as DbArmatureData[])[0];
}

/** 新建一个元件（官方 `NewSymbolWindow`）。返回新元件的名字。 */
export function addArmature(doc: SkeletonDoc, kind: SymbolKind, wanted: string): string {
  const name = uniqueArmatureName(doc, wanted);
  doc.armatures.push(templateArmature(kind, name));
  return name;
}

/**
 * 删除一个元件（官方 `LibraryPanelController.deleteArmatureVO`，
 * `_555/LibraryPanelController.as:1321-1339`：`DELETE_ARMATURE` 命令前会检查
 * `dragonBonesVO._2126.length > 1` —— **工程至少要留一个元件**）。
 * 返回是否真的删了。
 */
export function removeArmature(doc: SkeletonDoc, name: string): boolean {
  if (doc.armatures.length <= 1) return false;
  const index = doc.armatures.findIndex((armature) => armature.name === name);
  if (index < 0) return false;
  doc.armatures.splice(index, 1);
  return true;
}

/** 把外部骨架的 armature 全部并入当前工程（重名加后缀）。返回实际加入的名字。 */
export function mergeArmatures(doc: SkeletonDoc, incoming: DbArmatureData[] | undefined | null): string[] {
  const added: string[] = [];
  for (const armature of incoming ?? []) {
    const name = uniqueArmatureName(doc, armature.name ?? 'symbol');
    doc.armatures.push({ ...armature, name });   // 浅拷贝：只改名字，子数组沿用外部数据
    added.push(name);
  }
  return added;
}

/** 从另一个骨架文件（已解析）里取 armature 并并入。 */
export function mergeSkeletonDoc(doc: SkeletonDoc, incoming: DbSkeletonData | null | undefined): string[] {
  return mergeArmatures(doc, incoming?.armature);
}