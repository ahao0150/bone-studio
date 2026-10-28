/**
 * `?live=1`（可选 `&readonly=1&agent=<会话 id>`）：通过 SSE `/api/live` 原地更新当前工程。
 *
 * 工程文件变了 → 拉新 `*_ske.json`，用临时 Player 规范化后 `restoreArmature` 进当前 Player：
 * Player 对象不换，相机 / 选择 / 播放头都保留。图集（*_tex.json）变了才退回整页重载。
 * 只读时顶部横幅「正在观看 <name> 编辑 · 只读」，可勾「跟随 agent」跳到它最后渲染的动画/帧。
 * SSE 连不上时 App 里原有的 manifest 轮询 + 整页重载仍然生效（它看 `window.__bonestudioLiveSse`）。
 */
import { useEffect, useRef, useState } from 'react';
import { Player } from '../core/player';
import { restoreArmature, snapshotArmature } from '../core/editing';
import type { DbTextureAtlasData } from '../core/types';

interface SessionLite {
  id: string; displayName: string; clientName?: string; project?: string | null; status: string;
  lastTool?: string | null; lastRender?: { animation?: string | null; frame?: number | null; at: string } | null; task?: string;
}
interface Entry { name: string; skeleton: string; texture: string }

declare global { interface Window { __bonestudioLiveSse?: boolean; __bonestudioLiveApplied?: number } }

export function LiveSync({ sample, root = '/aiprojects', readonly, agentId, getPlayer, onApplied, flash, onExit }: {
  sample: string;
  /** 工程文件路由：AI 工程 `/aiprojects`（旧链接 `/dbsamples`） */
  root?: string;
  /** 「退出观看」按钮 / Esc */
  onExit?: () => void;
  readonly: boolean;
  agentId: string | null;
  getPlayer: () => Player | null;
  /** 数据已原地替换：App 刷新视图并重置只读基线 */
  onApplied: (kind: 'data' | 'follow') => void;
  flash: (msg: string) => void;
}) {
  const [agent, setAgent] = useState<SessionLite | null>(null);
  const [follow, setFollow] = useState(false);
  const [connected, setConnected] = useState(false);
  const [updates, setUpdates] = useState(0);
  const texRef = useRef<string | null>(null);
  const followRef = useRef(follow);
  followRef.current = follow;
  const lastRenderAt = useRef<string | null>(null);

  const jumpTo = (s: SessionLite | null) => {
    const p = getPlayer();
    const r = s?.lastRender;
    if (!p || !r) return;
    if (r.animation && p.animationNames().includes(r.animation) && p.animation?.name !== r.animation) p.setAnimation(r.animation);
    if (typeof r.frame === 'number') { p.playing = false; p.seek(r.frame); }
    onApplied('follow');
  };

  useEffect(() => {
    let alive = true;
    let busy = false;
    let again = false;
    const entryOf = async (): Promise<Entry | null> => {
      const m = await fetch(`${root}/manifest.json`, { cache: 'no-store' }).then((r) => r.json()) as { samples?: Entry[] };
      return m.samples?.find((e) => e.name === sample) ?? null;
    };
    void entryOf().then((e) => e && fetch(`${root}/${e.texture}`, { cache: 'no-store' }).then((r) => r.text()).then((t) => { texRef.current = t; })).catch(() => undefined);

    const apply = async () => {
      if (busy) { again = true; return; }
      busy = true;
      try {
        const e = await entryOf();
        const current = getPlayer();
        if (!e || !current) return;
        const [skeText, texText] = await Promise.all([
          fetch(`${root}/${e.skeleton}`, { cache: 'no-store' }).then((r) => r.text()),
          fetch(`${root}/${e.texture}`, { cache: 'no-store' }).then((r) => r.text()),
        ]);
        if (texRef.current !== null && texText !== texRef.current) { window.location.reload(); return; }   // 图集变了：整页重载
        const fresh = new Player(JSON.parse(skeText), JSON.parse(texText) as DbTextureAtlasData);
        const name = current.skeleton.armature.name;
        if (fresh.skeleton.armature.name !== name && fresh.doc.armatures.some((a: { name: string }) => a.name === name)) fresh.setArmature(name);
        const snap = snapshotArmature(fresh);
        if (!snap || snap === snapshotArmature(current)) return;
        const anim = current.animation?.name;
        const pos = current.position;
        const playing = current.playing;
        const setup = current.setupPose;
        restoreArmature(current, snap);
        if (anim && current.animationNames().includes(anim)) current.setAnimation(anim);
        current.setupPose = setup;
        current.seek(pos);
        current.playing = playing;
        if (!alive) return;
        window.__bonestudioLiveApplied = (window.__bonestudioLiveApplied ?? 0) + 1;
        setUpdates((n) => n + 1);
        onApplied('data');
      } catch (err) {
        flash(`实时同步失败：${err instanceof Error ? err.message : String(err)}`);
      } finally {
        busy = false;
        if (again && alive) { again = false; void apply(); }
      }
    };

    const es = new EventSource('/api/live');
    es.onopen = () => { window.__bonestudioLiveSse = true; setConnected(true); };
    es.onerror = () => { window.__bonestudioLiveSse = false; setConnected(false); };
    es.addEventListener('project', (ev) => {
      const d = JSON.parse((ev as MessageEvent).data) as { name: string };
      if (d.name === sample) void apply();
    });
    es.addEventListener('agents', (ev) => {
      const d = JSON.parse((ev as MessageEvent).data) as { sessions: SessionLite[] };
      const s = (agentId ? d.sessions.find((x) => x.id === agentId) : null)
        ?? d.sessions.find((x) => x.project === sample && x.status !== 'stale') ?? null;
      setAgent(s);
      if (s?.lastRender && s.lastRender.at !== lastRenderAt.current) {
        lastRenderAt.current = s.lastRender.at;
        if (followRef.current) jumpTo(s);
      }
    });
    return () => { alive = false; es.close(); window.__bonestudioLiveSse = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sample, root, agentId]);

  if (!readonly) return null;
  const name = agent?.displayName ?? (agentId ? `会话 ${agentId}` : 'agent');
  return (
    <div className="live-banner" data-readonly-banner="" role="status">
      <span className={`live-dot ${agent?.status ?? 'stale'}`} />
      <span className="live-banner-title">正在观看 {name} 编辑 · 只读</span>
      {agent?.task && <span className="muted">· {agent.task}</span>}
      {agent?.lastTool && <span className="muted" data-live-last="">· 最近：{agent.lastTool}</span>}
      <span className="spacer" style={{ flex: 1 }} />
      <span className="muted" data-live-updates={updates}>{connected ? `实时 · 已同步 ${updates} 次` : '连接中…（回退为整页重载）'}</span>
      <label className="live-follow">
        <input type="checkbox" data-live-follow="" checked={follow} onChange={(e) => { setFollow(e.target.checked); if (e.target.checked) jumpTo(agent); }} />
        跟随 agent
      </label>
      {onExit && <button className="chip on" data-live-exit="" title="退出观看（Esc）" onClick={onExit}>退出观看</button>}
    </div>
  );
}
