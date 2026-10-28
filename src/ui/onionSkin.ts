/**
 * 洋葱皮的帧号计算（官方 `Timeline.onion.tooltip`）。
 *
 * 动画默认是循环的，所以首帧的「前一帧」回绕到末帧、末帧的「后一帧」回绕到 0 ——
 * 这样在任何位置停下来都能同时看到前后两张参考帧，与时间轴循环播放的语义一致。
 * 纯函数，方便单测边界（首帧 / 尾帧 / 空动画 / 越界位置）。
 */
export interface OnionFrames {
  prev: number;
  next: number;
}

export function onionFrames(position: number, duration: number): OnionFrames | null {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const last = Math.max(0, Math.round(duration) - 1);
  const at = Math.max(0, Math.min(last, Math.round(position)));
  return {
    prev: at <= 0 ? last : at - 1,
    next: at >= last ? 0 : at + 1,
  };
}