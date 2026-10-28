/** Autosave / crash recovery (M6). */
import { describe, expect, it } from 'vitest';
import {
  AUTOSAVE_KEY, AUTOSAVE_MAX_BYTES, clearAutosave, describeAutosaveAge,
  readAutosave, writeAutosave, type AutosaveStorage,
} from '../src/core/project/autosave';

function memoryStorage(initial: Record<string, string> = {}): AutosaveStorage & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: (key) => { map.delete(key); },
  };
}

describe('autosave', () => {
  it('round-trips a snapshot', () => {
    const storage = memoryStorage();
    const record = { name: 'rooster', savedAt: 1700000000000, doc: { armature: [{ name: 'a' }] } };
    expect(writeAutosave(storage, record)).toBe(true);
    expect(readAutosave(storage)).toEqual(record);
    clearAutosave(storage);
    expect(readAutosave(storage)).toBeNull();
  });

  it('returns null for absent or corrupt payloads', () => {
    expect(readAutosave(memoryStorage())).toBeNull();
    expect(readAutosave(memoryStorage({ [AUTOSAVE_KEY]: '{not json' }))).toBeNull();
    expect(readAutosave(memoryStorage({ [AUTOSAVE_KEY]: '{"savedAt":1}' }))).toBeNull();
    expect(readAutosave(memoryStorage({ [AUTOSAVE_KEY]: '{"doc":null,"savedAt":1}' }))).toBeNull();
  });

  it('skips snapshots that would blow the quota', () => {
    const storage = memoryStorage();
    const huge = { name: 'x', savedAt: 1, doc: { blob: 'a'.repeat(AUTOSAVE_MAX_BYTES) } };
    expect(writeAutosave(storage, huge)).toBe(false);
    expect(storage.map.has(AUTOSAVE_KEY)).toBe(false);
  });

  it('survives a storage that throws', () => {
    const hostile: AutosaveStorage = {
      getItem: () => { throw new Error('nope'); },
      setItem: () => { throw new Error('nope'); },
      removeItem: () => { throw new Error('nope'); },
    };
    expect(writeAutosave(hostile, { name: 'a', savedAt: 1, doc: {} })).toBe(false);
    expect(() => clearAutosave(hostile)).not.toThrow();
  });

  it('describes the snapshot age', () => {
    const record = { name: 'a', savedAt: 0, doc: {} };
    expect(describeAutosaveAge(record, 30_000)).toBe('30 秒前');
    expect(describeAutosaveAge(record, 5 * 60_000)).toBe('5 分钟前');
    expect(describeAutosaveAge(record, 3 * 3600_000)).toBe('3 小时前');
  });
});
