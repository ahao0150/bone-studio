import { describe, expect, it } from 'vitest';
import {
  SCENE_TREE_FILTER_KEY, displayChildrenVisible, readSceneTreeFilter, writeSceneTreeFilter,
} from '../src/core/sceneTreeFilter';

function memStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    dump: () => map,
  };
}

// 官方 _4469：if(parent.children.length == 1) return false;
describe('场景树智能过滤（官方 _4469）', () => {
  it('关着时全列；开着时只有 1 个显示对象的槽位不列子行', () => {
    expect(displayChildrenVisible(1, false)).toBe(true);
    expect(displayChildrenVisible(2, false)).toBe(true);
    expect(displayChildrenVisible(3, false)).toBe(true);
    expect(displayChildrenVisible(1, true)).toBe(false);   // 只有 1 个 → 过滤掉
    expect(displayChildrenVisible(2, true)).toBe(true);    // 多个 → 保留
    expect(displayChildrenVisible(3, true)).toBe(true);
    expect(displayChildrenVisible(0, true)).toBe(false);   // 没有显示对象
    expect(displayChildrenVisible(0, false)).toBe(false);
  });

  it('状态能在存储里往返，坏存储不抛', () => {
    const storage = memStorage();
    expect(readSceneTreeFilter(storage)).toBe(false);          // 官方默认 0
    writeSceneTreeFilter(storage, true);
    expect(storage.dump().get(SCENE_TREE_FILTER_KEY)).toBe('1');
    expect(readSceneTreeFilter(storage)).toBe(true);
    writeSceneTreeFilter(storage, false);
    expect(storage.dump().get(SCENE_TREE_FILTER_KEY)).toBe('0');
    expect(readSceneTreeFilter(storage)).toBe(false);
    expect(readSceneTreeFilter(null)).toBe(false);
    writeSceneTreeFilter(null, true);                          // 不应抛
  });
});