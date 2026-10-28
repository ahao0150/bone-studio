/**
 * 「AI → MCP 服务…」面板：MCP server 状态、配置指南、Skill 下载、Agent 提示词。
 * 数据来自 dev server 的 `/api/mcp/info`（tools/mcpInfoPlugin.ts）；拿不到时用占位路径。
 */
import { useEffect, useMemo, useState } from 'react';
import { Icon } from './icons';
import { LiveAgentsPanel } from './LiveAgentsPanel';
import { PLACEHOLDER, agentPrompt, mcpSnippets, repoPathFor, skillTargets, type ClientId, type OsId } from '../ai/mcpSetup';

export interface McpInfo {
  repoRoot: string; serverPath: string; built: boolean; builtAt: string | null; buildHint: string | null;
  projectsDir: string; platform: string; node: string; skillAvailable: boolean;
  tools: Array<{ name: string; description: string }>;
  buildState?: 'ok' | 'stale' | 'missing' | 'unknown'; buildReason?: string | null; toolsError?: string | null;
  projectsSource?: 'BONESTUDIO_PROJECTS' | 'default'; legacySamplesEnv?: string | null; projectCount?: number; projectsHint?: string | null;
}

const fmtTime = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};
const SOURCE_LABEL = { BONESTUDIO_PROJECTS: '来自环境变量 BONESTUDIO_PROJECTS', default: '默认：仓库 projects/（可用 BONESTUDIO_PROJECTS 覆盖）' } as const;

type Tab = 'status' | 'live' | 'config' | 'skill' | 'prompt';

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const area = document.createElement('textarea');
    area.value = text; area.style.position = 'fixed'; area.style.opacity = '0';
    document.body.appendChild(area); area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

function CopyBlock({ id, title, text, file, note }: { id: string; title: string; text: string; file?: string; note?: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  return (
    <div data-snippet={id} style={{ display: 'grid', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="label" style={{ fontWeight: 600 }}>{title}</span>
        {file && <span className="muted" style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{file}</span>}
        <span className="spacer" style={{ flex: 1 }} />
        <button
          className={`chip${state === 'ok' ? ' on' : ''}`}
          data-copy={id}
          onClick={() => { void copyText(text).then((ok) => { setState(ok ? 'ok' : 'fail'); window.setTimeout(() => setState('idle'), 1600); }); }}
        >
          <Icon name="copy" size={11} /> {state === 'ok' ? '已复制' : state === 'fail' ? '复制失败' : '复制'}
        </button>
      </div>
      <pre style={{ margin: 0, padding: 8, background: 'var(--bg-input)', border: '1px solid var(--line-soft)', borderRadius: 'var(--radius)', fontFamily: 'var(--mono)', fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 220, overflow: 'auto' }}>{text}</pre>
      {note && <span className="muted" style={{ fontSize: 11 }}>{note}</span>}
    </div>
  );
}

export function AiMcpDialog({ onClose, sampleName, onOpenProject }: { onClose: () => void; sampleName?: string | null; onOpenProject?: (name: string) => void }) {
  const [tab, setTab] = useState<Tab>('status');
  const [info, setInfo] = useState<McpInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [client, setClient] = useState<ClientId>('cursor');
  const initialOs: OsId = /win/i.test(navigator.platform) ? 'windows' : 'unix';
  const [os, setOs] = useState<OsId>(initialOs);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildLog, setRebuildLog] = useState<string | null>(null);
  const rebuildNow = () => {
    setRebuilding(true); setRebuildLog(null);
    fetch('/api/mcp/rebuild', { method: 'POST' })
      .then((r) => r.json() as Promise<{ ok: boolean; log: string }>)
      .then((r) => { setRebuildLog(r.ok ? null : r.log); })
      .catch((e: Error) => setRebuildLog(e.message))
      .finally(() => { setRebuilding(false); reload(); });
  };
  const reload = () => {
    setError(null);
    fetch('/api/mcp/info', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: McpInfo) => { setInfo(data); setOs(data.platform === 'win32' ? 'windows' : 'unix'); })
      .catch((e) => setError(`读不到 /api/mcp/info（${e instanceof Error ? e.message : e}）—— 只有 dev server（npm run dev）提供这个接口，下面用占位路径。`));
  };
  useEffect(reload, []);
  const root = repoPathFor(os, info);
  const origin = window.location.origin;
  const liveUrl = `${origin}/?aiproject=${encodeURIComponent(sampleName || '<工程名>')}&live=1`;
  const snippets = useMemo(() => mcpSnippets(client, os, root), [client, os, root]);
  const prompt = useMemo(() => agentPrompt({ root, os, editorOrigin: origin }), [root, os, origin]);
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'status', label: '服务状态' }, { id: 'live', label: '实时预览' }, { id: 'config', label: '配置指南' }, { id: 'skill', label: 'Skill 下载' }, { id: 'prompt', label: 'Agent 提示词' },
  ];
  const row = (label: string, value: React.ReactNode) => (
    <div className="prop-row" style={{ gridTemplateColumns: '120px 1fr' }}>
      <span className="label">{label}</span>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 11, wordBreak: 'break-all' }}>{value}</span>
    </div>
  );
  return (
    <div data-ai-dialog="" onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 95, display: 'grid', placeItems: 'center', background: 'rgba(0, 0, 0, 0.45)' }}>
      <div onClick={(e) => e.stopPropagation()} className="panel" style={{ width: 760, maxWidth: '94vw', border: '1px solid var(--line-strong)' }}>
        <div className="panel-head">
          <Icon name="control" size={13} />
          <span className="panel-title">AI · MCP 服务</span>
          <span className="spacer" />
          {tabs.map((t) => (
            <button key={t.id} data-ai-tab={t.id} className={`chip${t.id === tab ? ' on' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
          <button className="head-btn" title="关闭" onClick={onClose}><Icon name="x" size={13} /></button>
        </div>
        <div className="panel-body" style={{ padding: 10, display: 'grid', gap: 10, maxHeight: '72vh', overflow: 'auto' }}>
          {error && <div className="muted" style={{ fontSize: 11, color: 'var(--warn, #e0b050)' }}>{error}</div>}
          {tab === 'live' && <LiveAgentsPanel onOpenProject={onOpenProject} />}
          {tab === 'status' && (
            <>
              <div className="muted" style={{ fontSize: 11, lineHeight: 1.7 }}>
                BoneStudio 把编辑内核暴露成一个 stdio MCP server：外部 agent（Cursor / Claude Code / Codex…）可以导入角色、绑骨、打关键帧、渲染预览并导出 Spine 4.2 / DragonBones。
                agent 写入的工程保存在工作区，编辑器打开下面的「实时链接」就会自动刷新。
              </div>
              {row('构建状态', !info ? '…'
                : info.buildState === 'ok' || (info.buildState === undefined && info.built)
                  ? <span data-mcp-built="yes" style={{ color: 'var(--ok, #6cc070)' }}>已构建 · {fmtTime(info.builtAt)}</span>
                  : (
                    <span data-mcp-built={info.built ? 'stale' : 'no'} style={{ color: 'var(--warn, #e0b050)', display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      {info.built ? '需要重新构建' : '未构建'}：npm run build:mcp
                      {info.buildReason && <span className="muted" style={{ fontSize: 11 }}>（{info.buildReason}）</span>}
                      <button className="chip on" data-mcp-rebuild="" disabled={rebuilding} onClick={rebuildNow}>{rebuilding ? '构建中…' : '立即构建'}</button>
                    </span>
                  ))}
              {rebuildLog && <pre data-mcp-rebuild-log="" style={{ whiteSpace: 'pre-wrap', fontSize: 11, color: 'var(--warn, #e0b050)', maxHeight: 160, overflow: 'auto', margin: 0 }}>{rebuildLog}</pre>}
              {row('启动命令', `node ${root}/dist-mcp/server.js`)}
              {row('工作区', (
                <span data-mcp-workspace="" style={{ display: 'grid', gap: 2 }}>
                  <span style={{ fontFamily: 'var(--mono)' }}>{info?.projectsDir ?? `${root}/projects`}</span>
                  {info?.projectsSource && <span className="muted" style={{ fontSize: 11 }}>{SOURCE_LABEL[info.projectsSource]} · {info.projectCount ?? 0} 个工程</span>}
                  {info?.projectsHint && <span className="muted" style={{ fontSize: 11 }}>{info.projectsHint}</span>}
                  {info?.legacySamplesEnv && info.legacySamplesEnv === info.projectsDir.replace(/[\\/]+$/, '') && (
                    <span style={{ fontSize: 11, color: 'var(--warn, #e0b050)' }}>BONESTUDIO_SAMPLES 也指向这个目录：它现在只表示内置示例目录，AI 工程请改用 BONESTUDIO_PROJECTS（或不设，默认 projects/）。</span>
                  )}
                </span>
              ))}
              {row('实时链接', <a href={liveUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>{liveUrl}</a>)}
              {row('运行环境', info ? `${info.platform} · node ${info.node}` : '—')}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="label" style={{ fontWeight: 600 }}>工具（{info?.tools.length ?? 0}）</span>
                <span className="spacer" style={{ flex: 1 }} />
                <button className="chip" onClick={reload}><Icon name="refresh" size={11} /> 刷新</button>
              </div>
              <div data-mcp-tools="" style={{ display: 'grid', gap: 2, maxHeight: 260, overflow: 'auto', border: '1px solid var(--line-soft)', borderRadius: 'var(--radius)', padding: 6 }}>
                {(info?.tools ?? []).map((t) => (
                  <div key={t.name} className="prop-row" style={{ gridTemplateColumns: '170px 1fr' }}>
                    <span className="label" style={{ fontFamily: 'var(--mono)' }}>{t.name}</span>
                    <span className="muted" style={{ fontSize: 11 }}>{t.description}</span>
                  </div>
                ))}
                {info && info.tools.length === 0 && (info.toolsError
                  ? <pre data-mcp-tools-error="" style={{ whiteSpace: 'pre-wrap', fontSize: 11, color: 'var(--warn, #e0b050)', margin: 0 }}>读取工具清单失败：{info.toolsError}</pre>
                  : <span className="muted">{info.built ? '工具清单为空' : '构建后可见：npm run build:mcp'}</span>)}
              </div>
            </>
          )}
          {tab === 'config' && (
            <>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="label">客户端</span>
                {([['cursor', 'Cursor'], ['claude', 'Claude Code'], ['codex', 'Codex / 通用']] as Array<[ClientId, string]>).map(([id, label]) => (
                  <button key={id} data-ai-client={id} className={`chip${client === id ? ' on' : ''}`} onClick={() => setClient(id)}>{label}</button>
                ))}
                <span style={{ width: 16 }} />
                <span className="label">系统</span>
                {([['windows', 'Windows'], ['unix', 'macOS / Linux']] as Array<[OsId, string]>).map(([id, label]) => (
                  <button key={id} data-ai-os={id} className={`chip${os === id ? ' on' : ''}`} onClick={() => setOs(id)}>{label}</button>
                ))}
              </div>
              <div className="muted" style={{ fontSize: 11 }}>路径：<span style={{ fontFamily: 'var(--mono)' }}>{root}</span>{root === PLACEHOLDER[os] ? '（占位，请替换成你的仓库路径）' : '（本机仓库绝对路径）'}</div>
              {snippets.map((s) => <CopyBlock key={s.id} id={s.id} title={s.title} text={s.text} file={s.file} note={s.note} />)}
            </>
          )}
          {tab === 'skill' && (
            <>
              <div className="muted" style={{ fontSize: 11, lineHeight: 1.7 }}>
                Skill 教 agent 怎么用这些 MCP 工具做骨骼动画（坐标约定、绑定/动画/预览/导出流程、自检方法）。下载后放到对应客户端的 skills 目录，文件夹名 <code>bonestudio-mcp</code>，文件名 <code>SKILL.md</code>。
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <a className="chip" data-download="md" href="/api/mcp/skill.md" download="SKILL.md"><Icon name="export" size={11} /> 下载 SKILL.md</a>
                <a className="chip" data-download="zip" href="/api/mcp/skill.zip" download="bonestudio-mcp.zip"><Icon name="export" size={11} /> 下载 bonestudio-mcp.zip</a>
              </div>
              {skillTargets(os).map((t) => (
                <div key={t.client} className="prop-row" style={{ gridTemplateColumns: '120px 1fr' }}>
                  <span className="label">{t.client}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{t.path}</span>
                </div>
              ))}
              <CopyBlock id="skill-oneclick" title="一键安装（Skill + MCP + 自检）" text={`cd ${os === 'windows' ? `"${root}"` : root}\nnpm run install:ai -- --client ${client}`} note="--client 可选 cursor / claude / codex；加 --global 装到用户目录，--dry-run 只打印不写入。" />
            </>
          )}
          {tab === 'prompt' && (
            <>
              <div className="muted" style={{ fontSize: 11 }}>把下面整段粘进外部 agent（Cursor / Claude Code / Codex），它会自己安装 Skill、注册 MCP 并用 project_list / skeleton_summary 自检。</div>
              <CopyBlock id="agent-prompt" title="Agent 提示词" text={prompt} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
