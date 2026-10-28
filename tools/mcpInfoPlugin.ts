/**
 * Dev-only：给编辑器「AI → MCP 服务」面板提供信息与 Skill 下载。
 *   GET /api/mcp/info        → 仓库绝对路径、dist-mcp 是否已构建、工作区、平台、工具清单（起一次 server 拿 tools/list，带缓存）
 *   GET /api/mcp/skill.md    → docs/SKILL-bone-studio-mcp.md（下载名 SKILL.md）
 *   GET /api/mcp/skill.zip   → bonestudio-mcp/SKILL.md 的 zip
 *   POST /api/mcp/rebuild    → node tools/build-mcp.mjs，完成后清工具缓存
 *   GET /api/mcp/install-ai.mjs → 一键安装脚本原文
 */
import type { Plugin } from 'vite';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildZip } from '../src/core/export/zip';
import { takeJsonLines, summarizeStderr, type ProjectsDirInfo } from './mcpInfoCore';

interface ToolInfo { name: string; description: string }
interface ToolList { tools: ToolInfo[]; error: string | null }
let cache: { key: string; result: ToolList } | null = null;

/** 起一次 server（process.execPath + 参数数组，不走 shell），发 initialize + tools/list，15s 超时；失败时带回真实 stderr / 退出码。 */
function listTools(server: string, cwd: string): Promise<ToolList> {
  const key = `${server}:${statSync(server).mtimeMs}`;
  if (cache && cache.key === key && !cache.result.error) return Promise.resolve(cache.result);
  return new Promise((done) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    const finish = (result: ToolList) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch { /* gone */ }
      if (!result.error) cache = { key, result };
      done(result);
    };
    const child = spawn(process.execPath, [server], { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false });
    const timer = setTimeout(() => finish({ tools: [], error: `超时（15s 内没有返回 tools/list）${stderr ? `\n${summarizeStderr(stderr)}` : ''}` }), 15000);
    child.on('error', (e) => finish({ tools: [], error: `无法启动 ${process.execPath}: ${e.message}` }));
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString('utf8'); });
    child.on('exit', (code, signal) => finish({ tools: [], error: `server 提前退出（code ${code ?? signal}）${stderr ? `\n${summarizeStderr(stderr)}` : '，无 stderr 输出'}` }));
    child.stdout.on('data', (chunk: Buffer) => {
      const { messages, rest } = takeJsonLines(stdout + chunk.toString('utf8'));
      stdout = rest;
      for (const m of messages as Array<{ id?: number; result?: { tools?: ToolInfo[] }; error?: { message?: string } }>) {
        if (m.id !== 2) continue;
        if (m.result?.tools) finish({ tools: m.result.tools.map((t) => ({ name: t.name, description: t.description })), error: null });
        else finish({ tools: [], error: `tools/list 返回错误：${m.error?.message ?? JSON.stringify(m)}` });
      }
    });
    child.stdin.on('error', () => { /* 进程已退出，exit 里报 */ });
    child.stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"bone-studio-panel","version":"1"}}}\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}\n');
  });
}

let building: Promise<{ ok: boolean; log: string }> | null = null;
function rebuild(root: string): Promise<{ ok: boolean; log: string }> {
  if (building) return building;
  building = new Promise<{ ok: boolean; log: string }>((done) => {
    let log = '';
    const child = spawn(process.execPath, [join(root, 'tools', 'build-mcp.mjs')], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false });
    child.stdout.on('data', (c: Buffer) => { log += c.toString('utf8'); });
    child.stderr.on('data', (c: Buffer) => { log += c.toString('utf8'); });
    child.on('error', (e) => done({ ok: false, log: `${log}\n${e.message}` }));
    child.on('exit', (code) => { cache = null; done({ ok: code === 0, log: log.replace(/\x1b\[[0-9;]*m/g, '').slice(-4000) }); });
  }).finally(() => { building = null; });
  return building;
}

async function buildState(root: string): Promise<{ state: string; reason?: string; sourceHash?: string; builtAt?: string }> {
  // 每次都重新 import（带 query 破缓存）；Windows 上绝对路径必须转 file:// URL
  const mod = await import(/* @vite-ignore */ `${pathToFileURL(join(root, 'tools', 'mcpBuildInfo.mjs')).href}?t=${Date.now()}`) as { buildStatus: (r: string) => never };
  return mod.buildStatus(root);
}

function projectCount(dir: string): number {
  if (!existsSync(dir)) return -1;
  try {
    const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { samples?: unknown[] };
    if (Array.isArray(m.samples)) return m.samples.length;
  } catch { /* 无 manifest：数子目录里的 *_ske.json */ }
  try { return readdirSync(dir).filter((n) => { try { return readdirSync(join(dir, n)).some((f) => f.endsWith('_ske.json')); } catch { return false; } }).length; } catch { return -1; }
}

export function mcpInfoPlugin(projectsDir: () => ProjectsDirInfo): Plugin {
  const root = resolve('.');
  const skill = join(root, 'docs', 'SKILL-bone-studio-mcp.md');
  return {
    name: 'bone-studio-mcp-info',
    configureServer(server) {
      server.middlewares.use('/api/mcp', (req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        if (url === '/rebuild' && req.method === 'POST') {
          void rebuild(root).then((r) => {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.statusCode = r.ok ? 200 : 500;
            res.end(JSON.stringify(r));
          });
          return;
        }
        if (url === '/info') {
          const serverJs = join(root, 'dist-mcp', 'server.js');
          void (async () => {
            const status = await buildState(root).catch((e: Error) => ({ state: 'unknown', reason: e.message } as { state: string; reason?: string; builtAt?: string }));
            const built = existsSync(serverJs);
            const list: ToolList = built ? await listTools(serverJs, root) : { tools: [], error: null };
            const ws = projectsDir();
            const count = projectCount(ws.dir);
            const wsHint = count < 0 ? '目录不存在：MCP 第一次 project_new / import_character 时会自动创建'
              : count === 0 ? '目录为空：agent 用 MCP 的 project_new / project_import 创建工程后会出现在欢迎页「AI 工程」和「实时预览」里（?aiproject=<名字>）'
              : null;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({
              repoRoot: root, serverPath: serverJs, built,
              buildState: status.state, buildReason: status.reason ?? null,
              builtAt: status.builtAt ?? (built ? statSync(serverJs).mtime.toISOString() : null),
              buildHint: status.state === 'ok' ? null : '需要重新构建：npm run build:mcp',
              projectsDir: ws.dir, projectsSource: ws.source, legacySamplesEnv: ws.legacySamplesEnv ?? null, aiRoute: '/aiprojects/', projectCount: Math.max(0, count), projectsHint: wsHint,
              platform: process.platform, node: process.version, execPath: process.execPath,
              skillAvailable: existsSync(skill), tools: list.tools, toolsError: list.error,
            }));
          })();
          return;
        }
        if (url === '/skill.md' || url === '/skill.zip') {
          if (!existsSync(skill)) { res.statusCode = 404; res.end('skill not found'); return; }
          const text = readFileSync(skill);
          if (url === '/skill.md') {
            res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
            res.setHeader('Content-Disposition', 'attachment; filename="SKILL.md"');
            res.end(text);
          } else {
            const zip = buildZip([{ name: 'bonestudio-mcp/SKILL.md', data: new Uint8Array(text) }]);
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', 'attachment; filename="bonestudio-mcp.zip"');
            res.end(Buffer.from(zip));
          }
          return;
        }
        if (url === '/install-ai.mjs') {
          res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
          res.end(readFileSync(join(root, 'scripts', 'install-ai.mjs')));
          return;
        }
        next();
      });
    },
  };
}
