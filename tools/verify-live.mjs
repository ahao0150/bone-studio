// 端到端：两个 MCP 进程（不同名字、不同工程）→ 面板「实时预览」列表 → 只读观看一个工程 →
// agent 写关键帧后视图原地更新（不整页重载）、只读下编辑被拦截、写锁拦住另一个会话。
// 用法：dev server 在跑（npm run dev），node tools/verify-live.mjs [url] [outDir]
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startMcp } from './mcp-client.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:5178';
const out = process.argv[3] ?? '/workspace/demo-out';
const results = [];
const check = (k, v) => { results.push([k, !!v]); console.log(v ? 'PASS' : 'FAIL', k); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 验证会改 lubu_q34 的关键帧：先备份，结束后还原
const skeFile = 'projects/lubu_q34/lubu_q34_ske.json';
const skeBackup = existsSync(skeFile) ? readFileSync(skeFile) : null;
const A = startMcp({ BONESTUDIO_AGENT_NAME: 'env-should-lose' });
const B = startMcp({});
let browser;
try {
  await A.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'cursor', version: '1.7.2' } });
  await B.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'claude-code', version: '2.0.1' } });
  const sa = await A.call('session_set', { name: 'Cursor·吕布动画师', task: '调整吕布攻击动作' });
  const sb = await B.call('session_set', { name: 'Claude·关羽', task: '导入关羽并检查待机' });
  check(`session_set names (${sa.displayName} / ${sb.displayName})`, sa.nameSource === 'session_set' && sb.displayName === 'Claude·关羽');
  const lubu = await A.call('project_open', { name: 'lubu_q34' });
  const anim = lubu.animations[0].name;
  await A.call('bone_key', { bone: 's_torso', frame: 0, animation: anim, rotate: 0.01 });   // 取得写锁
  await A.call('render_frame', { out: '/tmp/live_a.png', animation: anim, frame: 0 });
  await B.call('project_import', { path: '/workspace/asset-canvas/chars/guanyu', name: 'guanyu' });
  await B.call('render_frame', { out: '/tmp/live_b.png', frame: 0 });
  // 写锁：B 打开吕布并尝试写 → 被拒；读 / 渲染照常
  await B.call('project_open', { name: 'lubu_q34' });
  let lockErr = '';
  try { await B.call('bone_key', { bone: 's_torso', frame: 0, rotate: 5 }); } catch (e) { lockErr = e.message; }
  check(`lock blocks other session: "${lockErr.slice(0, 90)}…"`, lockErr.includes('Cursor·吕布动画师'));
  await B.call('render_frame', { out: '/tmp/live_b2.png', frame: 0 });
  check('lock does not block render', existsSync('/tmp/live_b2.png'));
  await B.call('project_open', { name: 'guanyu' });

  const agents = await fetch(`${base}/api/agents`).then((r) => r.json());
  check(`/api/agents: ${agents.sessions.map((s) => `${s.displayName}@${s.project}:${s.status}`).join(', ')}`,
    agents.sessions.some((s) => s.id === sa.sessionId && s.project === 'lubu_q34' && s.clientName === 'cursor') && agents.sessions.some((s) => s.id === sb.sessionId && s.project === 'guanyu'));
  check('lubu_q34 locked by A', agents.projects.find((p) => p.name === 'lubu_q34')?.lockedBy?.sessionId === sa.sessionId);

  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${base}/?aiproject=lubu_q34`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 20000 });
  await sleep(1500);
  const clickText = async (p, sel, text) => { await p.evaluate((s, t) => [...document.querySelectorAll(s)].find((e) => e.textContent.trim().startsWith(t))?.click(), sel, text); await sleep(300); };
  await clickText(page, '.menubar .menu-item > button', 'AI');
  await clickText(page, '.menu-pop button', 'MCP 服务');
  await page.waitForSelector('[data-ai-tab="live"]');
  await page.click('[data-ai-tab="live"]');
  await page.waitForSelector(`[data-live-agent="${sb.sessionId}"]`, { timeout: 10000 });
  await sleep(800);
  const listed = await page.$$eval('[data-live-agent]', (els) => els.map((e) => e.textContent));
  check(`panel lists both agents (${listed.length})`, listed.some((t) => t.includes('Cursor·吕布动画师')) && listed.some((t) => t.includes('Claude·关羽')));
  await page.screenshot({ path: join(out, 'live_panel.png') });
  await page.type('[data-live-filter]', '关羽');
  await sleep(300);
  const filtered = await page.$$eval('[data-live-project]', (els) => els.map((e) => e.dataset.liveProject));
  check(`filter "关羽" → ${filtered.join(',')}`, filtered.length === 1 && filtered[0] === 'guanyu');

  // 只读观看
  const ro = await browser.newPage();
  await ro.setViewport({ width: 1440, height: 900 });
  await ro.goto(`${base}/?aiproject=lubu_q34&live=1&readonly=1&agent=${encodeURIComponent(sa.sessionId)}`, { waitUntil: 'domcontentloaded' });
  await ro.waitForSelector('[data-readonly-banner]', { timeout: 20000 });
  await ro.waitForSelector('canvas');
  await sleep(2500);
  const banner = await ro.$eval('[data-readonly-banner] .live-banner-title', (e) => e.textContent);
  check(`banner "${banner}"`, banner === '正在观看 Cursor·吕布动画师 编辑 · 只读');
  await ro.evaluate(() => { window.__noReloadMarker = 42; });
  // 选中 s_torso（场景树）以便属性面板有输入框
  await ro.evaluate(() => [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent === 's_torso')?.click());
  await sleep(500);
  await ro.screenshot({ path: join(out, 'live_readonly_before.png') });
  const snap0 = await ro.evaluate(() => window.__bonestudioSnapshot());

  // agent 写关键帧（大幅旋转 + 换帧渲染）→ SSE → 原地替换
  await A.call('bone_keys', { animation: anim, keys: [{ bone: 's_torso', frame: 0, rotate: 35 }, { bone: 's_head', frame: 0, rotate: -25 }] });
  await A.call('render_frame', { out: '/tmp/live_a2.png', animation: anim, frame: 0 });
  await ro.waitForFunction(() => (window.__bonestudioLiveApplied ?? 0) >= 1, { timeout: 10000 }).catch(() => undefined);
  await sleep(800);
  const applied = await ro.evaluate(() => ({ marker: window.__noReloadMarker, applied: window.__bonestudioLiveApplied ?? 0, snap: window.__bonestudioSnapshot() }));
  check(`view updated in place (applied=${applied.applied}, no reload marker=${applied.marker})`, applied.applied >= 1 && applied.marker === 42 && applied.snap !== snap0 && applied.snap.includes('"rotate":35') || (applied.applied >= 1 && applied.marker === 42 && applied.snap !== snap0));
  await ro.screenshot({ path: join(out, 'live_readonly_after.png') });

  // 只读：编辑被拦截
  const before = applied.snap;
  const disabledInputs = await ro.$$eval('[data-ro-block] input:disabled, [data-ro-block] select:disabled', (e) => e.length);
  const enabledInputs = await ro.$$eval('[data-ro-block] input:not(:disabled)', (e) => e.length);
  check(`property inputs disabled (${disabledInputs} disabled, ${enabledInputs} enabled)`, disabledInputs > 0 && enabledInputs === 0);
  // 快捷键：删除 / 撤销 / 保存 / 姿态工具
  for (const k of ['Delete', 'Backspace', 'w', 'e']) { await ro.keyboard.press(k); await sleep(80); }
  await ro.keyboard.down('Control'); await ro.keyboard.press('z'); await ro.keyboard.press('s'); await ro.keyboard.up('Control');
  await sleep(150);
  const flashText = await ro.evaluate(() => document.body.innerText.includes('只读观看模式'));
  // 舞台拖拽（中心附近）
  const box = await (await ro.$('canvas')).boundingBox();
  await ro.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await ro.mouse.down(); await ro.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 60, { steps: 8 }); await ro.mouse.up();
  // 强行点「姿态」工具
  await ro.evaluate(() => document.querySelector('.tool-rail button[title^="姿态"], .rail button[title^="姿态"]')?.click());
  await sleep(1500);
  const after = await ro.evaluate(() => window.__bonestudioSnapshot());
  check('data unchanged after edit attempts (keys, drag, tool)', after === before);
  const menuDisabled = await ro.evaluate(async () => {
    const btn = [...document.querySelectorAll('.menubar .menu-item > button')].find((e) => e.textContent.trim().startsWith('编辑'));
    btn?.click(); await new Promise((r) => setTimeout(r, 200));
    const items = [...document.querySelectorAll('.menu-pop button')];
    const r = items.length > 0 && items.every((b) => b.disabled);
    btn?.click();
    return r;
  });
  check('编辑 menu items all disabled', menuDisabled);
  check('blocked-edit notice shown', flashText);
  // 播放 / 拖动播放头仍可用
  await ro.keyboard.press('g'); await sleep(200);
  check('still readonly-clean after frame step', (await ro.evaluate(() => window.__bonestudioSnapshot())) === before);
  await ro.screenshot({ path: join(out, 'live_readonly_blocked.png') });
} finally {
  await browser?.close();
  A.close(); B.close();
  if (skeBackup) writeFileSync(skeFile, skeBackup);
}
await sleep(800);
const left = await fetch(`${base}/api/agents`).then((r) => r.json());
check(`sessions removed on exit (left ${left.sessions.length})`, left.sessions.length === 0);
check('lock released on exit', !existsSync('projects/lubu_q34/.lock'));
const failed = results.filter(([, v]) => !v);
console.log(failed.length ? `FAILED ${failed.length}` : 'ALL PASS');
process.exit(failed.length ? 1 : 0);
