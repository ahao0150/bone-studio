// 构建 MCP server（dist-mcp/server.js）并写 build-info.json。
//   node tools/build-mcp.mjs            总是构建
//   node tools/build-mcp.mjs --if-stale 仅在缺失/过期时构建（predev 用）
// 用 process.execPath 直接跑 vite 的 JS 入口：不经过 shell / npx / .cmd，Windows 路径带空格也没问题。
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStatus, sourceFingerprint } from './mcpBuildInfo.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ifStale = process.argv.includes('--if-stale');
const status = buildStatus(root);
if (ifStale && status.state === 'ok') { console.log(`[build-mcp] up to date (${status.sourceHash})`); process.exit(0); }
console.log(`[build-mcp] building: ${status.state}${status.reason ? ` — ${status.reason}` : ''}`);
const require = createRequire(join(root, 'package.json'));
const viteBin = join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
const r = spawnSync(process.execPath, [viteBin, 'build', '--ssr', 'src/mcp/server.ts', '--outDir', 'dist-mcp', '--emptyOutDir'], { cwd: root, stdio: 'inherit' });
if (r.status !== 0) { console.error(`[build-mcp] vite build failed (${r.status ?? r.error?.message})`); process.exit(r.status || 1); }
const fp = sourceFingerprint(root);
mkdirSync(join(root, 'dist-mcp'), { recursive: true });
writeFileSync(join(root, 'dist-mcp', 'build-info.json'), JSON.stringify({ sourceHash: fp.hash, builtAt: new Date().toISOString(), node: process.version, platform: process.platform }, null, 2) + '\n');
console.log(`[build-mcp] done (${fp.hash})`);
