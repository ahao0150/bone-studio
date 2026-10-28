/**
 * Autosave / crash recovery (M6).
 *
 * The editor snapshots the parsed document after every mutation so a reload -
 * or a crashed tab - can offer to restore it. Storage is injected so the logic
 * is testable without a DOM.
 */
export interface AutosaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AutosaveRecord {
  /** display name of the document that was open */
  name: string;
  /** epoch milliseconds of the snapshot */
  savedAt: number;
  /** the document payload, ready to hand back to `new Player(...)` */
  doc: unknown;
}

export const AUTOSAVE_KEY = 'bonestudio.autosave';

/** Snapshots larger than this are skipped (quota safety, ~4 MB of JSON). */
export const AUTOSAVE_MAX_BYTES = 4 * 1024 * 1024;

export function writeAutosave(
  storage: AutosaveStorage,
  record: AutosaveRecord,
): boolean {
  let serialized: string;
  try {
    serialized = JSON.stringify(record);
  } catch {
    return false;
  }
  if (serialized.length > AUTOSAVE_MAX_BYTES) return false;
  try {
    storage.setItem(AUTOSAVE_KEY, serialized);
    return true;
  } catch {
    return false;
  }
}

/** Read a snapshot; returns null when absent, corrupt or from an older schema. */
export function readAutosave(storage: AutosaveStorage): AutosaveRecord | null {
  const raw = storage.getItem(AUTOSAVE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AutosaveRecord>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.savedAt !== 'number') return null;
    if (!('doc' in parsed) || parsed.doc === null || parsed.doc === undefined) return null;
    return {
      name: typeof parsed.name === 'string' ? parsed.name : 'untitled',
      savedAt: parsed.savedAt,
      doc: parsed.doc,
    };
  } catch {
    return null;
  }
}

export function clearAutosave(storage: AutosaveStorage): void {
  try {
    storage.removeItem(AUTOSAVE_KEY);
  } catch {
    /* ignore - clearing is best effort */
  }
}

/** Human-readable age, used by the restore prompt. */
export function describeAutosaveAge(record: AutosaveRecord, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - record.savedAt) / 1000));
  if (seconds < 60) return seconds + ' 秒前';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes + ' 分钟前';
  return Math.round(minutes / 60) + ' 小时前';
}
