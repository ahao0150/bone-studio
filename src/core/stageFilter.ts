/**
 * 舞台过滤器条（官方 `StageFilterBar`，文案在 `界面文案表` 第 854-862 行）。
 *
 * 格式验证：
 *   - 表头三列 `StageFilterBar.visible_tip`（可见控制）/ `selectable_tip`（选择控制）/ `inherite_tip`（继承控制）；
 *     两行是骨骼（`/assets/stageIcon/bone.png`）与图片（`image.png`），各带 3 个开关 → 一共 **6 个**（`_953/StageFilterBar.as` 第 116-195 行）。
 *   - 可见 / 可选 4 个开关点击后走 `_469._3470(target, type, value)` →
 *     `CommandNotification.CHANGE_GLOBAL_STAGE_FILTER`；`_397/_398.as` 把它们写进 `_759`
 *     （`visibleFilter.bone|image`、`selectableFilter.bone|image`）—— 默认值见 `_346/_357.as` 第 138-153 行，四个都是 1。
 *   - 继承 2 个开关走 `_469._3471(target, value)` → `CHANGE_INHERITED_EDITABLE`；`_388/_393.as` 写入全局
 *     `_1844._2969`（骨骼）/ `_2968`（图片）。`_226/_14062.as` 第 64-145 行是消费者：值为真时编辑父级**连带子级**，
 *     为假时把子级反算回来（子级保持自身世界变换）。
 */
export interface StageFilter {
  boneVisible: boolean;
  imageVisible: boolean;
  boneSelectable: boolean;
  imageSelectable: boolean;
  /** 官方 `_1844._2969`「子骨骼可控」：编辑父级时子骨骼是否跟随 */
  boneInherit: boolean;
  /** 官方 `_1844._2968`「子图片可控」 */
  imageInherit: boolean;
}

export const STAGE_FILTER_KEY = 'bonestudio.stageFilter';

/** 官方默认：可见 / 可选的 bone、image 都是 1；继承（子级可控）默认也是开。 */
export const DEFAULT_STAGE_FILTER: StageFilter = {
  boneVisible: true,
  imageVisible: true,
  boneSelectable: true,
  imageSelectable: true,
  boneInherit: true,
  imageInherit: true,
};

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'> | null | undefined;

const KEYS: Array<keyof StageFilter> = [
  'boneVisible', 'imageVisible', 'boneSelectable', 'imageSelectable', 'boneInherit', 'imageInherit',
];

/** 只收编已知布尔键，坏数据回落默认值（隐私模式 / 脏数据都不抛）。 */
export function readStageFilter(storage: Storage): StageFilter {
  const out = { ...DEFAULT_STAGE_FILTER };
  try {
    const raw = storage?.getItem(STAGE_FILTER_KEY);
    if (!raw) return out;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const key of KEYS) {
      if (typeof parsed?.[key] === 'boolean') out[key] = parsed[key] as boolean;
    }
  } catch {
    return { ...DEFAULT_STAGE_FILTER };
  }
  return out;
}

export function writeStageFilter(storage: Storage, filter: StageFilter): void {
  try {
    storage?.setItem(STAGE_FILTER_KEY, JSON.stringify(filter));
  } catch {
    // 存储不可用（隐私模式 / 配额）时静默忽略
  }
}

/** 翻转一个开关；返回新的过滤器（纯函数，便于单测）。 */
export function toggleStageFilter(filter: StageFilter, key: keyof StageFilter): StageFilter {
  return { ...filter, [key]: !filter[key] };
}