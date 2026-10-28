/**
 * 界面语言（官方 `Menu.File.Setting` 里的「语言」，见 `格式规范` §66）。
 *
 * 用**中文原文当词条键**：`t('文件')` 在中文下原样返回，在 English 下查 `en_US` 表，
 * 查不到就回退中文 —— 渐进式，没翻的词条不会变成空白。
 *
 * 覆盖范围（本轮）：菜单栏 / 工具栏提示 / 面板标题 / 页签 / 状态栏 / 设置对话框。
 * 行内提示（flash / notice / toast）仍是中文，后续按同一张表增量补。
 */
import { EN_US } from './en_US';

export type Locale = 'zh_CN' | 'en_US';

export const LOCALES: Array<{ id: Locale; name: string }> = [
  { id: 'zh_CN', name: '简体中文' },
  { id: 'en_US', name: 'English' },
];

export const LOCALE_STORAGE_KEY = 'bonestudio.locale';

let current: Locale = 'zh_CN';

export function setLocale(locale: Locale): void {
  current = locale;
}

export function getLocale(): Locale {
  return current;
}

/** 词条：中文下原样返回；English 下查表，缺失回退原文 */
export function t(key: string): string {
  if (!key) return key;
  return current === 'en_US' ? (EN_US[key] ?? key) : key;
}

/** 模板词条：`tpl('工作区：{0}', name)` —— 中英都按同一占位符替换 */
export function tpl(pattern: string, ...args: Array<string | number>): string {
  const base = t(pattern);
  return args.reduce<string>((acc, value, index) => acc.split(`{${index}}`).join(String(value)), base);
}

export function readLocale(storage: Pick<Storage, 'getItem'>): Locale {
  try {
    return storage.getItem(LOCALE_STORAGE_KEY) === 'en_US' ? 'en_US' : 'zh_CN';
  } catch {
    return 'zh_CN';
  }
}

export function writeLocale(storage: Pick<Storage, 'setItem'>, locale: Locale): void {
  storage.setItem(LOCALE_STORAGE_KEY, locale);
}
