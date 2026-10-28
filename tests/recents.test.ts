/** 最近打开列表（官方欢迎页的「项目」区）。 */
import { describe, expect, it } from 'vitest';
import { RECENTS_KEY, RECENTS_MAX, pushRecent, readRecents } from '../src/core/project/settings';

const memory = (seed?: string) => {
  const store = new Map<string, string>();
  if (seed !== undefined) store.set(RECENTS_KEY, seed);
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
  };
};

describe('最近打开', () => {
  it('空存储为空，推入后按时间倒序', () => {
    const storage = memory();
    expect(readRecents(storage)).toEqual([]);
    pushRecent(storage, { kind: 'sample', name: 'Rooster' }, 100);
    pushRecent(storage, { kind: 'file', name: 'Bicycle_ske.json' }, 200);
    expect(readRecents(storage).map((r) => r.name)).toEqual(['Bicycle_ske.json', 'Rooster']);
  });

  it('同 kind + name 去重并置顶，且截断到上限', () => {
    const storage = memory();
    for (let i = 0; i < RECENTS_MAX + 4; i++) pushRecent(storage, { kind: 'file', name: `f${i}.json` }, i);
    const list = readRecents(storage);
    expect(list.length).toBe(RECENTS_MAX);
    expect(list[0].name).toBe(`f${RECENTS_MAX + 3}.json`);
    pushRecent(storage, { kind: 'file', name: 'f5.json' }, 999);
    const again = readRecents(storage);
    expect(again[0].name).toBe('f5.json');
    expect(again.filter((r) => r.name === 'f5.json').length).toBe(1);
  });

  it('坏 JSON 与非法项回落', () => {
    expect(readRecents(memory('{nope'))).toEqual([]);
    const mixed = JSON.stringify([
      { kind: 'sample', name: 'ok', at: 5 },
      { kind: 'nope', name: 'bad' },
      { kind: 'file' },
      null,
    ]);
    expect(readRecents(memory(mixed)).map((r) => r.name)).toEqual(['ok']);
  });
});
