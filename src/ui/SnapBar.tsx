/**
 * 吸附工具栏：舞台顶部居中。两个醒目的开关 —— 「垫图吸附」「关节吸附」，
 * 以及载入参考垫图、透明度、吸附强度、搜索半径、垫图原点，和「全部吸附」「焊接关节」两个一次性操作。
 */
import { useRef } from 'react';

export interface SnapSettings {
  /** 参考垫图吸附（拖动部件松手后自动对齐垫图） */
  refSnap: boolean;
  /** 关节吸附（部件盖住关节 / 子骨骼起点吸到父骨骼末端） */
  jointSnap: boolean;
  showReference: boolean;
  opacity: number;
  strength: number;
  radius: number;
  /** 世界原点在垫图里的像素坐标 */
  originX: number;
  originY: number;
  pxPerUnit: number;
}

export const DEFAULT_SNAP: SnapSettings = { refSnap: true, jointSnap: true, showReference: true, opacity: 0.4, strength: 1, radius: 24, originX: 0, originY: 0, pxPerUnit: 1 };

const KEY = 'bonestudio.snap';
export function readSnapSettings(storage: Storage): SnapSettings {
  try { return { ...DEFAULT_SNAP, ...(JSON.parse(storage.getItem(KEY) ?? '{}') as Partial<SnapSettings>) }; } catch { return { ...DEFAULT_SNAP }; }
}
export function writeSnapSettings(storage: Storage, s: SnapSettings): void { try { storage.setItem(KEY, JSON.stringify(s)); } catch { /* 隐私模式 */ } }

export interface SnapBarProps {
  settings: SnapSettings;
  onChange: (patch: Partial<SnapSettings>) => void;
  referenceName: string | null;
  onLoadReference: (file: File) => void;
  onClearReference: () => void;
  onSnapAll: () => void;
  onSnapSelected: () => void;
  onWeld: () => void;
  onFitContour: () => void;
  busy?: boolean;
  canEdit: boolean;
}

export function SnapBar({ settings, onChange, referenceName, onLoadReference, onClearReference, onSnapAll, onSnapSelected, onWeld, onFitContour, busy, canEdit }: SnapBarProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const num = (key: keyof SnapSettings, v: string, min: number, max: number) => {
    const n = Number(v); if (Number.isFinite(n)) onChange({ [key]: Math.max(min, Math.min(max, n)) } as Partial<SnapSettings>);
  };
  return (
    <div className="snap-bar" data-snap-bar="" onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" className={`snap-toggle${settings.refSnap ? ' on' : ''}`} data-snap-toggle="reference" aria-pressed={settings.refSnap}
        title="垫图吸附：拖动部件松手后，在附近小范围里按轮廓 / 边缘自动对齐参考垫图" onClick={() => onChange({ refSnap: !settings.refSnap })}>
        <span className="dot" />垫图吸附
      </button>
      <button type="button" className={`snap-toggle${settings.jointSnap ? ' on' : ''}`} data-snap-toggle="joint" aria-pressed={settings.jointSnap}
        title="关节吸附：部件松手后必须盖住自己的关节点（断开就自动接上并压一点重叠）；子骨骼起点靠近父骨骼末端时吸过去" onClick={() => onChange({ jointSnap: !settings.jointSnap })}>
        <span className="dot" />关节吸附
      </button>
      <span className="snap-sep" />
      <button type="button" className="snap-btn" title="载入参考垫图（PNG / JPG，白底或透明底）" onClick={() => fileRef.current?.click()}>
        {referenceName ? `垫图：${referenceName}` : '载入垫图…'}
      </button>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onLoadReference(f); e.target.value = ''; }} />
      {referenceName && (
        <>
          <label className="snap-field" title="显示垫图"><input type="checkbox" checked={settings.showReference} onChange={(e) => onChange({ showReference: e.target.checked })} />显示</label>
          <label className="snap-field" title="垫图透明度">透明<input type="range" min={0.05} max={1} step={0.05} value={settings.opacity} onChange={(e) => num('opacity', e.target.value, 0.05, 1)} /></label>
          <label className="snap-field" title="世界原点在垫图中的像素位置 X / Y，与 px/单位">原点
            <input className="snap-num" type="number" value={settings.originX} onChange={(e) => num('originX', e.target.value, -1e5, 1e5)} />
            <input className="snap-num" type="number" value={settings.originY} onChange={(e) => num('originY', e.target.value, -1e5, 1e5)} />
            <input className="snap-num" type="number" step={0.05} value={settings.pxPerUnit} onChange={(e) => num('pxPerUnit', e.target.value, 0.01, 100)} />
          </label>
          <button type="button" className="snap-btn ghost" title="移除垫图" onClick={onClearReference}>✕</button>
        </>
      )}
      <span className="snap-sep" />
      <label className="snap-field" title="吸附强度：1=完全吸到最佳位置，0.5=走一半">强度<input type="range" min={0} max={1} step={0.05} value={settings.strength} onChange={(e) => num('strength', e.target.value, 0, 1)} /><b>{settings.strength.toFixed(2)}</b></label>
      <label className="snap-field" title="搜索半径（垫图像素）：只在松手位置附近这么大范围里找">半径<input className="snap-num" type="number" min={2} max={120} value={settings.radius} onChange={(e) => num('radius', e.target.value, 2, 120)} />px</label>
      <span className="snap-sep" />
      <button type="button" className="snap-btn" disabled={!canEdit || !referenceName || busy} title="把选中部件吸到垫图上" onClick={onSnapSelected}>吸附选中</button>
      <button type="button" className="snap-btn" disabled={!canEdit || !referenceName || busy} title="所有部件按父→子顺序吸到垫图上（可撤销）" onClick={onSnapAll}>全部吸附</button>
      <button type="button" className="snap-btn" disabled={!canEdit || !referenceName || busy} title="轮廓贴合（网格变形）：网格部件边界向垫图轮廓双向贴合 —— 青色（多盖）往里收、红色（缺）往外拉；被遮挡处不算、关节重叠区保留。有选中只做选中，否则全部网格（可撤销）" onClick={onFitContour}>轮廓贴合</button>
      <button type="button" className="snap-btn" disabled={!canEdit || busy} title="关节两侧的加权网格统一平滑权重，弯曲时切口一起动、不断缝（可撤销）" onClick={onWeld}>焊接关节</button>
    </div>
  );
}
