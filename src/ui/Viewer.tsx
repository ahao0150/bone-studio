import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons';
import { StageView, type StageStats } from './StageView';
import type { Player } from '../core/player';
import type { ToolId } from './chrome';
import type { BoneTransformValues } from '../core/editing';
import { WelcomeScreen, type WelcomeAiProject, type WelcomeSample } from './WelcomeScreen';
import type { RecentEntry } from '../core/project/settings';
import type { StageFilter } from '../core/stageFilter';
import { StageFilterBar } from './StageFilterBar';

export interface ViewerProps {
  player: Player | null;
  atlasUrl: string | null;
  showBones: boolean;
  /** 骨架装配模式：骨片更醒目，图片不透明 */
  anatomyMode?: boolean;
  /** 骨骼级「隐藏」（官方 MenuItem-hide） */
  hiddenBones?: Set<string>;
  /** 插槽锁定（官方 MenuItem-lockOthersLayer） */
  lockedSlots?: Set<string>;
  /** 插槽多选集合 */
  selectedSlots?: Set<string>;
  /** 洋葱皮（官方 Timeline.onion.tooltip）：透传给舞台 */
  onion?: boolean;
  /** 前一帧洋葱皮（官方 `Sheet.onion.prev`） */
  onionPrev?: boolean;
  /** 后一帧洋葱皮（官方 `Sheet.onion.next`） */
  onionNext?: boolean;
  /** 洋葱皮范围：前 / 后各几帧（默认 1） */
  onionBefore?: number;
  onionAfter?: number;
  /**
   * 显示边框（官方 `Sheet.showframe` → `_948/_951.as` 第 159-168 行）：舞台上给每个显示
   * 对象描一圈边框 —— 不是序列帧列表缩略图上的线。
   */
  showFrameBorder?: boolean;
  background: string;
  backgroundId: string;
  backgrounds: Array<{ id: string; name: string }>;
  onBackground: (id: string) => void;
  hiddenSlots: Set<string>;
  /** 锁定的骨骼在舞台上不可选（官方右键菜单的「锁定」） */
  lockedBones?: Set<string>;
  /** 偏好设置（骨骼颜色 / 图片平滑）—— 见 core/project/settings.ts */
  settings?: { boneColor: string; imageSmooth: boolean };
  /** 舞台辅助线（官方「辅助标尺」） */
  guides?: Array<{ axis: 'x' | 'y'; value: number }>;
  onGuidesChange?: (guides: Array<{ axis: 'x' | 'y'; value: number }>) => void;
  showGuides?: boolean;
  /** 变换坐标系（官方 TransformPanel） */
  transformSpace?: 'world' | 'parent' | 'local';
  /** 关闭当前项目（官方 Menu.File.CloseProject / 页签 ×） */
  onCloseDocument?: () => void;
  /** 欢迎页是当前页：舞台只渲染欢迎内容，文档页签仍可切回去 */
  welcome?: boolean;
  /** P-19 选项卡管理：同时打开的文档（官方 CloseTabButton 的 关闭 / 关闭其他 / 关闭全部） */
  documents?: Array<{ id: string; name: string }>;
  activeDocId?: string | null;
  onActivateDoc?: (id: string) => void;
  onCloseDoc?: (id: string) => void;
  onCloseOtherDocs?: (id: string) => void;
  onCloseAllDocs?: () => void;
  /** 在资源管理器中打开该页签项目所在目录 */
  onRevealDoc?: (id: string) => void;
  /** 舞台过滤器条（官方 StageFilterBar 的 6 个开关） */
  stageFilter?: StageFilter;
  /** 序列帧工程不显示过滤器条和变换条 */
  sheetMode?: boolean;
  onStageFilterToggle?: (key: keyof StageFilter) => void;
  /** 欢迎页（官方 Welcome.*）：本地示例、最近打开、文档索引 */
  samples?: WelcomeSample[];
  aiProjects?: WelcomeAiProject[];
  onOpenAiProject?: (name: string) => void;
  onNewFromAiProject?: (name: string) => void;
  /** 删除 AI 工程（磁盘目录一起删，宿主负责确认） */
  onDeleteAiProject?: (name: string) => void;
  recents?: RecentEntry[];
  onNewProject?: () => void;
  onLoadRecent?: (entry: RecentEntry) => void;
  onRemoveRecent?: (entry: RecentEntry) => void;
  /** 欢迎页卡片封面：`coverKey(kind, name)` → data URL */
  covers?: Record<string, string>;
  /** 欢迎页卡片悬停：第一个动画的帧序列 */
  onPreviewAnimation?: (kind: 'sample' | 'file' | 'workspace', name: string) => Promise<{ frames: string[]; interval: number } | null>;
  selectedBone: string | null;
  onSelectBone: (name: string | null) => void;
  /** 舞台点中图片时选中插槽 */
  onSelectSlot?: (name: string) => void;
  scale: number;
  onScaleChange: (scale: number) => void;
  fitToken: number;
  tool: ToolId;
  version?: number;
  onBeginEdit?: () => void;
  onEditBone?: (name: string, patch: Partial<BoneTransformValues>) => void;
  onEditSlot?: (name: string, patch: Partial<BoneTransformValues>) => void;
  onPaintWeight?: (slot: string, vertex: number) => void;
  /** 宿主选中的权重顶点（透传给 StageView 同步饼图选中环） */
  weightVertex?: number | null;
  /** 点舞台空白取消选中顶点（透传给 StageView） */
  onClearWeightVertex?: () => void;
  onMeshVertexMove?: (slot: string, vertex: number, x: number, y: number) => void;
  onMeshVertexRemove?: (slot: string, vertex: number) => void;
  onMeshEdgeAdd?: (slot: string, a: number, b: number, t: number) => void;
  onMeshLineToggle?: (slot: string, a: number, b: number) => void;
  /** 官方 TOOL_OUTLINE(3)：手绘轮廓闭合后回传点（armature 空间） */
  onOutlineComplete?: (points: Array<{ x: number; y: number }>) => void;
  /** 当前选中的槽位（边界框的显示/拾取要用） */
  selectedSlot?: string | null;
  bboxMode?: 'add' | 'delete' | null;
  /** 权重列表正在等舞台上点一根骨骼 */
  weightBonePick?: boolean;
  onAddWeightBone?: (bone: string) => void;
  /** 「设置约束目标」：舞台上点中的骨骼作为 IK 约束目标 */
  ikTargetPick?: boolean;
  onPickIkTarget?: (bone: string) => void;
  onBBoxAddEdge?: (a: number, b: number) => void;
  onBBoxDeletePoint?: (index: number) => void;
  /** 多选：Ctrl+A 全选 / Shift 点选 / 舞台框选 */
  selectedBones?: Set<string>;
  onToggleBone?: (name: string) => void;
  onSelectBonesRect?: (names: string[]) => void;
  /** 画布下缘的变换控件条（官方 TransformPanel 的那条细长控件） */
  transformBar?: ReactNode;
  /** 吸附工具栏（参考垫图吸附 / 关节吸附开关） */
  snapBar?: ReactNode;
  /** 画布右上角的非阻塞浮层（播放事件提示等），pointer-events: none */
  stageOverlay?: ReactNode;
  onSlotDragEnd?: (name: string) => void;
  onBoneDragEnd?: (name: string) => void;
  referenceOverlay?: { url: string; width: number; height: number; originX: number; originY: number; pxPerUnit: number; opacity: number } | null;
  /** 网格编辑悬浮工具栏（官方 `_877/_11511`）：进入「编辑网格」后浮在变换条上方 */
  meshEditorBar?: ReactNode;
  /** 舞台右键菜单（官方 MenuItem-*） */
  onStageContextMenu?: (info: { x: number; y: number; bone: string | null; slot: string | null }) => void;
  /** 资源树拖切片到舞台（§109）：`world` 为落点的 armature 世界坐标 */
  onRegionDrop?: (name: string, world: { x: number; y: number }) => void;
  /** 序列帧「绝对」：拖当前帧 */
  sheetDrag?: boolean;
  sheetSlot?: string | null;
  onSheetDrag?: (dx: number, dy: number) => void;
  ffdMode?: boolean;
  onFfdModeChange?: (value: boolean) => void;
  onFfdVertexMove?: (slot: string, vertex: number, dx: number, dy: number) => void;
  onCreateBone?: (from: { x: number; y: number }, to: { x: number; y: number }) => void;
  onFocusArea?: (area: 'stage' | 'timeline') => void;
  onStats: (stats: StageStats) => void;
  stats: StageStats;
  /** 外部注入的悬停高亮（场景树行 hover → 舞台，§113）：直接透传给 StageView */
  externalHover?: { kind: 'bone' | 'slot'; name: string } | null;
  duration: number;
  position: number;
  frameRate: number;
  docName: string;
  animationName: string;
  armatureName: string;
  error: string | null;
  onOpenFiles: () => void;
  onLoadSample?: (sample?: WelcomeSample) => void;
  sampleName?: string;
  onFit: () => void;
}

export function Viewer(props: ViewerProps) {
  const {
    player, atlasUrl, showBones, background, backgroundId, backgrounds, onBackground, hiddenSlots, lockedBones, settings, onion, onionPrev, onionNext, onionBefore, onionAfter, showFrameBorder, guides, onGuidesChange, showGuides, transformSpace, stageFilter, onStageFilterToggle, sheetMode,
    documents, activeDocId, onActivateDoc, onCloseDoc, onCloseOtherDocs, onCloseAllDocs, onRevealDoc, transformBar, meshEditorBar,
    samples, recents, onNewProject, onLoadRecent, selectedBone, onSelectBone, onSelectSlot, scale, onScaleChange,
    fitToken, tool, version, onBeginEdit, onEditBone, onEditSlot, onPaintWeight, weightVertex, onClearWeightVertex, onMeshVertexMove, onMeshVertexRemove, onMeshEdgeAdd, onMeshLineToggle, onOutlineComplete, selectedSlot, bboxMode, weightBonePick, onAddWeightBone, ikTargetPick, onPickIkTarget, onBBoxAddEdge, onBBoxDeletePoint, selectedBones, onToggleBone, onSelectBonesRect, onStageContextMenu, onRegionDrop, ffdMode, onFfdModeChange, onFfdVertexMove, onCreateBone, onFocusArea, onStats, stats, duration, position,
    frameRate, error, onOpenFiles, onLoadSample, onFit,
  } = props;
  const [tabMenu, setTabMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!tabMenu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTabMenu(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tabMenu]);
  const divider = <span style={{ width: 1, height: 14, background: 'var(--line-soft)' }} />;
  const gridTool = tool === 'mesh' || tool === 'meshAdd' || tool === 'meshDelete' || tool === 'meshOutline';
  const showingWelcome = Boolean(props.welcome) || !player;
  const docTabs: Array<{ id: string; name: string; pinned?: boolean }> = [
    { id: '__welcome', name: '欢迎', pinned: true },
    ...(documents ?? []),
  ];
  const activeTabId = showingWelcome ? '__welcome' : (activeDocId ?? '__welcome');
  return (
    <div className="center">
      <div className="doc-tabs">
        {docTabs.map((doc) => (
          <div
            key={doc.id}
            className={`doc-tab${doc.pinned ? ' pinned' : ''}${doc.id === activeTabId ? ' active' : ''}`}
            data-doc-tab={doc.id}
            title={doc.pinned ? '欢迎（固定，不可关闭）' : `${doc.name}（右键：关闭 / 关闭其他 / 关闭全部 / 打开所在文件夹）`}
            onClick={() => onActivateDoc?.(doc.id)}
            onContextMenu={(event) => {
              event.preventDefault();
              if (!doc.pinned) setTabMenu({ id: doc.id, x: event.clientX, y: event.clientY });
            }}
            onAuxClick={(event) => {
              if (event.button === 1 && !doc.pinned) {
                event.preventDefault();
                onCloseDoc?.(doc.id);
              }
            }}
          >
            <Icon name={doc.pinned ? 'logo' : 'image'} size={12} />
            {doc.name}
            {!doc.pinned && (
              <button
                className="x"
                title="关闭"
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseDoc?.(doc.id);
                }}
                style={{ background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', padding: 0 }}
              >×</button>
            )}
          </div>
        ))}
        <div className="add" title="新建项目" onClick={onNewProject}><Icon name="plus" size={12} /></div>
        {tabMenu && createPortal(
          <>
            <div
              className="stage-menu-backdrop"
              data-tab-menu-backdrop=""
              onPointerDown={() => setTabMenu(null)}
              onContextMenu={(event) => { event.preventDefault(); setTabMenu(null); }}
            />
            <div
              className="stage-menu tab-menu doc-tab-menu"
              data-tab-menu={tabMenu.id}
              style={{ left: tabMenu.x, top: tabMenu.y }}
            >
              <button data-tab-action="close" onClick={() => { const id = tabMenu.id; setTabMenu(null); onCloseDoc?.(id); }}>关闭</button>
              <button data-tab-action="closeOther" onClick={() => { const id = tabMenu.id; setTabMenu(null); onCloseOtherDocs?.(id); }}>关闭其他</button>
              <button data-tab-action="closeAll" onClick={() => { setTabMenu(null); onCloseAllDocs?.(); }}>关闭全部</button>
              <hr />
              <button data-tab-action="reveal" onClick={() => { const id = tabMenu.id; setTabMenu(null); onRevealDoc?.(id); }}>打开项目所在资源管理器</button>
            </div>
          </>,
          document.body,
        )}
      </div>
      {error && <div className="load-error" role="alert">{error}</div>}
      <div className="viewer">
        {!showingWelcome && !sheetMode && stageFilter && onStageFilterToggle && (
          <StageFilterBar filter={stageFilter} onToggle={onStageFilterToggle} />
        )}
        {!showingWelcome && player ? (
          <StageView
            player={player}
            atlasUrl={atlasUrl}
            showBones={showBones}
            anatomyMode={props.anatomyMode}
            hiddenBones={props.hiddenBones}
            lockedSlots={props.lockedSlots}
            selectedSlots={props.selectedSlots}
            hideImages={!stageFilter?.imageVisible}
            disableBonePick={!stageFilter?.boneSelectable}
            disableSlotPick={stageFilter ? !stageFilter.imageSelectable : false}
            onSelectSlot={onSelectSlot}
            onion={onion}
            onionPrev={onionPrev}
            onionNext={onionNext}
            onionBefore={onionBefore}
            onionAfter={onionAfter}
            showFrameBorder={showFrameBorder}
            background={background}
            hiddenSlots={hiddenSlots}
            lockedBones={lockedBones}
            boneColor={settings?.boneColor}
            imageSmooth={settings?.imageSmooth}
            guides={guides}
            onGuidesChange={onGuidesChange}
            showGuides={showGuides}
            transformSpace={transformSpace}
            selectedBone={selectedBone}
            onSelectBone={onSelectBone}
            scale={scale}
            onScaleChange={onScaleChange}
            fitToken={fitToken}
            tool={tool}
            version={version}
            onBeginEdit={onBeginEdit}
            onEditBone={onEditBone}
            onEditSlot={onEditSlot}
            onSlotDragEnd={props.onSlotDragEnd}
            onBoneDragEnd={props.onBoneDragEnd}
            referenceOverlay={props.referenceOverlay}
            onPaintWeight={onPaintWeight}
            weightVertex={weightVertex}
            onClearWeightVertex={onClearWeightVertex}
            onMeshVertexMove={onMeshVertexMove}
            onMeshVertexRemove={onMeshVertexRemove}
            onMeshEdgeAdd={onMeshEdgeAdd}
            onMeshLineToggle={onMeshLineToggle}
            onOutlineComplete={onOutlineComplete}
            selectedSlot={selectedSlot}
            bboxMode={bboxMode}
            weightBonePick={weightBonePick}
            onAddWeightBone={onAddWeightBone}
            ikTargetPick={ikTargetPick}
            onPickIkTarget={onPickIkTarget}
            onBBoxAddEdge={onBBoxAddEdge}
            onBBoxDeletePoint={onBBoxDeletePoint}
            selectedBones={selectedBones}
            onToggleBone={onToggleBone}
            onSelectBonesRect={onSelectBonesRect}
            onStageContextMenu={onStageContextMenu}
            onRegionDrop={onRegionDrop}
            sheetDrag={props.sheetDrag}
            sheetSlot={props.sheetSlot}
            onSheetDrag={props.onSheetDrag}
            ffdMode={ffdMode}
            onFfdModeChange={onFfdModeChange}
            onFfdVertexMove={onFfdVertexMove}
            onCreateBone={onCreateBone}
            onFocusArea={onFocusArea}
            onStats={onStats}
            externalHover={props.externalHover}
          />
        ) : (
          <WelcomeScreen
            samples={samples ?? []}
            aiProjects={props.aiProjects}
            onOpenAiProject={props.onOpenAiProject}
            onNewFromAiProject={props.onNewFromAiProject}
            onDeleteAiProject={props.onDeleteAiProject}
            recents={recents ?? []}
            onNewProject={() => onNewProject?.()}
            onOpenFiles={onOpenFiles}
            onLoadSample={(sample) => onLoadSample?.(sample)}
            onLoadRecent={(entry) => onLoadRecent?.(entry)}
            onRemoveRecent={(entry) => props.onRemoveRecent?.(entry)}
            covers={props.covers ?? {}}
            onPreviewAnimation={props.onPreviewAnimation}
          />
        )}
        {/* 网格编辑悬浮栏与底部变换条（z/x/c/v）互斥：进入网格编辑时只出网格栏 */}
        {!showingWelcome && meshEditorBar}
        {!showingWelcome && !meshEditorBar && transformBar}
        {!showingWelcome && props.snapBar}
        {!showingWelcome && props.stageOverlay}
      </div>
      {!showingWelcome && <div className="viewer-footer">
        <button className="head-btn" title="适应窗口 (F)" onClick={onFit} disabled={!player}><Icon name="fit" size={13} /></button>
        <button className="head-btn zoom-step" title="缩小" onClick={() => onScaleChange(scale / 1.25)} disabled={!player}>－</button>
        <button type="button" className="metric hl zoom-reset" data-zoom-reset title="恢复 100%" disabled={!player} onClick={() => onScaleChange(1)}>{(scale * 100).toFixed(0)}%</button>
        <button className="head-btn zoom-step" title="放大" onClick={() => onScaleChange(scale * 1.25)} disabled={!player}>＋</button>
        {divider}
        <span className="row" style={{ gap: 4 }}>
          背景
          <select
            value={backgroundId}
            onChange={(event) => onBackground(event.target.value)}
            style={{ padding: '0 2px', maxWidth: 160 }}
            title="画布背景（默认与 DragonBones 相同的棋盘）"
          >
            {backgrounds.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
        </span>
        {gridTool && (
          <>
            {divider}
            <label
              className="checkbox"
              title="勾选后拖动网格顶点写的是当前帧的 FFD 变形关键帧（官方 Mesh.property.ffd）"
            >
              <input
                type="checkbox"
                checked={!!ffdMode}
                onChange={(event) => onFfdModeChange?.(event.target.checked)}
              />
              FFD 变形
            </label>
          </>
        )}
        {divider}
        <span>{player ? `${duration} 帧 @ ${frameRate} fps` : '—'}</span>
        <span className="spacer" />
        <span className="metric">{position.toFixed(1)}f / {(position / Math.max(1, frameRate)).toFixed(2)}s</span>
        <span className="metric">渲染 {stats.ms.toFixed(1)} ms</span>
        <span className="metric">{stats.items} 对象</span>
      </div>}
    </div>
  );
}





