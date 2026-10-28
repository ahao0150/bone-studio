/**
 * 验收矩阵报告器（docs/ACCEPTANCE.md）。
 *
 * 做三件事：
 *   1. 解析矩阵表格，按 P0/P1/P2 统计 ✅ / ⚠️ / ❌ 与覆盖率（⚠️ 计 0.5）；
 *   2. 校验清单本身的自洽性（ID 唯一、优先级与现状取值合法、证据非空）；
 *   3. 校验证据列里引用的每个工程内路径**真实存在**，防止清单腐烂。
 *
 * 退出码：清单本身有问题（ID 重复 / 取值非法 / 证据路径不存在）→ 1；
 * 否则 0 —— 未达 DoD 是当前事实，由输出告知，不当作脚本错误。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** 一次性调试脚本放在仓库根的 work/ 下（不在工程内），见 AGENTS.md */
const REPO = resolve(ROOT, '..', '..');
const DOC = join(ROOT, 'docs', 'ACCEPTANCE.md');
const VALID_STATUS = new Set(['✅', '⚠️', '❌']);
const PATH_RE = /`((?:src|tests|tools|docs|work)\/[^`]+?)`/g;

const lines = readFileSync(DOC, 'utf8').split(/\r?\n/);
let section = null;
const rows = [];
const problems = [];

for (const line of lines) {
  const head = /^##\s+(P[012])\b/.exec(line);
  if (head) { section = head[1]; continue; }
  if (!line.startsWith('|')) continue;
  const cells = line.split('|').slice(1, -1).map((c) => c.trim());
  if (cells.length !== 5) continue;
  const [id, feature, entry, status, evidence] = cells;
  if (id === 'ID' || /^-+$/.test(id)) continue;
  if (!/^[A-Z]+-\d+$/.test(id)) continue;
  if (!section) problems.push(`${id}: 不在 P0/P1/P2 小节内`);
  if (!VALID_STATUS.has(status)) problems.push(`${id}: 现状取值非法 "${status}"`);
  if (!evidence) problems.push(`${id}: 证据为空`);
  rows.push({ id, feature, entry, status, priority: section, evidence });
}

const seen = new Set();
for (const r of rows) {
  if (seen.has(r.id)) problems.push(`${r.id}: ID 重复`);
  seen.add(r.id);
}

// 证据列里的工程内路径必须存在
const missing = new Set();
for (const r of rows) {
  PATH_RE.lastIndex = 0;
  let m;
  while ((m = PATH_RE.exec(r.evidence))) {
    const rel = m[1].replace(/[，、,。;；].*$/, '').trim();
    const base = rel.startsWith('work/') ? REPO : ROOT;
    if (!existsSync(join(base, rel))) missing.add(`${r.id} -> ${rel}`);
  }
}

const score = (status) => (status === '✅' ? 1 : status === '⚠️' ? 0.5 : 0);
const byPriority = new Map();
for (const r of rows) {
  if (!byPriority.has(r.priority)) byPriority.set(r.priority, []);
  byPriority.get(r.priority).push(r);
}

console.log(`验收矩阵: ${rows.length} 条（docs/ACCEPTANCE.md）`);
const summary = {};
for (const priority of ['P0', 'P1', 'P2']) {
  const list = byPriority.get(priority) ?? [];
  const done = list.filter((r) => r.status === '✅').length;
  const partial = list.filter((r) => r.status === '⚠️').length;
  const todo = list.filter((r) => r.status === '❌').length;
  const rate = list.length ? Math.round((list.reduce((s, r) => s + score(r.status), 0) / list.length) * 100) : 0;
  summary[priority] = { total: list.length, done, partial, todo, rate };
  console.log(`  ${priority}: ${String(list.length).padStart(3)} 条 | ✅ ${String(done).padStart(3)} | ⚠️ ${String(partial).padStart(2)} | ❌ ${String(todo).padStart(3)} | 覆盖率 ${rate}%`);
}
if (summary.P2) console.log('  （P2 为范围外，不计入 DoD 分母）');

console.log('');
console.log(`M6 DoD: P0 需 100%（当前 ${summary.P0?.rate ?? 0}%）${summary.P0?.rate === 100 ? ' ✅' : ' → 未达成'}`);
console.log(`        P1 需 ≥90%（当前 ${summary.P1?.rate ?? 0}%）${(summary.P1?.rate ?? 0) >= 90 ? ' ✅' : ' → 未达成'}`);
const p0Left = (byPriority.get('P0') ?? []).filter((r) => r.status !== '✅');
console.log(`        P0 待完成 ${p0Left.length} 条：${p0Left.slice(0, 12).map((r) => r.id).join(' ')}${p0Left.length > 12 ? ' …' : ''}`);

if (missing.size) {
  console.log('');
  console.log(`证据路径缺失 ${missing.size} 处：`);
  for (const m of [...missing].slice(0, 20)) console.log('  ' + m);
}
if (problems.length) {
  console.log('');
  console.log(`清单自洽性问题 ${problems.length} 处：`);
  for (const p of problems.slice(0, 20)) console.log('  ' + p);
}

const failed = problems.length > 0 || missing.size > 0;
if (failed) process.exit(1);
console.log('');
console.log('清单自洽性: OK（ID 唯一、取值合法、证据路径全部存在）');
