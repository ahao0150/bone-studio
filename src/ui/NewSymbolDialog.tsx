/**
 * 新建元件（官方 `NewSymbolWindow`）。
 *
 * 官方类型有 **主舞台 / 骨架 / 影片剪辑 / 序列帧**（`界面文案表` 第 1137-1140 行）；
 * 本仓库只提供 **骨架 / 序列帧**：「主舞台 / 影片剪辑」依赖 舞台工程，不在范围内，选项不显示。
 * 名称冲突与空名提示沿用官方文案（`NewSymbolWindow.nameConflict` / `nameNull`）。
 */
import { useState } from 'react';
import { Icon } from './icons';
import type { SymbolKind } from '../core/armatureEdit';

export interface NewSymbolDialogProps {
  /** 已有元件名（用于冲突提示；真正的去重由 core 的 uniqueArmatureName 做） */
  existing: string[];
  onCreate: (kind: SymbolKind, name: string) => void;
  onClose: () => void;
}

export function NewSymbolDialog({ existing, onCreate, onClose }: NewSymbolDialogProps) {
  const [kind, setKind] = useState<SymbolKind>('armature');
  const [name, setName] = useState('Symbol1');
  const [error, setError] = useState<string | null>(null);
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) { setError('元件名字不能为空！'); return; }
    if (existing.includes(trimmed)) { setError(`已经有相同名字的元件了！（会改成 ${trimmed}_1）`); }
    onCreate(kind, trimmed);
  };

  return (
    <div
      data-new-symbol-dialog=""
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 96, display: 'grid', placeItems: 'center', background: 'rgba(0, 0, 0, 0.45)' }}
    >
      <div onClick={stop} className="panel" style={{ width: 430, border: '1px solid var(--line-strong)' }}>
        <div className="panel-head">
          <Icon name="plus" size={13} />
          <span className="panel-title">新建元件</span>
          <span className="spacer" />
          <button className="head-btn" title="关闭" onClick={onClose}><Icon name="x" size={13} /></button>
        </div>
        <div className="panel-body" style={{ padding: 12, display: 'grid', gap: 10 }}>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span className="muted" style={{ fontSize: 11 }}>类型：</span>
            <button className={'chip' + (kind === 'armature' ? ' on' : '')} data-symbol-kind="armature" onClick={() => setKind('armature')}>骨架</button>
            <button className={'chip' + (kind === 'sheet' ? ' on' : '')} data-symbol-kind="sheet" onClick={() => setKind('sheet')}>序列帧</button>
          </div>
          <label className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span className="muted" style={{ fontSize: 11 }}>元件名：</span>
            <input
              data-symbol-name=""
              type="text"
              value={name}
              onChange={(event) => { setName(event.target.value); setError(null); }}
              onKeyDown={(event) => { if (event.key === 'Enter') submit(); }}
              style={{ flex: 1 }}
            />
          </label>
          {error && <span style={{ color: '#ff9a9a', fontSize: 11 }} data-symbol-error="">{error}</span>}
          <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <button className="chip" onClick={onClose}>取消</button>
            <button className="chip" data-symbol-create="" onClick={submit}>创建</button>
          </div>
        </div>
      </div>
    </div>
  );
}