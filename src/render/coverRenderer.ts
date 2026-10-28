/**
 * 欢迎页卡片封面：用一个共享的隐藏 StageRenderer 离屏画贴图（不画骨骼线框），转成 JPEG 缩略图。
 * 与舞台走同一套绘制代码。任务串行排队：整页只占一个 WebGL 上下文。
 */
import { Texture } from 'pixi.js';
import type { Player } from '../core/player';
import { StageRenderer } from './pixiRenderer';

export const COVER_WIDTH = 400;
export const COVER_HEIGHT = 250;
/** 骨钉 / 骨片线宽是固定屏幕像素：在大画布上画再缩小，线框相对形象才不会糊成一片 */
const RENDER_WIDTH = 640;
const RENDER_HEIGHT = 400;
const COVER_BACKGROUND = '#24272d';

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

let shared: Promise<StageRenderer> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let lastTexture: Texture | null = null;

function renderer(): Promise<StageRenderer> {
  if (!shared) {
    shared = (async () => {
      const host = document.createElement('div');
      host.setAttribute('data-cover-renderer', '');
      host.style.cssText = `position:fixed;left:-10000px;top:0;width:${RENDER_WIDTH}px;height:${RENDER_HEIGHT}px;pointer-events:none;visibility:hidden;`;
      document.body.appendChild(host);
      const stage = new StageRenderer();
      await stage.init(host);
      stage.showOriginCross = false;
      return stage;
    })();
  }
  return shared;
}

async function loadTexture(url: string): Promise<Texture | null> {
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    return Texture.from(image);
  } catch {
    return null;
  }
}

/** 串行占用离屏渲染器：先换上这份工程的贴图，再执行 `job`。出错返回 null。 */
export function withCoverStage<T>(imageUrl: string | null, job: (stage: StageRenderer) => T | Promise<T>): Promise<T | null> {
  const run = queue.then(async () => {
    const stage = await renderer();
    const texture = imageUrl ? await loadTexture(imageUrl) : null;
    stage.setTexture(texture, texture?.width ?? 1, texture?.height ?? 1);
    if (lastTexture && lastTexture !== texture) lastTexture.destroy(true);
    lastTexture = texture;
    return job(stage);
  }).catch(() => null);
  queue = run;
  return run;
}

/** 当前姿态下贴图顶点的包围盒（没有贴图时退回骨钉）；`into` 给了就并进去（动画多帧取并集）。 */
export function poseBounds(player: Player, into?: Bounds): Bounds {
  const b = into ?? { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (x: number, y: number) => {
    if (x < b.minX) b.minX = x;
    if (x > b.maxX) b.maxX = x;
    if (y < b.minY) b.minY = y;
    if (y > b.maxY) b.maxY = y;
  };
  const items = player.renderItems();
  for (const item of items) {
    for (let i = 0; i + 1 < item.positions.length; i += 2) add(item.positions[i], item.positions[i + 1]);
  }
  if (items.length === 0) for (const bone of player.skeleton.bones) add(bone.world[4], bone.world[5]);
  return b;
}

/** 画当前姿态并截成 JPEG data URL；`bounds` 决定取景（多帧共用同一取景，画面才不抖）。 */
export function snapshotPose(stage: StageRenderer, player: Player, bounds: Bounds, quality = 0.86): string | null {
  const b = Number.isFinite(bounds.minX) ? bounds : { minX: -50, minY: -50, maxX: 50, maxY: 50 };
  const scale = Math.min(RENDER_WIDTH / Math.max(1, b.maxX - b.minX), RENDER_HEIGHT / Math.max(1, b.maxY - b.minY)) * 0.84;
  stage.setCamera(scale, RENDER_WIDTH / 2 - ((b.minX + b.maxX) / 2) * scale, RENDER_HEIGHT / 2 - ((b.minY + b.maxY) / 2) * scale);
  stage.draw(player.renderItems());
  stage.clearOverlay();
  stage.render();
  // WebGL 缓冲在本任务结束前仍有效：立刻拷到 2D 画布，铺底色后压成 JPEG（体积约为 PNG 的 1/5）
  const out = document.createElement('canvas');
  out.width = COVER_WIDTH;
  out.height = COVER_HEIGHT;
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = COVER_BACKGROUND;
  ctx.fillRect(0, 0, COVER_WIDTH, COVER_HEIGHT);
  ctx.drawImage(stage.app.canvas as HTMLCanvasElement, 0, 0, COVER_WIDTH, COVER_HEIGHT);
  return out.toDataURL('image/jpeg', quality);
}

/** 画一帧封面（当前姿态）。失败返回 null，调用方显示占位。 */
export function renderCover(player: Player, imageUrl: string | null): Promise<string | null> {
  return withCoverStage(imageUrl, (stage) => snapshotPose(stage, player, poseBounds(player)));
}
