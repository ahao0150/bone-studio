/**
 * 舞台右键菜单落位（spec §113）。
 *
 * 判据重点是**三种落位分支**都要能被区分：放得下（贴光标）／下方放不下（上移贴底，
 * 不滚动）／容器太矮（贴顶 + maxHeight 兜底出滚动条）。另有水平夹取与退化容器。
 * 实测的 `.viewer` 尺寸见 格式规范（top 55 / bottom 841 / left 281 / right 991）。
 */
import { describe, expect, it } from 'vitest';
import { STAGE_MENU_MARGIN, fitStageMenu } from '../src/ui/stageMenuFit';

/** 实测舞台容器（`.viewer`，见 spec §113）的视口矩形。 */
const VIEWER = { top: 55, right: 991, bottom: 841, left: 281 };

describe('stage context menu fit', () => {
  it('sticks to the cursor when the menu fits below it', () => {
    const fit = fitStageMenu({ x: 400, y: 100 }, { width: 150, height: 300 }, VIEWER);
    expect(fit.left).toBe(400);
    expect(fit.top).toBe(100);
    expect(fit.maxHeight).toBeGreaterThanOrEqual(300);
  });

  it('shifts up so the bottom edge sits on the container, without scrolling', () => {
    const fit = fitStageMenu({ x: 400, y: 700 }, { width: 150, height: 300 }, VIEWER);
    expect(fit.top).toBe(VIEWER.bottom - STAGE_MENU_MARGIN - 300);
    expect(fit.top + 300).toBe(VIEWER.bottom - STAGE_MENU_MARGIN);
    expect(fit.maxHeight).toBe(300);
  });

  it('falls back to a maxHeight (scroll) when the menu is taller than the container', () => {
    const fit = fitStageMenu({ x: 400, y: 700 }, { width: 150, height: 900 }, VIEWER);
    expect(fit.top).toBe(VIEWER.top + STAGE_MENU_MARGIN);
    expect(fit.maxHeight).toBe(VIEWER.bottom - STAGE_MENU_MARGIN - fit.top);
    expect(fit.maxHeight).toBeLessThan(900);
  });

  it('clamps horizontally on both sides', () => {
    const right = fitStageMenu({ x: 980, y: 100 }, { width: 150, height: 300 }, VIEWER);
    expect(right.left).toBe(VIEWER.right - STAGE_MENU_MARGIN - 150);
    const left = fitStageMenu({ x: 100, y: 100 }, { width: 150, height: 300 }, VIEWER);
    expect(left.left).toBe(VIEWER.left + STAGE_MENU_MARGIN);
  });

  it('honours a custom margin', () => {
    const fit = fitStageMenu({ x: 400, y: 900 }, { width: 150, height: 300 }, VIEWER, 0);
    expect(fit.top).toBe(VIEWER.bottom - 300);
    expect(fit.maxHeight).toBe(300);
  });

  it('degrades to maxHeight 0 on a container shorter than 2 * margin', () => {
    const tiny = { top: 0, right: 100, bottom: 10, left: 0 };
    const fit = fitStageMenu({ x: 5, y: 5 }, { width: 50, height: 100 }, tiny);
    expect(fit.top).toBe(0 + STAGE_MENU_MARGIN);
    expect(fit.maxHeight).toBe(0);
  });
});
