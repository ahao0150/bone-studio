import { describe, expect, it } from 'vitest';
import {
  PLUGINS_KEY, installPlugin, parseManifest, pluginRunnable,
  readPlugins, removePlugin, setPluginEnabled, writePlugins,
} from '../src/plugins/registry';
import { activatePlugin, deactivatePlugin } from '../src/plugins/loader';
import { findAiCapability } from '../src/ai/pluginApi';

function memStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    dump: () => map,
  };
}

const sample = {
  id: 'example.lip-helper', name: '口型助手', entry: '/plugins/lip-helper.js',
  version: '1.2.0', author: 'someone', capabilities: ['example.lip'],
};

describe('插件清单校验（新架构：id + name + entry|source）', () => {
  it('accepts entry-based manifests and trims文本字段', () => {
    expect(parseManifest({ id: ' a.b ', name: ' x ', entry: ' /p.js ', author: ' a ', version: '', enabled: false }))
      .toEqual({
        id: 'a.b', name: 'x', entry: '/p.js', author: 'a', version: undefined,
        description: undefined, capabilities: undefined, enabled: false, source: undefined,
      });
  });

  it('accepts single-file source plugins', () => {
    const parsed = parseManifest({ id: 'p', name: 'p', source: 'export function activate() {}' });
    expect(parsed?.source).toContain('activate');
    expect(parsed?.entry).toBeUndefined();
  });

  it('rejects missing id / name / entry+source', () => {
    expect(parseManifest(null)).toBeNull();
    expect(parseManifest({ name: 'x', entry: '/a.js' })).toBeNull();
    expect(parseManifest({ id: 'x', entry: '/a.js' })).toBeNull();
    expect(parseManifest({ id: '  ', name: 'x', entry: '/a.js' })).toBeNull();
    expect(parseManifest({ id: 'x', name: 'x' })).toBeNull();
    expect(parseManifest({ id: 'x', name: 'x', source: '   ' })).toBeNull();
  });

  it('ignores the retired官方 path[] instead of emulating it', () => {
    const parsed = parseManifest({ id: 'x', name: 'x', path: ['legacy/page.html'], entry: '/a.js' });
    expect(parsed).not.toBeNull();
    expect('path' in (parsed as object)).toBe(false);
  });
});

describe('插件安装 / 启停 / 卸载（按 id）', () => {
  it('installs, replaces by id and keeps the enabled flag', () => {
    const storage = memStorage();
    installPlugin(storage, parseManifest(sample)!);
    expect(readPlugins(storage).map((entry) => entry.id)).toEqual(['example.lip-helper']);
    setPluginEnabled(storage, 'example.lip-helper', false);
    installPlugin(storage, parseManifest({ ...sample, version: '2.0.0' })!);
    const list = readPlugins(storage);
    expect(list.length).toBe(1);
    expect(list[0].version).toBe('2.0.0');
    expect(list[0].enabled).toBe(false);           // 覆盖时保留原有启用状态
    removePlugin(storage, 'example.lip-helper');
    expect(readPlugins(storage)).toEqual([]);
  });

  it('drops bad entries and survives a broken store', () => {
    const storage = memStorage();
    storage.setItem(PLUGINS_KEY, JSON.stringify([sample, { name: 'broken' }, null, 42]));
    expect(readPlugins(storage).map((entry) => entry.id)).toEqual(['example.lip-helper']);
    storage.setItem(PLUGINS_KEY, '{not json');
    expect(readPlugins(storage)).toEqual([]);
    expect(readPlugins(null)).toEqual([]);
    writePlugins(null, [sample as never]);         // 不应抛错
  });
});

describe('插件可运行性', () => {
  it('needs enabled + an entry point', () => {
    expect(pluginRunnable({ id: 'p', name: 'p', entry: '/a.js' })).toBe(true);
    expect(pluginRunnable({ id: 'p', name: 'p', source: 'export const x = 1;' })).toBe(true);
    expect(pluginRunnable({ id: 'p', name: 'p', entry: '/a.js', enabled: false })).toBe(false);
    expect(pluginRunnable({ id: 'p', name: 'p' })).toBe(false);
  });
});

describe('插件加载器（ESM 模块 → activate(api)）', () => {
  const moduleUrl = (code: string) => `data:text/javascript,${encodeURIComponent(code)}`;

  it('activates a module and registers its capability', async () => {
    const logs: string[] = [];
    const activation = await activatePlugin(
      { id: 't.one', name: 't', entry: moduleUrl(`
        export function activate(api) {
          api.log('hi ' + api.pluginId);
          api.registerCapability({ id: 't.one.cap', title: 't', description: '', async plan() { return []; } });
        }
      `) },
      (message) => logs.push(message),
    );
    expect(activation.capabilityIds).toEqual(['t.one.cap']);
    expect(logs).toEqual(['hi t.one']);
    expect(findAiCapability('t.one.cap')?.title).toBe('t');
    deactivatePlugin(activation);
    expect(findAiCapability('t.one.cap')).toBeUndefined();
  });

  it('supports a default export and rejects modules without activate', async () => {
    const activation = await activatePlugin(
      { id: 't.two', name: 't', entry: moduleUrl(`
        export default function (api) {
          api.registerCapability({ id: 't.two.cap', title: 't', description: '', async plan() { return []; } });
        }
      `) },
      () => {},
    );
    expect(activation.capabilityIds).toEqual(['t.two.cap']);
    deactivatePlugin(activation);

    await expect(activatePlugin({ id: 't.bad', name: 't', entry: moduleUrl('export const x = 1;') }, () => {}))
      .rejects.toThrow(/activate/);
  });

  it('rejects a plugin that registers nothing', async () => {
    await expect(activatePlugin(
      { id: 't.none', name: 't', entry: moduleUrl('export function activate() {}') },
      () => {},
    )).rejects.toThrow(/没有注册任何能力/);
  });
});