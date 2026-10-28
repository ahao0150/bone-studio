/**
 * P-19 选项卡管理的纯逻辑判据（官方 CloseTabButton 的 关闭 / 关闭其他 / 关闭全部）。
 */
import { describe, expect, it } from 'vitest';
import { closeAll, closeOne, closeOthers, nextActiveAfterClose } from '../src/core/documents';

const DOCS = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('选项卡管理', () => {
  it('关闭一个只移除它，顺序不变', () => {
    expect(closeOne(DOCS, 'b').map((doc) => doc.id)).toEqual(['a', 'c']);
    expect(closeOne(DOCS, 'nope').map((doc) => doc.id)).toEqual(['a', 'b', 'c']);
  });

  it('关闭其他只留目标', () => {
    expect(closeOthers(DOCS, 'b').map((doc) => doc.id)).toEqual(['b']);
    expect(closeOthers(DOCS, 'nope')).toEqual([]);
  });

  it('关闭全部清空', () => {
    expect(closeAll()).toEqual([]);
  });

  it('关掉当前页后激活右邻居', () => {
    expect(nextActiveAfterClose(DOCS, 'a')).toBe('b');
    expect(nextActiveAfterClose(DOCS, 'b')).toBe('c');
  });

  it('关掉最后一页后回退到左邻居；只剩一页时关掉返回 null', () => {
    expect(nextActiveAfterClose(DOCS, 'c')).toBe('b');
    expect(nextActiveAfterClose([{ id: 'only' }], 'only')).toBeNull();
  });

  it('关闭不存在的 id 时保持第一个为当前', () => {
    expect(nextActiveAfterClose(DOCS, 'nope')).toBe('a');
  });
});
