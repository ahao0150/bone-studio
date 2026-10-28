/**
 * 「层级」面板 —— 官方 `_857/DrawOrderPanel`（控制器 `_555/_558`）的等价物。
 *
 * 口径（清洁室格式验证行号见 docs/DBPRO-SPEC.md §117）：
 * - 列表是**槽位的倒序**：绘制顺序靠后 = 画在上层（`_558.as:701-717`）。
 * - 行首一枚位移箭头 = **相对绑定顺序**的位移，用最长递增子序列挑出「没动过」的那些，
 *   余下的按方向标上/下（`_669.as:64-115` + `_97/_10600.as:60-87`）。
 * - 工具条三件（官方 `_2438` 的 `addElement` 顺序：旗杆 → `upBtn` → `downBtn`）：
 *   「添加层级关键帧」/ 上移(=) / 下移(-)。旗杆**只在动画制作模式可见**（`_3864`），
 *   颜色三档 = `_10740` 的 0（白，无键）/ 1（红，当前帧有键）/ 2（黄，顺序改过没落帧）。
 * - 行悬停 → 舞台高亮（与场景树同一事件，`_558.as:4124`），并弹切片浮动预览。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Player } from '../core/player';
import { Icon } from './icons';
import { displayKindOf, sceneKindClass } from './panels';
import { PREVIEW_DELAY_MS, SlicePreview, type RegionRect } from './SymbolLibraryTree';

export interface DrawOrderPanelProps {
  player: Player | null;
  /** 当前生效的绘制顺序（名字，升序 = 从最下层到最上层）；面板内部倒过来渲染 */
  order: string[];
  /** 每个槽位相对绑定顺序的位移：-1 上移 / 1 下移 / 省略 = 没动过 */
  marks: Map<string, -1 | 0 | 1>;
  selectedSlot: string | null;
  selectedSlots?: Set<string>;
  onSelectSlot: (name: string) => void;
  onToggleSlotSelection?: (name: string) => void;
  onHoverSlot?: (name: string | null) => void;
  /** 上移 / 下移一格（`delta` = +1 前移、-1 后移） */
  onMove: (name: string, delta: number) => void;
  /** 旗杆只在动画制作模式可见 */
  animationMode: boolean;
  /** 0 无键 / 1 当前帧有键 / 2 顺序改过还没落帧 */
  keyStatus: 0 | 1 | 2;
  onToggleKey: () => void;
  atlasUrl: string | null;
  regionRects: Record<string, RegionRect>;
}

export function DrawOrderPanel({
  player, order, marks, selectedSlot, selectedSlots, onSelectSlot, onToggleSlotSelection,
  onHoverSlot, onMove, animationMode, keyStatus, onToggleKey, atlasUrl, regionRects,
}: DrawOrderPanelProps) {
  // 悬停预览：只在能落到一张切片上时弹，延迟 1 秒（与资源树同一官方口径）。
  const [preview, setPreview] = useState<{ name: string; x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setPreview(null);
  }, []);
  useEffect(() => cancel, [cancel]);

  /** 槽位当前显示对象对应的切片名（拿不到图集矩形就不弹预览）。 */
  const regionOf = useCallback((slotName: string): string | null => {
    const slot = player?.skeleton.slots.find((entry) => entry.name === slotName);
    const display = player?.skeleton.skinSlots.get(slotName)?.display?.[slot?.displayIndex ?? 0];
    const name = display?.path ?? display?.name;
    return name && regionRects[name] ? name : null;
  }, [player, regionRects]);

  const hoverRow = (name: string, event: { clientX: number; clientY: number }) => {
    const region = regionOf(name);
    if (!region) return;
    if (preview) { setPreview({ name: region, x: event.clientX, y: event.clientY }); return; }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setPreview({ name: region, x: event.clientX, y: event.clientY });
    }, PREVIEW_DELAY_MS);
  };

  // 官方列表是倒序：数组最后一个（画在上层）排最前。
  const rows = [...order].reverse();

  return (
    <div className="draw-order-panel" data-draw-order-panel="">
      <div className="library-bar">
        {animationMode && (
          <button
            className={`chip order-key state-${keyStatus}`}
            data-order-key=""
            data-order-key-state={keyStatus}
            title={keyStatus === 1 ? '删除当前帧的层级关键帧' : '添加层级关键帧'}
            onClick={onToggleKey}
          >
            <Icon name="flag" size={12} />
          </button>
        )}
        <button
          className="chip"
          data-order-up=""
          title="上移(=)"
          disabled={!selectedSlot}
          onClick={() => selectedSlot && onMove(selectedSlot, 1)}
        >
          <Icon name="bringForward" size={12} />
        </button>
        <button
          className="chip"
          data-order-down=""
          title="下移(-)"
          disabled={!selectedSlot}
          onClick={() => selectedSlot && onMove(selectedSlot, -1)}
        >
          <Icon name="sendBackward" size={12} />
        </button>
        <span className="muted">{order.length} 个槽位</span>
      </div>
      <div className="order-list" role="listbox" aria-label="层级">
        {rows.map((name) => {
          const mark = marks.get(name) ?? 0;
          const kind = displayKindOf(player, name, player?.skeleton.slots.find((entry) => entry.name === name)?.displayIndex ?? 0);
          const selected = selectedSlot === name || Boolean(selectedSlots?.has(name));
          return (
            <div
              key={name}
              className={`scene-row order-row${selected ? ' selected' : ''}`}
              data-order-row={name}
              data-order-mark={name}
              data-order-dir={mark}
              role="option"
              aria-selected={selected}
              title={`${kind.label} · ${mark < 0 ? '比绑定顺序靠前' : mark > 0 ? '比绑定顺序靠后' : '与绑定顺序一致'}`}
              onClick={(event) => {
                if (event.shiftKey || event.ctrlKey) onToggleSlotSelection?.(name);
                else onSelectSlot(name);
              }}
              onMouseEnter={(event) => { onHoverSlot?.(name); hoverRow(name, event); }}
              onMouseMove={(event) => hoverRow(name, event)}
              onMouseLeave={() => { onHoverSlot?.(null); cancel(); }}
            >
              <span className="order-mark">
                {mark !== 0 && <Icon name={mark < 0 ? 'arrowUp' : 'arrowDown'} size={11} />}
              </span>
              <span className={`scene-kind ${sceneKindClass(kind.icon)}`} title={kind.label}>
                <Icon name={kind.icon} size={12} />
              </span>
              <span className="tree-name"><span>{name}</span></span>
            </div>
          );
        })}
        {rows.length === 0 && <div className="hint">这个元件还没有槽位</div>}
      </div>
      {preview && <SlicePreview {...preview} atlasUrl={atlasUrl} regionRects={regionRects} />}
    </div>
  );
}
