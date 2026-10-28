/**
 * 运行环境判定（只判「会影响舞台交互」的那一类差异）。
 */

/**
 * 当前是不是 **桌面版** Chromium Edge。
 *
 * 为什么要判它：Edge 的「鼠标手势」是**浏览器级**特性 —— 按住右键往左划 = 后退。
 * 它跑在浏览器自己的输入处理里，**早于**页面事件：实测一次右键拖拽的中途，
 * 页面的 `pointermove` 会被大面积节流（2 秒里只剩个位数），并且页面会直接失焦
 * （`blur` + `visibilitychange`），松手时才补一个 `pointerup`。
 * 页面层把 `mousedown` / `pointerdown` / `contextmenu` / `dragstart` 的默认行为
 * 全部 `preventDefault()` 也拦不住它（浏览器级手势不受页面默认行为支配；
 * 见 Microsoft Q&A https://learn.microsoft.com/en-us/answers/questions/1311715/ ，
 * 官方给出的办法是站点屏蔽列表 / 策略，JS 无解）。
 * 所以舞台那条「右键拖 = 平移舞台」在 Edge 上不可靠，改为提示用户用 `H` 抓手。
 *
 * 只匹配 `Edg/`（桌面版）：Android 是 `EdgA/`、iOS 是 `EdgiOS/`，那两端没有这套鼠标手势，
 * 不算进来，免得在移动端弹一条用不上的提示。
 */
export function isDesktopEdge(ua: string = navigator.userAgent): boolean {
  return /Edg\//.test(ua);
}
