/**
 * 图集图片 → alpha 掩码。舞台拾取用它做「透明区域不触发」的判定（`src/core/alphaHit.ts`）。
 *
 * 图集是 PNG，浏览器侧最省事的取像素办法是离屏 canvas：`drawImage` 后 `getImageData`。
 * 同一个 url 只解一次（缓存 Promise），图集切换时才重新取。
 * 取不到（跨域污染画布、解码失败、拿不到 2D 上下文）时返回 null —— 调用方会回落到几何判定。
 */
import type { AlphaMask } from '../core/alphaHit';

const cache = new Map<string, Promise<AlphaMask | null>>();
/** 图集是 blob URL，每打开一个工程就是一个新 url —— 缓存要有上限，别攒着不放。 */
const CACHE_LIMIT = 4;

/** 只留 alpha 通道，比整张 RGBA 省 3/4 内存（1024² 图集 ≈ 1MB）。 */
async function decodeAlphaMask(url: string): Promise<AlphaMask | null> {
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (width <= 0 || height <= 0) return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, width, height).data;
    const alpha = new Uint8Array(width * height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
    return { width, height, alpha };
  } catch {
    return null;
  }
}

/** 取（或开始取）某个图集的 alpha 掩码；结果缓存在 url 上（只留最近几个）。 */
export function loadAlphaMask(url: string): Promise<AlphaMask | null> {
  const hit = cache.get(url);
  if (hit) {
    cache.delete(url);          // 重新插入，保持「最近使用」在后面
    cache.set(url, hit);
    return hit;
  }
  const task = decodeAlphaMask(url);
  cache.set(url, task);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return task;
}

/** 清缓存（单测与「重新打开同一份工程」用；正常渲染路径不需要）。 */
export function clearAlphaMaskCache(): void {
  cache.clear();
}
