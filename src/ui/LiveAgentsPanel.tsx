/**
 * 「AI → MCP 服务 → 实时预览」：按工程分组列出 MCP 会话（SSE `/api/live` 推送，断线回退 5 s 轮询 `/api/agents`）。
 * 点条目 → 新窗口 `?sample=<工程>&live=1&readonly=1&agent=<会话>` 只读观看。几十个会话也只是一张平铺列表 + 过滤框。
 */
import { useEffect, useMemo, useState } from 'react';

export interface LiveSession {
  id: string; displayName: string; clientName?: string; clientVersion?: string; task?: string; pid: number;
  project?: string | null; lastTool?: string | null; lastArgs?: string | null; lastToolAt?: string | null;
  lastRender?: { animation?: string | null; frame?: number | null } | null;
  startedAt: string; updatedAt: string; status: 'active' | 'idle' | 'stale';
}
export interface LiveProject { name: string; rev: number; lockedBy: { sessionId: string; displayName: string } | null; thumb: string; sessions: string[] }
export interface AgentsSnapshot { now: string; projectsDir: string; counts: Record<string, number>; sessions: LiveSession[]; projects: LiveProject[] }

export function relTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const d = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (d < 5) return '刚刚';
  if (d < 60) return `${d} 秒前`;
  if (d < 3600) return `${Math.floor(d / 60)} 分钟前`;
  return `${Math.floor(d / 3600)} 小时前`;
}

const STATUS_LABEL = { active: '活动', idle: '空闲', stale: '失联' } as const;

/** 分组：每个工程一组（含无人编辑的工程），没有工程的会话归到「未打开工程」 */
export function groupByProject(snap: AgentsSnapshot, filter: string): Array<{ project: LiveProject | null; name: string; sessions: LiveSession[] }> {
  const f = filter.trim().toLowerCase();
  const match = (s: LiveSession) => !f || [s.displayName, s.clientName, s.project, s.lastTool, s.task].some((v) => v?.toLowerCase().includes(f));
  const groups: Array<{ project: LiveProject | null; name: string; sessions: LiveSession[] }> = snap.projects.map((p) => ({ project: p, name: p.name, sessions: snap.sessions.filter((s) => s.project === p.name && match(s)) }));
  const orphans = snap.sessions.filter((s) => (!s.project || !snap.projects.some((p) => p.name === s.project)) && match(s));
  const out = groups.filter((g) => !f || g.sessions.length > 0 || g.name.toLowerCase().includes(f));
  out.sort((a, b) => (b.sessions.length - a.sessions.length) || a.name.localeCompare(b.name));
  if (orphans.length) out.push({ project: null, name: '未打开工程', sessions: orphans });
  return out;
}

export function watchUrl(project: string, sessionId?: string | null): string {
  return `/?aiproject=${encodeURIComponent(project)}&live=1&readonly=1${sessionId ? `&agent=${encodeURIComponent(sessionId)}` : ''}`;
}

export function LiveAgentsPanel({ onOpenProject }: { onOpenProject?: (name: string) => void } = {}) {
  const [snap, setSnap] = useState<AgentsSnapshot | null>(null);
  const [filter, setFilter] = useState('');
  const [sse, setSse] = useState(false);
  const [, setTick] = useState(0);
  useEffect(() => {
    const es = new EventSource('/api/live');
    es.onopen = () => setSse(true);
    es.onerror = () => setSse(false);
    es.addEventListener('agents', (ev) => setSnap(JSON.parse((ev as MessageEvent).data) as AgentsSnapshot));
    const poll = window.setInterval(() => {
      setTick((t) => t + 1);   // 相对时间
      if (es.readyState !== EventSource.OPEN) fetch('/api/agents', { cache: 'no-store' }).then((r) => r.json()).then(setSnap).catch(() => undefined);
    }, 5000);
    return () => { es.close(); window.clearInterval(poll); };
  }, []);
  const groups = useMemo(() => (snap ? groupByProject(snap, filter) : []), [snap, filter]);
  // 新标签页观看（保留 opener，「退出观看」可以直接关掉它回到这里；当前标签的工程不受影响）
  const open = (project: string, id?: string) => window.open(watchUrl(project, id), '_blank');
  return (
    <div style={{ display: 'grid', gap: 8 }} data-live-panel="">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input data-live-filter="" placeholder="过滤：agent / 客户端 / 工程 / 工具" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ flex: 1 }} />
        <span className="muted" style={{ fontSize: 11 }}>
          {snap ? `活动 ${snap.counts.active ?? 0} · 空闲 ${snap.counts.idle ?? 0} · 失联 ${snap.counts.stale ?? 0}` : '…'} · {sse ? 'SSE 实时' : '轮询'}
        </span>
      </div>
      <div className="live-list" data-live-list="">
        {snap && groups.length === 0 && <span className="muted">还没有 MCP 会话。agent 调用 session_set / project_* 后会出现在这里（工作区 {snap.projectsDir}）。</span>}
        {groups.map((g) => (
          <div key={g.name} className="live-group" data-live-project={g.name}>
            {g.project
              ? <img className="live-thumb" src={g.project.thumb} alt={g.name} loading="lazy" onClick={() => open(g.name, g.sessions[0]?.id)} style={{ cursor: 'pointer' }} />
              : <div className="live-thumb" />}
            <div style={{ display: 'grid', gap: 2, alignContent: 'start', minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontWeight: 600 }}>{g.name}</span>
                {g.project?.lockedBy && <span className="muted" style={{ fontSize: 11 }}>🔒 {g.project.lockedBy.displayName}</span>}
                <span className="spacer" style={{ flex: 1 }} />
                {g.project && onOpenProject && <button className="chip" data-live-edit={g.name} title={g.project.lockedBy ? `正被 ${g.project.lockedBy.displayName} 编辑，会先提示` : '在当前标签页打开编辑'} onClick={() => onOpenProject(g.name)}>打开编辑</button>}
                {g.project && <button className="chip" data-live-open={g.name} onClick={() => open(g.name, g.sessions[0]?.id)}>只读观看</button>}
              </div>
              {g.sessions.length === 0 && <span className="muted" style={{ fontSize: 11 }}>当前没有 agent 在编辑</span>}
              {g.sessions.map((s) => (
                <div key={s.id} className="live-agent" data-live-agent={s.id} title={`${s.lastTool ?? ''} ${s.lastArgs ?? ''}`} onClick={() => g.project && open(g.name, s.id)}>
                  <span className={`live-dot ${s.status}`} title={STATUS_LABEL[s.status]} />
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <b>{s.displayName}</b>
                    <span className="muted"> · {s.clientName ?? '未知客户端'}{s.clientVersion ? ` ${s.clientVersion}` : ''}</span>
                    {s.task && <span className="muted"> · {s.task}</span>}
                    <br />
                    <span className="muted" style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{s.lastTool ?? '—'} {s.lastArgs ?? ''}</span>
                  </span>
                  <span className="muted" style={{ fontSize: 11 }}>{relTime(s.lastToolAt ?? s.updatedAt)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
