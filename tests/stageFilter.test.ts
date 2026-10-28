import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STAGE_FILTER, STAGE_FILTER_KEY, readStageFilter, toggleStageFilter, writeStageFilter,
} from '../src/core/stageFilter';

function memStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    dump: () => map,
  };
}

// 官方默认（`_346/_357.as` 第 138-153 行）：visibleFilter / selectableFilter 的 bone、image 都是 1
describe('舞台过滤器（官方 StageFilterBar 的 6 个开关）', () => {
  it('没有存储时是官方默认：6 个开关全开', () => {
    expect(readStageFilter(memStorage())).toEqual(DEFAULT_STAGE_FILTER);
    expect(readStageFilter(null)).toEqual(DEFAULT_STAGE_FILTER);
  });

  it('只收编已知布尔键，缺失与脏值都回落默认', () => {
    const storage = memStorage();
    storage.setItem(STAGE_FILTER_KEY, JSON.stringify({ boneVisible: false, imageSelectable: false, boneInherit: 'nope', extra: 1 }));
    expect(readStageFilter(storage)).toEqual({
      ...DEFAULT_STAGE_FILTER, boneVisible: false, imageSelectable: false,
    });
    storage.setItem(STAGE_FILTER_KEY, '{not json');
    expect(readStageFilter(storage)).toEqual(DEFAULT_STAGE_FILTER);
  });

  it('写入后能原样读回，翻转是纯函数', () => {
    const storage = memStorage();
    const next = toggleStageFilter(DEFAULT_STAGE_FILTER, 'imageVisible');
    expect(next.imageVisible).toBe(false);
    expect(DEFAULT_STAGE_FILTER.imageVisible).toBe(true);          // 原对象不被改
    writeStageFilter(storage, next);
    expect(readStageFilter(storage)).toEqual(next);
    writeStageFilter(null, next);                                  // 不应抛
  });

  it('重复翻转回到原状态', () => {
    let filter = DEFAULT_STAGE_FILTER;
    for (const key of ['boneVisible', 'imageVisible', 'boneSelectable', 'imageSelectable', 'boneInherit', 'imageInherit'] as const) {
      filter = toggleStageFilter(toggleStageFilter(filter, key), key);
    }
    expect(filter).toEqual(DEFAULT_STAGE_FILTER);
  });
});