/**
 * Draggable panel separators (官方编辑器每个区域都能拉伸).
 *
 * `Sash` reports the **value** the caller should use, not a delta: it snapshots `value`
 * on pointer-down and adds the pointer displacement, so callers never have to remember
 * their own start size. `useStoredSize` keeps a layout number in localStorage so a user's
 * arrangement survives a reload.
 */
import { useCallback, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';

export function useStoredSize(key: string, initial: number): [number, (value: number) => void] {
  const [value, setValue] = useState(() => {
    if (typeof localStorage === 'undefined') return initial;
    try {
      const raw = Number(localStorage.getItem(`bonestudio.layout.${key}`));
      return Number.isFinite(raw) && raw > 0 ? raw : initial;
    } catch {
      return initial;
    }
  });
  const update = useCallback((next: number) => {
    setValue(next);
    try {
      localStorage.setItem(`bonestudio.layout.${key}`, String(Math.round(next)));
    } catch {
      /* private mode / quota — the layout just will not persist */
    }
  }, [key]);
  return [value, update];
}

export function Sash({
  axis, value, min, max, step = 1, onChange, className, title,
}: {
  axis: 'x' | 'y';
  /** current size in px (or any unit the caller clamps consistently) */
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  className?: string;
  title?: string;
}) {
  const origin = useRef<{ pointer: number; value: number } | null>(null);
  const clamp = (next: number) => Math.max(min, Math.min(max, next));

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    origin.current = { pointer: axis === 'x' ? event.clientX : event.clientY, value };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = origin.current;
    if (!start) return;
    const pointer = axis === 'x' ? event.clientX : event.clientY;
    const raw = start.value + (pointer - start.pointer);
    onChange(clamp(Math.round(raw / step) * step));
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    origin.current = null;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
  };
  // keyboard: arrows nudge, Home/End jump to the bounds
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const forward = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
    const back = axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
    if (event.key === forward) { onChange(clamp(value + step)); event.preventDefault(); }
    else if (event.key === back) { onChange(clamp(value - step)); event.preventDefault(); }
    else if (event.key === 'Home') { onChange(min); event.preventDefault(); }
    else if (event.key === 'End') { onChange(max); event.preventDefault(); }
  };

  return (
    <div
      className={`sash sash-${axis}${className ? ` ${className}` : ''}`}
      role="separator"
      tabIndex={0}
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      title={title}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    >
      <i />
    </div>
  );
}