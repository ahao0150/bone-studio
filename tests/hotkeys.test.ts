/**
 * P-09 快捷键自定义的纯逻辑判据（官方 `Setting.hotkey*`）。
 */
import { describe, expect, it } from 'vitest';
import {
  bindingOf, findConflict, matchHotkey, normalizeKey, readHotkeys, writeHotkeys, labelOf,
} from '../src/core/hotkeys';

const storage = (initial: Record<string, string> = {}) => {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    dump: () => Object.fromEntries(map),
  };
};

describe('快捷键：键串归一化', () => {
  it('字母小写、空格与加减号归一', () => {
    expect(normalizeKey({ key: 'Q' })).toBe('q');
    expect(normalizeKey({ key: ' ' })).toBe('space');
    expect(normalizeKey({ key: '+' })).toBe('=');
    expect(normalizeKey({ key: '_' })).toBe('-');
  });

  it('组合键按 ctrl+alt+shift 顺序', () => {
    expect(normalizeKey({ key: 'C', ctrlKey: true, shiftKey: true })).toBe('ctrl+shift+c');
    expect(normalizeKey({ key: 'Z', ctrlKey: true })).toBe('ctrl+z');
  });

  it('单独的修饰键不算命中', () => {
    expect(normalizeKey({ key: 'Shift', shiftKey: true })).toBe('');
  });
});

describe('快捷键：默认与覆盖', () => {
  it('没有覆盖时用默认键', () => {
    expect(bindingOf('tool.select', {})).toBe('q');
    expect(matchHotkey({ key: 'q' }, {})).toBe('tool.select');
  });

  it('覆盖后新键命中、旧键不再命中', () => {
    const overrides = { 'tool.select': 'u' };
    expect(bindingOf('tool.select', overrides)).toBe('u');
    expect(matchHotkey({ key: 'u' }, overrides)).toBe('tool.select');
    expect(matchHotkey({ key: 'q' }, overrides)).toBeNull();
  });

  it('冲突检测：撞到别的动作就报出对方 id', () => {
    expect(findConflict('tool.select', 'w', {})).toBe('tool.pose');
    expect(findConflict('tool.select', 'u', {})).toBeNull();
  });
});

describe('快捷键：持久化', () => {
  it('写进去能读回来', () => {
    const store = storage();
    writeHotkeys(store, { 'tool.select': 'u' });
    expect(readHotkeys(store)).toEqual({ 'tool.select': 'u' });
  });

  it('坏数据回退成空表，非字符串值被丢掉', () => {
    expect(readHotkeys(storage({ 'bonestudio.hotkeys': '{oops' }))).toEqual({});
    const store = storage({ 'bonestudio.hotkeys': JSON.stringify({ a: 1, b: 'x' }) });
    expect(readHotkeys(store)).toEqual({ b: 'x' });
  });

  it('labelOf 给出人类可读标签', () => {
    expect(labelOf('tool.select')).toBe('选择工具');
    expect(labelOf('nope')).toBe('nope');
  });
});
