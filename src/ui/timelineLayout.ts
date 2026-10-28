/**
 * 时间轴的官方几何与缩放模型（规格：DragonBonesPro.swf 格式规范 `_978/Timeline.as:83-113`、
 * 标尺 `_978/_988.as`、刻度 `_978/_989.as`、网格 `_978/_987.as`、配色 `_97/_100.as`）。
 *
 * 坐标系：「轨道区」左边（即左栏 242px 的右边）为 x = 0；第 `startIndex` 帧画在 x = LABEL_GAP。
 * 横向滚动不是像素 scrollLeft，而是整数起始帧 `startIndex`。
 */

export const TL = {
  NAME_W: 242,
  LABEL_H: 58,
  ROW_H: 24,
  KEY_H: 23,
  STATUS_H: 26,
  LABEL_GAP: 10,
  LONG_LINE: 38,
  SHORT_LINE: 16,
  /** 动画汇总帧条：y = LABEL_H - ROW_H，高 KEY_H */
  SUMMARY_Y: 34,
  /** 末帧红线从这里往下（LABEL_H - LONG_LINE） */
  LAST_LINE_Y: 20,
  INDENT: 14,
  KEY_W: 6,
  KEY_HOT: 14,
} as const;

export const MAX_GAP = 40;
export const MIN_GAP = 10;
const TWO_LABEL_GAP = 25;
const FIVE_LABEL_GAP = 15;
export const SCALE_LEVEL = [1, 2, 4, 10, 20];
export const ZOOM_RATE = 0.8;
export const SCALE_MIN = MIN_GAP / (MAX_GAP * SCALE_LEVEL[SCALE_LEVEL.length - 1]);
export const PLAY_RATE = [0.1, 0.2, 0.5, 1, 2, 4, 10];
export const PLAY_RATE_DEFAULT = 3;

export const TL_COLOR = {
  // 底色跟随应用主题（styles.css :root），只有关键帧 / 播放头 / 循环 / 末帧线保留官方语义色
  rulerBg: '#212121',
  tick: '#3d3d3d',
  tickText: '#7a7a7a',
  tickTextLoop: '#00567B',
  summaryBg: '#2f2f2f',
  rowAnim: '#333333',
  rowBone: '#2d2d2d',
  rowOther: '#272727',
  rowLine: '#191919',
  rowSelected: '#16406e',
  rowHover: '#3a3a3a',
  keyStroke: '#222222',
  keyStrokeOver: '#FFFFFF',
  keyStrokeDown: '#28FD2D',
  curve: '#999999',
  curveSelected: '#FFFFFF',
  pointer: '#28FD2D',
  loop: '#28BCE1',
  lastFrame: '#FF0000',
  statusBg: '#2d2d2d',
} as const;

export type KeyKind =
  | 'translate' | 'rotate' | 'scale' | 'color' | 'displayIndex' | 'visible'
  | 'zOrder' | 'ffd' | 'event' | 'ik' | 'slot' | 'mult' | 'bone';

/** `_13547.color`：单通道按类型取色；骨骼行多通道合并为 MULT，插槽行合并为 SLOT */
export const KEY_COLOR: Record<KeyKind, string> = {
  translate: '#00A900',
  rotate: '#0374CA',
  scale: '#FD3C3C',
  color: '#CA50C5',
  displayIndex: '#7C7C7C',
  visible: '#E45A2C',
  zOrder: '#419CE0',
  ffd: '#00FFFF',
  event: '#E04D50',
  ik: '#E04D50',
  slot: '#EAD457',
  mult: '#CDCDCD',
  bone: '#D9D9D9',
};

/** 每一行的底色分三档（`_982.as:174-206` / `_984.as:138-167`） */
export type RowTone = 'anim' | 'bone' | 'other';
export const ROW_BG: Record<RowTone, string> = {
  anim: TL_COLOR.rowAnim,
  bone: TL_COLOR.rowBone,
  other: TL_COLOR.rowOther,
};

export interface RulerScale {
  scale: number;
  /** 相邻刻度的像素间距 */
  gap: number;
  /** 每个刻度代表几帧（SCALE_LEVEL 之一） */
  framesPerTick: number;
  /** 每隔几个刻度出一个长刻度 + 数字 */
  labelEvery: number;
  pxPerFrame: number;
}

export function clampScale(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.min(1, Math.max(SCALE_MIN, value));
}

/** `_988.set _4718`：间距不足 MIN_GAP 就升一级；数字间隔 1 / 2 / 5 */
export function rulerScale(rawScale: number): RulerScale {
  const scale = clampScale(rawScale);
  let level = 0;
  let gap = MAX_GAP * scale;
  while (gap < MIN_GAP && level < SCALE_LEVEL.length - 1) {
    level += 1;
    gap = MAX_GAP * scale * SCALE_LEVEL[level];
  }
  const labelEvery = level > 0 ? 5 : gap > TWO_LABEL_GAP ? 1 : gap > FIVE_LABEL_GAP ? 2 : 5;
  const framesPerTick = SCALE_LEVEL[level];
  const intGap = Math.max(1, Math.trunc(gap));
  return { scale, gap: intGap, framesPerTick, labelEvery, pxPerFrame: intGap / framesPerTick };
}

/** `_988._6796` */
export function frameToX(frame: number, rs: RulerScale, startIndex: number): number {
  return Math.trunc(rs.pxPerFrame * (frame - startIndex)) + TL.LABEL_GAP;
}

/** `_988._6883`：以半帧为界取最近的帧 */
export function xToFrame(x: number, rs: RulerScale, startIndex: number): number {
  let local = x - TL.LABEL_GAP + rs.pxPerFrame / 2;
  if (local < 0) local = 0;
  const whole = Math.floor(local / rs.gap);
  const rest = local - whole * rs.gap;
  return whole * rs.framesPerTick + Math.trunc((rest / rs.gap) * rs.framesPerTick) + startIndex;
}

/** `Timeline._4755`「最适合」 */
export function fitScale(laneWidth: number, duration: number): number {
  const span = Math.max(1, duration) * MAX_GAP * 1.2;
  return clampScale((laneWidth - MAX_GAP) / span);
}

/** `Timeline._6861`：轨道区一屏能放下多少帧 */
export function visibleFrames(laneWidth: number, rs: RulerScale): number {
  return Math.max(1, Math.trunc((laneWidth - MAX_GAP) / rs.pxPerFrame));
}

export interface RulerTick {
  frame: number;
  x: number;
  long: boolean;
  label: string;
}

/** `_988.index` + `_989.data`：第一个刻度对齐到 framesPerTick 的整数倍 */
export function rulerTicks(laneWidth: number, rs: RulerScale, startIndex: number): RulerTick[] {
  const step = rs.framesPerTick;
  const first = Math.ceil(startIndex / step) * step;
  const count = Math.ceil(laneWidth / rs.gap) + 1;
  const out: RulerTick[] = [];
  for (let i = 0; i < count; i++) {
    const frame = first + i * step;
    const x = frameToX(frame, rs, startIndex);
    if (x > laneWidth) break;
    const long = rs.labelEvery === 1 || (frame / step) % rs.labelEvery === 0;
    out.push({ frame, x, long, label: long || frame === 0 ? String(frame) : '' });
  }
  return out;
}

/** `_987`：网格竖线 = 长刻度往下延长；返回 CSS 背景参数 */
export function gridBackground(rs: RulerScale, startIndex: number): { size: number; offset: number } {
  const span = rs.labelEvery * rs.framesPerTick;
  const size = rs.gap * rs.labelEvery;
  const rem = startIndex % span;
  const offset = rem > 0 ? ((span - rem) / rs.framesPerTick) * rs.gap : 0;
  return { size, offset: TL.LABEL_GAP + offset };
}
