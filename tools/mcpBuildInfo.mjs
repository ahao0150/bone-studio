// MCP 构建指纹：src 下 MCP 依赖源码（mcp/core/runtime/tools + package.json）的内容哈希。
// 用内容哈希而不是 mtime —— git checkout/pull 会重置 mtime，Windows 上尤其不可靠。纯 Node，无依赖。
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const HASH_DIRS = ['src/mcp', 'src/core', 'src/runtime', 'src/tools', 'src/plugins'];
export const HASH_FILES = ['package.json'];

function walk(dir, out) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs|json)$/.test(name)) out.push(p);
  }
}

/** 返回 { hash, newestMtimeMs, files }。路径统一用 / 并去掉 CR，Windows/Linux 同一份源码哈希一致（autocrlf 也不影响）。 */
export function sourceFingerprint(root) {
  const files = [];
  for (const d of HASH_DIRS) walk(join(root, d), files);
  for (const f of HASH_FILES) if (existsSync(join(root, f))) files.push(join(root, f));
  const h = createHash('sha1');
  let newest = 0;
  for (const f of files) {
    h.update(relative(root, f).split(sep).join('/'));
    h.update('\0');
    h.update(readFileSync(f, 'utf8').replace(/\r\n/g, '\n'));
    h.update('\0');
    newest = Math.max(newest, statSync(f).mtimeMs);
  }
  return { hash: h.digest('hex').slice(0, 16), newestMtimeMs: newest, files: files.length };
}

export function readBuildInfo(root) {
  const p = join(root, 'dist-mcp', 'build-info.json');
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

/** 构建状态：missing / stale / ok。 */
export function buildStatus(root) {
  const server = join(root, 'dist-mcp', 'server.js');
  if (!existsSync(server)) return { state: 'missing', reason: 'dist-mcp/server.js 不存在' };
  const info = readBuildInfo(root);
  const fp = sourceFingerprint(root);
  if (!info) return { state: 'stale', reason: '缺少 dist-mcp/build-info.json（旧版本构建或从 git 拉下来的产物）', sourceHash: fp.hash };
  if (info.sourceHash !== fp.hash) return { state: 'stale', reason: `源码已变化（构建 ${info.sourceHash} ≠ 当前 ${fp.hash}）`, sourceHash: fp.hash, builtAt: info.builtAt };
  return { state: 'ok', sourceHash: fp.hash, builtAt: info.builtAt };
}
