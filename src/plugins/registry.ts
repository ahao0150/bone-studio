/**
 * 插件注册表 —— **新编辑器架构**。
 *
 * 这里**刻意不复刻**官方 DragonBones 的插件格式。那套是 Flex / HTML+JS 时代的产物
 * （格式规范 `格式规范`：清单是 `{name, path[]}`，
 * 用 `HTMLLoader` 把本地 HTML 页面塞进面板），语言与加载方式都已淘汰。
 *
 * 新架构只有三件事：
 *   1. **清单**只描述元数据（`id` / `name` / `version` / `author` / `description`）；
 *   2. **本体**是一个 ESM 模块（`entry` URL，或导入时保存的 `source` 单文件源码）；
 *   3. 模块导出 `activate(api)`，用 `api.registerCapability()` 注册能力 —— 能力只产出
 *      `EditorCommand[]`，由编辑器审阅后应用（与 AI / MCP 同一条管线，可撤销）。
 *
 * **安全边界（如实说明）**：插件与编辑器同源运行，**不是沙箱**，只应安装可信插件。
 */
export interface PluginManifest {
  /** 唯一标识（反向域名或 kebab-case）；安装 / 启停 / 卸载都按它索引 */
  id: string;
  /** 显示名 */
  name: string;
  version?: string;
  description?: string;
  author?: string;
  /** ESM 模块 URL（http(s) / 工程内路径） */
  entry?: string;
  /** 单文件插件源码（本地导入时保存，加载时转成 blob: 模块） */
  source?: string;
  /** 清单声明的能力 id（仅供界面展示；真实注册以 activate 时为准） */
  capabilities?: string[];
  /** 缺省 = 启用（安装时按 id 覆盖并保留原状态） */
  enabled?: boolean;
}

export const PLUGINS_KEY = 'bonestudio.plugins';
const MAX_PLUGINS = 64;

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'> | null | undefined;

/**
 * 校验一份清单：必需 `id` + `name`（非空），且 `entry` / `source` 至少有一个。
 * 其余字段按类型收编 —— 多余的键（包括官方 `.expl` 的 `path`）**直接忽略**，
 * 不做兼容层，避免把一个已经不存在的运行时契约带进新架构。
 */
export function parseManifest(raw: unknown): PluginManifest | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Partial<PluginManifest>;
  const text = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined);
  const id = text(item.id);
  const name = text(item.name);
  if (!id || !name) return null;
  const entry = text(item.entry);
  const source = typeof item.source === 'string' && item.source.trim() !== '' ? item.source : undefined;
  if (!entry && !source) return null;
  const capabilities = Array.isArray(item.capabilities)
    ? item.capabilities.filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    : undefined;
  return {
    id,
    name,
    version: text(item.version),
    description: text(item.description),
    author: text(item.author),
    entry,
    source,
    capabilities,
    // 未提供就是 undefined —— 让 installPlugin 决定是继承已有状态还是默认启用
    enabled: typeof item.enabled === 'boolean' ? item.enabled : undefined,
  };
}

/** 读取已安装插件；坏数据逐条丢弃后回落空数组。 */
export function readPlugins(storage: Storage): PluginManifest[] {
  const raw = storage?.getItem(PLUGINS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => parseManifest(entry))
      .filter((entry): entry is PluginManifest => entry !== null)
      .slice(0, MAX_PLUGINS);
  } catch {
    return [];
  }
}

export function writePlugins(storage: Storage, list: PluginManifest[]): void {
  try {
    storage?.setItem(PLUGINS_KEY, JSON.stringify(list.slice(0, MAX_PLUGINS)));
  } catch {
    // 存储不可用（隐私模式 / 配额）时静默忽略
  }
}

/** 安装（按 `id` 覆盖，保留原有启用状态）。 */
export function installPlugin(storage: Storage, manifest: PluginManifest): PluginManifest[] {
  const list = readPlugins(storage);
  const existing = list.find((entry) => entry.id === manifest.id);
  const next = [
    { ...manifest, enabled: manifest.enabled ?? existing?.enabled ?? true },
    ...list.filter((entry) => entry.id !== manifest.id),
  ].slice(0, MAX_PLUGINS);
  writePlugins(storage, next);
  return next;
}

export function setPluginEnabled(storage: Storage, id: string, enabled: boolean): PluginManifest[] {
  const next = readPlugins(storage).map((entry) => (entry.id === id ? { ...entry, enabled } : entry));
  writePlugins(storage, next);
  return next;
}

export function removePlugin(storage: Storage, id: string): PluginManifest[] {
  const next = readPlugins(storage).filter((entry) => entry.id !== id);
  writePlugins(storage, next);
  return next;
}

/** 这个插件在当前环境能不能跑：启用 + 有入口（`entry` URL 或 `source` 源码）。 */
export function pluginRunnable(manifest: PluginManifest): boolean {
  return manifest.enabled !== false && Boolean(manifest.entry || manifest.source);
}