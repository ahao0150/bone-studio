import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { TlButton } from './TimelineButton';
import { SCALE_MIN, TL } from '../timelineLayout';

/**
 * 底部状态栏 26px（`_978/TimelinePanel.as:406-474`）：
 * 左 236px = 展开 / 折叠列表 · 过滤组（只显示选中 / 锁定 / 刷新 / 选择）· 复制 / 剪切 / 粘贴 / 删除；
 * 右 = 按「起始帧」滚动的横向滚动条（`_994.setData(末帧, 一屏帧数, 起始帧)`）+ 最适合 / 缩小 / 滑块 / 放大。
 */
export interface TimelineStatusBarProps {
  disabled: boolean;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  filterOn: boolean;
  onFilter: (value: boolean) => void;
  /** 锁定后时间轴只显示锁定那一刻的骨骼，不随选中变化 */
  filterLocked: boolean;
  onFilterLock: (value: boolean) => void;
  onFilterRefresh: () => void;
  onFilterSelect: () => void;
  canEditKeys: boolean;
  canPaste: boolean;
  canDistribute: boolean;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onDelete: () => void;
  onDistribute: () => void;
  startIndex: number;
  visible: number;
  lastFrame: number;
  onStartIndex: (value: number) => void;
  scale: number;
  onScale: (value: number) => void;
  onFit: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

export function TimelineStatusBar(props: TimelineStatusBarProps) {
  const { disabled, startIndex, visible, lastFrame } = props;
  const trackRef = useRef<HTMLDivElement>(null);
  const total = Math.max(lastFrame + 1, startIndex + visible, 1);
  const thumbPct = Math.min(100, (visible / total) * 100);
  const leftPct = Math.min(100 - thumbPct, (startIndex / total) * 100);

  const dragThumb = (event: ReactPointerEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    if (!track || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const width = track.clientWidth || 1;
    const x0 = event.clientX;
    const from = startIndex;
    const move = (e: PointerEvent) => {
      props.onStartIndex(Math.max(0, Math.round(from + ((e.clientX - x0) / width) * total)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const pageTrack = (event: ReactPointerEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    if (!track || event.target !== track) return;
    const rect = track.getBoundingClientRect();
    const at = ((event.clientX - rect.left) / Math.max(1, rect.width)) * total;
    props.onStartIndex(Math.max(0, at < startIndex ? startIndex - visible : startIndex + visible));
  };

  return (
    <div className="dbtl-status" style={{ height: TL.STATUS_H }}>
      <div className="dbtl-status-left" style={{ width: TL.NAME_W - 6 }}>
        <TlButton icon="expandAll" title="展开列表" disabled={disabled} onClick={props.onExpandAll} data={{ 'data-tl-expand-all': '' }} />
        <TlButton icon="collapseAll" title="折叠列表" disabled={disabled} onClick={props.onCollapseAll} data={{ 'data-tl-collapse-all': '' }} />
        <span className="dbtl-gap" />
        <TlButton
          icon={props.filterOn ? 'filterClose' : 'filterOpen'}
          title="只显示选中时间轴(Ctrl+D)"
          on={props.filterOn}
          disabled={disabled}
          onClick={() => props.onFilter(!props.filterOn)}
          data={{ 'data-tl-filter': props.filterOn ? 'on' : 'off' }}
        />
        <TlButton icon="lock" title="锁定时间轴显示的骨骼" on={props.filterLocked} disabled={disabled} onClick={() => props.onFilterLock(!props.filterLocked)} data={{ 'data-tl-filter-lock': props.filterLocked ? 'on' : 'off' }} />
        <TlButton icon="refresh" title="更新锁定状态下时间轴显示的骨骼" disabled={disabled || !props.filterLocked} onClick={props.onFilterRefresh} data={{ 'data-tl-filter-refresh': '' }} />
        <TlButton icon="cursor" title="选中锁定状态下时间轴内显示的骨骼" disabled={disabled || !props.filterLocked} onClick={props.onFilterSelect} data={{ 'data-tl-filter-select': '' }} />
        <span className="dbtl-gap" />
        <TlButton icon="copy" title="复制关键帧(Ctrl+C)" disabled={!props.canEditKeys} onClick={props.onCopy} data={{ 'data-key-action': 'copy' }} />
        <TlButton icon="cut" title="剪切关键帧(Ctrl+X)" disabled={!props.canEditKeys} onClick={props.onCut} data={{ 'data-key-action': 'cut' }} />
        <TlButton icon="paste" title="粘贴关键帧(Ctrl+V)" disabled={!props.canPaste} onClick={props.onPaste} data={{ 'data-key-action': 'paste' }} />
        <TlButton icon="trash" title="删除关键帧(Delete)" disabled={!props.canEditKeys} onClick={props.onDelete} data={{ 'data-key-action': 'delete' }} />
        <TlButton icon="distribute" title="分布到关键帧" disabled={!props.canDistribute} onClick={props.onDistribute} data={{ 'data-key-action': 'distribute' }} />
      </div>
      <div className="dbtl-status-right">
        <div className="dbtl-hscroll" ref={trackRef} onPointerDown={pageTrack} data-tl-hscroll="">
          <div className="dbtl-hthumb" style={{ left: `${leftPct}%`, width: `${thumbPct}%` }} onPointerDown={dragThumb} />
        </div>
        <div className="dbtl-zoom">
          <TlButton icon="fit" title="最适合" disabled={disabled} onClick={props.onFit} data={{ 'data-tl-zoom': 'fit' }} />
          <TlButton icon="meshMinus" title="缩小" disabled={disabled} onClick={props.onZoomOut} data={{ 'data-tl-zoom': 'out' }} />
          <input
            className="dbtl-zoom-slider"
            type="range"
            min={Math.ceil(SCALE_MIN * 100 * 100) / 100}
            max={100}
            step={0.25}
            value={props.scale * 100}
            disabled={disabled}
            onChange={(event) => props.onScale(Number(event.target.value) / 100)}
            data-tl-zoom-slider=""
          />
          <TlButton icon="meshPlus" title="放大" disabled={disabled} onClick={props.onZoomIn} data={{ 'data-tl-zoom': 'in' }} />
        </div>
      </div>
    </div>
  );
}
