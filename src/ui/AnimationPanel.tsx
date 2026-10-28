import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Icon } from './icons';

export interface AnimationPanelProps {
  names: string[];
  current: string;
  onSelect: (name: string) => void;
  onAdd: () => void;
  onClone: () => void;
  onDelete: (name: string) => void;
  /** 把 `name` 挪到动画列表的 `toIndex`（按拖动前的完整顺序计） */
  onReorder?: (name: string, toIndex: number) => void;
}

/**
 * Animation list (official 动画面板): search, list, add / clone / delete.
 * 按住一行拖动可调整顺序。
 */
export function AnimationPanel(props: AnimationPanelProps) {
  const { names, current, onSelect, onAdd, onClone, onDelete, onReorder } = props;
  const [query, setQuery] = useState('');
  const [dragName, setDragName] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ name: string; after: boolean } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ name: string; pointerId: number; startY: number; moved: boolean } | null>(null);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return names;
    return names.filter((name) => name.toLowerCase().includes(needle));
  }, [names, query]);

  const hitRow = (clientY: number): { name: string; after: boolean } | null => {
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-anim]') ?? [])];
    if (rows.length === 0) return null;
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      const name = row.dataset.anim;
      if (!name) continue;
      if (clientY < rect.top) return { name, after: false };
      if (clientY <= rect.bottom) return { name, after: clientY > rect.top + rect.height / 2 };
    }
    const last = rows[rows.length - 1]?.dataset.anim;
    return last ? { name: last, after: true } : null;
  };

  const clearDrag = () => {
    dragRef.current = null;
    setDragName(null);
    setDrop(null);
  };

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>, name: string) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('.anim-del')) return;
    dragRef.current = { name, pointerId: event.pointerId, startY: event.clientY, moved: false };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* 指针已释放时忽略 */ }
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.moved && Math.abs(event.clientY - drag.startY) < 4) return;
    drag.moved = true;
    setDragName(drag.name);
    const next = hitRow(event.clientY);
    setDrop(next && next.name !== drag.name ? next : null);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const moved = drag.moved;
    const target = moved ? hitRow(event.clientY) : null;
    clearDrag();
    if (!moved) {
      onSelect(drag.name);
      return;
    }
    if (!target || target.name === drag.name || !onReorder) return;
    const from = names.indexOf(drag.name);
    let to = names.indexOf(target.name);
    if (from < 0 || to < 0) return;
    if (target.after) to += 1;
    if (from < to) to -= 1;
    if (to !== from) onReorder(drag.name, to);
  };

  return (
    <div className="anim-panel">
      <div className="anim-head">
        <input
          className="anim-search"
          placeholder="请输入名称！"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button className="chip" title="添加动画" onClick={onAdd}>＋</button>
        <button className="chip" title="克隆动画" onClick={onClone} disabled={!current}>克隆</button>
      </div>
      <div className="anim-list" ref={listRef}>
        {filtered.map((name) => (
          <div
            key={name}
            data-anim={name}
            className={[
              'anim-row',
              name === current ? 'selected' : '',
              name === dragName ? 'dragging' : '',
              drop?.name === name ? (drop.after ? 'drop-after' : 'drop-before') : '',
            ].filter(Boolean).join(' ')}
            title={`切换到动画 ${name}；按住拖动可调整顺序`}
            onPointerDown={(event) => beginDrag(event, name)}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={clearDrag}
          >
            <span className="anim-icon"><Icon name={name === current ? 'play' : 'layers'} size={11} /></span>
            <span className="anim-name">{name}</span>
            <button
              className="anim-del"
              title="删除动画"
              onClick={(event) => { event.stopPropagation(); onDelete(name); }}
            >
              ×
            </button>
          </div>
        ))}
        {filtered.length === 0 && <div className="tl-empty">没有匹配的动画</div>}
      </div>
    </div>
  );
}
