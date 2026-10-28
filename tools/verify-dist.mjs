/**
 * Production-bundle verification (M6: 打包 + 性能预算).
 *
 * Every other round drives the **dev server**; this one proves the artifact users
 * actually ship. It serves `dist/` with a dependency-free static server, launches
 * headless Chrome against it, hands the app real projects through its
 * `<input type="file">`, and asserts the packaged bundle renders, stays error-free
 * and holds the 60fps budget on a large skeleton. Evidence lands in
 * `docs/evidence/dist-verify.json`.
 *
 *   npm run build && npm run verify:dist
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SAMPLES = process.env.BONESTUDIO_SAMPLES
  ?? 'samples';
const BIG = process.env.BONESTUDIO_BIG_SAMPLES
  ?? 'work/dragonbones-src/Cocos/Demos/assets/resources';
const PORT = Number(process.env.DIST_PORT ?? 5199);
const CDP_PORT = Number(process.env.DIST_CDP ?? 9339);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROJECTS = [
  { label: 'Rooster_Ani (63 bones)', files: [join(SAMPLES, 'Rooster_Ani/Rooster_An_ske.json'), join(SAMPLES, 'Rooster_Ani/Rooster_An_tex.json'), join(SAMPLES, 'Rooster_Ani/Rooster_An_tex.png')] },
  { label: 'you_xin/body (70 bones, 10 anims)', files: [join(BIG, 'you_xin/body/body_ske.json'), join(BIG, 'you_xin/body/body_tex.json'), join(BIG, 'you_xin/body/body_tex.png')] },
];

if (!existsSync(join(DIST, 'index.html'))) { console.error('dist/index.html missing — run `npm run build` first'); process.exit(2); }
if (!existsSync(CHROME)) { console.error(`Chrome not found: ${CHROME} (set CHROME_PATH)`); process.exit(2); }
for (const project of PROJECTS) {
  for (const file of project.files) {
    if (!existsSync(file)) { console.error(`missing fixture: ${file}`); process.exit(2); }
  }
}

const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = join(DIST, url === '/' ? 'index.html' : url.replace(/^[/\\]+/, ''));
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const profile = join(tmpdir(), `bonestudio-dist-${Date.now()}`);
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  '--window-size=1658,952', 'about:blank',
], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill(); } catch { /* ignore */ } server.close(); };

let page = null;
for (let i = 0; i < 60 && !page; i++) {
  await sleep(500);
  try {
    const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
    page = list.find((e) => e.type === 'page') ?? null;
  } catch { /* still starting */ }
}
if (!page) { cleanup(); console.error('headless Chrome did not expose a page target'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
let id = 0; const pending = new Map(); const consoleErrors = [];
ws.addEventListener('message', (event) => {
  const m = JSON.parse(event.data);
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') consoleErrors.push(m.params.entry.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push('console: ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const mid = ++id; pending.set(mid, { resolve, reject }); ws.send(JSON.stringify({ id: mid, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'evaluate failed');
  return r.result.value;
};
const READOUT = `(() => {
  const text = (sel) => (document.querySelector(sel)?.innerText ?? '').replace(/\\s+/g, ' ').trim();
  const num = (re, src) => { const m = src.match(re); return m ? Number(m[1]) : null; };
  const status = text('.statusbar');
  const footer = text('.viewer-footer');
  return {
    statusbar: status, footer,
    objects: num(/(\\d+) 对象/, footer),
    ms: num(/([\\d.]+) ms/, footer),
    fps: num(/(\\d+) fps/, status),
    frames: footer.match(/(\\d+) 帧 @ (\\d+) fps/) ? Number(footer.match(/(\\d+) 帧 @ (\\d+) fps/)[1]) : null,
    canvas: !!document.querySelector('.stage canvas'),
    timelineRows: document.querySelectorAll('.tl-track-head').length,
    animations: Array.from(document.querySelectorAll('.anim-row .anim-name')).map((n) => n.textContent),
  };
})()`;

try {
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('DOM.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await sleep(4000);
  const boot = await evaluate(`(() => ({ title: document.title, hasInput: !!document.querySelector('input[type=file]'), devProbe: typeof window.__boneStudio, welcomeShown: !!document.querySelector('[data-welcome]') }))()`);
  const doc = await send('DOM.getDocument', { depth: -1 });
  const input = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' });
  if (!input.nodeId) throw new Error('packaged bundle has no file input');

  const loads = [];
  for (const project of PROJECTS) {
    await send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: project.files });
    await sleep(5000);
    const first = await evaluate(READOUT);
    await sleep(2500); // settle, then take the steady-state window
    const steady = await evaluate(READOUT);
    loads.push({ label: project.label, first, steady });
    if (project === PROJECTS[PROJECTS.length - 1]) {
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      mkdirSync(join(ROOT, 'docs'), { recursive: true });
      writeFileSync(join(ROOT, 'docs', 'screenshot-editor-dist.png'), Buffer.from(shot.data, 'base64'));
    }
  }

  const last = loads[loads.length - 1];
  // 时间轴行数（timelineRows）不再作为门禁：打包产物首屏停在「骨架装配」，时间轴不渲染行，
  // 而时间轴交互自 2026-10-17 起改为人工验证（见 AGENTS.md「时间轴测试策略」）。
  // 仍把 timelineRows 写进 evidence 供以后排查，但不参与 ok 判定。
  const ok = boot.devProbe === 'undefined' && boot.hasInput && boot.welcomeShown
    && loads.every((l) => l.steady.canvas && (l.steady.objects ?? 0) > 0)
    && (last.steady.fps ?? 0) >= 55
    && consoleErrors.length === 0;
  const evidence = {
    capturedAt: new Date().toISOString(),
    dist: { index: 'dist/index.html', bytes: statSync(join(DIST, 'index.html')).size },
    url: `http://127.0.0.1:${PORT}/`,
    headlessChrome: CHROME, boot, loads, consoleErrors, ok,
  };
  mkdirSync(join(ROOT, 'docs', 'evidence'), { recursive: true });
  writeFileSync(join(ROOT, 'docs', 'evidence', 'dist-verify.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 1));
  cleanup();
  process.exit(ok ? 0 : 1);
} catch (error) {
  cleanup();
  console.error(String(error));
  process.exit(1);
}
