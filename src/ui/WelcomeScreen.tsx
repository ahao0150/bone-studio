/**
 * 欢迎页（官方 `Welcome.*`）：项目卡片 + 本地示例卡片。
 * 卡片封面是离屏渲染的「贴图 + 骨骼线框」（`render/coverRenderer.ts`），还没生成时显示占位。
 * 浏览器无法按路径重开本地文件，本地项目卡片点开会走「打开项目…」让用户重新选择。
 */
import { useEffect, useMemo, useState } from 'react';
import type { RecentEntry } from '../core/project/settings';
import { coverKey } from '../core/project/covers';

export interface WelcomeSample {
  name: string;
  skeleton: string;
}

/** AI 工作区工程（MCP 写的，和内置示例分开放） */
export interface WelcomeAiProject {
  name: string;
  thumb?: string;
  lockedBy?: string | null;
}

function ago(at: number): string {
  if (!at) return '';
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

type PreviewAnimation = (kind: 'sample' | 'file' | 'workspace', name: string) => Promise<{ frames: string[]; interval: number } | null>;

/** 封面：静止时显示封面图，`playing` 时取第一个动画的帧序列循环播放。 */
function Cover({ url, label, playing, load }: { url?: string; label: string; playing: boolean; load?: () => ReturnType<PreviewAnimation> }) {
  const [anim, setAnim] = useState<{ frames: string[]; interval: number } | null>(null);
  const [frame, setFrame] = useState(0);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!playing || !load) { setFrame(0); return; }
    let alive = true;
    let timer = 0;
    setLoading(!anim);
    void load().then((result) => {
      if (!alive) return;
      setLoading(false);
      setAnim(result);
      if (!result) return;
      timer = window.setInterval(() => setFrame((index) => (index + 1) % result.frames.length), result.interval);
    });
    return () => { alive = false; window.clearInterval(timer); };
    // anim 只用于判断是否首帧加载中，不能进依赖（否则拿到结果后会重启计时器）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, load]);
  const shown = playing && anim ? anim.frames[frame % anim.frames.length] : url;
  return (
    <div className="wl-cover" data-welcome-playing={playing && anim ? '' : undefined}>
      {shown ? <img src={shown} alt={label} draggable={false} /> : <span className="wl-cover-wait">生成预览…</span>}
      {playing && loading && <span className="wl-cover-badge">载入动画…</span>}
      {playing && anim && <span className="wl-cover-badge">▶ 预览</span>}
    </div>
  );
}

/** 一张可悬停预览的卡片 */
function Card({ kind, name, cover, tag, data, onOpen, onRemove, onPreview }: {
  kind: 'sample' | 'file' | 'workspace';
  name: string;
  cover?: string;
  tag: string;
  data: string;
  onOpen: () => void;
  onRemove?: () => void;
  onPreview?: PreviewAnimation;
}) {
  const [hovered, setHovered] = useState(false);
  const load = useMemo(() => (onPreview ? () => onPreview(kind, name) : undefined), [onPreview, kind, name]);
  return (
    <div className="wl-card" role="button" tabIndex={0} data-welcome-card={data} data-welcome-name={name}
      onClick={onOpen}
      onKeyDown={(event) => { if (event.key === 'Enter') onOpen(); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}>
      <Cover url={cover} label={name} playing={hovered} load={load} />
      <div className="wl-meta">
        <span className="wl-name" title={name}>{name}</span>
        <span className="wl-tag">{tag}</span>
      </div>
      {onRemove && (
        <button className="wl-remove" title="从列表移除（不删除文件）" data-welcome-remove=""
          onClick={(event) => { event.stopPropagation(); onRemove(); }}>×</button>
      )}
    </div>
  );
}

export function WelcomeScreen({
  samples, recents, covers, onNewProject, onOpenFiles, onLoadSample, onLoadRecent, onRemoveRecent, onPreviewAnimation,
  aiProjects, onOpenAiProject, onNewFromAiProject, onDeleteAiProject,
}: {
  aiProjects?: WelcomeAiProject[];
  onOpenAiProject?: (name: string) => void;
  onNewFromAiProject?: (name: string) => void;
  /** 删除一个 AI 工程（磁盘目录一起删）；宿主负责确认与持锁检查 */
  onDeleteAiProject?: (name: string) => void;
  /** 卡片悬停时播放第一个动画 */
  onPreviewAnimation?: PreviewAnimation;
  samples: WelcomeSample[];
  recents: RecentEntry[];
  /** `coverKey(kind, name)` → 封面 data URL */
  covers: Record<string, string>;
  onNewProject: () => void;
  onOpenFiles: () => void;
  onLoadSample: (sample: WelcomeSample) => void;
  onLoadRecent: (entry: RecentEntry) => void;
  onRemoveRecent: (entry: RecentEntry) => void;
}) {
  return (
    <div data-welcome="" className="wl-root">
      <header className="wl-hero">
        <div>
          <div className="wl-title">BoneStudio</div>
          <div className="wl-sub">DragonBones 5.x 兼容的骨骼动画编辑器</div>
        </div>
        <span style={{ flex: 1 }} />
        <button className="wl-btn primary" data-welcome-new="" onClick={onNewProject}>新建项目</button>
        <button className="wl-btn" data-welcome-open="" onClick={onOpenFiles}>打开项目…</button>
      </header>

      <section className="wl-section">
        <div className="wl-head">项目<span className="wl-count">{recents.length}</span></div>
        <div className="wl-grid">
          <button className="wl-card wl-new" data-welcome-card="new" onClick={onNewProject}>
            <div className="wl-cover"><span className="wl-plus">＋</span></div>
            <div className="wl-meta"><span className="wl-name">新建项目</span><span className="wl-tag">空白骨架</span></div>
          </button>
          {recents.map((entry) => (
            <Card key={coverKey(entry.kind, entry.name)} kind={entry.kind} name={entry.name} data="recent"
              cover={covers[coverKey(entry.kind, entry.name)]}
              tag={`${entry.kind === 'sample' ? '示例' : entry.kind === 'workspace' ? '项目' : '本地'} · ${ago(entry.at)}`}
              onOpen={() => onLoadRecent(entry)} onRemove={() => onRemoveRecent(entry)} onPreview={onPreviewAnimation} />
          ))}
        </div>
      </section>

      {aiProjects && aiProjects.length > 0 && (
        <section className="wl-section" data-welcome-ai="">
          <div className="wl-head">AI 工程<span className="wl-count">{aiProjects.length}</span>
            <span className="wl-tag" style={{ marginLeft: 8 }}>agent 通过 MCP 写入的工作区（BONESTUDIO_PROJECTS，默认仓库 projects/）</span>
          </div>
          <div className="wl-grid">
            {aiProjects.map((project) => (
              <div key={project.name} className="wl-card" role="button" tabIndex={0} data-welcome-card="ai" data-welcome-name={project.name}
                onClick={() => onOpenAiProject?.(project.name)}
                onKeyDown={(event) => { if (event.key === 'Enter') onOpenAiProject?.(project.name); }}>
                <div className="wl-cover">{project.thumb ? <img src={project.thumb} alt={project.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : null}</div>
                <div className="wl-meta">
                  <span className="wl-name" title={project.name}>{project.name}</span>
                  <span className="wl-tag">{project.lockedBy ? `🔒 ${project.lockedBy} 编辑中` : 'AI · MCP'}</span>
                  {onNewFromAiProject && (
                    <button className="wl-ai-new" data-welcome-ai-new={project.name} title="基于它新建独立工程"
                      onClick={(event) => { event.stopPropagation(); onNewFromAiProject(project.name); }}
                      onKeyDown={(event) => event.stopPropagation()}>＋ 基于它新建</button>
                  )}
                </div>
                {onDeleteAiProject && (
                  <button className="wl-remove" data-welcome-ai-delete={project.name} title="删除工程（磁盘目录一起删除）"
                    onClick={(event) => { event.stopPropagation(); onDeleteAiProject(project.name); }}
                    onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter') onDeleteAiProject(project.name); }}>×</button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="wl-section">
        <div className="wl-head">示例<span className="wl-count">{samples.length}</span></div>
        {samples.length > 0 ? (
          <div className="wl-grid">
            {samples.map((sample) => (
              <Card key={sample.name} kind="sample" name={sample.name} data="sample"
                cover={covers[coverKey('sample', sample.name)]}
                tag={/\.dbbin$/i.test(sample.skeleton) ? '二进制 dbbin' : 'JSON'}
                onOpen={() => onLoadSample(sample)} onPreview={onPreviewAnimation} />
            ))}
          </div>
        ) : (
          <div className="wl-empty">没有发现本地示例（用 BONESTUDIO_SAMPLES 指定目录）</div>
        )}
      </section>
    </div>
  );
}
