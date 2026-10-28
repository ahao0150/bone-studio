import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  TL, ZOOM_RATE, clampScale, fitScale, frameToX, rulerScale, visibleFrames, xToFrame,
} from '../timelineLayout';

/**
 * 时间轴视图状态：比例 `scale`（`_988._4718`，默认 1 = 40px/帧）+ 起始帧 `startIndex`。
 * 标尺滚轮缩放、按住标尺拖动定位、右键拖动平移（`Timeline.as:1491-1564`）、
 * 「当前」开着时播放自动滚动（`Timeline.tick` 的 `_13854` 分支）。
 */
export function useTimelineView(input: {
  duration: number;
  position: number;
  playing: boolean;
  follow: boolean;
  animKey: string;
  onSeek: (frame: number) => void;
}) {
  const { duration, position, playing, follow, animKey, onSeek } = input;
  const [scale, setScaleState] = useState(1);
  const [startIndex, setStartIndexState] = useState(0);
  const [laneWidth, setLaneWidth] = useState(800);
  const bodyRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const rs = rulerScale(scale);
  const visible = visibleFrames(laneWidth, rs);
  const live = useRef({ rs, startIndex, laneWidth });
  live.current = { rs, startIndex, laneWidth };

  const setScale = useCallback((value: number) => setScaleState(clampScale(value)), []);
  const setStartIndex = useCallback((value: number) => setStartIndexState(Math.max(0, Math.round(value))), []);
  const zoomIn = useCallback(() => setScaleState((value) => clampScale(value / ZOOM_RATE)), []);
  const zoomOut = useCallback(() => setScaleState((value) => clampScale(value * ZOOM_RATE)), []);
  const fit = useCallback(() => {
    setScaleState(fitScale(live.current.laneWidth, duration));
    setStartIndexState(0);
  }, [duration]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body || typeof ResizeObserver === 'undefined') return;
    const measure = () => setLaneWidth(Math.max(40, body.clientWidth - TL.NAME_W));
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    measure();
    return () => observer.disconnect();
  }, []);

  useEffect(() => { setStartIndexState(0); }, [animKey]);

  // 标尺上滚轮 = 缩放（官方不锚定鼠标，只改比例）；其它位置 Ctrl+滚轮也缩放
  useEffect(() => {
    const ruler = rulerRef.current;
    const body = bodyRef.current;
    const onWheel = (event: WheelEvent) => {
      const onRuler = !!(event.target as HTMLElement | null)?.closest('.dbtl-ruler');
      if (!onRuler && !event.ctrlKey) return;
      event.preventDefault();
      if (event.deltaY < 0) zoomIn(); else zoomOut();
    };
    ruler?.addEventListener('wheel', onWheel, { passive: false });
    body?.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      ruler?.removeEventListener('wheel', onWheel);
      body?.removeEventListener('wheel', onWheel);
    };
  }, [zoomIn, zoomOut]);

  // 播放跟随：越过一屏中线就把起始帧往后推；回绕到左边外面就跳回去
  useEffect(() => {
    if (!playing || !follow) return;
    const frame = Math.floor(position);
    const mid = startIndex + Math.floor(visible / 2);
    if (frame < startIndex) setStartIndexState(frame);
    else if (frame > mid) setStartIndexState(startIndex + (frame - mid));
  }, [position, playing, follow, startIndex, visible]);

  // 停着时换帧（按钮 / 快捷键）：保证播放头留在视野里（`_988.gotoFrame`）
  useEffect(() => {
    if (playing) return;
    const { rs: scaleNow, startIndex: from, laneWidth: width } = live.current;
    const frame = Math.round(position);
    if (frame < from) setStartIndexState(frame);
    else if (frameToX(frame, scaleNow, from) > width - 40) {
      setStartIndexState(from + Math.ceil((frameToX(frame, scaleNow, from) - (width - 40)) / scaleNow.pxPerFrame));
    }
  }, [position, playing]);

  const onRulerPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const element = event.currentTarget;
    const rect = element.getBoundingClientRect();
    const seekAt = (clientX: number) => {
      const { rs: scaleNow, startIndex: from, laneWidth: width } = live.current;
      const x = clientX - rect.left;
      if (x < 0 && from > 0) setStartIndexState(from - 1);
      else if (x > width) setStartIndexState(from + 1);
      onSeek(Math.max(0, Math.min(duration, xToFrame(Math.max(0, Math.min(width, x)), scaleNow, from))));
    };
    seekAt(event.clientX);
    const move = (e: PointerEvent) => seekAt(e.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [duration, onSeek]);

  /** 右键拖动平移（光标变手形）；没拖动就当普通右键 */
  const onPanPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 2) return;
    const x0 = event.clientX;
    const from = live.current.startIndex;
    const host = event.currentTarget;
    const move = (e: PointerEvent) => {
      host.classList.add('panning');
      setStartIndexState(Math.max(0, from - Math.round((e.clientX - x0) / live.current.rs.pxPerFrame)));
    };
    const up = () => {
      host.classList.remove('panning');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, []);

  return {
    rs, scale, setScale, startIndex, setStartIndex, laneWidth, visible,
    bodyRef, rulerRef, zoomIn, zoomOut, fit, onRulerPointerDown, onPanPointerDown,
  };
}
