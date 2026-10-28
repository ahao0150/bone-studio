/** 纯函数：工作区解析 + JSON-RPC 行解析。注入 path 实现，便于用 path.win32 做 Windows 单测。 */
import nodePath from 'node:path';

type PathImpl = Pick<typeof nodePath, 'resolve' | 'join' | 'isAbsolute'>;

export interface ProjectsDirInfo { dir: string; source: 'BONESTUDIO_PROJECTS' | 'default'; legacySamplesEnv?: string | null }

/**
 * AI 工程工作区：BONESTUDIO_PROJECTS > <repo>/projects（与 MCP server 的 workspace.ts 一致）。
 * BONESTUDIO_SAMPLES 不再挪作 AI 工作区 —— 它只表示编辑器的内置示例目录（/dbsamples）。
 * 若只设了 BONESTUDIO_SAMPLES 且它看起来就是旧的 AI 工作区，调用方可用 legacySamplesEnv 给提示。
 */
export function resolveProjectsDir(env: Record<string, string | undefined>, repoRoot: string, path: PathImpl = nodePath): ProjectsDirInfo {
  const pick = (v: string | undefined) => (v && v.trim() ? v.trim().replace(/^"(.*)"$/, '$1') : undefined);
  const legacy = pick(env.BONESTUDIO_SAMPLES) ? path.resolve(repoRoot, pick(env.BONESTUDIO_SAMPLES)!) : null;
  const p = pick(env.BONESTUDIO_PROJECTS);
  if (p) return { dir: path.resolve(repoRoot, p), source: 'BONESTUDIO_PROJECTS', legacySamplesEnv: legacy };
  return { dir: path.join(repoRoot, 'projects'), source: 'default', legacySamplesEnv: legacy };
}

/** 内置示例目录：BONESTUDIO_SAMPLES > 本地样本示例目录（存在时）> 无 */
export function resolveSamplesDir(env: Record<string, string | undefined>, repoRoot: string, exists: (p: string) => boolean, path: PathImpl = nodePath): string | null {
  const v = env.BONESTUDIO_SAMPLES?.trim().replace(/^"(.*)"$/, '$1');
  if (v) return path.resolve(repoRoot, v);
  const fallback = 'samples';
  return exists(fallback) ? path.resolve(fallback) : null;
}

/** 把 stdout 缓冲切成完整 JSON 行（容忍 CRLF、空行、非 JSON 日志），返回已解析消息与剩余半行。 */
export function takeJsonLines(buffer: string): { messages: unknown[]; rest: string } {
  const parts = buffer.split(/\r?\n/);
  const rest = parts.pop() ?? '';
  const messages: unknown[] = [];
  for (const raw of parts) {
    const line = raw.replace(/^\uFEFF/, '').trim();
    if (!line.startsWith('{')) continue;
    try { messages.push(JSON.parse(line)); } catch { /* 非协议输出 */ }
  }
  return { messages, rest };
}

/** 把 Node 报错（stderr）压成面板可读的一段：优先保留 Error/Cannot find 行。 */
export function summarizeStderr(stderr: string, max = 1200): string {
  const lines = stderr.replace(/\r/g, '').split('\n').map((l) => l.trimEnd()).filter(Boolean);
  const key = lines.findIndex((l) => /Error|Cannot find|ERR_/.test(l));
  const picked = (key >= 0 ? lines.slice(Math.max(0, key - 2), key + 6) : lines.slice(-8)).join('\n');
  return picked.length > max ? `${picked.slice(0, max)}…` : picked;
}
