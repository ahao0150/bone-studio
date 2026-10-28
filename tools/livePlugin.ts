/**
 * Dev-only：多 agent 实时预览。
 *   GET /api/agents            会话（active/idle/stale）+ 工程（锁、修订号、缩略图地址）汇总
 *   GET /api/live              SSE：`agents`（会话变化）/ `project`（工程文件变化，带 name + rev）
 *   GET /api/thumb/<proj>.png  缩略图：<proj>/cover.png，否则软件光栅渲染绑定姿态（按 ske 修改时间缓存）
 * 文件监听用 fs.watch(recursive)（Windows / macOS 原生，Linux 需 Node ≥ 20），150 ms 去抖；
 * 不支持递归时退回逐目录 watch。
 */
import type { Plugin } from 'vite';
import type { ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, watch, type FSWatcher } from 'node:fs';
import { join, sep } from 'node:path';
import { listSessions, readLock, lockHolder, type SessionRecord, type SessionStatus } from '../src/mcp/session';
import { Player } from '../src/core/player';
import { animationBounds, renderPlayer } from '../src/core/render/softRaster';
import { decodePng, encodePng } from '../src/tools/png';

interface ManifestEntry { name: string; skeleton: string; texture: string; image: string; rev?: number }

function manifest(dir: string): ManifestEntry[] {
  try { return (JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { samples?: ManifestEntry[] }).samples ?? []; } catch { return []; }
}

export function aggregate(dir: string, now = Date.now()) {
  const sessions = listSessions(dir, now);
  const projects = manifest(dir).map((m) => {
    const lock = readLock(dir, m.name);
    const holder = lock ? lockHolder(dir, m.name, '', now) : null;
    const skePath = join(dir, m.skeleton);
    const mtime = existsSync(skePath) ? statSync(skePath).mtimeMs : 0;
    return {
      name: m.name, rev: m.rev ?? mtime,
      lockedBy: holder ? { sessionId: holder.sessionId, displayName: holder.displayName ?? holder.sessionId } : null,
      thumb: `/api/thumb/${encodeURIComponent(m.name)}.png?v=${Math.round(mtime)}`,
      sessions: sessions.filter((s) => s.project === m.name).map((s) => s.id),
    };
  });
  const counts: Record<SessionStatus, number> = { active: 0, idle: 0, stale: 0 };
  for (const s of sessions) counts[s.status]++;
  return { now: new Date(now).toISOString(), projectsDir: dir, counts, sessions, projects };
}

const thumbCache = new Map<string, { key: number; png: Buffer }>();
function thumbnail(dir: string, name: string): Buffer | null {
  const entry = manifest(dir).find((m) => m.name === name);
  if (!entry) return null;
  const cover = join(dir, name, 'cover.png');
  if (existsSync(cover)) return readFileSync(cover);
  const ske = join(dir, entry.skeleton);
  if (!existsSync(ske)) return null;
  const key = statSync(ske).mtimeMs;
  const hit = thumbCache.get(name);
  if (hit && hit.key === key) return hit.png;
  try {
    const tex = JSON.parse(readFileSync(join(dir, entry.texture), 'utf8'));
    const page = decodePng(readFileSync(join(dir, entry.image)));
    const p = new Player(JSON.parse(readFileSync(ske, 'utf8')), tex);
    p.playing = false; p.setupPose = true; p.seek(0);
    const img = renderPlayer(p, [page], { width: 160, height: 160, bounds: animationBounds(p, [0]), padding: 6, background: [44, 46, 52, 255] });
    const png = encodePng(img);
    thumbCache.set(name, { key, png });
    return png;
  } catch { return null; }
}

export function livePlugin(projectsDir: () => string): Plugin {
  return {
    name: 'bone-studio-live',
    configureServer(server) {
      const dir = projectsDir();
      mkdirSync(join(dir, '.sessions'), { recursive: true });
      const clients = new Set<ServerResponse>();
      const send = (event: string, data: unknown) => {
        const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        for (const c of clients) c.write(msg);
      };
      // ---- 文件监听（去抖） ----
      let agentsTimer: ReturnType<typeof setTimeout> | null = null;
      const projTimers = new Map<string, ReturnType<typeof setTimeout>>();
      const onChange = (rel: string | null) => {
        if (!rel) return;
        const parts = rel.split(/[\\/]/);
        const head = parts[0];
        if (rel.endsWith('.tmp')) return;
        if (head === '.sessions' || parts[1] === '.lock') {
          if (agentsTimer) clearTimeout(agentsTimer);
          agentsTimer = setTimeout(() => { agentsTimer = null; send('agents', aggregate(dir)); }, 150);
          return;
        }
        if (head === 'manifest.json' || parts.length < 2 || !/\.(json|png)$/.test(rel) || parts[1] === 'cover.png') return;
        const t = projTimers.get(head);
        if (t) clearTimeout(t);
        projTimers.set(head, setTimeout(() => {
          projTimers.delete(head);
          const entry = manifest(dir).find((m) => m.name === head);
          const ske = entry ? join(dir, entry.skeleton) : null;
          send('project', { name: head, rev: entry?.rev ?? null, mtime: ske && existsSync(ske) ? statSync(ske).mtimeMs : null, at: Date.now() });
          send('agents', aggregate(dir));
        }, 150));
      };
      const watchers: FSWatcher[] = [];
      try {
        watchers.push(watch(dir, { recursive: true }, (_e, f) => onChange(f ? String(f) : null)));
      } catch {
        // 不支持递归：根目录 + .sessions + 每个工程目录各 watch 一个
        const add = (sub: string) => { try { watchers.push(watch(join(dir, sub), (_e, f) => onChange(f ? (sub ? `${sub}${sep}${f}` : String(f)) : null))); } catch { /* gone */ } };
        add(''); add('.sessions');
        for (const n of readdirSync(dir)) if (!n.startsWith('.') && statSync(join(dir, n)).isDirectory()) add(n);
      }
      // 心跳过期不会产生文件事件：定时重算，状态变化才推
      let lastSig = '';
      const tick = setInterval(() => {
        // 轮询失败（文件被占用、目录刚被删）不能让 dev server 退出：跳过这一拍，下一拍重试
        try {
          const a = aggregate(dir);
          const sig = a.sessions.map((s) => `${s.id}:${s.status}`).join(',') + '|' + a.projects.map((p) => `${p.name}:${p.lockedBy?.sessionId ?? ''}`).join(',');
          if (sig !== lastSig) { lastSig = sig; send('agents', a); }
          for (const c of clients) c.write(': ping\n\n');
        } catch { /* next tick */ }
      }, 5000);
      server.httpServer?.on('close', () => { clearInterval(tick); for (const w of watchers) w.close(); });

      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        if (url === '/api/agents') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(aggregate(dir)));
          return;
        }
        if (url === '/api/live') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
          res.write(`retry: 2000\nevent: agents\ndata: ${JSON.stringify(aggregate(dir))}\n\n`);
          clients.add(res);
          req.on('close', () => clients.delete(res));
          return;
        }
        const m = /^\/api\/thumb\/(.+)\.png$/.exec(url);
        if (m) {
          const png = thumbnail(dir, decodeURIComponent(m[1]));
          if (!png) { res.statusCode = 404; res.end(); return; }
          res.setHeader('Content-Type', 'image/png');
          res.setHeader('Cache-Control', 'max-age=60');
          res.end(png);
          return;
        }
        next();
      });
    },
  };
}
export type { SessionRecord };
