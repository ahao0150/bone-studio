// 端到端：① 欢迎页「AI 工程」与「示例」分开 ② 右键「移到最下层/最上层」真的改舞台与层级面板、可撤销
// ③ 退出观看（新标签 / 原地 / Esc），用户自己的工程不丢 ④ 持锁工程打开编辑先提示。
// 用法：dev server 在跑（npm run dev），node tools/verify-watch-draworder.mjs [url] [outDir]
import puppeteer from 'puppeteer-core';
import { join } from 'node:path';
import { startMcp } from './mcp-client.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:5178';
const out = process.argv[3] ?? '/workspace/demo-out';
const results = [];
const check = (k, v) => { results.push([k, !!v]); console.log(v ? 'PASS' : 'FAIL', k); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const newPage = async () => { const p = await browser.newPage(); await p.setViewport({ width: 1440, height: 900 }); return p; };
const clickText = async (p, sel, text) => { await p.evaluate((s, t) => [...document.querySelectorAll(s)].find((e) => e.textContent.trim().startsWith(t))?.click(), sel, text); await sleep(300); };
const bs = (p, expr) => p.evaluate(`window.__bonestudio.${expr}`);
let mcp;
try {
  // ① 欢迎页
  const home = await newPage();
  await home.goto(base, { waitUntil: 'domcontentloaded' });
  await home.waitForSelector('[data-welcome-card="ai"]', { timeout: 15000 });
  await sleep(1200);
  const ai = await home.$$eval('[data-welcome-card="ai"]', (e) => e.map((x) => x.dataset.welcomeName));
  const samples = await home.$$eval('[data-welcome-card="sample"]', (e) => e.map((x) => x.dataset.welcomeName));
  check(`welcome: AI 工程 [${ai}] separate from 示例 [${samples}]`, ai.includes('lubu_q34') && !samples.includes('lubu_q34'));
  await home.screenshot({ path: join(out, 'welcome_ai_projects.png') });

  // ② 右键层级
  await home.click('[data-welcome-card="ai"][data-welcome-name="lubu_q34"]');
  await home.waitForSelector('canvas');
  await sleep(2500);
  const box = await (await home.$('canvas')).boundingBox();
  await home.mouse.click(box.x + box.width * 0.52, box.y + box.height * 0.35, { button: 'right' });
  await sleep(400);
  const slot = await home.$eval('[data-stage-slot-menu]', (e) => e.dataset.stageSlotMenu).catch(() => null);
  check(`right-click opens slot menu (${slot})`, !!slot);
  const before = { data: await bs(home, 'slotOrder()'), stage: await home.evaluate(() => window.__bonestudioRenderer.stageOrder()) };
  await home.screenshot({ path: join(out, 'draworder_before.png') });
  await home.click('[data-stage-action="sendToBottom"]');
  await sleep(600);
  const after = { data: await bs(home, 'slotOrder()'), stage: await home.evaluate(() => window.__bonestudioRenderer.stageOrder()) };
  check(`移到最下层: data ${before.data.indexOf(slot)}→${after.data.indexOf(slot)}, stage ${before.stage.indexOf(slot)}→${after.stage.indexOf(slot)}`,
    after.data[0] === slot && after.stage[0] === slot && before.stage.indexOf(slot) > 0);
  await clickText(home, '.tabs button, [role="tab"], .tab', '层级');
  await sleep(300);
  const rows = await home.$$eval('[data-order-row]', (e) => e.map((x) => x.dataset.orderRow));
  check(`layer panel shows ${slot} at the bottom (rows ${rows.length})`, rows.length > 0 && (rows[rows.length - 1] === slot || rows[0] === slot) && rows.indexOf(slot) !== before.data.length - 1 - before.data.indexOf(slot));
  await home.screenshot({ path: join(out, 'draworder_after_bottom.png') });
  await home.mouse.click(box.x + box.width * 0.52, box.y + box.height * 0.35, { button: 'right' });
  await sleep(400);
  const slot2 = await home.$eval('[data-stage-slot-menu]', (e) => e.dataset.stageSlotMenu).catch(() => null);
  if (slot2) { await home.click('[data-stage-action="bringToFront"]'); await sleep(600); }
  const front = await home.evaluate(() => window.__bonestudioRenderer.stageOrder());
  check(`移到最上层 (${slot2}) → last on stage`, slot2 && front[front.length - 1] === slot2);
  await home.keyboard.down('Control'); await home.keyboard.press('z'); await home.keyboard.up('Control');
  await sleep(600);
  const undone = await bs(home, 'slotOrder()');
  check('Ctrl+Z undoes the last reorder', JSON.stringify(undone) === JSON.stringify(after.data));
  const myWork = await bs(home, 'slotOrder()');

  // ③a 从 AI 面板新标签观看 → 退出观看 → 关掉该标签，原标签工程不变
  await clickText(home, '.menubar .menu-item > button', 'AI');
  await clickText(home, '.menu-pop button', 'MCP 服务');
  await home.click('[data-ai-tab="live"]');
  await home.waitForSelector('[data-live-open="lubu_q34"]', { timeout: 10000 });
  const targetP = new Promise((r) => browser.once('targetcreated', r));
  await home.click('[data-live-open="lubu_q34"]');
  const target = await targetP;
  const watch = await target.page();
  await watch.setViewport({ width: 1440, height: 900 });
  await watch.waitForSelector('[data-live-exit]', { timeout: 20000 });
  await sleep(1500);
  await watch.screenshot({ path: join(out, 'watch_banner_exit.png') });
  const closed = new Promise((r) => watch.once('close', () => r(true)));
  await watch.click('[data-live-exit]');
  check('退出观看 (new tab) closes the watch tab', await Promise.race([closed, sleep(4000).then(() => false)]));
  check('original tab keeps the user\'s project + unsaved edits', JSON.stringify(await bs(home, 'slotOrder()')) === JSON.stringify(myWork));

  // ③b 直接打开观看链接 → 按钮原地退出（不重载）
  const direct = await newPage();
  await direct.goto(`${base}/?aiproject=lubu_q34&live=1&readonly=1`, { waitUntil: 'domcontentloaded' });
  await direct.waitForSelector('[data-live-exit]', { timeout: 20000 });
  await sleep(1200);
  await direct.evaluate(() => { window.__marker = 7; });
  await direct.click('[data-live-exit]');
  await sleep(800);
  const st = await direct.evaluate(() => ({ url: location.search, marker: window.__marker, welcome: !!document.querySelector('[data-welcome]'), banner: !!document.querySelector('[data-readonly-banner]'), ro: document.documentElement.classList.contains('bs-readonly') }));
  check(`in-place exit: url "${st.url}", welcome ${st.welcome}, no reload ${st.marker === 7}`, st.url === '' && st.welcome && !st.banner && !st.ro && st.marker === 7);
  await direct.screenshot({ path: join(out, 'watch_exit_inplace.png') });
  // 退出后恢复编辑：打开工程，右键菜单可用（只读时右键被拦）
  await direct.click('[data-welcome-card="ai"][data-welcome-name="lubu_q34"]');
  await direct.waitForSelector('canvas'); await sleep(2000);
  const b2 = await (await direct.$('canvas')).boundingBox();
  await direct.mouse.click(b2.x + b2.width * 0.52, b2.y + b2.height * 0.35, { button: 'right' });
  await sleep(400);
  check('editing restored after exit (slot context menu works)', !!(await direct.$('[data-stage-slot-menu]')));
  // ③c Esc
  await direct.goto(`${base}/?aiproject=lubu_q34&live=1&readonly=1`, { waitUntil: 'domcontentloaded' });
  await direct.waitForSelector('[data-live-exit]', { timeout: 20000 });
  await sleep(1000);
  await direct.keyboard.press('Escape');
  await sleep(800);
  check('Esc exits watching', await direct.evaluate(() => !document.querySelector('[data-readonly-banner]') && location.search === ''));

  // ④ 持锁：agent 锁住 lubu_q34 → 欢迎页打开编辑先提示
  mcp = startMcp({});
  await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'cursor', version: '1' } });
  await mcp.call('session_set', { name: 'Cursor·锁测试' });
  await mcp.call('project_open', { name: 'lubu_q34' });
  await mcp.call('project_save', {});
  await sleep(500);
  await direct.goto(base, { waitUntil: 'domcontentloaded' });
  await direct.waitForSelector('[data-welcome-card="ai"]');
  await sleep(1500);
  await direct.click('[data-welcome-card="ai"][data-welcome-name="lubu_q34"]');
  await direct.waitForSelector('[data-ai-lock-prompt]', { timeout: 5000 }).catch(() => undefined);
  const prompt = await direct.$eval('[data-ai-lock-prompt] .confirm-message', (e) => e.textContent).catch(() => '');
  check(`lock prompt: "${prompt.slice(0, 40)}…"`, prompt.includes('Cursor·锁测试'));
  await direct.screenshot({ path: join(out, 'ai_lock_prompt.png') });
  const t2 = new Promise((r) => browser.once('targetcreated', r));
  await direct.click('[data-ai-lock-watch]');
  const w2 = await (await t2).page();
  await w2.waitForSelector('[data-readonly-banner]', { timeout: 20000 });
  check('lock prompt → 只读观看 opens a read-only tab', (await w2.evaluate(() => location.search)).includes('readonly=1'));
} finally {
  mcp?.close();
  await browser.close();
}
const failed = results.filter(([, v]) => !v);
console.log(failed.length ? `FAILED ${failed.length}` : 'ALL PASS');
process.exit(failed.length ? 1 : 0);
