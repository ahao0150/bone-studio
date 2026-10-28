// 端到端：持锁 AI 工程 → 提示框「基于它新建」→ 副本落盘为 projects/ 里的独立新工程，原工程文件与锁不变。
// 用法：dev server 在跑，node tools/verify-ai-new-copy.mjs [url] [outDir]
import puppeteer from 'puppeteer-core';
import { join } from 'node:path';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { startMcp } from './mcp-client.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:5178';
const out = process.argv[3] ?? '/workspace/demo-out';
const results = [];
const check = (k, v) => { results.push([k, !!v]); console.log(v ? 'PASS' : 'FAIL', k); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ske = 'projects/lubu_q34/lubu_q34_ske.json';
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
let mcp;
try {
  mcp = startMcp({});
  await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'cursor', version: '1' } });
  await mcp.call('session_set', { name: 'Cursor·新建测试' });
  await mcp.call('project_open', { name: 'lubu_q34' });
  await mcp.call('project_save', {});
  await sleep(500);
  const before = { text: readFileSync(ske, 'utf8'), mtime: statSync(ske).mtimeMs };
  const lockBefore = (await (await fetch(`${base}/api/agents`)).json()).projects.find((p) => p.name === 'lubu_q34')?.lockedBy?.sessionId;
  const p = await browser.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  await p.goto(base, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('[data-welcome-card="ai"]', { timeout: 15000 });
  await sleep(1500);
  check('welcome AI card has 基于它新建', !!(await p.$('[data-welcome-ai-new="lubu_q34"]')));
  await p.click('[data-welcome-card="ai"][data-welcome-name="lubu_q34"]');
  await p.waitForSelector('[data-ai-lock-new]', { timeout: 5000 });
  check('lock prompt has 基于它新建', (await p.$eval('[data-ai-lock-new] .ailock-opt-label', (e) => e.textContent)) === '基于它新建');
  await p.screenshot({ path: join(out, 'ai_lock_new.png') });
  await (await p.$('.ailock-panel')).screenshot({ path: join(out, 'ai_lock_dialog_v2.png') });
  await (await p.$('[data-welcome-card="ai"]')).screenshot({ path: join(out, 'ai_card_new_v2.png') });
  await p.setViewport({ width: 420, height: 800 }); await sleep(300);
  await p.screenshot({ path: join(out, 'ai_lock_dialog_v2_narrow.png') });
  await p.setViewport({ width: 1280, height: 800 }); await sleep(300);
  await p.screenshot({ path: join(out, 'ai_lock_dialog_v2_1280.png') });
  let promptDefault = '';
  p.once('dialog', async (d) => { promptDefault = d.defaultValue(); await d.accept('lubu_q34-copy-test'); });
  await p.click('[data-ai-lock-new]');
  await p.waitForSelector('canvas', { timeout: 15000 });
  await sleep(2500);
  check(`prompt default "${promptDefault}"`, promptDefault === 'lubu_q34-copy');
  const anims = await p.evaluate('window.__bonestudio?.player?.()?.animationNames?.() ?? null').catch(() => null);
  const tabText = await p.evaluate(() => document.body.innerText.includes('lubu_q34-copy-test'));
  check('new doc named lubu_q34-copy-test is open', tabText);
  check('new project saved to projects/', existsSync('projects/lubu_q34-copy-test/lubu_q34-copy-test_ske.json'));
  check('editable (no readonly banner)', !(await p.$('[data-readonly-banner]')));
  await p.screenshot({ path: join(out, 'ai_lock_new_opened.png') });
  const after = { text: readFileSync(ske, 'utf8'), mtime: statSync(ske).mtimeMs };
  check('agent workspace file untouched', after.text === before.text && after.mtime === before.mtime);
  const lockAfter = (await (await fetch(`${base}/api/agents`)).json()).projects.find((x) => x.name === 'lubu_q34')?.lockedBy?.sessionId;
  check('agent lock unchanged', lockBefore && lockAfter === lockBefore);
  void anims;
} finally {
  mcp?.close();
  await browser.close();
}
const failed = results.filter(([, v]) => !v);
console.log(failed.length ? `${failed.length} FAILED` : 'ALL PASS');
process.exit(failed.length ? 1 : 0);
