/**
 * Dev-only：工作区管理（欢迎页 AI 工程删除 + 所有项目的「打开工程所在目录」）。
 *
 *   POST /api/projects/delete  { name }
 *     删除一个 AI 工程：移除 manifest 条目 + 删磁盘目录 `<projectsRoot>/<name>`。
 *     工程被活着的 agent 会话持锁时返回 409（不删正在写的工程）。
 *
 *   POST /api/reveal  { source: 'ai' | 'sample', dir?: string }
 *     在资源管理器里打开目录。source='ai' 走 BONESTUDIO_PROJECTS 工作区，
 *     source='sample' 走内置示例目录；dir 为相对路径，空串表示根目录。
 *     两条路径都夹在各自根目录内（拒绝 `..` 与解析后越界的目标）。
 *
 *   POST /api/projects/save  { name, skeleton, texture?, image?, overwrite? }
 *     编辑器的「保存到项目」：把当前文档写进 `<projectsRoot>/<name>/` 并登记 manifest
 *     （与 MCP 的 project_save 同一个 saveToWorkspace）。image 为 base64/data URL PNG，
 *     缺省时写 4×4 透明图集（空工程）；同名已存在需 overwrite:true；agent 持锁时 409。
 */
import type { Plugin } from 'vite';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { lockHolder } from '../src/mcp/session';
import { saveToWorkspace } from '../src/mcp/workspace';
import { encodePng } from '../src/tools/png';
import type { DbSkeletonData, DbTextureAtlasData } from '../src/core/types';

interface Options {
  projectsRoot: () => string;
  samplesRoot: () => string | null;
}

/** 目标是否在 root 内（Windows 大小写不敏感；resolve 后再比，杜绝 `..` 穿越） */
function inside(root: string, target: string): boolean {
  const base = resolve(root);
  const path = resolve(target);
  const prefix = base.endsWith(sep) ? base : base + sep;
  return path === base || path.toLowerCase().startsWith(prefix.toLowerCase());
}

/** 工程名校验：与 MCP `workspace.safeName` 同一规则，且必须原样（`a/b` 被替换后不等 → 拒绝） */
function cleanProjectName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  if (!name || name.length > 120) return null;
  // Windows 会吞掉结尾的 `.` 与空格：`a.` 与 `a` 指向同一个目录，删除时必须拒绝这种歧义名
  if (/[. ]$/.test(name)) return null;
  const safe = name.replace(/[^\w.-]+/g, '_').replace(/^\.+/, '');
  return safe === name ? name : null;
}

/** 读 JSON 请求体（默认上限 8 KB；保存接口放宽）；超限 / 读取失败都 reject */
function readBody(req: import('node:http').IncomingMessage, limit = 8 * 1024): Promise<string> {
  return new Promise((done, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > limit) { tooLarge = true; return; }
      chunks.push(buf);
    });
    req.on('end', () => (tooLarge ? fail(new Error('body too large')) : done(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', fail);
  });
}

/** 4×4 透明图集：空工程没有素材时的占位（与 MCP projectNew 一致） */
function emptyAtlas(name: string): DbTextureAtlasData {
  return { name, imagePath: `${name}_tex.png`, width: 4, height: 4, SubTexture: [] } as unknown as DbTextureAtlasData;
}

/** base64 / data URL → PNG 字节；缺省给 4×4 透明 PNG，非法数据拒绝 */
function decodeImage(raw: unknown): Uint8Array | null {
  if (raw === undefined || raw === null || raw === '') return encodePng({ width: 4, height: 4, rgba: new Uint8Array(64) });
  if (typeof raw !== 'string') return null;
  const b64 = raw.replace(/^data:[^,]*,/, '');
  const bytes = Buffer.from(b64, 'base64');
  // PNG 签名：坏 base64 多半解出空/垃圾，别把非图片写进工程目录
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes.toString('latin1', 1, 4) !== 'PNG') return null;
  return bytes;
}

function sendJson(res: import('node:http').ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

/** 用系统文件管理器打开目录（Windows / macOS / Linux） */
function openFolder(target: string): void {
  const [command, argv]: [string, string[]] = process.platform === 'win32'
    ? ['explorer.exe', [target]]
    : process.platform === 'darwin'
      ? ['open', [target]]
      : ['xdg-open', [target]];
  const child = spawn(command, argv, { detached: true, windowsHide: true, stdio: 'ignore' });
  // 没有文件管理器 / 命令不存在时别让未捕获的 'error' 事件把 dev server 带崩
  child.on('error', () => { /* 打开失败：前端仍收到 204，用户可手动找目录 */ });
  child.unref();
}

export function projectAdminPlugin(options: Options): Plugin {
  return {
    name: 'bone-studio-project-admin',
    configureServer(server) {
      // ---- 删除 AI 工程（欢迎页卡片） ----
      server.middlewares.use('/api/projects/delete', (req, res) => {
        if (req.method !== 'POST') { sendJson(res, 405, { error: 'POST only' }); return; }
        void readBody(req).then((raw) => {
          let name: string | null = null;
          try { name = cleanProjectName((JSON.parse(raw) as { name?: unknown }).name); } catch { name = null; }
          if (!name) { sendJson(res, 400, { error: 'invalid project name' }); return; }
          const root = resolve(options.projectsRoot());
          const dir = join(root, name);
          if (dir === root || !inside(root, dir)) { sendJson(res, 400, { error: 'invalid project name' }); return; }
          if (!existsSync(dir) || !statSync(dir).isDirectory()) { sendJson(res, 404, { error: 'project not found' }); return; }
          const holder = lockHolder(root, name, '');
          if (holder) {
            sendJson(res, 409, { error: 'project is locked by an agent', holder: { displayName: holder.displayName ?? holder.sessionId } });
            return;
          }
          try {
            const manifestFile = join(root, 'manifest.json');
            if (existsSync(manifestFile)) {
              // 手工编辑 / 某些编辑器会写 BOM，JSON.parse 前先剥掉
              const text = readFileSync(manifestFile, 'utf8').replace(/^\uFEFF/, '');
              const doc = JSON.parse(text) as { samples?: Array<{ name?: string }> };
              if (Array.isArray(doc.samples)) {
                doc.samples = doc.samples.filter((entry) => entry.name !== name);
                const tmp = `${manifestFile}.${process.pid}.tmp`;
                writeFileSync(tmp, JSON.stringify(doc, null, 1));
                renameSync(tmp, manifestFile);
              }
            }
            rmSync(dir, { recursive: true, force: true });
            sendJson(res, 200, { ok: true, name });
          } catch (error) {
            sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
          }
        }).catch(() => sendJson(res, 400, { error: 'bad body' }));
      });

      // ---- 保存到项目（编辑器「保存项目」：基于 AI 工程新建 / 普通新建） ----
      server.middlewares.use('/api/projects/save', (req, res) => {
        if (req.method !== 'POST') { sendJson(res, 405, { error: 'POST only' }); return; }
        void readBody(req, 64 * 1024 * 1024).then((raw) => {
          let body: { name?: unknown; skeleton?: unknown; texture?: unknown; image?: unknown; overwrite?: unknown };
          try { body = JSON.parse(raw) as typeof body; } catch { sendJson(res, 400, { error: 'bad body' }); return; }
          const name = cleanProjectName(body.name);
          if (!name) { sendJson(res, 400, { error: 'invalid project name' }); return; }
          if (!body.skeleton || typeof body.skeleton !== 'object') { sendJson(res, 400, { error: 'missing skeleton' }); return; }
          const root = resolve(options.projectsRoot());
          const dir = join(root, name);
          if (dir === root || !inside(root, dir)) { sendJson(res, 400, { error: 'invalid project name' }); return; }
          const holder = lockHolder(root, name, '');
          if (holder) {
            sendJson(res, 409, { error: 'locked', holder: { displayName: holder.displayName ?? holder.sessionId, sessionId: holder.sessionId } });
            return;
          }
          if (body.overwrite !== true && existsSync(dir)) { sendJson(res, 409, { error: 'exists', name }); return; }
          const png = decodeImage(body.image);
          if (!png) { sendJson(res, 400, { error: 'bad image' }); return; }
          const texture = body.texture && typeof body.texture === 'object' ? body.texture as DbTextureAtlasData : emptyAtlas(name);
          try {
            const entry = saveToWorkspace(name, body.skeleton as DbSkeletonData, texture, png, 'ui');
            sendJson(res, 200, { ok: true, ...entry });
          } catch (error) {
            sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
          }
        }).catch((error) => sendJson(res, error instanceof Error && error.message === 'body too large' ? 413 : 400, { error: 'bad body' }));
      });

      // ---- 打开工程所在目录（内置示例 / AI 工程） ----
      server.middlewares.use('/api/reveal', (req, res) => {
        if (req.method !== 'POST') { sendJson(res, 405, { error: 'POST only' }); return; }
        void readBody(req).then((raw) => {
          let source: 'ai' | 'sample' = 'sample';
          let dir = '';
          try {
            const body = JSON.parse(raw) as { source?: unknown; dir?: unknown };
            if (body.source === undefined || body.source === 'sample' || body.source === 'samples') source = 'sample';
            else if (body.source === 'ai') source = 'ai';
            else { sendJson(res, 400, { error: 'unknown source' }); return; }
            if (typeof body.dir === 'string') dir = body.dir;
          } catch {
            sendJson(res, 400, { error: 'bad body' });
            return;
          }
          const root = source === 'ai' ? options.projectsRoot() : options.samplesRoot();
          if (!root) { sendJson(res, 404, { error: 'samples dir not configured' }); return; }
          const rootAbs = resolve(root);
          const clean = dir.replace(/\\/g, '/').replace(/^\/+/, '');
          if (clean.split('/').some((part) => part === '..')) { sendJson(res, 400, { error: 'bad dir' }); return; }
          const target = resolve(join(rootAbs, clean));
          if (!inside(rootAbs, target) || !existsSync(target) || !statSync(target).isDirectory()) {
            sendJson(res, 400, { error: 'bad dir' });
            return;
          }
          openFolder(target);
          res.statusCode = 204;
          res.end();
        }).catch(() => sendJson(res, 400, { error: 'bad body' }));
      });
    },
  };
}
