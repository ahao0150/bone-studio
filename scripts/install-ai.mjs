#!/usr/bin/env node
/**
 * 一键接入：构建 MCP server、安装 Skill、注册 MCP、自检。
 * One-click install of the BoneStudio MCP server + skill into an AI coding agent.
 *
 *   npm run install:ai -- --client cursor|claude|codex [--global] [--dry-run] [--skip-build] [--home <dir>]
 *
 *   cursor : skill → <repo>/.cursor/skills/bonestudio-mcp/SKILL.md（--global: ~/.cursor/skills/…）
 *            mcp   → <repo>/.cursor/mcp.json（--global: ~/.cursor/mcp.json），合并已有配置
 *   claude : skill → ~/.claude/skills/bonestudio-mcp/SKILL.md
 *            mcp   → `claude mcp add -s user …`（找不到 claude CLI 时写 <repo>/.mcp.json）
 *   codex  : skill → ~/.codex/skills/bonestudio-mcp/SKILL.md
 *            mcp   → ~/.codex/config.toml 里的 [mcp_servers.bone-studio]
 * 最后起一次 server，调用 project_list 与 skeleton_summary 验证。
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const client = opt('client', '');
const global = flag('global');
const dry = flag('dry-run');
const home = resolve(opt('home', homedir()));
if (!['cursor', 'claude', 'codex'].includes(client)) {
  console.error('用法: npm run install:ai -- --client cursor|claude|codex [--global] [--dry-run] [--skip-build] [--home <dir>]');
  process.exit(2);
}

const server = join(repo, 'dist-mcp', 'server.js');
const projects = join(repo, 'projects');
const skillSrc = join(repo, 'docs', 'SKILL-bone-studio-mcp.md');
const log = (...a) => console.log('[install-ai]', ...a);
const write = (file, text) => { log(dry ? '(dry-run) 将写入' : '写入', file); if (!dry) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); } };

// 1. 构建
// 缺失或过期（源码哈希对不上）都重建；直接用 process.execPath 跑构建脚本，不经 npm.cmd / shell
if (!flag('skip-build')) {
  log('检查 dist-mcp 构建（缺失/过期则 build）');
  if (!dry) execFileSync(process.execPath, [join(repo, 'tools', 'build-mcp.mjs'), '--if-stale'], { cwd: repo, stdio: 'inherit' });
}

// 2. Skill
const skillDir = client === 'cursor'
  ? join(global ? join(home, '.cursor') : join(repo, '.cursor'), 'skills', 'bonestudio-mcp')
  : join(home, client === 'claude' ? '.claude' : '.codex', 'skills', 'bonestudio-mcp');
log(dry ? '(dry-run) 将复制 skill →' : '复制 skill →', join(skillDir, 'SKILL.md'));
if (!dry) { mkdirSync(skillDir, { recursive: true }); copyFileSync(skillSrc, join(skillDir, 'SKILL.md')); }

// 3. 注册 MCP
const entry = { command: 'node', args: [server], env: { BONESTUDIO_PROJECTS: projects } };
function mergeJson(file, useWorkspaceVar = false) {
  let data = {};
  if (existsSync(file)) { try { data = JSON.parse(readFileSync(file, 'utf8')); } catch { log('警告: 无法解析', file, '，将覆盖 mcpServers.bone-studio'); } }
  data.mcpServers = data.mcpServers ?? {};
  data.mcpServers['bone-studio'] = useWorkspaceVar
    ? { command: 'node', args: ['${workspaceFolder}/dist-mcp/server.js'], env: { BONESTUDIO_PROJECTS: '${workspaceFolder}/projects' } }
    : entry;
  write(file, JSON.stringify(data, null, 2) + '\n');
}
if (client === 'cursor') {
  mergeJson(global ? join(home, '.cursor', 'mcp.json') : join(repo, '.cursor', 'mcp.json'), !global);
} else if (client === 'claude') {
  const probe = spawnSync('claude', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' });
  if (probe.status === 0 && !dry) {
    spawnSync('claude', ['mcp', 'remove', 'bone-studio', '-s', 'user'], { stdio: 'ignore', shell: process.platform === 'win32' });
    const r = spawnSync('claude', ['mcp', 'add', 'bone-studio', '-s', 'user', '-e', `BONESTUDIO_PROJECTS=${projects}`, '--', 'node', server], { stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.status !== 0) { log('claude mcp add 失败，改写 .mcp.json'); mergeJson(join(repo, '.mcp.json')); }
  } else {
    log(probe.status === 0 ? '(dry-run) 将执行 claude mcp add …' : '没找到 claude CLI → 写项目级 .mcp.json');
    mergeJson(join(repo, '.mcp.json'));
  }
} else {
  const file = join(home, '.codex', 'config.toml');
  const old = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const q = (s) => JSON.stringify(s);
  const block = `[mcp_servers.bone-studio]\ncommand = "node"\nargs = [${q(server)}]\n\n[mcp_servers.bone-studio.env]\nBONESTUDIO_PROJECTS = ${q(projects)}\n`;
  const stripped = old.replace(/\[mcp_servers\.bone-studio(\.env)?\][\s\S]*?(?=\n\[(?!mcp_servers\.bone-studio)|$)/g, '').trimEnd();
  write(file, (stripped ? stripped + '\n\n' : '') + block);
}

// 4. 自检
if (dry || !existsSync(server)) { log(dry ? '(dry-run) 跳过自检' : '未构建，跳过自检'); process.exit(0); }
const child = spawn(process.execPath, [server], { env: { ...process.env, BONESTUDIO_PROJECTS: projects }, stdio: ['pipe', 'pipe', 'inherit'] });
let buf = '';
const results = {};
const timer = setTimeout(() => { console.error('[install-ai] 自检超时'); child.kill(); process.exit(1); }, 15000);
child.stdout.on('data', (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    const msg = JSON.parse(line);
    results[msg.id] = msg.result;
    if (results[2] && results[3] && results[4]) {
      clearTimeout(timer); child.kill();
      const list = JSON.parse(results[3].content[0].text);
      log(`自检通过：${results[2].tools.length} 个工具；project_list → ${list.projects.length} 个工程（${list.dir}）`);
      log(`skeleton_summary（未打开工程时应报错）：${results[4].isError ? results[4].content[0].text : 'ok'}`);
      log('完成。重启 / 刷新你的 agent 让它加载 bone-studio MCP 与 bonestudio-mcp skill。');
      process.exit(0);
    }
  }
});
const send = (id, method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
send(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'install-ai', version: '1' } });
send(2, 'tools/list', {});
send(3, 'tools/call', { name: 'project_list', arguments: {} });
send(4, 'tools/call', { name: 'skeleton_summary', arguments: {} });
