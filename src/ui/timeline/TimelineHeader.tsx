import { useRef, type PointerEvent as ReactPointerEvent, type Ref } from 'react';
import { Icon } from '../icons';
import { TlButton } from './TimelineButton';
import { TL, frameToX, rulerTicks, xToFrame, type RulerScale } from '../timelineLayout';

/**
 * 表头 58px（`_978/Timeline.as:356-440` + 皮肤 `_965/_973.as:79-174`）：
 * 左 242px = 上排工具（右对齐）+ 下排「动画图标 / 名字 / 眼睛 / 锁」；右 = 标尺 + 动画汇总帧条。
 */
export interface TimelineHeaderProps {
  rs: RulerScale;
  startIndex: number;
  laneWidth: number;
  loopStart: number | null;
  loopEnd: number | null;
  animName: string;
  disabled: boolean;
  allVisible: boolean;
  allSelectable: boolean;
  onArmatureVisible: (mode: 'all' | 'invert') => void;
  onArmatureSelectable: (mode: 'all' | 'invert') => void;
  summary: number[];
  columnSelected: (frame: number) => boolean;
  onSelectColumn: (frame: number) => void;
  onion: boolean;
  onOnion: (value: boolean) => void;
  onShiftFrames: (direction: -1 | 1) => void;
  onToggleKey: () => void;
  rulerRef: Ref<HTMLDivElement>;
  onRulerPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  position: number;
  autoKey: boolean;
  onAutoKey: (value: boolean) => void;
  multiFrame: boolean;
  onMultiFrame: (value: boolean) => void;
  onPrune: () => void;
  onCurveEditor: () => void;
  /** 洋葱皮范围：播放头前 / 后各几帧（标尺上拖两端的柄改） */
  onionBefore: number;
  onionAfter: number;
  onOnionRange: (before: number, after: number) => void;
}

const ONION_MAX = 20;

const LABEL_CLEAR = 18;

export function TimelineHeader(props: TimelineHeaderProps) {
  const { rs, startIndex, laneWidth, loopStart, loopEnd, disabled } = props;
  const ticks = rulerTicks(laneWidth, rs, startIndex);
  const inLoop = (frame: number) => loopStart !== null && loopEnd !== null && loopStart < loopEnd
    && frame > loopStart && frame < loopEnd;
  const visible = (frame: number) => frame >= startIndex && frameToX(frame, rs, startIndex) <= laneWidth;
  // 当前帧的数字始终显示且标绿（居中对齐绿线）；不落在刻度上时补一个，并让开挨得太近的邻居
  const current = Math.round(props.position);
  const curX = frameToX(current, rs, startIndex);
  const labeled = ticks.filter((tick) => tick.label);
  const labels = !visible(current) || labeled.some((tick) => tick.frame === current)
    ? labeled
    : [...labeled.filter((tick) => Math.abs(tick.x - curX) >= LABEL_CLEAR), { frame: current, x: curX }];
  return (
    <div className="dbtl-header" style={{ height: TL.LABEL_H }}>
      <div className="dbtl-header-left" style={{ width: TL.NAME_W }}>
        <div className="dbtl-tools">
          <TlButton icon="x" title="删除非必要帧：去掉与前后关键帧数值相同、不改变动画的帧" disabled={disabled} onClick={props.onPrune} data={{ 'data-tl-prune': '' }} />
          <TlButton icon="marquee" title="编辑多帧：改一个选中的关键帧，其余选中的关键帧加上同样的增量" on={props.multiFrame} disabled={disabled} onClick={() => props.onMultiFrame(!props.multiFrame)} data={{ 'data-tl-multiframe': props.multiFrame ? 'on' : 'off' }} />
          <TlButton icon="layers" title="洋葱皮" on={props.onion} disabled={disabled} onClick={() => props.onOnion(!props.onion)} />
          <TlButton icon="prevKey" title="向左移动帧：删掉当前帧，后面的帧整体前移" disabled={disabled} onClick={() => props.onShiftFrames(-1)} data={{ 'data-tl-shift': 'left' }} />
          <TlButton icon="nextKey" title="向右移动帧：插入一帧，后面的帧整体后移" disabled={disabled} onClick={() => props.onShiftFrames(1)} data={{ 'data-tl-shift': 'right' }} />
          <TlButton icon="key" title="自动关键帧：属性变化时在播放头处自动添加 / 修改关键帧" on={props.autoKey} disabled={disabled} onClick={() => props.onAutoKey(!props.autoKey)} data={{ 'data-tl-autokey': props.autoKey ? 'on' : 'off' }} />
          <TlButton icon="flag" title="添加关键帧(K)" disabled={disabled} onClick={props.onToggleKey} data={{ 'data-tl-add-key': '' }} />
          <TlButton icon="curveEaseInOut" title="曲线编辑器" disabled={disabled} onClick={props.onCurveEditor} data={{ 'data-tl-curve-editor': '' }} />
        </div>
        <div className="dbtl-anim-line">
          <span className="dbtl-anim-icon"><Icon name="clock" size={13} /></span>
          <span className="dbtl-anim-name" title={props.animName}>{props.animName}</span>
          <button
            type="button"
            className={`dbtl-flag eye${props.allVisible ? ' on' : ''}`}
            style={{ left: 162 }}
            data-tl-armature-eye=""
            title="全部显示（Shift：显隐反选）"
            onClick={(event) => props.onArmatureVisible(event.shiftKey ? 'invert' : 'all')}
          >
            <Icon name="eye" size={12} />
          </button>
          <button
            type="button"
            className={`dbtl-flag lock${props.allSelectable ? '' : ' on'}`}
            style={{ left: 186 }}
            data-tl-armature-lock=""
            title="全部可选（Shift：可选反选）"
            onClick={(event) => props.onArmatureSelectable(event.shiftKey ? 'invert' : 'all')}
          >
            <Icon name="lock" size={12} />
          </button>
        </div>
      </div>
      <div className="dbtl-ruler" ref={props.rulerRef} onPointerDown={props.onRulerPointerDown} title="点击或拖动定位播放头；滚轮缩放；右键拖动平移">
        <div className="dbtl-summary" style={{ top: TL.SUMMARY_Y, height: TL.KEY_H }} />
        {ticks.map((tick) => (
          <span
            key={`t-${tick.frame}`}
            className={`dbtl-tick${tick.long ? ' long' : ''}`}
            style={{ left: tick.x, top: TL.LABEL_H - (tick.long ? TL.LONG_LINE : TL.SHORT_LINE) - 2, height: tick.long ? TL.LONG_LINE : TL.SHORT_LINE }}
          />
        ))}
        {labels.map((tick) => (
          <span
            key={`l-${tick.frame}`}
            className={`dbtl-tick-label${tick.frame === current ? ' current' : inLoop(tick.frame) ? ' loop' : ''}`}
            style={{ left: tick.x }}
          >
            {tick.frame}
          </span>
        ))}
        {props.onion && !disabled && (
          <OnionRange {...props} curX={curX} current={current} />
        )}
        {props.summary.filter(visible).map((frame) => (
          <span
            key={`s-${frame}`}
            className={`dbtl-diamond${props.columnSelected(frame) ? ' picked' : ''}`}
            style={{ left: frameToX(frame, rs, startIndex), top: TL.SUMMARY_Y + TL.KEY_H / 2 - 4 }}
            title={`选中第 ${frame} 帧这一列（该帧上所有骨骼的关键帧）`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => props.onSelectColumn(frame)}
          />
        ))}
      </div>
    </div>
  );
}

/** 洋葱皮范围（官方摄影表文档「播放头左右两侧会出现洋葱皮工具」）：两端的柄拖动改前 / 后帧数。 */
function OnionRange(props: TimelineHeaderProps & { curX: number; current: number }) {
  const { rs, startIndex, current, onionBefore, onionAfter } = props;
  const latest = useRef({ before: onionBefore, after: onionAfter });
  latest.current = { before: onionBefore, after: onionAfter };
  const left = frameToX(current - onionBefore, rs, startIndex);
  const right = frameToX(current + onionAfter, rs, startIndex);
  const drag = (side: 'before' | 'after') => (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const ruler = (event.currentTarget as HTMLElement).closest('.dbtl-ruler');
    if (!ruler) return;
    const rect = ruler.getBoundingClientRect();
    const move = (e: PointerEvent) => {
      const frame = Math.round(xToFrame(e.clientX - rect.left, rs, startIndex));
      const count = Math.max(0, Math.min(ONION_MAX, side === 'before' ? current - frame : frame - current));
      const next = { ...latest.current, [side]: count };
      if (next.before !== latest.current.before || next.after !== latest.current.after) props.onOnionRange(next.before, next.after);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <>
      <span className="dbtl-onion-band before" style={{ left, width: Math.max(0, props.curX - left) }} />
      <span className="dbtl-onion-band after" style={{ left: props.curX, width: Math.max(0, right - props.curX) }} />
      <span className="dbtl-onion-handle before" style={{ left }} data-tl-onion="before" title={`洋葱皮：向前 ${onionBefore} 帧（拖动修改）`} onPointerDown={drag('before')} />
      <span className="dbtl-onion-handle after" style={{ left: right }} data-tl-onion="after" title={`洋葱皮：向后 ${onionAfter} 帧（拖动修改）`} onPointerDown={drag('after')} />
    </>
  );
}