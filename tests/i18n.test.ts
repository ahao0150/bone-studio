/**
 * P-09 多语言的纯逻辑判据（中文原文当词条键 + 回退策略，见 DBPRO-SPEC §66）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { getLocale, readLocale, setLocale, t, tpl, writeLocale } from '../src/i18n';

const storage = (initial: Record<string, string> = {}) => {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    dump: () => Object.fromEntries(map),
  };
};

beforeEach(() => setLocale('zh_CN'));

describe('多语言：词条', () => {
  it('中文下原样返回，English 下查表', () => {
    expect(t('文件')).toBe('文件');
    setLocale('en_US');
    expect(t('文件')).toBe('File');
    expect(t('视图')).toBe('View');
    expect(t('关闭其他')).toBe('Close Others');
  });

  it('没翻的词条回退中文，不返回空白', () => {
    setLocale('en_US');
    expect(t('这条还没翻')).toBe('这条还没翻');
    expect(t('')).toBe('');
  });

  it('模板词条按 {0} 占位替换', () => {
    expect(tpl('工作区：{0}', '动画')).toBe('工作区：动画');
    setLocale('en_US');
    expect(tpl('未知模板{0}', 42)).toBe('未知模板42');
  });
});

describe('多语言：持久化', () => {
  it('写进去能读回来，非法值回退中文', () => {
    const store = storage();
    writeLocale(store, 'en_US');
    expect(readLocale(store)).toBe('en_US');
    expect(readLocale(storage({ 'bonestudio.locale': 'fr_FR' }))).toBe('zh_CN');
    expect(readLocale(storage())).toBe('zh_CN');
  });

  it('setLocale 立刻影响 getLocale 与 t()', () => {
    setLocale('en_US');
    expect(getLocale()).toBe('en_US');
    expect(t('帮助')).toBe('Help');
    setLocale('zh_CN');
    expect(t('帮助')).toBe('帮助');
  });
});
