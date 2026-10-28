import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * 时间轴右键菜单（官方 `_874/_873.as:111-114`）：外壳沿用舞台菜单的 `.stage-menu`。
 * 两套：关键帧区（补间 / 剪切复制粘贴删除帧 / 选中全部关键帧）与树名区（显示 / 隐藏 / 锁定 / 展开折叠）。
 * 每项带 `data-tl-menu="<key>"`，CDP 脚本靠它点，不靠文案。
 * 挂到 `body` 并按视口夹紧：时间轴贴着窗口底部，原地展开会被裁掉，放不下就往上翻。
 */
export type TimelineMenuEntry = { key: string; label: string; disabled?: boolean; onClick: () => void } | 'sep';

export interface TimelineContextMenuProps {
  x: number;
  y: number;
  title: string;
  entries: TimelineMenuEntry[];
  onClose: () => void;
}

const MARGIN = 4;

export function TimelineContextMenu({ x, y, title, entries, onClose }: TimelineContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const left = Math.max(MARGIN, Math.min(x, window.innerWidth - width - MARGIN));
    const top = y + height > window.innerHeight - MARGIN ? Math.max(MARGIN, y - height) : y;
    setPos({ left, top });
  }, [x, y, entries.length]);
  return createPortal(
    <>
      <div className="stage-menu-backdrop" onPointerDown={onClose} onContextMenu={(event) => { event.preventDefault(); onClose(); }} />
      <div ref={ref} className="stage-menu dbtl-menu" data-tl-menu-shell={title} style={pos}>
        {entries.map((entry, index) => (entry === 'sep'
          ? <hr key={`sep-${index}`} />
          : (
            <button
              key={entry.key}
              type="button"
              disabled={entry.disabled}
              data-tl-menu={entry.key}
              onClick={() => { onClose(); entry.onClick(); }}
            >
              {entry.label}
            </button>
          )))}
      </div>
    </>,
    document.body,
  );
}
