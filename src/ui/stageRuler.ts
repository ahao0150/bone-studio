/**
 * Stage ruler math (official 舞台标尺).
 *
 * DragonBones surrounds the stage with world-coordinate rulers on the top and
 * left edges. The strips must stay readable at every zoom, so the labelled step is
 * chosen from the 1 / 2 / 5 x 10^n family and ticks are laid out with the exact
 * camera mapping the renderer uses: `screen = world * scale + pan`.
 *
 * Kept free of React/Pixi imports so the math is unit-testable.
 */

export interface RulerTick {
  /** screen px inside the strip */
  px: number;
  /** label text; empty for minor ticks */
  label: string;
  major: boolean;
  zero: boolean;
}

/** Pick a 1/2/5/10 world-space step so labels stay about `target` px apart. */
export function niceStep(scale: number, target: number): number {
  const raw = target / Math.max(1e-6, scale);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10] as const) if (pow * m >= raw - 1e-9) return pow * m;
  return pow * 10;
}

/** Ticks for one axis. `pan` is the screen px of world 0, `size` the strip length. */
export function rulerTicks(scale: number, pan: number, size: number, step: number): RulerTick[] {
  const out: RulerTick[] = [];
  if (!(scale > 0) || !(size > 0) || !(step > 0) || !Number.isFinite(pan)) return out;
  const minor = step / 5;
  const from = Math.floor(-pan / scale / minor);
  const to = Math.ceil((size - pan) / scale / minor);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to - from > 4000) return out;
  for (let i = from; i <= to; i++) {
    const value = i * minor;
    const major = i % 5 === 0;
    out.push({ px: value * scale + pan, label: major ? String(Math.round(value)) : '', major, zero: i === 0 });
  }
  return out;
}
