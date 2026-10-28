/**
 * 替换图片对话框（官方 `SwapImageWindow.title` / `SwapImageWindow.newTitle` / `SwapImageWindow.replace`）。
 *
 * 离线等价物：官方能把**任意本地文件**拖进窗口（桌面端可以把它塞进工程资源库）；
 * 浏览器里没有工程资源库的写入口，所以这里列出**当前图集已有的区域**让用户选 ——
 * 落点与官方 `Property.display.changeAsset` 一致：改显示对象引用的 `path`。
 */
import { useMemo, useState } from 'react';
import { Icon } from './icons';

export interface SwapImageDialogProps {
  regions: string[];
  /** 当前显示对象引用的区域名（高亮用） */
  current: string | null;
  onPick: (regionName: string) => void;
  onClose: () => void;
}

export function SwapImageDialog({ regions, current, onPick, onClose }: SwapImageDialogProps) {
  const [query, setQuery] = useState('');
  const list = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return regions;
    return regions.filter((name) => name.toLowerCase().includes(needle));
  }, [regions, query]);
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  return (
    <div
      data-swap-image=""
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 95, display: 'grid', placeItems: 'center', background: 'rgba(0, 0, 0, 0.45)' }}
    >
      <div onClick={stop} className="panel" style={{ minWidth: 380, maxWidth: 460, border: '1px solid var(--line-strong)' }}>
        <div className="panel-head">
          <Icon name="image" size={13} />
          <span className="panel-title">替换图片</span>
          <span className="spacer" />
          <span className="muted" style={{ fontSize: 11 }}>{regions.length} 张</span>
          <button className="head-btn" title="关闭" onClick={onClose}><Icon name="x" size={13} /></button>
        </div>
        <div className="panel-body" style={{ padding: 10, display: 'grid', gap: 8 }}>
          <input
            autoFocus
            data-swap-search=""
            placeholder="搜索当前图集的图片…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div style={{ maxHeight: 300, overflow: 'auto', display: 'grid', gap: 4 }}>
            {list.map((name) => (
              <button
                key={name}
                className={`chip${name === current ? ' on' : ''}`}
                data-swap-region={name}
                style={{ justifyContent: 'flex-start', width: '100%' }}
                onClick={() => onPick(name)}
              >
                {name}
              </button>
            ))}
            {list.length === 0 && <span className="muted" style={{ fontSize: 11 }}>没有匹配的图片</span>}
          </div>
        </div>
      </div>
    </div>
  );
}