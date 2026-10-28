/**
 * 素材库（P-08）的纯逻辑：切片搜索 + 引用统计。
 *
 * 官方 `MaterialPanel.*` 是在线素材市场（关注 / 下载 / 预览 / 安装，见 `格式规范` §61）；
 * 离线版本把它收敛成本地图集素材库：搜索切片、把 PNG 并进图集、刷新重新统计引用次数。
 * 这里只放可以直接单测的部分，UI 在 `src/ui/panels.tsx` 的 `LibraryTable`。
 */

/** 图集里的一片区域（只用到名字；其余字段原样保留） */
export interface NamedRegion { name: string }

/** 显示对象引用（`DbDisplayData` 的最小结构） */
export interface DisplayRef { path?: string; name?: string }

/** 槽位（`DbSlotData` 的最小结构） */
export interface SlotRef { display?: DisplayRef[] }

/** 按名字过滤切片；query 去空白 + 忽略大小写，空 query 返回原数组 */
export function filterRegions<T extends NamedRegion>(regions: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...regions];
  return regions.filter((region) => region.name.toLowerCase().includes(needle));
}

/**
 * 统计每个切片名被多少显示对象引用。
 * 引用名按官方运行时口径取 `display.path ?? display.name`（见 `src/core/runtime/skeleton.ts` 的 `renderItems`）。
 */
export function slotDisplayUsage(slots: readonly SlotRef[]): Map<string, number> {
  const usage = new Map<string, number>();
  for (const slot of slots) {
    for (const display of slot.display ?? []) {
      const name = display.path ?? display.name;
      if (!name) continue;
      usage.set(name, (usage.get(name) ?? 0) + 1);
    }
  }
  return usage;
}
