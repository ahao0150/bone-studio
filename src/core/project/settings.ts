/**
 * 偏好设置（官方 `Menu.File.Setting` / `Setting.*`）。
 *
 * 条目与说明都取自官方界面文案（`界面文案表`）：
 *   Setting.ImageSmooth      图片平滑显示（线性过滤 vs 最近邻）
 *   Setting.BOColor          骨骼颜色
 *   Setting.BGSize           背景网格尺寸
 *   Setting.DeleteConfirmation 删除确认提示
 *   Setting.Reset            重置所有偏好设置
 *
 * 存储放在 localStorage —— 这是**编辑器偏好**，不进骨架/工程数据。
 */
export interface StudioSettings {
  /** 图片平滑显示：true = 线性过滤（可能发糊），false = 最近邻（锐利） */
  imageSmooth: boolean;
  /** 骨骼线框颜色（十六进制，如 `#6cc7ff`） */
  boneColor: string;
  /** 舞台背景棋盘的格子尺寸（px） */
  backgroundGridSize: number;
  /** 删除骨骼/插槽前是否弹确认 */
  deleteConfirmation: boolean;
}

export const SETTINGS_KEY = 'bonestudio.settings';

export const DEFAULT_SETTINGS: StudioSettings = {
  imageSmooth: true,
  // 与 StageRenderer.drawBoneOverlay 一直用的颜色保持一致
  boneColor: '#6cc7ff',
  backgroundGridSize: 100,
  deleteConfirmation: true,
};

/** 读取设置；解析失败或字段非法时回落到默认值（逐字段校验，不整份丢弃）。 */
export function readSettings(storage: Pick<globalThis.Storage, 'getItem'> | null | undefined): StudioSettings {
  const raw = storage?.getItem(SETTINGS_KEY);
  if (!raw) return { ...DEFAULT_SETTINGS };
  let parsed: Partial<StudioSettings>;
  try {
    parsed = JSON.parse(raw) as Partial<StudioSettings>;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  const out = { ...DEFAULT_SETTINGS };
  if (typeof parsed.imageSmooth === 'boolean') out.imageSmooth = parsed.imageSmooth;
  if (typeof parsed.boneColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(parsed.boneColor)) out.boneColor = parsed.boneColor;
  if (typeof parsed.backgroundGridSize === 'number' && parsed.backgroundGridSize >= 8 && parsed.backgroundGridSize <= 400) {
    out.backgroundGridSize = Math.round(parsed.backgroundGridSize);
  }
  if (typeof parsed.deleteConfirmation === 'boolean') out.deleteConfirmation = parsed.deleteConfirmation;
  return out;
}

export function writeSettings(storage: Pick<globalThis.Storage, 'setItem'> | null | undefined, settings: StudioSettings): void {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // 存储被禁用时静默忽略：偏好设置丢了不影响编辑数据
  }
}

/** `#rrggbb` → Pixi 用的 0xRRGGBB。 */
export function colorToNumber(color: string): number {
  return Number.parseInt(color.replace('#', ''), 16) || 0;
}

/**
 * 舞台辅助线（官方 `MenuItem-ruler` 辅助标尺 / `MenuItem-clearRulerLines` 清除所有辅助线）。
 *
 * 位置存**世界坐标**（与当前缩放/平移无关），所以缩放舞台时线仍贴在同一个世界位置。
 * 与偏好设置一样属于编辑器状态，存在 localStorage，不进骨架/工程数据。
 */
export interface GuideLine {
  /** `x` = 竖直辅助线（记 x 坐标）；`y` = 水平辅助线（记 y 坐标） */
  axis: 'x' | 'y';
  /** 世界坐标 */
  value: number;
}

export const GUIDES_KEY = 'bonestudio.guides';

/** 读取辅助线；过滤掉轴不合法或数值非有限的项。 */
export function readGuides(storage: Pick<globalThis.Storage, 'getItem'> | null | undefined): GuideLine[] {
  const raw = storage?.getItem(GUIDES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is GuideLine => {
        if (!entry || typeof entry !== 'object') return false;
        const guide = entry as Partial<GuideLine>;
        return (guide.axis === 'x' || guide.axis === 'y')
          && typeof guide.value === 'number' && Number.isFinite(guide.value);
      })
      .map((guide) => ({ axis: guide.axis, value: Math.round(guide.value * 100) / 100 }));
  } catch {
    return [];
  }
}

export function writeGuides(
  storage: Pick<globalThis.Storage, 'setItem'> | null | undefined, guides: readonly GuideLine[],
): void {
  try {
    storage?.setItem(GUIDES_KEY, JSON.stringify(guides));
  } catch {
    // 存储不可用时静默忽略
  }
}

/**
 * 「最近打开」列表（官方欢迎页 `Welcome.project` 一带的入口）。
 *
 * 浏览器里**无法按路径重新打开本地文件**（没有持久化的文件权限），所以：
 *   - 样例（`kind: 'sample'`）记名字，点击可以直接重新载入；
 *   - 本地文件（`kind: 'file'`）只记文件名，点击时提示重新选择 —— 诚实反映平台限制；
 *   - 工作区工程（`kind: 'workspace'`）记 `projects/<name>` 的工程名，点击按最新版本重新载入。
 */
export interface RecentEntry {
  kind: 'sample' | 'file' | 'workspace';
  name: string;
  /** 最近一次打开的时间戳 */
  at: number;
}

export const RECENTS_KEY = 'bonestudio.recents';
export const RECENTS_MAX = 8;

/** 读取最近列表：坏数据回落空数组，非法项逐条过滤。 */
export function readRecents(storage: Pick<globalThis.Storage, 'getItem'> | null | undefined): RecentEntry[] {
  const raw = storage?.getItem(RECENTS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is RecentEntry => {
        if (!entry || typeof entry !== 'object') return false;
        const item = entry as Partial<RecentEntry>;
        return (item.kind === 'sample' || item.kind === 'file' || item.kind === 'workspace')
          && typeof item.name === 'string' && item.name.length > 0;
      })
      .map((entry) => ({ kind: entry.kind, name: entry.name, at: typeof entry.at === 'number' ? entry.at : 0 }))
      .sort((a, b) => b.at - a.at)
      .slice(0, RECENTS_MAX);
  } catch {
    return [];
  }
}

/** 把一项推到最前（同 kind + name 去重），只保留 RECENTS_MAX 条，并写回存储。 */
export function pushRecent(
  storage: Pick<globalThis.Storage, 'getItem' | 'setItem'> | null | undefined,
  entry: { kind: RecentEntry['kind']; name: string },
  now = Date.now(),
): RecentEntry[] {
  const next = [
    { kind: entry.kind, name: entry.name, at: now },
    ...readRecents(storage).filter((item) => !(item.kind === entry.kind && item.name === entry.name)),
  ].slice(0, RECENTS_MAX);
  try {
    storage?.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // 存储不可用时静默忽略
  }
  return next;
}

export function clearRecents(storage: Pick<globalThis.Storage, 'setItem'> | null | undefined): void {
  try {
    storage?.setItem(RECENTS_KEY, '[]');
  } catch {
    // 同上
  }
}
