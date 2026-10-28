/** Minimal line-icon set used across the editor chrome (24x24 viewBox). */
const PATHS: Record<string, { d: string; fill?: boolean }[]> = {
  logo: [
    { d: 'M8.2 8.2 15.8 15.8' },
    { d: 'M8.2 8.2a2.7 2.7 0 1 1-3.8-3.8 2.7 2.7 0 0 1 3.8 3.8z' },
    { d: 'M15.8 15.8a2.7 2.7 0 1 0 3.8 3.8 2.7 2.7 0 0 0-3.8-3.8z' },
  ],
  cursor: [{ d: 'M5 3l13 9.2-5.4.8L15 20l-2.6 1-2.4-6.5-3.9 3z', fill: true }],
  star: [{ d: 'M12 3.5l2.4 5.4 5.9.6-4.4 4 1.2 5.9L12 16.5l-5.1 2.9 1.2-5.9-4.4-4 5.9-.6z' }],
  bone: [
    { d: 'M9 9l6 6' },
    { d: 'M9 9a2.6 2.6 0 1 1-3.6-3.6A2.6 2.6 0 0 1 9 9z' },
    { d: 'M15 15a2.6 2.6 0 1 0 3.6 3.6A2.6 2.6 0 0 0 15 15z' },
  ],
  drop: [{ d: 'M12 3s6 6.5 6 10.5A6 6 0 0 1 6 13.5C6 9.5 12 3 12 3z' }],
  mesh: [{ d: 'M3 3h18v18H3zM9 3v18M15 3v18M3 9h18M3 15h18' }],
  hand: [{ d: 'M8 12.5V6a1.5 1.5 0 0 1 3 0v4.5M11 10.5V4.5a1.5 1.5 0 0 1 3 0V10M14 10.5V6a1.5 1.5 0 0 1 3 0v9a5.5 5.5 0 0 1-5.5 5.5H11A4.5 4.5 0 0 1 6.5 16v-2.6l-.9 1' }],
  move: [{ d: 'M12 3v18M3 12h18M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5' }],
  rotate: [{ d: 'M20 12a8 8 0 1 1-2.6-5.9M20.5 4v4.5h-4.5' }],
  scale: [{ d: 'M4 15V4h11M20 9v11H9M4 4l7 7M20 20l-7-7' }],
  play: [{ d: 'M7 4.5l12 7.5-12 7.5z', fill: true }],
  pause: [{ d: 'M9 5v14M15 5v14' }],
  stop: [{ d: 'M6 6h12v12H6z', fill: true }],
  toStart: [{ d: 'M7 5v14M19 5l-9 7 9 7z', fill: true }],
  toEnd: [{ d: 'M17 5v14M5 5l9 7-9 7z', fill: true }],
  prevKey: [{ d: 'M13 6l-6 6 6 6M19 6l-6 6 6 6' }],
  nextKey: [{ d: 'M11 6l6 6-6 6M5 6l6 6-6 6' }],
  key: [{ d: 'M12 4l2 5 5 .6-3.7 3.5 1 5.1L12 15.5 7.7 18.2l1-5.1L5 9.6 10 9z' }],
  undo: [{ d: 'M9 7H5V3M5.6 7.6A8 8 0 1 1 4.2 14.6' }],
  redo: [{ d: 'M15 7h4V3M18.4 7.6A8 8 0 1 0 19.8 14.6' }],
  eye: [{ d: 'M2 12s3.8-6.2 10-6.2S22 12 22 12s-3.8 6.2-10 6.2S2 12 2 12z' }, { d: 'M12 9.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2z' }],
  lock: [{ d: 'M6.5 10V7.4a5.5 5.5 0 1 1 11 0V10M5 10h14v10H5z' }],
  search: [{ d: 'M11 4.5a6.5 6.5 0 1 0 4.6 11.1L21 21M11 4.5a6.5 6.5 0 0 1 4.6 11.1' }],
  menu: [{ d: 'M4 7h16M4 12h16M4 17h16' }],
  chevronDown: [{ d: 'M6 9.5l6 6 6-6' }],
  chevronRight: [{ d: 'M9.5 6l6 6-6 6' }],
  /** 场景树「展开全部」：主干向右伸出子级，和单行的「⌄」区分开 */
  expandAll: [
    { d: 'M6.5 4.5v15' },
    { d: 'M6.5 7h11' },
    { d: 'M6.5 12.5h11' },
    { d: 'M6.5 18h7' },
  ],
  /** 场景树「折叠全部」：整颗图标都是向右的双箭头，对应单行收起时的「›」 */
  collapseAll: [
    { d: 'M4 6 11 12 4 18' },
    { d: 'M12 6 19 12 12 18' },
  ],
  plus: [{ d: 'M12 5v14M5 12h14' }],
  x: [{ d: 'M6 6l12 12M18 6L6 18' }],
  folder: [{ d: 'M3 6.5h6l2 2h10V20H3z' }],
  save: [{ d: 'M4 4h12l4 4v12H4zM8 4v6h8V4M8 20v-6h8v6' }],
  export: [{ d: 'M12 15.5V4M8 8l4-4 4 4M4 15.5V20h16v-4.5' }],
  image: [{ d: 'M3 4h18v16H3zM3 16l5-5 4 4 3-3 6 6' }, { d: 'M8.5 8.5h.01' }],
  fit: [{ d: 'M4 9.5V4h5.5M20 9.5V4h-5.5M4 14.5V20h5.5M20 14.5V20h-5.5' }],
  zoom: [{ d: 'M11 4.5a6.5 6.5 0 1 0 4.6 11.1L21 21M8.5 11h5M11 8.5v5' }],
  layers: [{ d: 'M12 3.5l8.5 4.5L12 12.5 3.5 8zM3.5 13l8.5 4.5 8.5-4.5' }],
  clock: [{ d: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 7.5V12l3 2' }],
  info: [{ d: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 11v5.5M12 7.8h.01' }],
  reset: [{ d: 'M4 12a8 8 0 1 0 8-8 8 8 0 0 0-6 2.7M3.5 4v4.2h4.2' }],
  opacity: [{ d: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 3.5v17' }],
  anchor: [{ d: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM12 3v2.5M12 18.5V21M4.5 12H3M21 12h-1.5' }],
  crosshair: [
    { d: 'M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4' },
    { d: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z' },
  ],
  grid: [{ d: 'M3 3h18v18H3zM3 10h18M3 16h18M9 3v18M15 3v18' }],
  dot: [{ d: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', fill: true }],
  // 官方 /assets/skins/tree/filterClose.png（关）与 filterOpen.png（开）—— 场景树「智能过滤」
  // 序列帧面板的帧排序（官方 /assets/frames/sortUp.png、sortDown.png）—— 按名字重排整个帧列表
  sortUp: [{ d: 'M12 5v14M6.5 10.5L12 5l5.5 5.5' }],
  // 序列帧帧编辑条的翻转（官方 /assets/button/flipX.png、flipY.png）
  // 舞台过滤器条「继承控制」列（官方 /assets/stageIcon/control.png）
  control: [{ d: 'M5 4.5h5v5H5zM14 14.5h5v5h-5zM10 7h4.5a2 2 0 0 1 2 2v5.5' }],  flipX: [{ d: 'M12 4v16M8.5 8.5L5 12l3.5 3.5M15.5 8.5L19 12l-3.5 3.5' }],
  flipY: [{ d: 'M4 12h16M8.5 8.5L12 5l3.5 3.5M8.5 15.5L12 19l3.5-3.5' }],
  sortDown: [{ d: 'M12 19V5M6.5 13.5L12 19l5.5-5.5' }],
  /** 序列帧洋葱皮（官方 /assets/frames/onionPrev | onionNext）：睁眼 + 顶上一枚指向箭头 */
  onionPrev: [
    { d: 'M9.5 4.2 7 6.7l2.5 2.5' },
    { d: 'M2 15.6s3.8-5.8 10-5.8S22 15.6 22 15.6s-3.8 5.8-10 5.8S2 15.6 2 15.6z' },
    { d: 'M12 13.5a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2z' },
  ],
  onionNext: [
    { d: 'M14.5 4.2 17 6.7l-2.5 2.5' },
    { d: 'M2 15.6s3.8-5.8 10-5.8S22 15.6 22 15.6s-3.8 5.8-10 5.8S2 15.6 2 15.6z' },
    { d: 'M12 13.5a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2z' },
  ],
  filterClose: [{ d: 'M3.5 5h17l-6.5 7.6V20l-4-2.2v-5.2z' }],
  filterOpen: [{ d: 'M3.5 5h17l-6.5 7.6V20l-4-2.2v-5.2z' }, { d: 'M8.5 8.4h7' }],
  free: [
    { d: 'M12 4v16M4 12h16M12 4l-2 2M12 4l2 2M12 20l-2-2M12 20l2-2M4 12l2-2M4 12l2 2M20 12l-2-2M20 12l-2 2' },
    { d: 'M9.5 9.5h5v5h-5z' },
  ],
  meshPlus: [
    { d: 'M3 3h18v18H3zM9 3v18M15 3v18M3 9h18M3 15h18' },
    { d: 'M18 5.5h3.5M19.75 4v3' },
  ],
  meshMinus: [
    { d: 'M3 3h18v18H3zM9 3v18M15 3v18M3 9h18M3 15h18' },
    { d: 'M18 5.5h3.5' },
  ],
  /** 变换条：解锁宽高比 / 打关键帧的旗标 */
  unlock: [
    { d: 'M5 10h14v10H5z' },
    { d: 'M8.5 10V7.4a3.5 3.5 0 0 1 6.6-1.7' },
  ],
  flag: [
    { d: 'M6 3.5v17' },
    { d: 'M6 4.5h11.5l-2.2 3.6 2.2 3.6H6z' },
  ],
  /** 曲线预设：台阶 / 线性 / 渐入 / 渐出 / 渐入渐出 */
  curveStep: [{ d: 'M4 18H18V6' }],
  curveLinear: [{ d: 'M5 18 19 6' }],
  curveEaseIn: [{ d: 'M4 18c7 0 11-3 16-12' }],
  curveEaseOut: [{ d: 'M4 18c1-9 5-12 16-12' }],
  curveEaseInOut: [{ d: 'M4 18c4 0 4-12 8-12s4 0 8 0' }],
  copy: [{ d: 'M9 8h10v12H9z' }, { d: 'M6 16V5h10' }],
  paste: [{ d: 'M8 6h4.2L14 8h3v11H8z' }, { d: 'M10 6V4.5h4V6' }],
  tracks: [{ d: 'M8 7h12M8 12h12M8 17h12' }, { d: 'M4.5 7h.01M4.5 12h.01M4.5 17h.01' }],
  cut: [
    { d: 'M7.2 8.2a2.2 2.2 0 1 1-3.1-3.1 2.2 2.2 0 0 1 3.1 3.1z' },
    { d: 'M7.2 15.8a2.2 2.2 0 1 0-3.1 3.1 2.2 2.2 0 0 0 3.1-3.1z' },
    { d: 'M8.2 9.2 20 17M8.2 14.8 20 7' },
  ],
  trash: [{ d: 'M5 7h14M9 7V5h6v2M7.5 7l.8 13h7.4l.8-13' }],
  /**
   * 「层级」面板行左侧的相对位移箭头（官方 `/assets/button/arrow_up.png` / `arrow_down.png`）：
   * 比绑定顺序更靠前（画得更上层）画上箭头，更靠后画下箭头。
   */
  arrowUp: [{ d: 'M12 19.5V6M6.5 11.5L12 6l5.5 5.5' }],
  arrowDown: [{ d: 'M12 4.5V18M6.5 12.5L12 18l5.5-5.5' }],
  /** 层级工具条的「上移(=) / 下移(-)」（官方 `/assets/button/bringForward.png`、`sendBackward.png`） */
  bringForward: [{ d: 'M5 4.5h14' }, { d: 'M12 20V9M7.5 13.5L12 9l4.5 4.5' }],
  sendBackward: [{ d: 'M5 19.5h14' }, { d: 'M12 4v11M7.5 10.5L12 15l4.5-4.5' }],
  /** 官方 `/assets/button/refresh.png`（资源面板「刷新」）：环形箭头 */
  refresh: [
    { d: 'M19.5 12a7.5 7.5 0 1 1-2.4-5.5' },
    { d: 'M19.8 3.5v4.2h-4.2' },
  ],
  /** 官方 `/assets/button/create_symbol.png`（资源面板「新建元件」）：方块 + 加号 */
  newSymbol: [
    { d: 'M4 4.5h9v9H4z' },
    { d: 'M17 8.5v9h-9' },
    { d: 'M17 3.5v5M14.5 6h5' },
  ],
  distribute: [{ d: 'M5 7v10M12 4v16M19 7v10' }],
  marquee: [{ d: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5' }],
};

export type IconName = keyof typeof PATHS | string;

export function Icon({ name, size = 14, className }: { name: IconName; size?: number; className?: string }) {
  const shapes = PATHS[name] ?? PATHS.dot;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {shapes.map((shape, i) => (
        <path key={i} d={shape.d} fill={shape.fill ? 'currentColor' : 'none'} />
      ))}
    </svg>
  );
}

