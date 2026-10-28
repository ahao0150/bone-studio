import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLEANUP_MS, LockedError, STALE_MS, Session, atomicWriteJson, listSessions, lockHolder, resolveDisplayName, sessionStatus, summarizeArgs } from '../src/mcp/session';

const tmp = () => mkdtempSync(join(tmpdir(), 'bs-sess-'));

describe('name priority', () => {
  it('session_set > clientInfo > env > pid', () => {
    expect(resolveDisplayName({ setName: 'A', clientName: 'B', envName: 'C', pid: 1 })).toEqual({ name: 'A', source: 'session_set' });
    expect(resolveDisplayName({ setName: ' ', clientName: 'B', envName: 'C', pid: 1 })).toEqual({ name: 'B', source: 'clientInfo' });
    expect(resolveDisplayName({ clientName: null, envName: 'C', pid: 1 })).toEqual({ name: 'C', source: 'env' });
    expect(resolveDisplayName({ pid: 42 })).toEqual({ name: 'Agent-42', source: 'pid' });
  });
  it('Session applies the priority as information arrives', () => {
    const s = new Session({ projectsDir: tmp(), pid: 7, env: { BONESTUDIO_AGENT_NAME: 'envy' } });
    expect(s.rec.displayName).toBe('envy');
    s.setClient({ name: 'cursor', version: '1.2' });
    expect([s.rec.displayName, s.rec.clientVersion]).toEqual(['cursor', '1.2']);
    s.setAgent('吕布动画师', '攻击动画');
    expect([s.rec.displayName, s.rec.nameSource, s.rec.task]).toEqual(['吕布动画师', 'session_set', '攻击动画']);
    s.setClient({ name: 'other' });
    expect(s.rec.displayName).toBe('吕布动画师');
    s.close();
  });
});

describe('registry', () => {
  it('writes, updates and deletes the session file', () => {
    const dir = tmp();
    let t = Date.parse('2026-10-14T00:00:00Z');
    const s = new Session({ projectsDir: dir, pid: 9, env: {}, now: () => t, id: 'abc' });
    s.flush();
    const f = join(dir, '.sessions', 'abc.json');
    expect(JSON.parse(readFileSync(f, 'utf8')).displayName).toBe('Agent-9');
    t += 1000;
    s.noteTool('bone_key', { bone: 'arm', frame: 3, keys: [1, 2, 3], long: 'x'.repeat(100) });
    s.setProject('lubu'); s.noteRender('attack', 6); s.flush();
    const rec = JSON.parse(readFileSync(f, 'utf8'));
    expect(rec).toMatchObject({ project: 'lubu', lastTool: 'bone_key', lastRender: { animation: 'attack', frame: 6 } });
    expect(rec.lastArgs).toContain('keys=[3]');
    expect(rec.updatedAt).toBe(new Date(t).toISOString());
    expect(readdirSync(join(dir, '.sessions')).filter((n) => n.endsWith('.tmp'))).toEqual([]);
    s.close();
    expect(existsSync(f)).toBe(false);
  });
  it('status: active / idle / stale and cleanup of old files', () => {
    const now = Date.parse('2026-10-14T01:00:00Z');
    const iso = (ms: number) => new Date(now - ms).toISOString();
    expect(sessionStatus({ updatedAt: iso(1000), lastToolAt: iso(2000) }, now)).toBe('active');
    expect(sessionStatus({ updatedAt: iso(1000), lastToolAt: iso(5 * 60_000) }, now)).toBe('idle');
    expect(sessionStatus({ updatedAt: iso(STALE_MS + 1) }, now)).toBe('stale');
    const dir = tmp();
    mkdirSync(join(dir, '.sessions'));
    atomicWriteJson(join(dir, '.sessions', 'old.json'), { id: 'old', displayName: 'x', pid: 1, startedAt: iso(CLEANUP_MS * 2), updatedAt: iso(CLEANUP_MS + 1000) });
    atomicWriteJson(join(dir, '.sessions', 'gone.json'), { id: 'gone', displayName: 'y', pid: 2, startedAt: iso(60_000), updatedAt: iso(STALE_MS + 5000) });
    writeFileSync(join(dir, '.sessions', 'junk.json.1.tmp'), '{');
    utimesSync(join(dir, '.sessions', 'junk.json.1.tmp'), new Date(now - CLEANUP_MS * 2), new Date(now - CLEANUP_MS * 2));
    const list = listSessions(dir, now);
    expect(list.map((s) => [s.id, s.status])).toEqual([['gone', 'stale']]);
    expect(readdirSync(join(dir, '.sessions'))).toEqual(['gone.json']);
  });
  it('summarizeArgs keeps it short', () => {
    expect(summarizeArgs({ a: 1, b: { c: 1 }, d: [1, 2] })).toBe('a=1 b={…} d=[2]');
    expect(summarizeArgs({ s: 'y'.repeat(500) }).length).toBeLessThanOrEqual(200);
  });
});

describe('project write lock', () => {
  it('blocks another live session, allows re-entry, takes over stale locks, releases on close', () => {
    const dir = tmp();
    let t = Date.parse('2026-10-14T02:00:00Z');
    const a = new Session({ projectsDir: dir, pid: 1, env: {}, now: () => t, id: 'A' });
    const b = new Session({ projectsDir: dir, pid: 2, env: {}, now: () => t, id: 'B' });
    a.setAgent('Alice'); b.setAgent('Bob');
    a.acquire('hero');
    a.acquire('hero');                         // 自己可重入
    expect(() => b.acquire('hero')).toThrow(LockedError);
    try { b.acquire('hero'); } catch (e) { expect((e as Error).message).toContain('Alice'); }
    b.acquire('villain');                      // 别的工程不受影响
    expect(lockHolder(dir, 'hero', 'B', t)?.sessionId).toBe('A');
    // A 的心跳停了 30 s 以上 → stale → B 接管
    t += STALE_MS + 1000;
    b.flush();
    b.acquire('hero');
    expect(JSON.parse(readFileSync(join(dir, 'hero', '.lock'), 'utf8')).sessionId).toBe('B');
    // A 回来刷新时发现锁已被接管：不会把锁抢回去
    a.flush();
    expect(JSON.parse(readFileSync(join(dir, 'hero', '.lock'), 'utf8')).sessionId).toBe('B');
    expect(a.holds('hero')).toBe(false);
    b.close();
    expect(existsSync(join(dir, 'hero', '.lock'))).toBe(false);
    a.close();
  });
  it('lock of a session whose file vanished is not honoured', () => {
    const dir = tmp();
    const t = Date.now();
    mkdirSync(join(dir, 'p'), { recursive: true });
    atomicWriteJson(join(dir, 'p', '.lock'), { sessionId: 'ghost', heartbeat: new Date(t).toISOString() });
    expect(lockHolder(dir, 'p', 'me', t)).toBeNull();
  });
});
