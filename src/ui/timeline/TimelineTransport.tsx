import { Icon } from '../icons';
import { PLAY_RATE } from '../timelineLayout';

/**
 * 页签栏右侧（`_978/TimelinePanel.as:363-405` 的 `_2527`），从左到右：
 * [当前 ▢][开始 ▢][结束 ▢] · 首帧 / 前一帧 / 倒放 / 播放 / 后一帧 / 尾帧 / 循环 · 速度: 滑块 xN · 时间: 0.00 s 帧率: N
 * 「当前」= 播放时自动滚动时间轴；「开始 / 结束」= 把当前帧设成循环区间的起点 / 终点，再点取消。
 */
export interface TimelineTransportProps {
  disabled: boolean;
  position: number;
  duration: number;
  frameRate: number;
  playing: boolean;
  reverse: boolean;
  loop: boolean;
  speed: number;
  follow: boolean;
  loopStart: number | null;
  loopEnd: number | null;
  onSeek: (frame: number) => void;
  onPlay: () => void;
  onPlayback: () => void;
  onLoop: (value: boolean) => void;
  onSpeed: (value: number) => void;
  onFollow: (value: boolean) => void;
  onLoopStart: (frame: number | null) => void;
  onLoopEnd: (frame: number | null) => void;
}

function rateIndex(speed: number): number {
  let best = 0;
  PLAY_RATE.forEach((rate, index) => { if (Math.abs(rate - speed) < Math.abs(PLAY_RATE[best] - speed)) best = index; });
  return best;
}

const toFrame = (value: string, max: number) => Math.max(0, Math.min(max, Math.round(Number(value) || 0)));

export function TimelineTransport(props: TimelineTransportProps) {
  const { disabled, position, duration, frameRate } = props;
  const frame = Math.round(position);
  const rate = rateIndex(props.speed);
  const field = (
    label: string, title: string, on: boolean, toggle: () => void,
    value: number | null, onValue: (frame: number) => void, hook: string,
  ) => (
    <span className="dbtl-field">
      <button type="button" className={`dbtl-toggle${on ? ' on' : ''}`} title={title} disabled={disabled} onClick={toggle} data-tl-range={hook}>{label}</button>
      <input
        className={hook === 'current' ? 'tl-frame dbtl-num' : 'dbtl-num'}
        value={value ?? ''}
        disabled={disabled}
        inputMode="numeric"
        onChange={(event) => onValue(toFrame(event.target.value, duration))}
        data-tl-range-input={hook}
      />
    </span>
  );
  return (
    <div className="dbtl-transport">
      {field('当前', '播放时自动滚动时间轴', props.follow, () => props.onFollow(!props.follow), frame, props.onSeek, 'current')}
      {field('开始', '设置循环播放的起点为当前帧\n再次点击取消', props.loopStart !== null,
        () => props.onLoopStart(props.loopStart !== null ? null : frame), props.loopStart, (v) => props.onLoopStart(v), 'start')}
      {field('结束', '设置循环播放的终点为当前帧\n再次点击取消', props.loopEnd !== null,
        () => props.onLoopEnd(props.loopEnd !== null ? null : frame), props.loopEnd, (v) => props.onLoopEnd(v), 'end')}
      <span className="dbtl-sep" />
      <span className="dbtl-buttons">
        <button type="button" title="首帧" disabled={disabled} onClick={() => props.onSeek(0)}><Icon name="toStart" size={12} /></button>
        <button type="button" title="前一帧(T)" disabled={disabled} onClick={() => props.onSeek(Math.max(0, frame - 1))}><Icon name="prevKey" size={12} /></button>
        <button type="button" title="倒放" disabled={disabled} className={props.playing && props.reverse ? 'on' : ''} onClick={props.onPlayback} data-tl-playback=""><Icon name="play" size={12} className="flip" /></button>
        <button type="button" title="播放(Enter)" disabled={disabled} className={props.playing && !props.reverse ? 'on' : ''} onClick={props.onPlay} data-tl-play=""><Icon name={props.playing && !props.reverse ? 'pause' : 'play'} size={12} /></button>
        <button type="button" title="后一帧(G)" disabled={disabled} onClick={() => props.onSeek(Math.min(duration, frame + 1))}><Icon name="nextKey" size={12} /></button>
        <button type="button" title="尾帧" disabled={disabled} onClick={() => props.onSeek(duration)}><Icon name="toEnd" size={12} /></button>
        <button type="button" title="循环播放" disabled={disabled} className={props.loop ? 'on' : ''} onClick={() => props.onLoop(!props.loop)} data-tl-loop=""><Icon name="reset" size={12} /></button>
      </span>
      <span className="dbtl-sep" />
      <span className="dbtl-lab">速度:</span>
      <input
        className="dbtl-rate"
        type="range"
        min={0}
        max={PLAY_RATE.length - 1}
        step={1}
        value={rate}
        disabled={disabled}
        onChange={(event) => props.onSpeed(PLAY_RATE[Number(event.target.value)] ?? 1)}
        data-tl-rate=""
      />
      <span className="dbtl-readout rate">x{PLAY_RATE[rate]}</span>
      <span className="dbtl-sep" />
      <span className="dbtl-lab">时间:</span>
      <span className="dbtl-readout">{(position / Math.max(1, frameRate)).toFixed(2)} s</span>
      <span className="dbtl-lab">帧率:</span>
      <span className="dbtl-readout">{frameRate}</span>
    </div>
  );
}
