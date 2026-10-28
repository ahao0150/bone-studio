import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Tabs } from './chrome';
import type { Player } from '../core/player';
import type { BoneRow } from './panels';
import type { KeySelectionEntry } from '../core/keyEdit';
import type { KeyTweenState } from '../core/curveEdit';
import type { ExtraTrack } from '../core/timelineTracks';
import type { BoneChannelName } from '../core/boneChannels';
import { expandTrackRef, type TrackKeyRef } from '../core/trackKeyEdit';
import { xToFrame } from './timelineLayout';
import { TimelineContextMenu, type TimelineMenuEntry } from './timeline/TimelineContextMenu';
import { TimelineHeader, type TimelineHeaderProps } from './timeline/TimelineHeader';
import { TimelineRows } from './timeline/TimelineRows';
import { TimelineStatusBar, type TimelineStatusBarProps } from './timeline/TimelineStatusBar';
import { TimelineTransport } from './timeline/TimelineTransport';
import { TimelineOverlay } from './timeline/TimelineOverlay';
import { buildLanes, summaryFrames } from './timeline/lanes';
import { useTimelineView } from './timeline/useTimelineView';
import { useKeyDrags } from './timeline/useKeyDrags';

export interface TimelineDockProps {
  player: Player | null;
  /** 序列帧工程：底部同一个容器改显示「序列帧」面板（时间轴让位） */
  sheetPanel?: ReactNode;
  /** 序列帧面板的工具条（与「序列帧」页签同一行、靠右） */
  sheetTools?: ReactNode;
  height: number;
  onHeight: (height: number) => void;
  rows: BoneRow[];
  selectedBone: string | null;
  onSelectBone: (name: string) => void;
  extraTracks: ExtraTrack[];
  selectedTrack: string | null;
  onSelectTrack: (id: string | null) => void;
  onTrackKeyClick: (track: ExtraTrack, channel: string | null, frame: number, additive: boolean) => void;
  /** 非骨骼轨道的键选区（插槽 / 事件 / 绘制顺序 / IK） */
  trackSelection: TrackKeyRef[];
  onTrackSelection: (refs: TrackKeyRef[], additive: boolean) => void;
  /** 当前骨骼在播放头的补间状态（右键菜单用） */
  boneTween: KeyTweenState | null;
  onTween: (remove: boolean) => void;
  /** 补间线上右键：切换这段补间（channel 缺省 = 骨骼汇总行，三个通道一起） */
  onSpanTween: (bone: string, channel: BoneChannelName | undefined, frame: number, on: boolean) => void;
  onSelectAllKeys: () => void;
  /** 树菜单「隐藏其他 / 锁定其他」 */
  onIsolate: (name: string, kind: 'hide' | 'lock') => void;
  onToggleTrackKey: (trackId: string, channelId?: string) => void;
  hiddenBones: Set<string>;
  lockedBones: Set<string>;
  onArmatureVisible: (mode: 'all' | 'invert') => void;
  onArmatureSelectable: (mode: 'all' | 'invert') => void;
  onToggleRowVisible: (name: string) => void;
  onToggleRowLock: (name: string) => void;
  allKeyFrames: number[];
  onSelectColumn: (frame: number) => void;
  onShiftFrames: (direction: -1 | 1) => void;
  onSeek: (frame: number) => void;
  loop: boolean;
  onLoop: (value: boolean) => void;
  onion: boolean;
  onOnion: (value: boolean) => void;
  onTogglePlay: () => void;
  onToggleKey: () => void;
  tab: string;
  onTab: (id: string) => void;
  onFocusArea?: (area: 'stage' | 'timeline') => void;
  keySelection: KeySelectionEntry[];
  onKeySelection: (selection: KeySelectionEntry[]) => void;
  onKeysMove: (delta: number) => void;
  onKeysScale: (factor: number) => void;
  onDeleteKeys: () => void;
  onCopyKeys: () => void;
  onDistributeKeys: () => void;
  onCutKeys: () => void;
  onPasteKeys: () => void;
  hasClipboard: boolean;
  speed: number;
  onSpeed: (value: number) => void;
  /** 状态栏「只显示选中时间轴」 */
  filterOn?: boolean;
  onFilter?: (value: boolean) => void;
  /** 表头工具：自动关键帧 / 编辑多帧 / 删除非必要帧 / 曲线编辑器 / 洋葱皮范围 */
  headerTools: Pick<TimelineHeaderProps, 'autoKey' | 'onAutoKey' | 'multiFrame' | 'onMultiFrame' | 'onPrune' | 'onCurveEditor' | 'onionBefore' | 'onionAfter' | 'onOnionRange'>;
  /** 过滤组：锁定时间轴显示的骨骼 / 更新锁定 / 选中锁定的骨骼 */
  filterLock: Pick<TimelineStatusBarProps, 'filterLocked' | 'onFilterLock' | 'onFilterRefresh' | 'onFilterSelect'>;
}

const TABS = [{ id: 'timeline', name: '时间轴' }];
const SHEET_TABS = [{ id: 'sheet', name: '序列帧' }];

export function TimelineDock(props: TimelineDockProps) {
  const { player, height, onHeight, rows, keySelection, selectedBone } = props;
  const duration = Math.max(1, player?.duration ?? 1);
  const position = Math.max(0, Math.min(duration, player?.position ?? 0));
  const animName = player?.animation?.name || '动画';
  const playing = !!player?.playing;

  const [openBones, setOpenBones] = useState<Set<string>>(() => new Set());
  const [openTracks, setOpenTracks] = useState<Set<string>>(() => new Set());
  const [follow, setFollow] = useState(true);
  const [loopStart, setLoopStart] = useState<number | null>(null);
  const [loopEnd, setLoopEnd] = useState<number | null>(null);

  useEffect(() => {
    if (!selectedBone) return;
    setOpenBones((current) => (current.has(selectedBone) ? current : new Set(current).add(selectedBone)));
  }, [selectedBone]);
  useEffect(() => { setLoopStart(null); setLoopEnd(null); }, [animName]);
  useEffect(() => {
    if (!player) return;
    player.playRange = loopStart === null && loopEnd === null
      ? null
      : { start: loopStart ?? 0, end: loopEnd ?? duration };
  }, [player, loopStart, loopEnd, duration]);

  const view = useTimelineView({ duration, position, playing, follow, animKey: animName, onSeek: props.onSeek });
  const drags = useKeyDrags({
    enabled: !!player,
    pxPerFrame: view.rs.pxPerFrame,
    keySelection,
    onKeySelection: props.onKeySelection,
    onKeysMove: props.onKeysMove,
    onKeysScale: props.onKeysScale,
  });

  const lanes = useMemo(
    () => buildLanes(rows, props.extraTracks, openBones, openTracks),
    [rows, props.extraTracks, openBones, openTracks],
  );
  const summary = useMemo(() => summaryFrames(lanes, props.allKeyFrames), [lanes, props.allKeyFrames]);
  const toggle = (setter: typeof setOpenBones, key: string) => setter((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const columnSelected = (frame: number) => keySelection.length > 0
    && keySelection.every((entry) => Math.round(entry.frame) === Math.round(frame));

  const expandAll = () => {
    setOpenBones(new Set(rows.map((row) => row.name)));
    setOpenTracks(new Set(props.extraTracks.filter((track) => track.channels?.length).map((track) => track.id)));
  };
  const collapseAll = () => { setOpenBones(new Set()); setOpenTracks(new Set()); };

  /** 右键菜单：树名区 → 树菜单；关键帧区 → 先把播放头移到该帧，没选中时选中这一行在该帧的键（官方 `Timeline.as:1506-1529`） */
  const [menu, setMenu] = useState<{ x: number; y: number; kind: 'frame' | 'tree'; bone: string | null; span?: { channel?: BoneChannelName; frame: number; tween: boolean } } | null>(null);
  const hasSelection = keySelection.length + props.trackSelection.length > 0;
  const onMainContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const target = event.target as HTMLElement;
    const lane = lanes.find((entry) => entry.id === target.closest<HTMLElement>('[data-lane]')?.dataset.lane);
    const bone = lane && (lane.kind === 'bone' || lane.kind === 'chan') ? lane.row.name : null;
    if (target.closest('.dbtl-name')) {
      if (bone) props.onSelectBone(bone);
      setMenu({ x: event.clientX, y: event.clientY, kind: 'tree', bone });
      return;
    }
    const laneEl = target.closest<HTMLElement>('.dbtl-lane');
    if (!laneEl || !lane) return;
    const frame = Math.max(0, Math.round(xToFrame(event.clientX - laneEl.getBoundingClientRect().left, view.rs, view.startIndex)));
    props.onSeek(frame);
    const onKey = lane.keys.some((key) => Math.round(key.frame) === frame);
    // 补间线：点在两键之间（不在键上），归属段起点那个键（官方右键补间线只给「删除补间」）
    const owner = !onKey && bone ? lane.keys.findIndex((key, index) => key.frame < frame && (lane.keys[index + 1]?.frame ?? -1) > frame) : -1;
    const span = owner >= 0 ? { channel: lane.kind === 'chan' ? lane.channel : undefined, frame: lane.keys[owner].frame, tween: lane.keys[owner].tween !== 0 } : undefined;
    if (!hasSelection && onKey) {
      if (bone) {
        // 通道子行上右键：只选中这个通道的键（不带出另外两条通道）
        const channel = lane?.kind === 'chan' ? lane.channel : undefined;
        props.onKeySelection([channel ? { bone, frame, channel } : { bone, frame }]);
      }
      else if (lane.kind === 'track' || lane.kind === 'trackChan') {
        props.onTrackSelection(expandTrackRef(lane.track, lane.kind === 'trackChan' ? lane.channel.id : null, frame), false);
      }
    }
    if (bone) props.onSelectBone(bone);
    setMenu({ x: event.clientX, y: event.clientY, kind: 'frame', bone, span });
  };
  const frameEntries = (): TimelineMenuEntry[] => {
    const entries: TimelineMenuEntry[] = [];
    const tween = props.boneTween;
    const span = menu?.span;
    const spanBone = menu?.bone;
    if (span && spanBone) {
      entries.push(span.tween
        ? { key: 'deleteTween', label: '删除补间', onClick: () => props.onSpanTween(spanBone, span.channel, span.frame, false) }
        : { key: 'addTween', label: '添加补间', onClick: () => props.onSpanTween(spanBone, span.channel, span.frame, true) });
    } else if (tween?.exact && tween.tween === 'none' && !tween.last) entries.push({ key: 'addTween', label: '添加补间', onClick: () => props.onTween(false) });
    if (tween?.exact && tween.tween !== 'none') entries.push({ key: 'deleteTween', label: '删除补间', onClick: () => props.onTween(true) });
    if (entries.length > 0) entries.push('sep');
    entries.push(
      { key: 'cut', label: '剪切帧', disabled: !hasSelection, onClick: props.onCutKeys },
      { key: 'copy', label: '复制帧', disabled: !hasSelection, onClick: props.onCopyKeys },
      { key: 'paste', label: '粘贴帧', disabled: !props.hasClipboard, onClick: props.onPasteKeys },
      { key: 'delete', label: '删除帧', disabled: !hasSelection, onClick: props.onDeleteKeys },
      'sep',
      { key: 'selectAll', label: '选中全部关键帧', onClick: props.onSelectAllKeys },
    );
    return entries;
  };
  const treeEntries = (bone: string | null): TimelineMenuEntry[] => [
    { key: 'showAll', label: '显示并解锁全部', onClick: () => { props.onArmatureVisible('all'); props.onArmatureSelectable('all'); } },
    { key: 'hideOthers', label: '隐藏其他', disabled: !bone, onClick: () => { if (bone) props.onIsolate(bone, 'hide'); } },
    { key: 'lockOthers', label: '锁定其他', disabled: !bone, onClick: () => { if (bone) props.onIsolate(bone, 'lock'); } },
    'sep',
    { key: 'expandAll', label: '展开全部', onClick: expandAll },
    { key: 'collapseAll', label: '折叠全部', onClick: collapseAll },
  ];

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const y0 = event.clientY;
    const from = height;
    const move = (e: PointerEvent) => onHeight(Math.max(140, Math.min(620, from - (e.clientY - y0))));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  if (props.sheetPanel) {
    return (
      <div className="timeline-dock" style={{ height }} onPointerEnter={() => props.onFocusArea?.('timeline')}>
        <div className="timeline-resizer" onPointerDown={startResize} title="拖动调整高度" />
        <Tabs tabs={SHEET_TABS} active="sheet" onChange={() => {}} tools={props.sheetTools} />
        {props.sheetPanel}
      </div>
    );
  }

  // 官方 `Timeline.play`：正在播（不论正放倒放）就停，否则正放
  const play = () => {
    if (!player) return;
    player.reverse = false;
    props.onTogglePlay();
  };
  const playback = () => {
    if (!player) return;
    if (player.playing && player.reverse) { props.onTogglePlay(); player.reverse = false; return; }
    player.reverse = true;
    if (!player.playing) props.onTogglePlay();
  };

  const disabled = !player;
  return (
    <div className="timeline-dock dbtl" style={{ height }} onPointerEnter={() => props.onFocusArea?.('timeline')}>
      <div className="timeline-resizer" onPointerDown={startResize} title="拖动调整时间轴高度" />
      <Tabs
        tabs={TABS}
        active={props.tab}
        onChange={props.onTab}
        tools={(
          <TimelineTransport
            disabled={disabled}
            position={position}
            duration={duration}
            frameRate={player?.frameRate ?? 24}
            playing={playing}
            reverse={!!player?.reverse}
            loop={props.loop}
            speed={props.speed}
            follow={follow}
            loopStart={loopStart}
            loopEnd={loopEnd}
            onSeek={props.onSeek}
            onPlay={play}
            onPlayback={playback}
            onLoop={props.onLoop}
            onSpeed={props.onSpeed}
            onFollow={setFollow}
            onLoopStart={setLoopStart}
            onLoopEnd={setLoopEnd}
          />
        )}
      />
      <div className="dbtl-main" onPointerDown={view.onPanPointerDown} onContextMenu={onMainContextMenu}>
        <TimelineHeader
          rs={view.rs}
          startIndex={view.startIndex}
          laneWidth={view.laneWidth}
          loopStart={loopStart}
          loopEnd={loopEnd}
          animName={animName}
          disabled={disabled}
          allVisible={rows.length > 0 && rows.every((row) => !props.hiddenBones.has(row.name))}
          allSelectable={rows.length > 0 && rows.every((row) => !props.lockedBones.has(row.name))}
          onArmatureVisible={props.onArmatureVisible}
          onArmatureSelectable={props.onArmatureSelectable}
          summary={summary}
          columnSelected={columnSelected}
          onSelectColumn={props.onSelectColumn}
          onion={props.onion}
          onOnion={props.onOnion}
          onShiftFrames={props.onShiftFrames}
          onToggleKey={props.onToggleKey}
          rulerRef={view.rulerRef}
          onRulerPointerDown={view.onRulerPointerDown}
          position={position}
          {...props.headerTools}
        />
        <div className="dbtl-body" ref={view.bodyRef}>
          <TimelineRows
            lanes={lanes}
            rs={view.rs}
            startIndex={view.startIndex}
            laneWidth={view.laneWidth}
            openBones={openBones}
            openTracks={openTracks}
            onToggleBone={(name) => toggle(setOpenBones, name)}
            onToggleTrack={(id) => toggle(setOpenTracks, id)}
            selectedBone={selectedBone}
            selectedTrack={props.selectedTrack}
            hiddenBones={props.hiddenBones}
            lockedBones={props.lockedBones}
            onSelectBone={props.onSelectBone}
            onSelectTrack={props.onSelectTrack}
            onToggleRowVisible={props.onToggleRowVisible}
            onToggleRowLock={props.onToggleRowLock}
            onToggleTrackKey={props.onToggleTrackKey}
            onTrackKeyClick={props.onTrackKeyClick}
            trackSelection={props.trackSelection}
            onTrackSelection={props.onTrackSelection}
            onSeek={props.onSeek}
            isPicked={drags.isPicked}
            shiftPx={drags.shiftPx}
            onKeyPointerDown={drags.startKeyDrag}
            onKeyClick={(bone, frame) => { props.onSelectBone(bone); props.onSeek(frame); props.onTrackSelection([], false); }}
            keySelection={keySelection}
            onKeySelection={props.onKeySelection}
            selection={drags.selection}
            scaleFactor={drags.scaleFactor}
            onScaleHandleDown={drags.startScaleDrag}
            empty={rows.length === 0 ? <div className="dbtl-empty">载入 DragonBones 工程后在此编辑关键帧</div> : null}
          />
        </div>
        <TimelineOverlay
          rs={view.rs}
          startIndex={view.startIndex}
          laneWidth={view.laneWidth}
          position={position}
          duration={duration}
          loopStart={loopStart}
          loopEnd={loopEnd}
          show={!!player}
        />
              </div>
      <TimelineStatusBar
        disabled={disabled}
        onExpandAll={expandAll}
        onCollapseAll={collapseAll}
        filterOn={props.filterOn ?? true}
        onFilter={(value) => props.onFilter?.(value)}
        {...props.filterLock}
        canEditKeys={hasSelection}
        canPaste={props.hasClipboard}
        canDistribute={keySelection.length >= 3}
        onCopy={props.onCopyKeys}
        onCut={props.onCutKeys}
        onPaste={props.onPasteKeys}
        onDelete={props.onDeleteKeys}
        onDistribute={props.onDistributeKeys}
        startIndex={view.startIndex}
        visible={view.visible}
        lastFrame={duration}
        onStartIndex={view.setStartIndex}
        scale={view.rs.scale}
        onScale={view.setScale}
        onFit={view.fit}
        onZoomIn={view.zoomIn}
        onZoomOut={view.zoomOut}
      />
      {menu && (
        <TimelineContextMenu
          x={menu.x}
          y={menu.y}
          title={menu.kind}
          entries={menu.kind === 'frame' ? frameEntries() : treeEntries(menu.bone)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
