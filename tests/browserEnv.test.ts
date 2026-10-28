/**
 * 运行环境判定：只认**桌面版** Chromium Edge（`Edg/`）。
 *
 * 为什么要专门测：这条判定决定「要不要给用户弹那条改用 H 抓手的提示」。
 * 判歪了要么在 Chrome 上弹无用提示（狼来了），要么在 Edge 上不弹（用户继续被手势坑）。
 * 所以正例反例都要钉住 —— 特别是 Android / iOS 的 `EdgA` `EdgiOS` 与旧 EdgeHTML 的 `Edge/`，
 * 它们都没有这套鼠标手势。
 */
import { describe, expect, it } from 'vitest';
import { isDesktopEdge } from '../src/core/browserEnv';

const CHROME_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
const EDGE_WIN = `${CHROME_WIN} Edg/155.0.4283.45`;
const EDGE_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.4283.45';
const EDGE_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36 EdgA/155.0.0.0';
const EDGE_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/155.0.0.0 Version/17.0 Mobile/15E148 Safari/604.1';
/** 旧 EdgeHTML（非 Chromium、非桌面鼠标手势那一套） */
const LEGACY_EDGE =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/64.0.3282.140 Safari/537.36 Edge/18.17763';

describe('isDesktopEdge', () => {
  it('桌面版 Edge（Windows / macOS）判为真', () => {
    expect(isDesktopEdge(EDGE_WIN)).toBe(true);
    expect(isDesktopEdge(EDGE_MAC)).toBe(true);
  });

  it('Chrome / Firefox / Safari 判为假（不能满世界弹提示）', () => {
    expect(isDesktopEdge(CHROME_WIN)).toBe(false);
    expect(isDesktopEdge('Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0')).toBe(false);
    expect(isDesktopEdge('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15')).toBe(false);
  });

  it('移动端 Edge 与旧 EdgeHTML 判为假（它们没有这套鼠标手势）', () => {
    expect(isDesktopEdge(EDGE_ANDROID)).toBe(false);
    expect(isDesktopEdge(EDGE_IOS)).toBe(false);
    expect(isDesktopEdge(LEGACY_EDGE)).toBe(false);
  });

  it('只认带斜杠的 `Edg/`，裸 `Edg` 不算（避免被别处字样误伤）', () => {
    expect(isDesktopEdge('Edg')).toBe(false);
    expect(isDesktopEdge(`${CHROME_WIN} EdgeBrowser/1.0`)).toBe(false);
  });
});
