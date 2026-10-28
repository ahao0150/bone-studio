/**
 * 插槽颜色选择器。布局对照官方颜色窗口：饱和度/明度方块、色相条、
 * 新的/当前、R/G/B 与十六进制。不含透明度，透明度留在属性行的滑条上。
 */
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

export interface Rgb { r: number; g: number; b: number }

interface ColorPickerDialogProps {
  initial: Rgb;
  /** 拖动、改数字、还原时把草稿画到舞台上，还不算确认。 */
  onChange?: (color: Rgb) => void;
  onConfirm: (color: Rgb) => void;
  onCancel: () => void;
}

function clampByte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

function hsvToRgb(h: number, s: number, v: number): Rgb {
  const c = v * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = v - c;
  return { r: clampByte((r + m) * 255), g: clampByte((g + m) * 255), b: clampByte((b + m) * 255) };
}

function cssRgb(color: Rgb): string {
  return `rgb(${color.r}, ${color.g}, ${color.b})`;
}

function hexOf(color: Rgb): string {
  return [color.r, color.g, color.b].map((channel) => channel.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function ColorPickerDialog({ initial, onChange, onConfirm, onCancel }: ColorPickerDialogProps) {
  const [draft, setDraft] = useState<Rgb>(initial);
  const [hex, setHex] = useState(hexOf(initial));
  const hsv = rgbToHsv(draft.r, draft.g, draft.b);
  const padRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);

  const apply = (next: Rgb) => {
    setDraft(next);
    setHex(hexOf(next));
    onChange?.(next);
  };

  const paintPad = (clientX: number, clientY: number) => {
    const rect = padRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const s = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const v = Math.min(1, Math.max(0, 1 - (clientY - rect.top) / rect.height));
    apply(hsvToRgb(hsv.h, s, v));
  };

  const paintHue = (clientY: number) => {
    const rect = hueRef.current?.getBoundingClientRect();
    if (!rect || rect.height === 0) return;
    const h = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)) * 360;
    apply(hsvToRgb(h, hsv.s === 0 ? 1 : hsv.s, hsv.v === 0 ? 1 : hsv.v));
  };

  const drag = (event: ReactPointerEvent<HTMLDivElement>, paint: (x: number, y: number) => void) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    paint(event.clientX, event.clientY);
    const move = (next: PointerEvent) => paint(next.clientX, next.clientY);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const setChannel = (key: keyof Rgb, raw: string) => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    apply({ ...draft, [key]: clampByte(parsed) });
  };

  return (
    <div className="color-picker" data-color-picker="" role="dialog" aria-label="颜色选择器">
      <div className="color-picker-head">颜色选择器</div>
      <div className="color-picker-body">
        <div
          ref={padRef}
          className="color-pad"
          data-color-pad=""
          style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h}, 100%, 50%))` }}
          onPointerDown={(event) => drag(event, paintPad)}
        >
          <i style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
        </div>
        <div
          ref={hueRef}
          className="color-hue"
          data-color-hue=""
          onPointerDown={(event) => drag(event, (_x, y) => paintHue(y))}
        >
          <i style={{ top: `${(hsv.h / 360) * 100}%` }} />
        </div>
        <div className="color-fields">
          <label>新的<span className="swatch" data-color-new="" style={{ background: cssRgb(draft) }} /></label>
          <label>当前<span className="swatch" data-color-current="" style={{ background: cssRgb(initial) }} /></label>
          {(['r', 'g', 'b'] as const).map((key) => (
            <label key={key}>{key.toUpperCase()}
              <input type="number" min={0} max={255} data-color-channel={key} value={draft[key]} onChange={(event) => setChannel(key, event.target.value)} />
            </label>
          ))}
          <label>#
            <input
              data-color-hex=""
              value={hex}
              maxLength={6}
              onChange={(event) => {
                const next = event.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6).toUpperCase();
                setHex(next);
                if (next.length === 6) {
                  apply({
                    r: Number.parseInt(next.slice(0, 2), 16),
                    g: Number.parseInt(next.slice(2, 4), 16),
                    b: Number.parseInt(next.slice(4, 6), 16),
                  });
                }
              }}
            />
          </label>
        </div>
      </div>
      <div className="color-picker-actions">
        <button type="button" data-color-revert="" onClick={() => apply(initial)}>还原</button>
        <button type="button" data-color-ok="" onClick={() => onConfirm(draft)}>确定</button>
        <button type="button" data-color-cancel="" onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}
