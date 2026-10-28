/**
 * 由 work/jioz-gen-bone-shape.mjs 从 主体.svg 生成 —— 请勿手改，改完重跑脚本覆盖。
 * 数值全部原样来自 SVG（路径命令 + 各级 transform + 颜色/线宽），只有末尾几个派生量由脚本算出。
 */
export type BoneShapeCommand =
  | ['M', number, number]
  | ['L', number, number]
  | ['Q', number, number, number, number]
  | ['Z'];

export interface BoneShapePath {
  commands: BoneShapeCommand[];
  fill: string | null;
  stroke: string | null;
  strokeWidth: number | null;
  /** SVG 里的 vector-effect="non-scaling-stroke"（本工程忽略它，让描边随缩放一起变粗） */
  nonScalingStroke: boolean;
}

export const BONE_SHAPE = {
  /** 环：两个同心圆（外深描边 + 内浅描边），fill=none */
  ring: {
    cx: 64, cy: 37, r: 23,
    outerStroke: '#383838', outerWidth: 8,
    innerStroke: '#aeaeae', innerWidth: 3.5,
  },
  /** 连接杆：从环心附近伸出（上端插进环内），双线 */
  connector: [
    { commands: [['M', 64, 38], ['L', 76, 64]], fill: null, stroke: '#383838', strokeWidth: 8, nonScalingStroke: false },
    { commands: [['M', 64, 38], ['L', 76, 64]], fill: null, stroke: '#aeaeae', strokeWidth: 4, nonScalingStroke: false },
  ] as BoneShapePath[],
  /** body 组：translate + rotate，肩部与下段都在这个坐标系里 */
  body: { tx: 76, ty: 61, deg: -26 },
  /** 下段锚点 translate（肩部底面中心），下段围绕它伸缩 */
  anchor: { tx: 0, ty: 11 },
  /** 下段原始 scale（示例里第二个数就是长度比例） */
  lowerScale: { x: 1, y: 1 },
  /** 肩部帽：先填后描，两组命令 */
  shoulder: [
    {
      commands: [['M', -22, 11], ['L', -5, -4], ['Q', -3, -5, 0, -4], ['L', 20, 11], ['Z']],
      fill: '#aeaeae',
      stroke: null,
      strokeWidth: 2.5,
      nonScalingStroke: false,
    },
    {
      commands: [['M', -22, 11], ['L', -5, -4], ['Q', -3, -5, 0, -4], ['L', 20, 11]],
      fill: null,
      stroke: '#383838',
      strokeWidth: 2.5,
      nonScalingStroke: false,
    },
  ] as BoneShapePath[],
  /** 锥形下段：先填后描；y 乘以长度比例即示例的 scale(1 ratio) */
  lower: [
    {
      commands: [['M', -22, -0.5], ['L', 20, -0.5], ['L', -4, 245], ['Q', -4.3, 248, -6, 245], ['Z']],
      fill: '#aeaeae',
      stroke: null,
      strokeWidth: 2.5,
      nonScalingStroke: false,
    },
    {
      commands: [['M', 20, 0], ['L', -4, 245], ['Q', -4.3, 248, -6, 245], ['L', -22, 0]],
      fill: null,
      stroke: '#383838',
      strokeWidth: 2.5,
      nonScalingStroke: true,
    },
  ] as BoneShapePath[],
  /** 派生：设计轴（环心 → 锥尖）角度，度 */
  axisDeg: 65.161709,
  /** 派生：环心 → 下段锚点距离（固定段长度） */
  anchorDistance: 37.832436,
  /** 派生：下段原长（沿自身 y） */
  lowerLength: 245,
} as const;
