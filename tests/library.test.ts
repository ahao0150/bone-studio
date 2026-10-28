/**
 * P-08 素材库纯逻辑的判据：切片搜索 + 引用统计。
 */
import { describe, expect, it } from 'vitest';
import { filterRegions, slotDisplayUsage } from '../src/core/library';

const REGIONS = [
  { name: 'body_1' },
  { name: 'Body_2' },
  { name: 'leg_lt' },
  { name: 'wing' },
];

describe('素材库：切片搜索', () => {
  it('空 query 返回全部（且是新数组，不改原数据）', () => {
    const out = filterRegions(REGIONS, '   ');
    expect(out).toHaveLength(4);
    expect(out).not.toBe(REGIONS);
  });

  it('忽略大小写与首尾空白', () => {
    expect(filterRegions(REGIONS, ' body ').map((r) => r.name)).toEqual(['body_1', 'Body_2']);
    expect(filterRegions(REGIONS, 'WING').map((r) => r.name)).toEqual(['wing']);
  });

  it('没有匹配时返回空数组', () => {
    expect(filterRegions(REGIONS, 'nope')).toEqual([]);
  });
});

describe('素材库：引用统计', () => {
  it('按 display.path ?? display.name 计数，同名累加', () => {
    const usage = slotDisplayUsage([
      { display: [{ path: 'body_1' }, { name: 'body_1' }] },
      { display: [{ name: 'wing' }] },
      { display: [{ path: 'leg_lt' }, { name: '' }] },
    ]);
    expect(usage.get('body_1')).toBe(2);
    expect(usage.get('wing')).toBe(1);
    expect(usage.get('leg_lt')).toBe(1);
    expect(usage.size).toBe(3);
  });

  it('path 优先于 name（官方运行时口径）', () => {
    const usage = slotDisplayUsage([{ display: [{ path: 'real', name: 'alias' }] }]);
    expect(usage.get('real')).toBe(1);
    expect(usage.has('alias')).toBe(false);
  });

  it('没有显示对象的槽位不产生计数', () => {
    expect(slotDisplayUsage([{}, { display: [] }]).size).toBe(0);
  });
});
