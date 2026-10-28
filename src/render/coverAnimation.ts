/**
 * 欢迎页卡片悬停预览：把第一个动画离屏渲染成一组 JPEG 帧，由卡片按动画帧率循环播放。
 * 所有帧共用一个取景（各帧包围盒的并集），画面不会随姿态跳动。
 */
import type { Player } from '../core/player';
import { poseBounds, snapshotPose, withCoverStage } from './coverRenderer';

/** 帧数上限：长动画均匀抽帧，单次悬停的渲染开销封顶 */
const MAX_FRAMES = 48;

export interface CoverAnimation {
  frames: string[];
  /** 相邻两帧的播放间隔（毫秒，已计入抽帧步长） */
  interval: number;
}

/** `player` 由调用方新建、专供预览用：这里会改它的动画状态。没有动画时返回 null。 */
export function renderCoverAnimation(player: Player, imageUrl: string | null): Promise<CoverAnimation | null> {
  const first = player.animationNames()[0];
  if (!first) return Promise.resolve(null);
  player.setupPose = false;
  player.playing = false;
  player.setAnimation(first);
  const duration = Math.max(1, Math.round(player.duration));
  const step = Math.max(1, Math.ceil(duration / MAX_FRAMES));
  const positions: number[] = [];
  for (let frame = 0; frame < duration; frame += step) positions.push(frame);
  const rate = player.frameRate > 0 ? player.frameRate : 24;
  return withCoverStage(imageUrl, (stage) => {
    const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const frame of positions) {
      player.seek(frame);
      poseBounds(player, bounds);
    }
    const frames: string[] = [];
    for (const frame of positions) {
      player.seek(frame);
      const url = snapshotPose(stage, player, bounds, 0.8);
      if (url) frames.push(url);
    }
    return frames.length > 1 ? { frames, interval: (1000 / rate) * step } : null;
  });
}
