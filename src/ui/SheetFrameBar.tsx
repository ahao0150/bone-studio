/**
 * 序列帧「帧编辑条」—— 官方 `_953/_13221.as`，浮在**舞台底部中央**（`.transform-bar` 定位）。
 *
 * 布局对齐官方：左圆角框 = 水平 / 垂直翻转（官方 `/assets/button/flipX.png` / `flipY.png`，
 * `flipX` 在左）；右圆角框 = 绝对 / 相对 TabBar（`Sheet.abs` / `Sheet.relative`，
 * 官方 `selectedIndex = 0` 即默认「绝对」）+ 绝对组（位置 X/Y）或相对组（九宫格 + 轴心 X/Y）
 * +「应用所有帧」（`Sheet.apply.all`）。见 `DBPRO-SPEC.md` §51 / §51.1。
 *
 * 相对模式的两个坐标框显示**官方 UI 值**（-0.5..0.5、0 = 图片中心），
 * 与数据里的 `pivot` 差一个 `0.5 - v`（`sheetEdit.uiFromPivot`）。
 */
import { useState } from 'react';
import { Icon } from './icons';
import { SHEET_ANCHORS, uiFromPivot, type SheetFrameValues } from '../core/sheetEdit';

export interface SheetFrameBarProps {
  /** 当前帧的显示对象变换（`readFrameValues`；`pivot` 是数据里的 0..1） */
  values: SheetFrameValues;
  placeMode: 'absolute' | 'relative';
  onPlaceMode: (mode: 'absolute' | 'relative') => void;
  /** 绝对模式：位置 X/Y（显示对象局部坐标） */
  onPosition: (x: number, y: number) => void;
  /** 相对模式：轴心 UI 值（-0.5..0.5） */
  onPivot: (x: number, y: number) => void;
  /** 水平 / 垂直翻转；`applyAll` = 按住 Shift */
  onFlip: (axis: 'x' | 'y', applyAll: boolean) => void;
  onApplyAll: () => void;
}

export function SheetFrameBar(props: SheetFrameBarProps) {
  const { values, placeMode, onPlaceMode, onPosition, onPivot, onFlip, onApplyAll } = props;
  const [draft, setDraft] = useState<Record<string, string>>({});
  const pivotUiX = uiFromPivot(values.pivotX);
  const pivotUiY = uiFromPivot(values.pivotY);
  const shown = (value: number) => String(Math.round(value * 100) / 100);

  const field = (key: string, title: string, value: number, commit: (next: number) => void) => (
    <input
      key={key}
      className="tb-input sb-num"
      data-sheet-num={key}
      data-sheet-num-value={shown(value)}
      type="number"
      step={0.01}
      title={title}
      value={draft[key] ?? shown(value)}
      onChange={(event) => setDraft((prev) => ({ ...prev, [key]: event.target.value }))}
      onBlur={() => {
        const raw = draft[key];
        setDraft((prev) => { const next = { ...prev }; delete next[key]; return next; });
        if (raw === undefined) return;
        const num = Number(raw);
        if (Number.isFinite(num)) commit(num);
      }}
      onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }}
    />
  );

  return (
    <div className="transform-bar sheet-bar" data-sheet-bar={placeMode}>
      <span className="sb-box sb-flip">
        <button
          className={'tb-ico' + (values.flipX ? ' on' : '')}
          data-sheet-flip-x=""
          title="水平翻转（按住 Shift 键翻转所有帧）"
          onClick={(event) => onFlip('x', event.shiftKey)}
        ><Icon name="flipX" size={13} /></button>
        <button
          className={'tb-ico' + (values.flipY ? ' on' : '')}
          data-sheet-flip-y=""
          title="垂直翻转（按住 Shift 键翻转所有帧）"
          onClick={(event) => onFlip('y', event.shiftKey)}
        ><Icon name="flipY" size={13} /></button>
      </span>
      <span className="sb-box sb-main">
        <span className="sb-tabs">
          <button
            className={'sb-tab' + (placeMode === 'absolute' ? ' on' : '')}
            data-sheet-mode="absolute"
            title="自由拖动当前帧"
            onClick={() => onPlaceMode('absolute')}
          >绝对</button>
          <button
            className={'sb-tab' + (placeMode === 'relative' ? ' on' : '')}
            data-sheet-mode="relative"
            title="相对舞台原点"
            onClick={() => onPlaceMode('relative')}
          >相对</button>
        </span>
        {placeMode === 'absolute' ? (
          <>
            {field('x', '位置 X', values.x, (next) => onPosition(next, values.y))}
            {field('y', '位置 Y', values.y, (next) => onPosition(values.x, next))}
          </>
        ) : (
          <>
            <span className="anchor-grid">
              {SHEET_ANCHORS.map((anchor) => (
                <button
                  key={anchor.id}
                  className={'anchor' + (Math.abs(pivotUiX - anchor.x) < 1e-9 && Math.abs(pivotUiY - anchor.y) < 1e-9 ? ' on' : '')}
                  data-sheet-anchor={anchor.id}
                  title={anchor.id}
                  onClick={() => onPivot(anchor.x, anchor.y)}
                />
              ))}
            </span>
            {field('pivot-x', '轴心 X（0 = 图片中心）', pivotUiX, (next) => onPivot(next, pivotUiY))}
            {field('pivot-y', '轴心 Y（0 = 图片中心）', pivotUiY, (next) => onPivot(pivotUiX, next))}
          </>
        )}
        <button className="sb-apply" data-sheet-apply-all="" title="应用所有帧" onClick={onApplyAll}>应用所有帧</button>
      </span>
    </div>
  );
}
