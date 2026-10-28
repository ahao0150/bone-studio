/**
 * MCP 工作区：MCP 写出的工程放在 `projects/<name>/`，并登记到 `projects/manifest.json`。
 * dev server 把同一个目录挂在 `/aiprojects/...`（BONESTUDIO_PROJECTS > <repo>/projects），编辑器读到同一份文件；
 * 打开 `?aiproject=<name>&live=1` 的页面会在 `rev` 变化时原地更新（SSE，兜底整页重载） → agent 的每次写入都能在编辑器里看到。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DbSkeletonData, DbTextureAtlasData } from '../core/types';

export interface ManifestEntry { name: string; skeleton: string; texture: string; image: string; rev?: number; source?: string }

function repoRoot(): string {
  let dir = process.cwd();
  try { dir = dirname(fileURLToPath(import.meta.url)); } catch { /* cjs */ }
  for (let i = 0; i < 6; i++) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg) && /"name":\s*"bone-studio"/.test(readFileSync(pkg, 'utf8'))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

export function projectsDir(): string {
  // BONESTUDIO_SAMPLES 不再兼作 AI 工作区（它只是编辑器内置示例目录）
  const dir = resolve(process.env.BONESTUDIO_PROJECTS?.trim() || join(repoRoot(), 'projects'));
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function readManifest(): { samples: ManifestEntry[] } {
  const file = join(projectsDir(), 'manifest.json');
  if (!existsSync(file)) return { samples: [] };
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return { samples: [] }; }
}

export function safeName(name: string): string {
  const n = name.replace(/[^\w.-]+/g, '_').replace(/^\.+/, '');
  if (!n) throw new Error('bad project name');
  return n;
}

/** 写守卫（server.ts 装上会话写锁）：saveToWorkspace 落盘前调用，抛错即拒绝写入 */
let writeGuard: ((project: string) => void) | null = null;
export function setWriteGuard(fn: ((project: string) => void) | null): void { writeGuard = fn; }

export function saveToWorkspace(name: string, ske: DbSkeletonData | string, tex: DbTextureAtlasData, png: Uint8Array, source?: string): ManifestEntry & { dir: string } {
  const n = safeName(name);
  writeGuard?.(n);
  const dir = join(projectsDir(), n);
  mkdirSync(dir, { recursive: true });
  const texOut = { ...tex, imagePath: `${n}_tex.png` };
  writeFileSync(join(dir, `${n}_ske.json`), typeof ske === 'string' ? ske : JSON.stringify(ske));
  writeFileSync(join(dir, `${n}_tex.json`), JSON.stringify(texOut, null, 1));
  writeFileSync(join(dir, `${n}_tex.png`), png);
  const manifest = readManifest();
  const entry: ManifestEntry = { name: n, skeleton: `${n}/${n}_ske.json`, texture: `${n}/${n}_tex.json`, image: `${n}/${n}_tex.png`, rev: Date.now(), ...(source ? { source } : {}) };
  const i = manifest.samples.findIndex((s) => s.name === n);
  if (i >= 0) manifest.samples[i] = { ...manifest.samples[i], ...entry }; else manifest.samples.push(entry);
  writeFileSync(join(projectsDir(), 'manifest.json'), JSON.stringify(manifest, null, 1));
  return { ...entry, dir };
}

export function loadFromWorkspace(name: string): { ske: unknown; tex: DbTextureAtlasData; png: Uint8Array; dir: string } {
  const n = safeName(name);
  const dir = join(projectsDir(), n);
  if (!existsSync(join(dir, `${n}_ske.json`))) throw new Error(`no workspace project: ${n}`);
  return {
    ske: JSON.parse(readFileSync(join(dir, `${n}_ske.json`), 'utf8')),
    tex: JSON.parse(readFileSync(join(dir, `${n}_tex.json`), 'utf8')),
    png: readFileSync(join(dir, `${n}_tex.png`)),
    dir,
  };
}

/** 找到正在跑、且在服务这个工作区的编辑器 dev server */
export async function findEditorUrl(): Promise<string | null> {
  const candidates = process.env.BONESTUDIO_EDITOR_URL
    ? [process.env.BONESTUDIO_EDITOR_URL]
    : [5178, 5179, 5180, 5181].map((p) => `http://127.0.0.1:${p}`);
  const names = new Set(readManifest().samples.map((s) => s.name));
  for (const base of candidates) {
    try {
      const res = await fetch(`${base.replace(/\/$/, '')}/aiprojects/manifest.json`, { signal: AbortSignal.timeout(1500) });
      if (!res.ok) continue;
      const data = await res.json() as { samples?: Array<{ name: string }> };
      if (!Array.isArray(data.samples)) continue;
      if (names.size === 0 || data.samples.some((s) => names.has(s.name))) return base.replace(/\/$/, '');
    } catch { /* next */ }
  }
  return null;
}
