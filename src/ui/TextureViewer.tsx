/**
 * 纹理图片预览框：滚轮以光标为中心缩放、左键拖拽平移、适应 / 1:1。
 * 只做 CSS 变换不重采样，放大时最近邻显示（image-rendering: pixelated），大分辨率图集也能逐像素看。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './icons';

const CHECKER = 'repeating-conic-gradient(#5a5f66 0% 25%, #474b51 0% 50%) 0 0 / 16px 16px';
const MIN_ZOOM = 1 / 64;
const MAX_ZOOM = 64;

export function TextureViewer({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  const fit = useCallback((natural = size) => {
    const box = boxRef.current;
    if (!box || !natural) return;
    const zoom = Math.min(1, (box.clientWidth - 24) / natural.width, (box.clientHeight - 24) / natural.height);
    setView({ zoom, x: (box.clientWidth - natural.width * zoom) / 2, y: (box.clientHeight - natural.height * zoom) / 2 });
  }, [size]);

  const zoomAt = (factor: number, cx?: number, cy?: number) => {
    const box = boxRef.current;
    if (!box) return;
    const px = cx ?? box.clientWidth / 2;
    const py = cy ?? box.clientHeight / 2;
    setView((v) => {
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
      const k = zoom / v.zoom;
      return { zoom, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
    });
  };

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    // React 的 onWheel 是 passive，拦不住页面滚动，只能原生挂
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = box.getBoundingClientRect();
      zoomAt(event.deltaY < 0 ? 1.25 : 0.8, event.clientX - rect.left, event.clientY - rect.top);
    };
    box.addEventListener('wheel', onWheel, { passive: false });
    return () => box.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopImmediatePropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div data-texture-viewer="" onClick={(event) => { event.stopPropagation(); onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 96, display: 'grid', placeItems: 'center', background: 'rgba(0, 0, 0, 0.55)' }}>
      <div className="panel" onClick={(event) => event.stopPropagation()}
        style={{ width: '82vw', height: '82vh', display: 'grid', gridTemplateRows: 'auto 1fr auto', border: '1px solid var(--line-strong)' }}>
        <div className="panel-head">
          <span className="panel-title">{title}</span>
          <span className="spacer" />
          <button className="head-btn" title="关闭（Esc）" onClick={onClose}><Icon name="x" size={13} /></button>
        </div>
        <div ref={boxRef} data-texture-viewer-canvas=""
          style={{ position: 'relative', overflow: 'hidden', background: '#15181d', cursor: drag.current ? 'grabbing' : 'grab' }}
          onPointerDown={(event) => { drag.current = { x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerUp={() => { drag.current = null; }}
          onPointerMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setPointer({ x: Math.floor((event.clientX - rect.left - view.x) / view.zoom), y: Math.floor((event.clientY - rect.top - view.y) / view.zoom) });
            if (!drag.current) return;
            const dx = event.clientX - drag.current.x;
            const dy = event.clientY - drag.current.y;
            drag.current = { x: event.clientX, y: event.clientY };
            setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
          }}
          onPointerLeave={() => setPointer(null)}
          onDoubleClick={() => fit()}
        >
          <img src={url} alt={title} draggable={false}
            onLoad={(event) => {
              const natural = { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight };
              setSize(natural);
              fit(natural);
            }}
            style={{
              position: 'absolute', left: 0, top: 0, transformOrigin: '0 0', maxWidth: 'none',
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
              imageRendering: view.zoom > 1 ? 'pixelated' : 'auto', background: CHECKER,
              visibility: size ? 'visible' : 'hidden',
            }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px', fontSize: 12, color: 'var(--text-dim)' }}>
          <span data-texture-viewer-size="">{size ? `${size.width} x ${size.height}` : '加载中…'}</span>
          <span style={{ fontFamily: 'var(--mono)', minWidth: 90 }}>
            {pointer && size && pointer.x >= 0 && pointer.y >= 0 && pointer.x < size.width && pointer.y < size.height ? `(${pointer.x}, ${pointer.y})` : ''}
          </span>
          <span className="spacer" style={{ flex: 1 }} />
          <span>滚轮缩放 · 拖拽平移 · 双击适应</span>
          <button className="chip" onClick={() => zoomAt(0.5)}>－</button>
          <span data-texture-viewer-zoom="" style={{ minWidth: 48, textAlign: 'center' }}>{Math.round(view.zoom * 1000) / 10}%</span>
          <button className="chip" onClick={() => zoomAt(2)}>＋</button>
          <button className="chip" onClick={() => fit()}>适应</button>
          <button className="chip" onClick={() => { const box = boxRef.current; if (box && size) setView({ zoom: 1, x: (box.clientWidth - size.width) / 2, y: (box.clientHeight - size.height) / 2 }); }}>1:1</button>
        </div>
      </div>
    </div>
  );
}
