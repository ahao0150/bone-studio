import { useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { KeySelectionEntry } from '../../core/keyEdit';

const id = (entry: KeySelectionEntry) => `${entry.bone}#${Math.round(entry.frame * 1000)}#${entry.channel ?? ''}`;

/**
 * 命中判断：骨骼汇总行（channel 缺省）命中同一帧的任何条目；通道子行只命中
 * 「同通道」或「整帧」条目 —— 点「旋转」不会把「移动」「缩放」一起选中（官方不全选）。
 */
const hits = (entry: KeySelectionEntry, bone: string, frame: number, channel?: KeySelectionEntry['channel']) =>
  entry.bone === bone
  && Math.abs(entry.frame - frame) < 1e-3
  && (channel === undefined || entry.channel === undefined || entry.channel === channel);

/** 关键帧的拖动移帧（`MOVE_KEY_FRAME`）与选区右缘缩放（`SCALE_KEY_FRAME`）。 */
export function useKeyDrags(input: {
  enabled: boolean;
  pxPerFrame: number;
  keySelection: KeySelectionEntry[];
  onKeySelection: (selection: KeySelectionEntry[]) => void;
  onKeysMove: (delta: number) => void;
  onKeysScale: (factor: number) => void;
}) {
  const { enabled, pxPerFrame, keySelection, onKeySelection, onKeysMove, onKeysScale } = input;
  const [dragDelta, setDragDelta] = useState(0);
  const [scalePreview, setScalePreview] = useState<number | null>(null);
  const isPicked = (bone: string, frame: number, channel?: KeySelectionEntry['channel']) =>
    keySelection.some((entry) => hits(entry, bone, frame, channel));
  const frames = keySelection.map((entry) => entry.frame);
  const selection = {
    min: frames.length ? Math.min(...frames) : 0,
    max: frames.length ? Math.max(...frames) : 0,
    count: frames.length,
  };

  const startKeyDrag = (event: ReactPointerEvent<HTMLSpanElement>, bone: string, frame: number, channel?: KeySelectionEntry['channel']) => {
    if (!enabled || event.button !== 0) return;
    event.stopPropagation();
    const entry: KeySelectionEntry = channel ? { bone, frame, channel } : { bone, frame };
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      const without = keySelection.filter((item) => id(item) !== id(entry));
      onKeySelection(without.length === keySelection.length ? [...keySelection, entry] : without);
      return;
    }
    // 没点中的键：整个替换为这一个（子行只选这一个通道）；已选中的键保留选区，便于整组拖动
    if (!isPicked(bone, frame, channel)) onKeySelection([entry]);
    const x0 = event.clientX;
    let delta = 0;
    const move = (e: PointerEvent) => {
      delta = Math.round((e.clientX - x0) / Math.max(pxPerFrame, 1e-6));
      setDragDelta(delta);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDragDelta(0);
      if (delta !== 0) onKeysMove(delta);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startScaleDrag = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (!enabled || event.button !== 0 || selection.max <= selection.min) return;
    event.stopPropagation();
    event.preventDefault();
    const x0 = event.clientX;
    const span = selection.max - selection.min;
    let factor = 1;
    const move = (e: PointerEvent) => {
      factor = Math.min(10, Math.max(0.1, 1 + (e.clientX - x0) / Math.max(span * pxPerFrame, 1e-6)));
      setScalePreview(factor);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setScalePreview(null);
      if (Math.abs(factor - 1) > 0.01) onKeysScale(factor);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return {
    isPicked, selection, startKeyDrag, startScaleDrag,
    shiftPx: dragDelta * pxPerFrame,
    scaleFactor: scalePreview ?? 1,
  };
}
