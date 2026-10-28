/**
 * 首屏体积预算（M6）：拆包之后给产物定一条可复跑的线。
 *
 * 判据（2026-10-12 实测：入口 332 kB / gzip 109.5 kB）：
 *   - 入口 chunk（`dist/assets/index-*.js`）原始 ≤ 400 kB、gzip ≤ 130 kB；
 *   - 全部 JS 原始合计 ≤ 1.2 MB（含 pixi / react 两个独立 chunk）。
 * 超线就抛错并打印每一项，方便定位是哪次改动把产物撑大了。
 */
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ASSETS = join(ROOT, 'dist', 'assets');
const ENTRY_RAW = 400 * 1024;
const ENTRY_GZIP = 130 * 1024;
const TOTAL_RAW = 1200 * 1024;

const files = readdirSync(ASSETS).filter((name) => name.endsWith('.js'));
const sizes = files.map((name) => {
  const path = join(ASSETS, name);
  const bytes = readFileSync(path);
  return { name, raw: statSync(path).size, gzip: gzipSync(bytes).length };
}).sort((a, b) => b.raw - a.raw);

const entry = sizes.find((entry) => entry.name.startsWith('index-'));
if (!entry) {
  console.error('no entry chunk (dist/assets/index-*.js) found — run `npm run build` first');
  process.exit(2);
}
// 按需加载的 Spine 导入器（`await import()` 才会拉取）不算首屏：单列记录，其余照常合计
const DEFERRED_PREFIXES = ['spine-core-', 'spineFileImport-'];
const deferred = sizes.filter((item) => DEFERRED_PREFIXES.some((prefix) => item.name.startsWith(prefix)));
const deferredRaw = deferred.reduce((sum, item) => sum + item.raw, 0);
const total = sizes.filter((item) => !deferred.includes(item)).reduce((sum, item) => sum + item.raw, 0);
const problems = [];
if (entry.raw > ENTRY_RAW) problems.push(`入口 chunk 原始 ${entry.raw} B > 预算 ${ENTRY_RAW} B`);
if (entry.gzip > ENTRY_GZIP) problems.push(`入口 chunk gzip ${entry.gzip} B > 预算 ${ENTRY_GZIP} B`);
if (total > TOTAL_RAW) problems.push(`JS 合计 ${total} B > 预算 ${TOTAL_RAW} B`);

const evidence = {
  capturedAt: new Date().toISOString(),
  budget: { entryRaw: ENTRY_RAW, entryGzip: ENTRY_GZIP, totalRaw: TOTAL_RAW },
  entry,
  total,
  deferredRaw,
  chunks: sizes,
  ok: problems.length === 0,
  problems,
};
mkdirSync(join(ROOT, 'docs', 'evidence'), { recursive: true });
writeFileSync(join(ROOT, 'docs', 'evidence', 'bundle-budget.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ entry: `${entry.raw} B (gzip ${entry.gzip} B)`, total, ok: evidence.ok, chunks: sizes.length }, null, 1));
if (problems.length > 0) {
  for (const problem of problems) console.error('FAIL:', problem);
  process.exit(1);
}