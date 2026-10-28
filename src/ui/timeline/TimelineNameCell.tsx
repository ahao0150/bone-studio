import { Icon } from '../icons';
import { TL } from '../timelineLayout';
import type { Lane } from './lanes';

/**
 * 一行的左半边 242px（`_978/_982.as:386-466`）：树节点（缩进 14/级、展开箭头、图标、名字，宽 162）
 * 后面接眼睛（x 162）与锁（x 186）—— 只有骨骼行有；轨道行在锁的位置放旗杆。
 */
export interface NameCellProps {
  lane: Lane;
  open: boolean;
  selected: boolean;
  hidden: boolean;
  locked: boolean;
  onToggleOpen: () => void;
  onSelect: () => void;
  onToggleVisible: (name: string) => void;
  onToggleLock: (name: string) => void;
  onToggleTrackKey: (trackId: string, channelId?: string) => void;
}

export function NameCell(props: NameCellProps) {
  const { lane, open } = props;
  const flagged = lane.kind === 'track' ? (!lane.expandable ? lane.track : null) : null;
  return (
    <div
      className="dbtl-name"
      style={{ width: TL.NAME_W }}
      onClick={props.onSelect}
    >
      <div className="dbtl-tree" style={{ paddingLeft: 6 + lane.depth * TL.INDENT }}>
        {lane.expandable
          ? (
            <button
              type="button"
              className={`dbtl-caret${open ? ' open' : ''}`}
              onClick={(event) => { event.stopPropagation(); props.onToggleOpen(); }}
            >
              <Icon name={open ? 'chevronDown' : 'chevronRight'} size={10} />
            </button>
          )
          : <span className="dbtl-caret" />}
        <span className="dbtl-node-icon"><Icon name={lane.icon} size={12} /></span>
        <span className="dbtl-label" title={lane.label}>{lane.label}</span>
      </div>
      {lane.kind === 'bone' && (
        <>
          <button
            type="button"
            className={`dbtl-flag eye${props.hidden ? '' : ' on'}`}
            style={{ left: 162 }}
            data-tl-eye={lane.row.name}
            title={props.hidden ? '显示这根骨骼' : '隐藏这根骨骼'}
            onClick={(event) => { event.stopPropagation(); props.onToggleVisible(lane.row.name); }}
          >
            <Icon name="eye" size={12} />
          </button>
          <button
            type="button"
            className={`dbtl-flag lock${props.locked ? ' on' : ''}`}
            style={{ left: 186 }}
            data-tl-lock={lane.row.name}
            title={props.locked ? '解除锁定（舞台上可选中）' : '锁定（舞台上点不中）'}
            onClick={(event) => { event.stopPropagation(); props.onToggleLock(lane.row.name); }}
          >
            <Icon name="lock" size={12} />
          </button>
        </>
      )}
      {(flagged || lane.kind === 'trackChan') && (
        <button
          type="button"
          className={`dbtl-flag${(lane.kind === 'trackChan' ? lane.channel.keyed : flagged?.keyed) ? ' on keyed' : ''}`}
          style={{ left: 186 }}
          data-tl-track-flag={lane.kind === 'trackChan' ? lane.channel.id : flagged?.id}
          title="在当前帧打 / 删这条轨道的键"
          onClick={(event) => {
            event.stopPropagation();
            if (lane.kind === 'trackChan') props.onToggleTrackKey(lane.track.id, lane.channel.id);
            else if (flagged) props.onToggleTrackKey(flagged.id);
          }}
        >
          <Icon name="flag" size={12} />
        </button>
      )}
    </div>
  );
}
