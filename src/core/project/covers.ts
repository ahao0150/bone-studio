/**
 * 欢迎页卡片封面缓存（JPEG data URL，localStorage）。
 * 键 = `${kind}:${name}`，与「最近打开」同一套身份；超过上限按写入时间淘汰最旧的，
 * 写满配额时也先淘汰再重试 —— 封面只是锦上添花，不能挤掉自动保存。
 */

export const COVERS_KEY = 'bonestudio.covers.v3';
export const COVERS_MAX = 24;

type CoverStorage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

interface CoverRecord { url: string; at: number }

export function coverKey(kind: 'sample' | 'file' | 'workspace', name: string): string {
  return `${kind}:${name}`;
}

function readAll(storage: CoverStorage | null | undefined): Record<string, CoverRecord> {
  try {
    const parsed = JSON.parse(storage?.getItem(COVERS_KEY) ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, CoverRecord> : {};
  } catch {
    return {};
  }
}

export function readCovers(storage: CoverStorage | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, record] of Object.entries(readAll(storage))) {
    if (record && typeof record.url === 'string') out[key] = record.url;
  }
  return out;
}

export function writeCover(storage: CoverStorage | null | undefined, key: string, url: string, now = Date.now()): Record<string, string> {
  const all = readAll(storage);
  all[key] = { url, at: now };
  let entries = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, COVERS_MAX);
  while (entries.length > 0) {
    try {
      storage?.setItem(COVERS_KEY, JSON.stringify(Object.fromEntries(entries)));
      break;
    } catch {
      entries = entries.slice(0, -1);
    }
  }
  return Object.fromEntries(entries.map(([k, record]) => [k, record.url]));
}
