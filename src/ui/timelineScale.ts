/**
 * Pure scale math for the dope sheet (timeline).
 *
 * The official editor zooms the timeline with the mouse wheel over the ruler
 * (Loongbones `ui-dope-sheet.md`: "使用鼠标滚轮可以对标尺进行缩放") and shows a
 * horizontal scrollbar once the whole range no longer fits. The rendering
 * container only owns the playhead; everything positional is derived here.
 */

/** Zoom limits (1 = fit the whole animation into the viewport). */
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 40;

export interface TimelineMetrics {
  /** horizontal pixels per animation frame */
  pxPerFrame: number;
  /** scrollable content width (>= the viewport) */
  contentWidth: number;
  /** playhead x within the lanes container (relative to the visible left edge) */
  playheadPx: number;
}

export function clampZoom(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, value));
}

export function timelineMetrics(input: {
  duration: number;
  viewportWidth: number;
  zoom: number;
  /** 只有「内层自己滚动」的老结构才需要；现在滚动交给整张表的容器，缺省 0 */
  scrollLeft?: number;
  position: number;
}): TimelineMetrics {
  const duration = Math.max(1, input.duration);
  const viewport = Math.max(1, input.viewportWidth);
  const zoom = clampZoom(input.zoom);
  const pxPerFrame = (viewport / duration) * zoom;
  const contentWidth = Math.max(viewport, duration * pxPerFrame);
  const playheadPx = input.position * pxPerFrame - Math.max(0, input.scrollLeft ?? 0);
  return { pxPerFrame, contentWidth, playheadPx };
}

/** Frames per major tick so labels stay at least ~56px apart. */
export function majorStepFor(pxPerFrame: number): number {
  const wanted = 56 / Math.max(pxPerFrame, 1e-6);
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(wanted, 1e-6))));
  const candidates = [1, 2, 5, 10].map((m) => m * pow);
  return candidates.find((value) => value >= wanted) ?? 10 * pow;
}

export interface TimelineTick {
  frame: number;
  major: boolean;
}

/**
 * Ruler ticks for the current scale. Minor ticks are dropped when they would be
 * closer than 3px (zoomed far out), which also bounds the element count.
 */
export function timelineTicks(duration: number, pxPerFrame: number, limit = 4000): TimelineTick[] {
  const span = Math.max(1, duration);
  const major = majorStepFor(pxPerFrame);
  const perMajor = pxPerFrame * major >= 120 ? 5 : pxPerFrame * major >= 40 ? 2 : 1;
  const minor = major / perMajor;
  const out: TimelineTick[] = [];
  if (minor * pxPerFrame < 3) return out;
  for (let i = 0; i * minor <= span + 1e-6; i++) {
    const frame = Math.round(i * minor * 100) / 100;
    out.push({ frame, major: Math.abs(frame % major) < 1e-6 });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Frame under a pointer, given the lanes rect and the current scroll offset.
 *
 * **按帧取整**（官方标尺的单位是帧，不是秒）：取整之后播放头永远停在整数帧上，
 * 属性面板 / 变换栏旗杆的「当前帧有没有这个属性的关键帧」才判得准（用户 185 轮）。
 */
export function frameAtPointer(input: {
  clientX: number;
  lanesLeft: number;
  scrollLeft: number;
  pxPerFrame: number;
  duration: number;
}): number {
  const raw = (input.clientX - input.lanesLeft + input.scrollLeft) / Math.max(input.pxPerFrame, 1e-6);
  return Math.max(0, Math.min(input.duration, Math.round(raw)));
}

/**
 * Scroll offset that keeps `frame` under the same pointer x after a zoom change
 * (official wheel zoom feels anchored to the cursor rather than the left edge).
 */
export function scrollForAnchoredZoom(input: {
  frame: number;
  clientX: number;
  lanesLeft: number;
  pxPerFrame: number;
  duration: number;
  viewportWidth: number;
}): number {
  const wanted = input.frame * input.pxPerFrame - (input.clientX - input.lanesLeft);
  const max = Math.max(0, input.duration * input.pxPerFrame - input.viewportWidth);
  return Math.max(0, Math.min(max, wanted));
}
