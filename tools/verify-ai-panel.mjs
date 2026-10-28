// 端到端：AI → MCP 服务面板（复制按钮、Skill 下载）+ 导出对话框 Spine 4.2 并用 spine-core 4.2 加载。
// 用法：dev server 跑着（npm run dev；工程来自 AI 工作区 /aiprojects），node tools/verify-ai-panel.mjs [url] [outDir]
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import * as spine from '@esotericsoftware/spine-core';

const base = process.argv[2] ?? 'http://127.0.0.1:5179';
const out = process.argv[3] ?? '/workspace/demo-out';
const dl = join(out, 'ai_dl');
rmSync(dl, { recursive: true, force: true }); mkdirSync(dl, { recursive: true });
const sample = process.env.SAMPLE ?? 'lubu_q34';
const chrome = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const results = {};
const check = (k, v) => { results[k] = v; console.log(v ? 'PASS' : 'FAIL', k); };
try {
  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions(base, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
  await page.goto(`${base}/?aiproject=${sample}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 2500));
  const clickText = async (sel, text) => {
    const ok = await page.evaluate((s, t) => { const el = [...document.querySelectorAll(s)].find((e) => e.textContent.trim().startsWith(t)); if (el) el.click(); return !!el; }, sel, text);
    if (!ok) throw new Error(`not found: ${sel} "${text}"`);
    await new Promise((r) => setTimeout(r, 300));
  };
  const clip = () => page.evaluate(() => navigator.clipboard.readText());
  // 菜单
  await clickText('.menubar .menu-item > button', 'AI');
  await page.screenshot({ path: join(out, 'ai_panel_menu.png') });
  await clickText('.menu-pop button', 'MCP 服务');
  await page.waitForSelector('[data-mcp-tools] .prop-row', { timeout: 15000 });
  const tools = await page.$$eval('[data-mcp-tools] .prop-row', (r) => r.length);
  check(`status: tools listed (${tools})`, tools >= 40);
  check('status: built', !!(await page.$('[data-mcp-built="yes"]')));
  await page.screenshot({ path: join(out, 'ai_panel.png') });
  // 配置
  await page.click('[data-ai-tab="config"]');
  await page.click('[data-copy="cursor-global"]'); await new Promise((r) => setTimeout(r, 300));
  const c1 = JSON.parse(await clip());
  check('config: cursor json copied with abs path', String(c1.mcpServers['bone-studio'].args[0]).startsWith('/') && c1.mcpServers['bone-studio'].args[0].endsWith('dist-mcp/server.js'));
  await page.click('[data-ai-client="claude"]');
  await page.click('[data-copy="claude-cli"]'); await new Promise((r) => setTimeout(r, 300));
  check('config: claude cli copied', (await clip()).startsWith('claude mcp add bone-studio'));
  await page.click('[data-ai-client="codex"]'); await page.click('[data-ai-os="windows"]');
  await page.click('[data-copy="codex-toml"]'); await new Promise((r) => setTimeout(r, 300));
  check('config: codex toml (windows placeholder)', (await clip()).includes('C:/path/to/bone-studio/dist-mcp/server.js'));
  await page.screenshot({ path: join(out, 'ai_panel_config.png') });
  await page.click('[data-ai-os="unix"]');
  // Skill
  await page.click('[data-ai-tab="skill"]');
  await page.click('[data-download="md"]'); await page.click('[data-download="zip"]');
  for (let i = 0; i < 30 && !(existsSync(join(dl, 'SKILL.md')) && existsSync(join(dl, 'bonestudio-mcp.zip'))); i++) await new Promise((r) => setTimeout(r, 200));
  check('skill: SKILL.md downloaded', existsSync(join(dl, 'SKILL.md')) && readFileSync(join(dl, 'SKILL.md'), 'utf8').startsWith('---\nname:'));
  const listing = existsSync(join(dl, 'bonestudio-mcp.zip')) ? execFileSync('unzip', ['-l', join(dl, 'bonestudio-mcp.zip')]).toString() : '';
  check('skill: zip contains bonestudio-mcp/SKILL.md', listing.includes('bonestudio-mcp/SKILL.md'));
  await page.screenshot({ path: join(out, 'ai_panel_skill.png') });
  // 提示词
  await page.click('[data-ai-tab="prompt"]');
  await page.click('[data-copy="agent-prompt"]'); await new Promise((r) => setTimeout(r, 300));
  const prompt = await clip();
  check('prompt: copied, mentions install:ai + project_list', prompt.includes('npm run install:ai') && prompt.includes('project_list'));
  await page.screenshot({ path: join(out, 'ai_panel_prompt.png') });
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.querySelector('[data-ai-dialog]')?.click());
  await new Promise((r) => setTimeout(r, 300));
  // 导出对话框 → Spine 4.2
  await clickText('.menubar .menu-item > button', '文件');
  await clickText('.menu-pop button', '导出…');
  await page.waitForSelector('[data-export-type]');
  await page.select('[data-export-type]', 'spine');
  await new Promise((r) => setTimeout(r, 200));
  const versions = await page.$$eval('[data-export-version] option', (o) => o.map((x) => x.value));
  const selected = await page.$eval('[data-export-version]', (s) => s.value);
  check(`export: versions ${versions.join('/')} default ${selected}`, versions.includes('4.2') && versions.includes('4.1') && selected === '4.2');
  await page.screenshot({ path: join(out, 'export_dialog_42.png') });
  const before = new Set(readdirSync(dl));
  await page.click('[data-export-ok]');
  for (let i = 0; i < 50 && readdirSync(dl).filter((f) => !before.has(f) && !f.endsWith('.crdownload')).length < 3; i++) await new Promise((r) => setTimeout(r, 200));
  const files = readdirSync(dl).filter((f) => !before.has(f));
  const jsonF = files.find((f) => f.endsWith('.json')), atlasF = files.find((f) => f.endsWith('.atlas'));
  check(`export: downloaded ${files.join(', ')}`, !!jsonF && !!atlasF && files.some((f) => f.endsWith('.png')));
  if (jsonF && atlasF) {
    const json = JSON.parse(readFileSync(join(dl, jsonF), 'utf8'));
    const atlas = new spine.TextureAtlas(readFileSync(join(dl, atlasF), 'utf8'));
    class T extends spine.Texture { setFilters() {} setWraps() {} dispose() {} }
    for (const p of atlas.pages) p.setTexture(new T({ width: p.width, height: p.height }));
    const data = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(json);
    const sk = new spine.Skeleton(data);
    let finite = true;
    for (const a of data.animations) for (let t = 0; t <= a.duration; t += 1 / 24) { sk.setToSetupPose(); a.apply(sk, 0, t, false, [], 1, spine.MixBlend.setup, spine.MixDirection.mixIn); sk.updateWorldTransform(spine.Physics.none); finite &&= sk.bones.every((b) => Number.isFinite(b.worldX)); }
    check(`export: spine-core ${json.skeleton.spine} loads (${data.bones.length} bones, ${data.animations.length} anims), all frames finite`, json.skeleton.spine.startsWith('4.2') && finite && data.animations.length > 0);
  }
} finally { await browser.close(); }
const failed = Object.entries(results).filter(([, v]) => !v);
console.log(failed.length ? `FAILED ${failed.length}` : 'ALL PASS');
process.exit(failed.length ? 1 : 0);
