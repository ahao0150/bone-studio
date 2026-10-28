/** 偏好设置的读写与回落（官方 Setting.* 的四个条目）。 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SETTINGS_KEY, colorToNumber, readSettings, writeSettings } from '../src/core/project/settings';

const memory = (seed?: string) => {
  const store = new Map<string, string>();
  if (seed !== undefined) store.set(SETTINGS_KEY, seed);
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
  };
};

describe('偏好设置', () => {
  it('空存储回落到默认值，写入后能读回', () => {
    const storage = memory();
    expect(readSettings(storage)).toEqual(DEFAULT_SETTINGS);
    const custom = { ...DEFAULT_SETTINGS, imageSmooth: false, boneColor: '#ff8800', backgroundGridSize: 64 };
    writeSettings(storage, custom);
    expect(readSettings(storage)).toEqual(custom);
  });

  it('坏 JSON 回落默认值，非法字段逐条回落而不是整份丢弃', () => {
    expect(readSettings(memory('{ not json'))).toEqual(DEFAULT_SETTINGS);
    const partial = JSON.stringify({
      imageSmooth: false,          // 合法
      boneColor: 'red',            // 非法（不是 #rrggbb）
      backgroundGridSize: 9999,    // 越界
      deleteConfirmation: false,   // 合法
    });
    expect(readSettings(memory(partial))).toEqual({
      ...DEFAULT_SETTINGS,
      imageSmooth: false,
      deleteConfirmation: false,
    });
  });

  it('颜色转换与边界', () => {
    expect(colorToNumber('#6cc7ff')).toBe(0x6cc7ff);
    expect(colorToNumber('#000000')).toBe(0);
    expect(resolveGrid(8)).toBe(8);
    expect(resolveGrid(400)).toBe(400);
    expect(resolveGrid(7)).toBe(DEFAULT_SETTINGS.backgroundGridSize);
    expect(resolveGrid(401)).toBe(DEFAULT_SETTINGS.backgroundGridSize);
  });
});

/** 网格尺寸的合法区间（与 settings.ts 的校验保持一致，写在这里以便断言边界）。 */
function resolveGrid(value: number): number {
  return readSettings(memory(JSON.stringify({ backgroundGridSize: value }))).backgroundGridSize;
}
