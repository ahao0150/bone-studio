import { afterEach, describe, expect, it, vi } from 'vitest';
import { allowKey, allowTool, assertWritable, guard, isReadonly, setReadonly } from '../src/core/readonlyGuard';

afterEach(() => setReadonly(false));

describe('readonly guard', () => {
  it('passes through when editable', () => {
    const fn = vi.fn(() => 5);
    expect(guard('x', fn)()).toBe(5);
    expect(assertWritable('x')).toBe(true);
    expect(allowTool('bone')).toBe(true);
    expect(allowKey({ key: 'Delete' })).toBe(true);
  });
  it('blocks commands, tools and editing shortcuts when readonly', () => {
    const blocked = vi.fn();
    setReadonly(true, blocked);
    expect(isReadonly()).toBe(true);
    const fn = vi.fn();
    expect(guard('commitDrag', fn)(1, 2)).toBeUndefined();
    expect(fn).not.toHaveBeenCalled();
    expect(blocked).toHaveBeenCalledWith('commitDrag');
    expect(assertWritable('undo')).toBe(false);
    expect(['select', 'pan'].every(allowTool)).toBe(true);
    expect(['pose', 'bone', 'weight', 'mesh', 'move', 'rotate'].some(allowTool)).toBe(false);
    for (const k of [{ key: ' ' }, { key: 't' }, { key: 'g' }, { key: 'ArrowLeft' }, { key: '=', ctrlKey: true }, { key: '0', metaKey: true }]) expect(allowKey(k)).toBe(true);
    for (const k of [{ key: 'z', ctrlKey: true }, { key: 'y', ctrlKey: true }, { key: 's', ctrlKey: true }, { key: 'e', ctrlKey: true }, { key: 'k' }, { key: 'Delete' }, { key: 'Backspace' }, { key: 'w' }, { key: 'Tab', ctrlKey: true }]) expect(allowKey(k)).toBe(false);
  });
});
