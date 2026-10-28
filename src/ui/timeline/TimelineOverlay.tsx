import { TL, frameToX, type RulerScale } from '../timelineLayout';

/**
 * 叠在表头 + 轨道区上面、不吃鼠标的一层：
 * 播放头（`_992`：2px 绿线 + 顶部 10×5 倒三角，y = 2）、末帧红线（`_6795`：x = 末帧，从 y = 20 往下）、
 * 循环区起止标记（`_13565`：1px 青线 + 半个三角旗，y = 10、高 20）。
 */
export function TimelineOverlay(props: {
  rs: RulerScale;
  startIndex: number;
  laneWidth: number;
  position: number;
  duration: number;
  loopStart: number | null;
  loopEnd: number | null;
  show: boolean;
}) {
  const { rs, startIndex, laneWidth, position, duration, show } = props;
  if (!show) return null;
  const inView = (frame: number) => frame >= startIndex && frameToX(frame, rs, startIndex) <= laneWidth;
  const x = (frame: number) => frameToX(frame, rs, startIndex);
  const marker = (frame: number | null, side: 'start' | 'end') => (
    frame !== null && inView(frame) && (
      <div key={side} className={`dbtl-loopmark ${side}`} style={{ left: x(frame) }} data-tl-loopmark={side}>
        <span className="flag" />
        <span className="label">{frame}</span>
      </div>
    )
  );
  return (
    <div className="dbtl-overlay" style={{ left: TL.NAME_W, width: laneWidth }}>
      {inView(duration) && <div className="dbtl-endline" style={{ left: x(duration), top: TL.LAST_LINE_Y }} />}
      {marker(props.loopStart, 'start')}
      {marker(props.loopEnd, 'end')}
      {inView(Math.floor(position)) && (
        <div className="dbtl-playhead playhead" style={{ left: x(position) - 1 }} data-tl-playhead={Math.round(position)}>
          <span className="head" />
        </div>
      )}
    </div>
  );
}
