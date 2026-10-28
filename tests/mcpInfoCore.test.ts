import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { resolveProjectsDir, resolveSamplesDir, summarizeStderr, takeJsonLines } from '../tools/mcpInfoCore';

const WIN_ROOT = 'C:\\Users\\Administrator\\Documents\\Codex\\2026-10-11\\a-b-n\\outputs\\bone-studio';

describe('resolveProjectsDir (win32)', () => {
  it('defaults to <repo>\\projects', () => {
    expect(resolveProjectsDir({}, WIN_ROOT, path.win32)).toEqual({ dir: `${WIN_ROOT}\\projects`, source: 'default', legacySamplesEnv: null });
  });
  it('BONESTUDIO_PROJECTS wins; quotes stripped; forward slashes normalised', () => {
    const r = resolveProjectsDir({ BONESTUDIO_PROJECTS: '"D:/My Projects/bs"', BONESTUDIO_SAMPLES: 'C:\\old' }, WIN_ROOT, path.win32);
    expect(r).toMatchObject({ dir: 'D:\\My Projects\\bs', source: 'BONESTUDIO_PROJECTS', legacySamplesEnv: 'C:\\old' });
  });
  it('BONESTUDIO_SAMPLES is no longer the AI workspace (only reported as legacy)', () => {
    expect(resolveProjectsDir({ BONESTUDIO_PROJECTS: ' ', BONESTUDIO_SAMPLES: 'work\\s' }, WIN_ROOT, path.win32)).toEqual({ dir: `${WIN_ROOT}\\projects`, source: 'default', legacySamplesEnv: `${WIN_ROOT}\\work\\s` });
  });
  it('samples dir: env > fallback > none', () => {
    expect(resolveSamplesDir({ BONESTUDIO_SAMPLES: 'D:/s' }, WIN_ROOT, () => false, path.win32)).toBe('D:\\s');
    expect(resolveSamplesDir({}, WIN_ROOT, () => false, path.win32)).toBeNull();
    expect(resolveSamplesDir({}, WIN_ROOT, () => true, path.win32)).toContain('samples');
  });
  it('posix default', () => {
    expect(resolveProjectsDir({}, '/repo', path.posix).dir).toBe('/repo/projects');
  });
});

describe('takeJsonLines', () => {
  it('handles CRLF, BOM, log noise and partial lines', () => {
    const { messages, rest } = takeJsonLines('\uFEFF{"id":1}\r\nwarning: x\r\n\r\n{"id":2,"result":{}}\r\n{"id":3');
    expect(messages).toEqual([{ id: 1 }, { id: 2, result: {} }]);
    expect(rest).toBe('{"id":3');
  });
});

describe('summarizeStderr', () => {
  it('keeps the error line from a Windows stack', () => {
    const s = 'node:internal/modules/esm/resolve:854\r\n  throw new ERR_MODULE_NOT_FOUND(packageName, fileURLToPath(base), null);\r\n\r\nError [ERR_MODULE_NOT_FOUND]: Cannot find package \'@esotericsoftware/spine-core\' imported from C:\\x\\dist-mcp\\server.js\r\n    at packageResolve\r\n';
    expect(summarizeStderr(s)).toContain("Cannot find package '@esotericsoftware/spine-core'");
    expect(summarizeStderr(s)).not.toContain('\r');
  });
});
