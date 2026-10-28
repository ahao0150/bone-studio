import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { KeySelectionEntry } from '../../core/keyEdit';
import { expandTrackRef, type TrackKeyRef } from '../../core/trackKeyEdit';
import type { ExtraTrack } from '../../core/timelineTracks';
import { TL, frameToX, gridBackground, xToFrame, type RulerScale } from '../timelineLayout';
import type { Lane } from './lanes';
import { NameCell } from './TimelineNameCell';
import { LaneView } from './TimelineLane';

/** 轨道区：每行 = 左 242px 树节点 + 右侧轨道。框选 / 单击定位在这里做。 */
export interface TimelineRowsProps {
  lanes: Lane[];
  rs: RulerScale;
  startIndex: number;
  laneWidth: number;
  openBones: Set<string>;
  openTracks: Set<string>;
  onToggleBone: (name: string) => void;
  onToggleTrack: (id: string) => void;
  selectedBone: string | null;
  selectedTrack: string | null;
  hiddenBones: Set<string>;
  lockedBones: Set<string>;
  onSelectBone: (name: string) => void;
  onSelectTrack: (id: string | null) => void;
  onToggleRowVisible: (name: string) => void;
  onToggleRowLock: (name: string) => void;
  onToggleTrackKey: (trackId: string, channelId?: string) => void;
  onTrackKeyClick: (track: ExtraTrack, channel: string | null, frame: number, additive: boolean) => void;
  trackSelection: TrackKeyRef[];
  onTrackSelection: (refs: TrackKeyRef[], additive: boolean) => void;
  onSeek: (frame: number) => void;
  isPicked: (bone: string, frame: number, channel?: KeySelectionEntry['channel']) => boolean;
  shiftPx: number;
  onKeyPointerDown: (event: ReactPointerEvent<HTMLSpanElement>, bone: string, frame: number, channel?: KeySelectionEntry['channel']) => void;
  onKeyClick: (bone: string, frame: number, channel?: KeySelectionEntry['channel']) => void;
  keySelection: KeySelectionEntry[];
  onKeySelection: (selection: KeySelectionEntry[]) => void;
  /** 选中关键帧的帧范围 + 右缘缩放手柄（框画在选中键所在的行上） */
  selection: { min: number; max: number; count: number };
  scaleFactor: number;
  onScaleHandleDown: (event: ReactPointerEvent<HTMLSpanElement>) => void;
  empty?: ReactNode;
}

interface Band { x0: number; y0: number; x1: number; y1: number }
const DRAG_PX = 4;

export function TimelineRows(props: TimelineRowsProps) {
  const { lanes, rs, startIndex, laneWidth } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const [band, setBand] = useState<Band | null>(null);
  const grid = gridBackground(rs, startIndex);
  const trackKeys = new Set(props.trackSelection.map((ref) => `${ref.channel}@${Math.round(ref.frame)}`));
  const tracks = new Map(lanes.flatMap((lane) => (lane.kind === 'track' || lane.kind === 'trackChan') ? [[lane.track.id, lane.track] as const] : []));
  const selectLane = (lane: Lane) => {
    if (lane.kind === 'bone' || lane.kind === 'chan') props.onSelectBone(lane.row.name);
    else props.onSelectTrack(lane.track.id);
  };
  /** 高亮只落在被选中的那一行：骨骼选中只亮骨骼行，三条通道子行不跟着变色 */
  const rowSelected = (lane: Lane) => (lane.kind === 'bone' ? props.selectedBone === lane.row.name
    : lane.kind === 'track' ? props.selectedTrack === lane.track.id : false);
  const trackPicked = (lane: Lane, frame: number) => (lane.kind === 'track' || lane.kind === 'trackChan')
    && expandTrackRef(lane.track, lane.kind === 'trackChan' ? lane.channel.id : null, frame)
      .some((ref) => trackKeys.has(`${ref.channel}@${Math.round(frame)}`));
  const lanePicked = (lane: Lane) => lane.keys.some((key) => (lane.kind === 'bone' || lane.kind === 'chan'
    ? props.isPicked(lane.row.name, key.frame, lane.kind === 'chan' ? lane.channel : undefined)
    : false));
  const pickedRows = lanes.map((lane, index) => (lanePicked(lane) ? index : -1)).filter((index) => index >= 0);
  const sel = props.selection;
  const box = sel.count > 1 && sel.max > sel.min && pickedRows.length > 0
    ? {
      left: TL.NAME_W + frameToX(sel.min, rs, startIndex) - TL.KEY_W / 2 - 2 + props.shiftPx,
      width: (sel.max - sel.min) * rs.pxPerFrame * props.scaleFactor + TL.KEY_W + 4,
      top: pickedRows[0] * TL.ROW_H,
      height: (pickedRows[pickedRows.length - 1] - pickedRows[0] + 1) * TL.ROW_H - 1,
    }
    : null;

  const startBand = (event: ReactPointerEvent<HTMLDivElement>) => {
    const host = hostRef.current;
    if (!host || event.button !== 0) return;
    const laneEl = (event.target as HTMLElement).closest<HTMLElement>('.dbtl-lane');
    if (!laneEl) return;
    const rect = host.getBoundingClientRect();
    const laneLeft = laneEl.getBoundingClientRect().left;
    const startX = event.clientX;
    const startY = event.clientY;
    const x0 = startX - rect.left;
    const y0 = startY - rect.top;
    // 官方 `Shortcut._1677()`：只有 Ctrl / Cmd 是加选，Shift 不加选
    const additive = event.ctrlKey || event.metaKey;
    setBand({ x0, y0, x1: x0, y1: y0 });
    const move = (e: PointerEvent) => setBand({ x0, y0, x1: e.clientX - rect.left, y1: e.clientY - rect.top });
    const up = (e: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setBand(null);
      // 单击轨道空白处：选中该行 + 移播放头，并取消已选中的关键帧（用户第 210 轮要求，覆盖第 207 轮「不动选区」）
      if (Math.abs(e.clientX - startX) < DRAG_PX && Math.abs(e.clientY - startY) < DRAG_PX) {
        const lane = lanes.find((entry) => entry.id === laneEl.closest<HTMLElement>('[data-lane]')?.dataset.lane);
        if (lane) selectLane(lane);
        if (props.keySelection.length > 0) props.onKeySelection([]);
        if (props.trackSelection.length > 0) props.onTrackSelection([], false);
        props.onSeek(Math.max(0, Math.round(xToFrame(startX - laneLeft, rs, startIndex))));
        return;
      }
      const left = Math.min(startX, e.clientX) - 1;
      const right = Math.max(startX, e.clientX) + 1;
      const top = Math.min(startY, e.clientY);
      const bottom = Math.max(startY, e.clientY);
      const hit = (el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        return !(r.right < left || r.left > right || r.bottom < top || r.top > bottom);
      };
      const picked = new Map<string, KeySelectionEntry>();
      const keyOf = (entry: KeySelectionEntry) => `${entry.bone}#${Math.round(entry.frame * 1000)}#${entry.channel ?? ''}`;
      host.querySelectorAll<HTMLElement>('[data-sel-bone]').forEach((el) => {
        if (!hit(el)) return;
        const bone = el.dataset.selBone ?? '';
        const frame = Number(el.dataset.selFrame);
        const channel = el.dataset.selChannel as KeySelectionEntry['channel'];
        const entry: KeySelectionEntry = channel ? { bone, frame, channel } : { bone, frame };
        picked.set(keyOf(entry), entry);
      });
      if (additive) for (const entry of props.keySelection) picked.set(keyOf(entry), entry);
      props.onKeySelection([...picked.values()]);
      const refs: TrackKeyRef[] = [];
      host.querySelectorAll<HTMLElement>('[data-sel-track]').forEach((el) => {
        if (!hit(el)) return;
        const id = el.dataset.selTrack ?? '';
        const frame = Number(el.dataset.selFrame);
        if (el.dataset.selGroup) {
          const track = tracks.get(id);
          if (track) refs.push(...expandTrackRef(track, null, frame));
        } else refs.push({ channel: id, frame });
      });
      props.onTrackSelection(refs, additive);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="dbtl-rows" ref={hostRef} onPointerDown={startBand}>
      {lanes.map((lane) => {
        const isBone = lane.kind === 'bone' || lane.kind === 'chan';
        const selected = rowSelected(lane);
        const open = lane.kind === 'bone' ? props.openBones.has(lane.row.name)
          : lane.kind === 'track' ? props.openTracks.has(lane.track.id) : false;
        const isTrackPicked = (frame: number) => trackPicked(lane, frame);
        return (
          <div key={lane.id} className={`dbtl-row kind-${lane.kind} tone-${lane.tone}${selected ? ' selected' : ''}`} data-lane={lane.id}>
            <NameCell
              lane={lane}
              open={open}
              selected={selected}
              hidden={isBone && props.hiddenBones.has(lane.row.name)}
              locked={isBone && props.lockedBones.has(lane.row.name)}
              onToggleOpen={() => {
                if (lane.kind === 'bone') props.onToggleBone(lane.row.name);
                else if (lane.kind === 'track') props.onToggleTrack(lane.track.id);
              }}
              onSelect={() => selectLane(lane)}
              onToggleVisible={props.onToggleRowVisible}
              onToggleLock={props.onToggleRowLock}
              onToggleTrackKey={props.onToggleTrackKey}
            />
            <LaneView
              lane={lane}
              rs={rs}
              startIndex={startIndex}
              laneWidth={laneWidth}
              selected={selected}
              grid={grid}
              isPicked={props.isPicked}
              isTrackPicked={isTrackPicked}
              shiftPx={props.shiftPx}
              onKeyPointerDown={props.onKeyPointerDown}
              onKeyClick={props.onKeyClick}
              onTrackKeyClick={props.onTrackKeyClick}
            />
          </div>
        );
      })}
      {props.empty}
      {box && (
        <div className="dbtl-selbox" data-tl-selbox="" style={box} title="拖动右边缘缩放选中关键帧（改变动画快慢）">
          <span className="dbtl-selhandle" onPointerDown={props.onScaleHandleDown} />
        </div>
      )}
      {band && (
        <div
          className="dbtl-band"
          style={{
            left: Math.min(band.x0, band.x1),
            top: Math.min(band.y0, band.y1),
            width: Math.abs(band.x1 - band.x0),
            height: Math.abs(band.y1 - band.y0),
          }}
        />
      )}
    </div>
  );
}
