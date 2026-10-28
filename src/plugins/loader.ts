/**
 * 插件加载器 —— 新架构的执行侧。
 *
 * 契约：插件模块导出 `activate(api)`（或 `default` 函数）。`api` 只做两件事 ——
 * 注册能力（进入 `src/ai/pluginApi.ts` 的注册表）与写日志；插件**不能**直接改数据，
 * 它只能产出 `EditorCommand[]`，由编辑器审阅后应用（可撤销）。
 *
 * 运行时才知道 URL，所以动态 `import()` 必须带 `@vite-ignore`，否则打包器会在构建期
 * 尝试解析一个还不存在的路径。
 */
import type { AiCapability } from '../ai/pluginApi';
import { registerAiCapability, unregisterAiCapability } from '../ai/pluginApi';
import type { PluginManifest } from './registry';

/** 传给插件模块的 API 面（故意很小：能力注册 + 日志）。 */
export interface PluginApi {
  readonly apiVersion: 1;
  readonly pluginId: string;
  registerCapability(capability: AiCapability): void;
  log(message: string): void;
}

export interface PluginActivation {
  capabilityIds: string[];
  /** 单文件插件（`source`）产生的 blob: URL，卸载时要 revoke */
  blobUrl?: string;
}

type PluginModule = { activate?: unknown; default?: unknown };

/** 单文件插件源码 → blob: 模块 URL。 */
export function sourceUrl(source: string): string {
  return URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
}

/**
 * 加载并激活一个插件。
 *
 * 失败时抛错（调用方展示原因）；`registerCapability` 里对空 id 直接拒绝，
 * 免得一个坏插件把注册表写脏。
 */
export async function activatePlugin(
  manifest: PluginManifest,
  log: (message: string) => void,
): Promise<PluginActivation> {
  let blobUrl: string | undefined;
  const url = manifest.entry ?? (blobUrl = sourceUrl(manifest.source ?? ''));
  const module = (await import(/* @vite-ignore */ url)) as PluginModule;
  const activate = typeof module.activate === 'function'
    ? module.activate as (api: PluginApi) => unknown
    : typeof module.default === 'function'
      ? module.default as (api: PluginApi) => unknown
      : null;
  if (!activate) throw new Error('插件模块必须导出 activate(api) 或 default 函数');

  const capabilityIds: string[] = [];
  const api: PluginApi = {
    apiVersion: 1,
    pluginId: manifest.id,
    registerCapability(capability) {
      const id = capability && typeof capability.id === 'string' ? capability.id.trim() : '';
      if (!id) throw new Error('registerCapability 需要带 id 的能力');
      registerAiCapability({ ...capability, id });
      if (!capabilityIds.includes(id)) capabilityIds.push(id);
    },
    log,
  };
  await activate(api);
  if (capabilityIds.length === 0) throw new Error('插件没有注册任何能力（activate 里要调用 api.registerCapability）');
  return { capabilityIds, blobUrl };
}

/** 卸载：把插件注册过的能力摘掉，并回收 blob URL。 */
export function deactivatePlugin(activation: PluginActivation | undefined): void {
  if (!activation) return;
  for (const id of activation.capabilityIds) unregisterAiCapability(id);
  if (activation.blobUrl) URL.revokeObjectURL(activation.blobUrl);
}