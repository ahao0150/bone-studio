/**
 * 事件帧面板（官方 `EventPanel`，参考图 5）：三个添加入口 ——
 * **添加自定义事件 / 添加声音事件 / 添加动画控制**，列出当前帧已有事件（可逐条删除）。
 * 点一条事件展开它的参数（官方 `EventFolderItem`）：目标骨骼 / 整型 / 浮点 / 字符串，逗号分隔。
 */
import { useState } from 'react';
import { Icon } from './icons';
import type { EventEntry, EventKind } from '../core/eventEdit';

export interface EventPanelProps {
  frame: number;
  events: EventEntry[];
  /** 动画控制默认用第一条动画名 */
  defaultAnimation: string;
  bones: string[];
  onAdd: (kind: EventKind, name: string) => void;
  onRemove: (position: number) => void;
  onPatch: (position: number, patch: { bone?: string; ints?: number[]; floats?: number[]; strings?: string[] }) => void;
}

const parseList = (text: string) => text.split(',').map((part) => part.trim()).filter((part) => part.length > 0);

export function EventPanel({ frame, events, defaultAnimation, bones, onAdd, onRemove, onPatch }: EventPanelProps) {
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const typed = draft.trim();
  const add = (kind: EventKind) => {
    const fallback = kind === 'action' ? defaultAnimation || 'animation' : kind === 'sound' ? 'sound' : 'event';
    onAdd(kind, typed || fallback);
    setDraft('');
  };
  const current = events.find((entry) => entry.index === editing) ?? null;
  return (
    <>
      <div className="prop-group" data-event-panel="">
        <div className="group-head">
          <Icon name="key" size={12} />
          <span>事件帧</span>
          <span className="spacer" />
          <span className="muted">第 {Math.round(frame)} 帧</span>
        </div>
        <div className="prop-row" style={{ gridTemplateColumns: '1fr' }}>
          <input
            data-event-name=""
            type="text"
            placeholder="事件名 / 声音名 / 动画名"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </div>
        <div className="prop-row" style={{ gridTemplateColumns: '1fr' }}>
          <button type="button" className="chip" data-event-add="custom" onClick={() => add('custom')}>
            <Icon name="plus" size={11} /> 添加自定义事件
          </button>
        </div>
        <div className="prop-row" style={{ gridTemplateColumns: '1fr' }}>
          <button type="button" className="chip" data-event-add="sound" onClick={() => add('sound')}>
            <Icon name="plus" size={11} /> 添加声音事件
          </button>
        </div>
        <div className="prop-row" style={{ gridTemplateColumns: '1fr' }}>
          <button type="button" className="chip" data-event-add="action" onClick={() => add('action')}>
            <Icon name="plus" size={11} /> 添加动画控制
          </button>
        </div>
        {events.length === 0
          ? <div className="hint" data-event-empty="">这一帧还没有事件</div>
          : events.map((entry) => (
            <div
              className="prop-row"
              key={`${entry.kind}-${entry.index}`}
              data-event-row={entry.index}
              onClick={() => setEditing(entry.index === editing ? null : entry.index)}
              style={{ cursor: 'pointer' }}
            >
              <span className="ico"><Icon name="key" size={11} /></span>
              <span className="label">{entry.label}</span>
              <span className="muted" style={{ fontSize: 10 }}>{entry.kind}</span>
              <button
                type="button"
                className="prop-flag"
                data-event-remove={entry.index}
                title="删除这个事件"
                onClick={(event) => { event.stopPropagation(); onRemove(entry.index); }}
              >
                <Icon name="x" size={11} />
              </button>
            </div>
          ))}
      </div>
      {current && (
        <div className="prop-group" data-event-params={current.index}>
          <div className="group-head"><span>事件参数：{current.label}</span></div>
          <div className="prop-row" style={{ gridTemplateColumns: '64px 1fr' }}>
            <span className="label">目标骨骼</span>
            <select
              data-event-bone=""
              value={current.bone}
              onChange={(event) => onPatch(current.index, { bone: event.target.value })}
            >
              <option value="">无</option>
              {bones.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
          {([['整型', 'ints', current.ints], ['浮点', 'floats', current.floats], ['字符串', 'strings', current.strings]] as const).map(([label, field, list]) => (
            <div className="prop-row" key={field} style={{ gridTemplateColumns: '64px 1fr' }}>
              <span className="label">{label}</span>
              <input
                key={`${current.index}-${field}-${list.join(',')}`}
                data-event-param={field}
                type="text"
                defaultValue={list.join(', ')}
                placeholder="逗号分隔"
                onBlur={(event) => {
                  const parts = parseList(event.target.value);
                  if (field === 'strings') onPatch(current.index, { strings: parts });
                  else {
                    const nums = parts.map(Number).filter((value) => Number.isFinite(value));
                    onPatch(current.index, field === 'ints' ? { ints: nums } : { floats: nums });
                  }
                }}
              />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
