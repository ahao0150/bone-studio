import type { PointerEvent as ReactPointerEvent } from 'react';
import { KEY_COLOR, TL, TL_COLOR, frameToX, type RulerScale } from '../timelineLayout';
import type { ExtraTrack } from '../../core/timelineTracks';
import type { BoneChannelName } from '../../core/boneChannels';
import type { Lane, LaneKey } from './lanes';

/**
 * 一行的右半边（`_984` 行底 + `_983` 补间线 + `_986` 关键帧）。
 * 关键帧 6×23、左偏 3px；补间线画在行中线 y = 11，曲线补间画成 6px 起伏的 S 形。
 */
export interface LaneViewProps {
  lane: Lane;
  rs: RulerScale;
  startIndex: number;
  laneWidth: number;
  selected: boolean;
  grid: { size: number; offset: number };
  isPicked: (bone: string, frame: number, channel?: BoneChannelName) => boolean;
  shiftPx: number;
  onKeyPointerDown: (event: ReactPointerEvent<HTMLSpanElement>, bone: string, frame: number, channel?: BoneChannelName) => void;
  onKeyClick: (bone: string, frame: number, channel?: BoneChannelName) => void;
  /** 轨道 / 通道行上的键：channel 为空表示整条轨道（汇总行） */
  onTrackKeyClick: (track: ExtraTrack, channel: string | null, frame: number, additive: boolean) => void;
  isTrackPicked: (frame: number) => boolean;
}

const BONE_KEY = '#FFFFFF';
const MID = TL.ROW_H / 2 - 1;
const CURVE_GAP = 14;
const HALF_GAP = 7;
const CURVE_H = 6;

function tweenPath(keys: LaneKey[], toX: (frame: number) => number, width: number, picked: (key: LaneKey) => boolean) {
  const normal: string[] = [];
  const hot: string[] = [];
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (key.tween === 0) continue;
    const x1 = toX(key.frame);
    const x2 = toX(keys[i + 1].frame);
    if (x2 < 0 || x1 > width) continue;
    let d: string;
    if (key.tween === 2) {
      d = x2 - x1 > CURVE_GAP
        ? `M${x1},${MID + CURVE_H}L${x1 + HALF_GAP},${MID}L${x2 - HALF_GAP},${MID}L${x2},${MID - CURVE_H}`
        : `M${x1},${MID + CURVE_H}L${x2},${MID - CURVE_H}`;
    } else d = `M${x1},${MID}L${x2},${MID}`;
    (picked(key) ? hot : normal).push(d);
  }
  return { normal: normal.join(''), hot: hot.join('') };
}

export function LaneView(props: LaneViewProps) {
  const { lane, rs, startIndex, laneWidth, isPicked, shiftPx } = props;
  const toX = (frame: number) => frameToX(frame, rs, startIndex);
  const bone = lane.kind === 'bone' || lane.kind === 'chan' ? lane.row.name : null;
  // 子行只认自己的通道；汇总行（channel 缺省）认整帧
  const laneChannel = lane.kind === 'chan' ? lane.channel : undefined;
  const picked = (key: LaneKey) => !!bone && isPicked(bone, key.frame, laneChannel);
  const path = tweenPath(lane.keys, toX, laneWidth, picked);
  return (
    <div
      className="dbtl-lane"
      style={{
        backgroundImage: `linear-gradient(to right, ${TL_COLOR.tick} 1px, transparent 1px)`,
        backgroundSize: `${props.grid.size}px 100%`,
        backgroundPosition: `${props.grid.offset}px 0`,
      }}
    >
      {(path.normal || path.hot) && (
        <svg className="dbtl-tween" width={laneWidth} height={TL.ROW_H}>
          {path.normal && <path d={path.normal} stroke={TL_COLOR.curve} />}
          {path.hot && <path d={path.hot} stroke={TL_COLOR.curveSelected} />}
        </svg>
      )}
      {lane.keys.map((key) => {
        if (key.frame < startIndex) return null;
        const x = toX(key.frame);
        if (x > laneWidth + TL.KEY_W) return null;
        const chosen = picked(key);
        const shift = chosen ? shiftPx : 0;
        // 骨骼汇总行固定白色竖块（不随合并的通道数变色）；通道子行按通道取色（移动绿 / 旋转蓝 / 缩放红）
        const style = { left: x - TL.KEY_W / 2 + shift, background: lane.kind === 'bone' ? BONE_KEY : KEY_COLOR[key.kind] };
        if (bone) {
          return (
            <span
              key={`k-${key.frame}`}
              className={`dbtl-key${chosen ? ' picked' : ''}${shift ? ' dragging' : ''}`}
              style={style}
              {...(lane.kind === 'bone' ? { 'data-key': `${bone}@${key.frame}` } : { 'data-chan-key': `${lane.kind === 'chan' ? lane.channel : ''}@${key.frame}` })}
              data-sel-bone={bone}
              data-sel-frame={key.frame}
              data-sel-channel={laneChannel}
              title={`${bone} · ${lane.label} @ ${key.frame} 帧${chosen ? '（已选中）' : ''}`}
              onPointerDown={(event) => props.onKeyPointerDown(event, bone, key.frame, laneChannel)}
              onClick={(event) => { event.stopPropagation(); props.onKeyClick(bone, key.frame, laneChannel); }}
            />
          );
        }
        const track = lane.kind === 'track' || lane.kind === 'trackChan' ? lane.track : null;
        const channel = lane.kind === 'trackChan' ? lane.channel.id : null;
        const trackChosen = props.isTrackPicked(key.frame);
        return (
          <span
            key={`k-${key.frame}`}
            className={`dbtl-key${trackChosen ? ' picked' : ''}`}
            style={style}
            data-track-key={`${track?.id}@${key.frame}`}
            data-sel-track={channel ?? track?.id}
            data-sel-frame={key.frame}
            data-sel-group={lane.kind === 'track' ? '1' : undefined}
            title={`${lane.label} @ ${key.frame} 帧（点选；Ctrl 加选；框选后 Delete 删键）`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              if (track) props.onTrackKeyClick(track, channel, key.frame, event.ctrlKey || event.metaKey);
            }}
          />
        );
      })}
    </div>
  );
}
