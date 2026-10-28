/**
 * 舞台右键菜单落位（spec §113）。
 *
 * 菜单是 `position: fixed`、按鼠标 `clientX/clientY` 定位的浮层（见 App.tsx 的
 * `.stage-menu`）。骨骼菜单近 30 项，右键靠舞台底部时会被视口裁掉 —— 这里按
 * **舞台容器** `.viewer` 的矩形算落位：
 *   1. 先贴光标；
 *   2. 下方放不下 → 整体上移，贴容器底边（不越出容器上边）；
 *   3. 上移到顶仍放不下 → 用 `maxHeight` 兜底，配合内层 `.stage-menu-scroll`
 *      的 `overflow-y: auto` 出竖向滚动条。
 *
 * 纯函数、不碰 DOM，便于单测（tests/stageMenuFit.test.ts）。
 */

/** 菜单与容器边缘留的空隙（px）。 */
export const STAGE_MENU_MARGIN = 6;

/** 视口坐标系下的矩形（`getBoundingClientRect()` 的形状）。 */
export interface StageMenuRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface StageMenuFit {
  /** 菜单左边界（视口 px，`.stage-menu` 是 fixed 定位，直接当 left 用）。 */
  left: number;
  /** 菜单上边界。 */
  top: number;
  /** 菜单可用的最大高度：小于菜单自然高时由内层滚动容器出滚动条。 */
  maxHeight: number;
}

/**
 * 按舞台容器矩形夹取菜单落位。
 *
 * @param anchor 鼠标位置（视口 px，即 `clientX/clientY`）
 * @param size 菜单的**自然**尺寸（未受 maxHeight 限制时的 offsetWidth/offsetHeight）
 * @param container 舞台容器矩形（`.viewer` 的 getBoundingClientRect）
 * @param margin 菜单与容器边缘的空隙
 */
export function fitStageMenu(
  anchor: { x: number; y: number },
  size: { width: number; height: number },
  container: StageMenuRect,
  margin = STAGE_MENU_MARGIN,
): StageMenuFit {
  const topLimit = container.top + margin;
  const bottomLimit = container.bottom - margin;
  const leftLimit = container.left + margin;
  const rightLimit = container.right - margin;

  // 水平：先贴光标；右侧放不下就往左收，窄容器下仍不够则贴左边（允许越出右侧）。
  const left = Math.max(leftLimit, Math.min(anchor.x, rightLimit - size.width));

  // 垂直：贴光标 → 上移贴底 → 贴顶（容器比菜单还矮时只能贴顶 + 滚动兜底）。
  let top = anchor.y;
  if (top + size.height > bottomLimit) top = bottomLimit - size.height;
  if (top < topLimit) top = topLimit;

  return { left, top, maxHeight: Math.max(0, bottomLimit - top) };
}
