/**
 * MCP 会话登记 + 工程写锁。
 *
 * 每个 MCP server 进程 = 一个会话：`<projectsDir>/.sessions/<id>.json`，每次工具调用和每 5 s 心跳刷新，
 * 退出（exit / SIGINT / SIGTERM）删除。30 s 没刷新算 stale，10 min 以上的残留文件被清掉。
 * 写锁：`<projectsDir>/<project>/.lock` 记 sessionId + 心跳；别的活会话持有时写工具报错，stale 锁直接接管。
 * 所有文件都 tmp + rename 原子写（Windows 上 rename 覆盖已存在文件也是原子的）。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export const HEARTBEAT_MS = 5_000;
export const STALE_MS = 30_000;
export const CLEANUP_MS = 10 * 60_000;
/** 最近一次工具调用在这个窗口内 → active，否则（心跳仍新鲜）→ idle */
export const ACTIVE_MS = 60_000;

export type SessionStatus = 'active' | 'idle' | 'stale';

export interface SessionRecord {
  id: string;
  displayName: string;
  nameSource: 'session_set' | 'clientInfo' | 'env' | 'pid';
  task?: string;
  clientName?: string;
  clientVersion?: string;
  pid: number;
  project?: string | null;
  lastTool?: string | null;
  lastArgs?: string | null;
  lastToolAt?: string | null;
  lastRender?: { animation?: string | null; frame?: number | null; at: string } | null;
  startedAt: string;
  updatedAt: string;
}

export interface LockRecord { sessionId: string; displayName?: string; pid?: number; heartbeat: string }

export function atomicWriteJson(file: string, data: unknown): void {
  const tmp = `${file}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 1));
  try { renameSync(tmp, file); } catch (e) { rmSync(tmp, { force: true }); throw e; }
}

function readJson<T>(file: string): T | null {
  try { return JSON.parse(readFileSync(file, 'utf8')) as T; } catch { return null; }
}

/** 名字优先级：session_set > clientInfo.name > BONESTUDIO_AGENT_NAME > Agent-<pid> */
export function resolveDisplayName(o: { setName?: string | null; clientName?: string | null; envName?: string | null; pid: number }): { name: string; source: SessionRecord['nameSource'] } {
  const ok = (v?: string | null) => (v && v.trim() ? v.trim() : null);
  if (ok(o.setName)) return { name: ok(o.setName)!, source: 'session_set' };
  if (ok(o.clientName)) return { name: ok(o.clientName)!, source: 'clientInfo' };
  if (ok(o.envName)) return { name: ok(o.envName)!, source: 'env' };
  return { name: `Agent-${o.pid}`, source: 'pid' };
}

export function sessionStatus(rec: Pick<SessionRecord, 'updatedAt' | 'lastToolAt'>, now = Date.now()): SessionStatus {
  const updated = Date.parse(rec.updatedAt);
  if (!Number.isFinite(updated) || now - updated > STALE_MS) return 'stale';
  const tool = rec.lastToolAt ? Date.parse(rec.lastToolAt) : NaN;
  return Number.isFinite(tool) && now - tool <= ACTIVE_MS ? 'active' : 'idle';
}

/** 参数摘要：长字符串截断、数组只报长度，整段 ≤ 200 字符 */
export function summarizeArgs(args: Record<string, unknown> | undefined): string {
  if (!args) return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    let s: string;
    if (Array.isArray(v)) s = `[${v.length}]`;
    else if (v && typeof v === 'object') s = '{…}';
    else s = String(v);
    if (s.length > 40) s = `${s.slice(0, 37)}…`;
    parts.push(`${k}=${s}`);
  }
  const out = parts.join(' ');
  return out.length > 200 ? `${out.slice(0, 197)}…` : out;
}

export function sessionsDir(projectsDir: string): string { return join(projectsDir, '.sessions'); }

/** 读全部会话并按状态分类；顺便清掉超过 CLEANUP_MS 的残留文件。 */
export function listSessions(projectsDir: string, now = Date.now()): Array<SessionRecord & { status: SessionStatus }> {
  const dir = sessionsDir(projectsDir);
  if (!existsSync(dir)) return [];
  const out: Array<SessionRecord & { status: SessionStatus }> = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (f.endsWith('.tmp')) { try { if (now - statSync(p).mtimeMs > CLEANUP_MS) rmSync(p, { force: true }); } catch { /* raced */ } continue; }
    if (!f.endsWith('.json')) continue;
    const rec = readJson<SessionRecord>(p);
    const updated = rec ? Date.parse(rec.updatedAt) : NaN;
    if (!rec || !Number.isFinite(updated) || now - updated > CLEANUP_MS) {
      // 文件可能正被别的 agent 进程写/被杀毒软件占用：删不掉就跳过，别让清理失败带崩调用方（dev server 的轮询 tick）
      try { rmSync(p, { force: true }); } catch { /* 下次再删 */ }
      continue;
    }
    out.push({ ...rec, status: sessionStatus(rec, now) });
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function lockPath(projectsDir: string, project: string): string { return join(projectsDir, project, '.lock'); }

export function readLock(projectsDir: string, project: string): LockRecord | null {
  return readJson<LockRecord>(lockPath(projectsDir, project));
}

/** 锁是否被「别的活会话」持有：锁心跳新鲜且该会话文件也新鲜 */
export function lockHolder(projectsDir: string, project: string, selfId: string, now = Date.now()): LockRecord | null {
  const lock = readLock(projectsDir, project);
  if (!lock || lock.sessionId === selfId) return null;
  const beat = Date.parse(lock.heartbeat);
  if (!Number.isFinite(beat) || now - beat > STALE_MS) return null;
  const rec = readJson<SessionRecord>(join(sessionsDir(projectsDir), `${lock.sessionId}.json`));
  if (!rec || sessionStatus(rec, now) === 'stale') return null;
  return lock;
}

export class LockedError extends Error {
  constructor(public project: string, public holder: LockRecord) {
    super(`工程「${project}」正被 ${holder.displayName ?? holder.sessionId}（会话 ${holder.sessionId}，pid ${holder.pid ?? '?'}）编辑，写操作被拒绝。` +
      `可以：等对方结束（锁 ${STALE_MS / 1000}s 无心跳自动失效）、用 project_save {name:"<新名字>"} 另存一份再改，或只做读取/渲染。` +
      ` / project "${project}" is locked by ${holder.displayName ?? holder.sessionId}; write rejected.`);
  }
}

export interface SessionOptions { projectsDir: string; pid?: number; env?: Record<string, string | undefined>; now?: () => number; id?: string }

export class Session {
  readonly id: string;
  readonly projectsDir: string;
  rec: SessionRecord;
  private setName: string | null = null;
  private clientName: string | null = null;
  private env: Record<string, string | undefined>;
  private now: () => number;
  private locks = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  closed = false;

  constructor(o: SessionOptions) {
    this.projectsDir = o.projectsDir;
    this.env = o.env ?? process.env;
    this.now = o.now ?? Date.now;
    const pid = o.pid ?? process.pid;
    this.id = o.id ?? `${pid}-${randomBytes(3).toString('hex')}`;
    const at = new Date(this.now()).toISOString();
    const n = resolveDisplayName({ envName: this.env.BONESTUDIO_AGENT_NAME, pid });
    this.rec = { id: this.id, displayName: n.name, nameSource: n.source, pid, project: null, lastTool: null, lastArgs: null, lastToolAt: null, lastRender: null, startedAt: at, updatedAt: at };
  }

  get file(): string { return join(sessionsDir(this.projectsDir), `${this.id}.json`); }

  private rename(): void {
    const n = resolveDisplayName({ setName: this.setName, clientName: this.clientName, envName: this.env.BONESTUDIO_AGENT_NAME, pid: this.rec.pid });
    this.rec.displayName = n.name; this.rec.nameSource = n.source;
  }

  setClient(info: { name?: string; version?: string } | undefined): void {
    this.clientName = info?.name ?? null;
    this.rec.clientName = info?.name; this.rec.clientVersion = info?.version;
    this.rename(); this.flush();
  }

  setAgent(name: string | undefined, task?: string): void {
    if (name !== undefined) this.setName = name;
    if (task !== undefined) this.rec.task = task;
    this.rename(); this.flush();
  }

  setProject(project: string | null | undefined): void {
    if ((project ?? null) === (this.rec.project ?? null)) return;
    this.rec.project = project ?? null;
  }

  noteTool(tool: string, args?: Record<string, unknown>): void {
    this.rec.lastTool = tool; this.rec.lastArgs = summarizeArgs(args);
    this.rec.lastToolAt = new Date(this.now()).toISOString();
  }

  noteRender(animation: string | null | undefined, frame: number | null | undefined): void {
    this.rec.lastRender = { animation: animation ?? null, frame: frame ?? null, at: new Date(this.now()).toISOString() };
  }

  /** 写之前调用：被别的活会话锁住就抛 LockedError，否则取得 / 续上锁 */
  acquire(project: string): void {
    const holder = lockHolder(this.projectsDir, project, this.id, this.now());
    if (holder) throw new LockedError(project, holder);
    const dir = join(this.projectsDir, project);
    mkdirSync(dir, { recursive: true });
    atomicWriteJson(lockPath(this.projectsDir, project), this.lockRecord());
    this.locks.add(project);
  }

  /** 当前持有的锁里有没有这个工程（测试用） */
  holds(project: string): boolean { return this.locks.has(project); }

  private lockRecord(): LockRecord { return { sessionId: this.id, displayName: this.rec.displayName, pid: this.rec.pid, heartbeat: new Date(this.now()).toISOString() }; }

  /** 写会话文件 + 续所有锁 */
  flush(): void {
    if (this.closed) return;
    try {
      mkdirSync(sessionsDir(this.projectsDir), { recursive: true });
      this.rec.updatedAt = new Date(this.now()).toISOString();
      atomicWriteJson(this.file, this.rec);
      for (const p of this.locks) {
        const cur = readLock(this.projectsDir, p);
        if (cur && cur.sessionId !== this.id) { this.locks.delete(p); continue; }   // 被接管了
        atomicWriteJson(lockPath(this.projectsDir, p), this.lockRecord());
      }
    } catch { /* 工作区不可写不影响 MCP 本身 */ }
  }

  start(): void {
    this.flush();
    this.timer = setInterval(() => this.flush(), HEARTBEAT_MS);
    this.timer.unref?.();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    rmSync(this.file, { force: true });
    for (const p of this.locks) {
      const cur = readLock(this.projectsDir, p);
      if (cur?.sessionId === this.id) rmSync(lockPath(this.projectsDir, p), { force: true });
    }
    this.locks.clear();
  }
}
