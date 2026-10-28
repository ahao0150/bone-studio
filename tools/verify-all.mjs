/**
 * 门禁总控（2026-10-13）：把 `npm run verify` 从 `&&` 链改成分步汇总。
 *
 * 动机：`&&` 链在 `verify:dist` 处中断 —— 而 `verify:dist` 有一个已知环境红
 * （骨架工程 `.tl-track-head` 行数为 0，见 AGENTS.md），于是 `verify:closure`
 * 在链里永远跑不到。单跑 `npm run verify` 拿不到闭包判据，等于门禁有盲区。
 *
 * 行为：
 *   - 顺序跑完全部步骤（不因前一步失败而提前退出），各自继承 stdio 实时输出；
 *   - 依赖 `build` 的步骤在 `build` 失败时标记 SKIP（不拿过期 dist 报假绿）；
 *   - 末尾打印汇总表；任一步骤非零退出 → 退出码 1，全绿 → 0。
 *
 * 已知环境红（显式、可审计，**默认关闭**，绝不默认豁免）：
 *   VERIFY_KNOWN_RED="verify:dist" npm run verify
 *   被点名的步骤记为 KNOWN-RED，不计入失败聚合，但会在汇总里单列出来。
 *
 * 覆盖步骤表与依赖（用于自测本脚本能否区分对错）：
 *   VERIFY_STEPS="ok=node -e \"process.exit(0)\",bad=node -e \"process.exit(3)\""
 *   VERIFY_NEEDS="verify:dist=build+foo"      # 逗号分隔的 name=dep1+dep2
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

const DEFAULT_STEPS = [
  { name: 'test', cmd: 'npm test' },
  { name: 'build', cmd: 'npm run build' },
  { name: 'build:mcp', cmd: 'npm run build:mcp' },
  { name: 'verify:budget', cmd: 'npm run verify:budget', needs: ['build'] },
  { name: 'verify:dist', cmd: 'npm run verify:dist', needs: ['build'] },
  { name: 'verify:closure', cmd: 'npm run verify:closure' },
];

const parseSteps = (raw) => raw.split(',').map((chunk) => {
  const at = chunk.indexOf('=');
  if (at < 0) throw new Error(`VERIFY_STEPS 项缺少 '='：${chunk}`);
  return { name: chunk.slice(0, at).trim(), cmd: chunk.slice(at + 1).trim() };
}).filter((step) => step.name && step.cmd);

const steps = process.env.VERIFY_STEPS ? parseSteps(process.env.VERIFY_STEPS) : DEFAULT_STEPS;
const knownRed = new Set(
  (process.env.VERIFY_KNOWN_RED ?? '').split(',').map((s) => s.trim()).filter(Boolean),
);
// 允许外部覆盖依赖（自测用）：VERIFY_NEEDS="verify:dist=build+foo"
for (const pair of (process.env.VERIFY_NEEDS ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
  const at = pair.indexOf('=');
  if (at < 0) throw new Error(`VERIFY_NEEDS 项缺少 '='：${pair}`);
  const name = pair.slice(0, at).trim();
  const deps = pair.slice(at + 1).split('+').map((s) => s.trim()).filter(Boolean);
  const target = steps.find((step) => step.name === name);
  if (!target) throw new Error(`VERIFY_NEEDS 指向未知步骤：${name}`);
  target.needs = deps;
}

console.log(`verify 总控：${steps.length} 个步骤${knownRed.size ? `（显式豁免: ${[...knownRed].join(', ')}）` : ''}`);

const results = [];
const failed = new Set();
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;

for (let i = 0; i < steps.length; i += 1) {
  const step = steps[i];
  const blockedBy = (step.needs ?? []).filter((dep) => failed.has(dep));
  if (blockedBy.length > 0) {
    console.log(`\n>>> [${i + 1}/${steps.length}] SKIP ${step.name} —— 依赖失败: ${blockedBy.join(', ')}`);
    results.push({ ...step, status: 'SKIP', code: null, ms: 0, note: `依赖失败: ${blockedBy.join(', ')}` });
    continue;
  }
  console.log(`\n>>> [${i + 1}/${steps.length}] ${step.name} :: ${step.cmd}`);
  const startedAt = Date.now();
  const out = spawnSync(step.cmd, { cwd: ROOT, shell: true, stdio: 'inherit' });
  const ms = Date.now() - startedAt;
  const code = out.status ?? 1;
  if (code !== 0) failed.add(step.name);
  const status = code === 0 ? 'PASS' : (knownRed.has(step.name) ? 'KNOWN-RED' : 'FAIL');
  results.push({ ...step, status, code, ms });
  console.log(`<<< [${i + 1}/${steps.length}] ${step.name} -> ${status} (exit ${code}, ${secs(ms)})`);
}

console.log('\n=== verify 汇总 ===');
for (const r of results) {
  const code = r.code === null ? '-' : String(r.code);
  console.log(`  ${r.status.padEnd(9)} ${r.name.padEnd(14)} ${code.padStart(3)}  ${secs(r.ms).padStart(8)}${r.note ? `  (${r.note})` : ''}`);
}

const hardFails = results.filter((r) => r.status === 'FAIL');
const knownReds = results.filter((r) => r.status === 'KNOWN-RED');
const skips = results.filter((r) => r.status === 'SKIP');
if (knownReds.length > 0) console.log(`known-red（显式豁免，不计入退出码）: ${knownReds.map((r) => r.name).join(', ')}`);
if (skips.length > 0) console.log(`skip（依赖失败，未运行）: ${skips.map((r) => r.name).join(', ')}`);

if (hardFails.length > 0) {
  console.log(`\n=> FAIL: ${hardFails.length} 个步骤非零退出 (${hardFails.map((r) => r.name).join(', ')})`);
  process.exit(1);
}
console.log('\n=> OK: 全部步骤通过');
process.exit(0);
