import { onionFrames } from './onionSkin';
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Texture } from 'pixi.js';
import { slotDisplayWorld, type RenderItem } from '../core/runtime/skeleton';
import { StageRenderer, type BoneSegment } from '../render/pixiRenderer';
import type { Player } from '../core/player';
import { effectiveTransform, sampleTransform, type BoneTransformValues } from '../core/editing';
import { poseFromGizmo, readSlotDisplayTransform, slotCenterLocal, slotParentWorld, slotPoseEditable, slotVisualCenter } from '../core/slotPose';
import { vertexWeightPies } from '../core/weightPie';
import { IDENTITY, invert, type Mat2D } from '../core/runtime/math';
import { findMesh, isBakedMesh, meshEdges, outlineEdges, readMesh, readUserEdges } from '../core/meshEdit';
import { pickOutlineEdge, pickOutlineVertex } from '../core/slotOutlinePick';
import { boundingBoxOf, boundingBoxPoints } from '../core/bboxEdit';
import type { ToolId } from './chrome';
import { colorToNumber } from '../core/project/settings';
import { niceStep, rulerTicks } from './stageRuler';
import { itemOpaqueAt, type AlphaMask } from '../core/alphaHit';
import { loadAlphaMask } from './atlasAlpha';
import { REGION_DRAG_MIME } from './SymbolLibraryTree';
import { isSheetArmature } from '../core/sheetEdit';
import { ikRoleOf } from '../core/ikEdit';
import { drawOrder } from '../core/zorderEdit';
import { ikTimelineOf } from '../core/ikKeyEdit';

/** 权重饼图的屏幕半径，以及比它略大的点选半径（最近的顶点胜出）。 */
const WEIGHT_PIE_PX = 9;
const WEIGHT_PIE_HIT = 16;

/** 轮廓里最长的一条边（世界坐标）—— 端到端判据用它点「线条」，免得被连接点的阈值抢走。 */
function longestOutlineEdge(
  edges: Array<[number, number, number, number]> | undefined,
): [number, number, number, number] | null {
  let best: [number, number, number, number] | null = null;
  let bestLen = -1;
  for (const e of edges ?? []) {
    const len = (e[2] - e[0]) * (e[2] - e[0]) + (e[3] - e[1]) * (e[3] - e[1]);
    if (len > bestLen) { bestLen = len; best = e; }
  }
  return best;
}

export interface StageStats {
  items: number;
  fps: number;
  ms: number;
}

export interface StageViewProps {
  player: Player | null;
  atlasUrl: string | null;
  showBones: boolean;
  /** 洋葱皮总开关（官方 `Timeline.onion.tooltip`）：暂停时叠加前 / 后帧的淡色副本 */
  onion?: boolean;
  /** 前一帧洋葱皮（官方 `Sheet.onion.prev`）；不传则跟随总开关 */
  onionPrev?: boolean;
  /** 后一帧洋葱皮（官方 `Sheet.onion.next`）；不传则跟随总开关 */
  onionNext?: boolean;
  /** 洋葱皮范围：前 / 后各几帧（默认 1，越远越淡） */
  onionBefore?: number;
  onionAfter?: number;
  /** CSS backdrop painted behind the transparent Pixi canvas */
  background: string;
  hiddenSlots: Set<string>;
  /** 锁定的骨骼在舞台上点不中 */
  lockedBones?: Set<string>;
  /** 舞台过滤器条（官方 StageFilterBar）：图片可见关了就不画任何图片 */
  hideImages?: boolean;
  /**
   * 显示边框（官方 `Sheet.showframe` → `_948/_951.as` 第 159-168 行）：给舞台上的每个显示
   * 对象描一圈边框（序列帧面板工具条上那个勾选框）。
   */
  showFrameBorder?: boolean;
  /** 舞台过滤器条：骨骼可选关了，舞台点选直接落空 */
  disableBonePick?: boolean;
  /** 舞台过滤器：图片可选 = 关 */
  disableSlotPick?: boolean;
  /** 点中图片时选中该插槽 */
  onSelectSlot?: (name: string) => void;
  /** 偏好设置：骨骼线框颜色（官方 Setting.BOColor） */
  boneColor?: string;
  /** 偏好设置：图片平滑（官方 Setting.ImageSmooth） */
  imageSmooth?: boolean;
  /** 变换坐标系（官方 TransformPanel 的世界/父/本地三个按钮） */
  transformSpace?: 'world' | 'parent' | 'local';
  /** 舞台辅助线（官方「辅助标尺」）：世界坐标 */
  guides?: Array<{ axis: 'x' | 'y'; value: number }>;
  onGuidesChange?: (guides: Array<{ axis: 'x' | 'y'; value: number }>) => void;
  /** Ctrl+; 的显示开关（线还在，只是不显示） */
  showGuides?: boolean;
  selectedBone: string | null;
  onSelectBone: (name: string | null) => void;
  /** effective world -> screen scale (drives the viewer zoom readout) */
  scale: number;
  onScaleChange: (scale: number) => void;
  fitToken: number;
  tool: ToolId;
  /** bumped by the host on every document edit; drives overlay rebuilds */
  version?: number;
  /** `bone` 只有骨骼拨杆拖动会给（App 用它判断这次拖动要不要进撤销栈）。 */
  onBeginEdit?: (bone?: string) => void;
  onEditBone?: (name: string, patch: Partial<BoneTransformValues>) => void;
  /** 骨架装配：选中图片或网格插槽时，Z/X/C/V 改显示对象变换 */
  onEditSlot?: (name: string, patch: Partial<BoneTransformValues>) => void;
  /** 部件（插槽显示对象）拖动松手：宿主在这里做参考垫图吸附 / 关节吸附 */
  onSlotDragEnd?: (name: string) => void;
  /** 骨骼拖动松手：宿主做骨骼关节吸附 */
  onBoneDragEnd?: (name: string) => void;
  /** 参考垫图（半透明叠在舞台上）：refPx → world = (refPx - origin) / pxPerUnit */
  referenceOverlay?: { url: string; width: number; height: number; originX: number; originY: number; pxPerUnit: number; opacity: number } | null;
  /** weight painting: assign the selected bone to one mesh vertex */
  onPaintWeight?: (slot: string, vertex: number) => void;
  /** 宿主已选中的权重顶点；舞台用它同步饼图选中环，并据此判断是否已退出顶点编辑 */
  weightVertex?: number | null;
  /** 取消当前选中的权重顶点（点舞台空白时回调宿主，属性面板随之还原） */
  onClearWeightVertex?: () => void;
  /** "创建骨骼" tool: two armature-space points of the drawn segment */
  onCreateBone?: (from: { x: number; y: number }, to: { x: number; y: number }) => void;
  /** M4 mesh edit: set one vertex to an absolute slot-local position (a drag) */
  onMeshVertexMove?: (slot: string, vertex: number, x: number, y: number) => void;
  /** M4 mesh edit: drop one vertex and every triangle that used it */
  onMeshVertexRemove?: (slot: string, vertex: number) => void;
  /** M4 mesh edit: insert a vertex on the triangle edge (a,b) at parameter t */
  onMeshEdgeAdd?: (slot: string, a: number, b: number, t: number) => void;
  /** M4：勾选后拖动网格顶点写的是 FFD 关键帧（官方 Mesh.property.ffd） */
  ffdMode?: boolean;
  onFfdModeChange?: (value: boolean) => void;
  /** M4 FFD：按局部增量改当前帧的 FFD */
  onFfdVertexMove?: (slot: string, vertex: number, dx: number, dy: number) => void;
  /** M4 mesh edit: toggle a hand-drawn edge (official "手动绘制边线" tool) */
  onMeshLineToggle?: (slot: string, a: number, b: number) => void;
  /** 官方 TOOL_OUTLINE(3)：用户依次点出的轮廓点（armature 空间），点回起点闭合后回调 */
  onOutlineComplete?: (points: Array<{ x: number; y: number }>) => void;
  /** 当前选中的槽位（边界框显示 / 拾取要用） */
  selectedSlot?: string | null;
  /** 官方 BoundingBoxPanel.btn.create / btn.delete 的舞台拾取模式 */
  bboxMode?: 'add' | 'delete' | null;
  /** 添加绑定骨骼：舞台上点中的骨骼回调 */
  weightBonePick?: boolean;
  onAddWeightBone?: (bone: string) => void;
  /** 「设置约束目标」：舞台上点中的骨骼回调（官方 Property.ik.target 的舞台拾取） */
  ikTargetPick?: boolean;
  onPickIkTarget?: (bone: string) => void;
  onBBoxAddEdge?: (a: number, b: number) => void;
  onBBoxDeletePoint?: (index: number) => void;
  /** 多选集合（官方 Menu.Edit.SelectAll / Shift 点选 / 框选） */
  selectedBones?: Set<string>;
  /** 骨架装配模式：骨片更醒目，图片不透明 */
  anatomyMode?: boolean;
  /** 骨骼级「隐藏」（官方 MenuItem-hide）：不画骨片 / 骨钉，也不可拾取 */
  hiddenBones?: Set<string>;
  /** 插槽锁定（官方 MenuItem-lockOthersLayer）：锁定后舞台上点不到它 */
  lockedSlots?: Set<string>;
  /** 插槽多选集合（debug 与端到端判据读它） */
  selectedSlots?: Set<string>;
  /** Shift 点选：切换某根骨骼的选中状态 */
  onToggleBone?: (name: string) => void;
  /** 框选结束：把矩形内的骨骼一次性选中 */
  onSelectBonesRect?: (names: string[]) => void;
  /** 舞台右键（官方 `MenuItem-*`）：坐标 + 命中的骨骼，null = 空白处 */
  onStageContextMenu?: (info: { x: number; y: number; bone: string | null; slot: string | null }) => void;
  /**
   * 资源树把切片拖到舞台上（§109）：`world` 是落点换算到 armature 世界坐标的位置。
   * 官方口径：父骨骼固定取元件第一根骨骼，落点只用于摆放显示对象。
   */
  onRegionDrop?: (name: string, world: { x: number; y: number }) => void;
  /** 序列帧「绝对」：拖当前帧的图，增量是舞台世界坐标 */
  sheetDrag?: boolean;
  sheetSlot?: string | null;
  onSheetDrag?: (dx: number, dy: number) => void;
  onFocusArea?: (area: 'stage' | 'timeline') => void;
  onStats?: (stats: StageStats) => void;
  /**
   * 外部注入的悬停高亮（官方 `StageNotification.ROLLOVER_BONE` / `ROLLOVER_SLOT` 的
   * 「面板 → 舞台」方向，`_586/_588.as:275-307` 骨骼行 / `_555/_558.as:4124-4125` 插槽行）：
   * 场景树行鼠标悬停时由 App 传进来，与舞台自身的鼠标悬停（`hoverBone` / `hoverSlot`）
   * 合并后走同一套画法。移出传 null。
   */
  externalHover?: { kind: 'bone' | 'slot'; name: string } | null;
}

const MIN_SCALE = 0.03;
const MAX_SCALE = 24;

/** Ruler strips mirror DragonBones's stage chrome (top + left, world coordinates). */
const RULER_STEP_X = 56;
const RULER_STEP_Y = 40;

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

/** Linear part only: rotate/scale/translate a stage-space delta into parent space. */
function applyLinear(m: Mat2D, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y, m[1] * x + m[3] * y];
}

/** Invert the 2x2 map `[a,b,c,d]` (world = [a c; b d] * local); null when singular. */
function invertLinear(j: [number, number, number, number]): [number, number, number, number] | null {
  const [a, b, c, d] = j;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-9) return null;
  return [d / det, -b / det, -c / det, a / det];
}

export function StageView(props: StageViewProps) {
  const itemsRef = useRef<RenderItem[]>([]);
  const {
    player, atlasUrl, showBones, onion, onionPrev, onionNext, onionBefore = 1, onionAfter = 1, background, hiddenSlots, lockedBones, hideImages, disableBonePick, disableSlotPick, boneColor, imageSmooth, showFrameBorder,
    guides, onGuidesChange, showGuides, transformSpace, selectedBone, onSelectBone,
    scale, onScaleChange, fitToken, tool, version, onBeginEdit, onEditBone, onEditSlot, onFocusArea, onStats,
    onPaintWeight, weightVertex, onClearWeightVertex, onCreateBone, onMeshVertexMove, onMeshVertexRemove, onMeshEdgeAdd, onMeshLineToggle, onOutlineComplete, selectedSlot, onSelectSlot, bboxMode, weightBonePick, onAddWeightBone, ikTargetPick, onPickIkTarget, onBBoxAddEdge, onBBoxDeletePoint, selectedBones, onToggleBone, onSelectBonesRect, onStageContextMenu, sheetDrag, sheetSlot, onSheetDrag,
    ffdMode, onFfdModeChange, onFfdVertexMove, onRegionDrop, externalHover,
  } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<StageRenderer | null>(null);
  const textureRef = useRef<Texture | null>(null);
  /** 图集的 alpha 掩码（拾取用）：透明像素不触发鼠标事件。没准备好时为 null → 回落几何判定。 */
  const alphaMaskRef = useRef<AlphaMask | null>(null);
  /** tick 的 effect 依赖里没有 atlasUrl，debug 对象要用就走 ref（避免闭包里的旧值） */
  const atlasUrlRef = useRef<string | null>(atlasUrl);
  atlasUrlRef.current = atlasUrl;
  const panRef = useRef({ x: 0, y: 0 });
  const scaleRef = useRef(scale);
  const [ready, setReady] = useState(false);
  /** live camera mirror for the rulers (panRef/scaleRef mutate without re-rendering) */
  const [view, setView] = useState({ scale, panX: 0, panY: 0, w: 0, h: 0 });
  const syncView = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    const next = { scale: scaleRef.current, panX: panRef.current.x, panY: panRef.current.y, w: host.clientWidth, h: host.clientHeight };
    setView((prev) => (prev.scale === next.scale && prev.panX === next.panX && prev.panY === next.panY && prev.w === next.w && prev.h === next.h ? prev : next));
  }, []);
  const dragRef = useRef<null | {
    mode: 'pan' | 'bone' | 'slot' | 'pick' | 'ikTarget' | 'outlinePick' | 'create' | 'meshVertex' | 'outlineVertex' | 'guide' | 'marquee' | 'sheet';
    /** 正在拖动的辅助线下标（mode === 'guide'） */
    guide?: number;
    /** 新拉的辅助线还没进 state 时先记住轴 */
    guideAxis?: 'x' | 'y';
    bone?: string;
    /** 装配模式下正在改的插槽 */
    slot?: string;
    /** 手柄：move 自由平移，move-x/y 分轴，scale 等比，scale-free 宽高一起动，scale-x/y 单轴，rotate 旋转 */
    gizmo?: 'move' | 'move-x' | 'move-y' | 'rotate' | 'scale' | 'scale-free' | 'scale-x' | 'scale-y';
    button?: number;
    /** 右键平移的按下点（没超过阈值就不改相机，留给右键菜单） */
    originClientX?: number;
    originClientY?: number;
    /** 拨杆拖动起点：屏幕坐标 / 起始角度 / 起始距离 / 单轴缩放的起始偏移 */
    originScreenX?: number;
    originScreenY?: number;
    startAngle?: number;
    startDistance?: number;
    startAxis?: number;
    /** 宽高一起拖时，竖直方向的起始偏移 */
    startAxisY?: number;
    startValues?: BoneTransformValues;
    /** 插槽可见中心在显示对象局部的位置；旋转 / 缩放绕它，避免中心漂移 */
    centerLocal?: { x: number; y: number };
    lastX: number;
    lastY: number;
    moved: boolean;
    /** armature-space start point of the bone being drawn */
    from?: { x: number; y: number };
    /** mesh drag: local start position plus the inverted world-per-local 2x2 map */
    mesh?: {
      slot: string; vertex: number; startX: number; startY: number;
      originX: number; originY: number; inv: [number, number, number, number] | null;
      /** 轮廓线条：一次拖动整条边的所有端点（每端各自的局部起点与逆矩阵） */
      group?: Array<{ vertex: number; originX: number; originY: number; inv: [number, number, number, number] | null }>;
    };
  }>(null);
  /** 右键拖过舞台后，松手那下 contextmenu 不要再弹出菜单 */
  const suppressContextMenuRef = useRef(false);
  /** signature of the last mesh-overlay build, so a static frame skips rebuilding 400+ segments */
  const overlaySigRef = useRef('');
  /** 显示边框（`Sheet.showframe`）的上一次内容签名：静止帧不重复重建 Graphics */
  const frameBorderSigRef = useRef('');
  /** 当前已画出的边框边数（签名不变时沿用上一帧的值，供 dev 钩子 `__boneStudio.frameBorder` 读） */
  const frameEdgeCountRef = useRef(0);
  /** 权重工具里点中的顶点，饼图描白环 + 蓝外环 */
  const weightVertexRef = useRef<number | null>(null);
  /** 权重工具里鼠标下的顶点，只高亮当前槽位上画出来的那颗 */
  const hoverWeightRef = useRef<number | null>(null);
  const [weightPointer, setWeightPointer] = useState(false);
  const weightPieCountRef = useRef(0);
  /** first vertex of a pending hand-drawn edge ("手动绘制边线" tool) */
  const pendingVertexRef = useRef<{ slot: string; vertex: number } | null>(null);
  /** hand-drawn edge under the cursor (for the highlight) */
  const hoverUserEdgeRef = useRef<{ slot: string; index: number } | null>(null);
  /** 官方 TOOL_OUTLINE：正在画的轮廓点（armature 空间），点回起点即闭合 */
  const outlinePointsRef = useRef<Array<{ x: number; y: number }>>([]);
  /** 框选矩形（host 内坐标），拖拽时实时更新 */
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  /** tick 的 effect 依赖里没有 marquee，渲染循环只能读 ref */
  const marqueeRef = useRef(marquee);
  marqueeRef.current = marquee;
  /** panRef 是 ref（pixi 自己重绘），HTML 覆盖层要跟着动就得自己 bump 一次渲染 */
  const [cameraVersion, setCameraVersion] = useState(0);
  /** 鼠标悬停在哪根骨片上（决定要不要画它与父级的连线） */
  const [hoverBone, setHoverBone] = useState<string | null>(null);
  /**
   * 鼠标悬停在哪个插槽上（官方 `StageNotification.ROLLOVER_SLOT`）——只画一层临时的白色剪影，
   * 移出即消失，与选中态无关。骨骼优先命中时它为 null（见 §112）。
   */
  const [hoverSlot, setHoverSlot] = useState<string | null>(null);
  /** 点中的插槽轮廓元素（连接点=单顶点；线条=整条边的两端），它决定舞台上的位移拨杆 */
  const [outlinePick, setOutlinePick] = useState<{ slot: string; kind: 'vertex' | 'edge'; vertices: number[] } | null>(null);
  /** tick 里的 debug 对象读它（tick 的 effect 依赖里没有 outlinePick） */
  const outlinePickRef = useRef<{ slot: string; kind: 'vertex' | 'edge'; vertices: number[] } | null>(null);
  /** 骨架装配模式（来自 App 的 editMode）：tick 里把它交给 renderer */
  const anatomyRef = useRef(false);
  anatomyRef.current = !!props.anatomyMode;
  /** 骨骼级隐藏（官方 MenuItem-hide）：tick 与拾取都读它 */
  const hiddenBonesRef = useRef<Set<string>>(new Set());
  hiddenBonesRef.current = props.hiddenBones ?? new Set<string>();
  /** 插槽锁定：pickSlot 跳过它们 */
  const lockedSlotsRef = useRef<Set<string>>(new Set());
  lockedSlotsRef.current = props.lockedSlots ?? new Set<string>();
  /** 插槽多选：tick 的 effect 不依赖它，所以用 ref 传 */
  const selectedSlotsRef = useRef<Set<string>>(new Set());
  selectedSlotsRef.current = props.selectedSlots ?? new Set<string>();

  /**
   * 换插槽就丢掉上一个轮廓的选中（官方切选择时那个拨杆一起消失）。
   * 切工具同样要清：轮廓拨杆只在「选择工具」里能被点出来（见 pointerdown 里 `toolNow === 'select'` 的守卫），
   * 否则切到 B/R 等其它工具后，那个青色拨杆会一直残留在舞台上（用户报「进入权重模式方块还在」）。
   */
  useEffect(() => { setOutlinePick(null); }, [selectedSlot, tool]);
  /** tick 里的 debug 对象读它（tick 的 effect 依赖里没有 hoverBone） */
  const hoverBoneRef = useRef<string | null>(null);
  hoverBoneRef.current = hoverBone;
  /** 同上：tick 每帧要把 hovered 插槽交给 renderer，所以用 ref 而不是 state */
  const hoverSlotRef = useRef<string | null>(null);
  hoverSlotRef.current = hoverSlot;
  /**
   * 外部注入的悬停（场景树行 hover，§113）：tick 的 effect 依赖里同样没有它，
   * 所以也走 ref —— 每渲染同步一次，下一帧 tick（常驻 rAF）就能读到。
   */
  const externalHoverRef = useRef<{ kind: 'bone' | 'slot'; name: string } | null>(null);
  externalHoverRef.current = externalHover ?? null;
  outlinePickRef.current = outlinePick;
  const bumpCamera = () => setCameraVersion((value) => value + 1);

  /**
   * 选中骨骼关节上的十字手柄（屏幕轴即世界轴）：平移 / 分轴缩放 / 整体缩放 / 旋转。
   * 位置跟着 pan/scale 走，所以依赖 cameraVersion 触发重算（见 bumpCamera）。
   */
  const gizmo = (() => {
    void cameraVersion;
    const current = player;
    const name = selectedBone;
    if (!current || !name || !showBones) return null;
    const bone = current.skeleton.bones.find((entry) => entry.name === name);
    if (!bone) return null;
    return {
      name,
      x: bone.world[4] * scale + panRef.current.x,
      y: bone.world[5] * scale + panRef.current.y,
      angle: (Math.atan2(bone.world[1], bone.world[0]) * 180) / Math.PI,
      // 骨骼自身的长度（屏幕上）：从拨杆＝骨骼头部沿自身方向延伸出去，
      // 这样「拨杆在头部还是尾部」一眼可辨
      length: Math.max(12, (bone.length || 0) * scale),
      /** 骨片在屏幕上的真实长度（自由变换 V 的末端手柄按它放） */
      rawLength: (bone.length || 0) * scale,
      angleRad: Math.atan2(bone.world[1], bone.world[0]),
    };
  })();
  /** 装配模式、选中图片或网格插槽：拨杆落在可见包围盒中心，而不是骨骼关节。 */
  const slotGizmo = (() => {
    void cameraVersion;
    if (!props.anatomyMode || !player || !selectedSlot || selectedBone) return null;
    if (!slotPoseEditable(player, selectedSlot)) return null;
    const center = slotVisualCenter(player, selectedSlot);
    if (!center) return null;
    return {
      name: selectedSlot,
      x: center.x * scale + panRef.current.x,
      y: center.y * scale + panRef.current.y,
    };
  })();
  const handleGizmo = gizmo ?? slotGizmo;
  /** edge under the cursor while the "添加网格点" tool is active (for the highlight) */
  const hoverEdgeRef = useRef<{ slot: string; index: number } | null>(null);
  /** live rubber band for the bone tool */
  const createPreview = useRef<null | { x: number; y: number }>(null);
  const createFrom = useRef<null | { x: number; y: number }>(null);

  const stateRef = useRef({ player, scale, tool, selectedBone, hiddenSlots, lockedBones, hideImages, disableBonePick, disableSlotPick, onSelectSlot, onion, onionPrev, onionNext, onionBefore, onionAfter, onSelectBone, onEditBone, onEditSlot, anatomyMode: !!props.anatomyMode, onBeginEdit, onStats, onCreateBone, onMeshVertexMove, onMeshVertexRemove, onMeshEdgeAdd, onMeshLineToggle, onOutlineComplete, selectedSlot, bboxMode, weightBonePick: !!weightBonePick, onAddWeightBone, onClearWeightVertex, ikTargetPick: !!ikTargetPick, onPickIkTarget, onBBoxAddEdge, onBBoxDeletePoint, selectedBones, onToggleBone, onSelectBonesRect, ffdMode, onFfdModeChange, onFfdVertexMove,
    guides, onGuidesChange, showGuides, transformSpace, version, sheetDrag: !!sheetDrag, sheetSlot: sheetSlot ?? null, onSheetDrag, showFrameBorder: !!showFrameBorder });
  stateRef.current = { player, scale, tool, selectedBone, hiddenSlots, lockedBones, hideImages, disableBonePick, disableSlotPick, onSelectSlot, onion, onionPrev, onionNext, onionBefore, onionAfter, onSelectBone, onEditBone, onEditSlot, anatomyMode: !!props.anatomyMode, onBeginEdit, onStats, onCreateBone, onMeshVertexMove, onMeshVertexRemove, onMeshEdgeAdd, onMeshLineToggle, onOutlineComplete, selectedSlot, bboxMode, weightBonePick: !!weightBonePick, onAddWeightBone, onClearWeightVertex, ikTargetPick: !!ikTargetPick, onPickIkTarget, onBBoxAddEdge, onBBoxDeletePoint, selectedBones, onToggleBone, onSelectBonesRect, ffdMode, onFfdModeChange, onFfdVertexMove, guides, onGuidesChange, showGuides, transformSpace, version, sheetDrag: !!sheetDrag, sheetSlot: sheetSlot ?? null, onSheetDrag, showFrameBorder: !!showFrameBorder };
  scaleRef.current = scale;
  // 宿主状态是真相源：属性面板清空选中顶点后，舞台的饼图选中环要跟着消失（反之亦然）。
  useEffect(() => { weightVertexRef.current = weightVertex ?? null; }, [weightVertex]);

  // 偏好设置：骨骼颜色与图片平滑（renderer 就绪后应用，改设置立刻生效）
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setBoneColor(colorToNumber(boneColor ?? '#6cc7ff'));
    renderer.setTextureSmoothing(imageSmooth ?? true);
  }, [boneColor, imageSmooth, ready]);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new StageRenderer();
    if (import.meta.env.DEV) (window as unknown as { __bonestudioRenderer?: StageRenderer }).__bonestudioRenderer = renderer;
    rendererRef.current = renderer;
    let disposed = false;
    void renderer.init(host, 0x000000, 0).then(() => {
      if (disposed) return;
      const texture = textureRef.current;
      renderer.setTexture(texture, texture?.width ?? 1, texture?.height ?? 1);
      renderer.resizeToHost();
      setReady(true);
    });
    const watch = new ResizeObserver(() => renderer.resizeToHost());
    watch.observe(host);
    return () => {
      disposed = true;
      watch.disconnect();
      setReady(false);
      rendererRef.current = null;
      renderer.destroy();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!atlasUrl) {
      textureRef.current = null;
      alphaMaskRef.current = null;
      return;
    }
    // 拾取用的 alpha 掩码与贴图并行取；没拿到就回落几何判定（见 core/alphaHit.ts）
    void loadAlphaMask(atlasUrl).then((mask) => {
      if (!cancelled) alphaMaskRef.current = mask;
    });
    void loadTexture(atlasUrl).then((texture) => {
      if (cancelled || !texture) return;
      textureRef.current = texture;
      const renderer = rendererRef.current;
      if (renderer) renderer.setTexture(texture, texture.width, texture.height);
    });
    return () => { cancelled = true; };
  }, [atlasUrl]);

  /** Fit the view to the project bounds; also runs on the "适应窗口" command. */
  const fit = useCallback((target?: Player | null) => {
    const current = target ?? stateRef.current.player;
    const host = hostRef.current;
    if (!host || !current) return;
    const items = current.renderItems();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const item of items) {
      for (let i = 0; i < item.positions.length; i += 2) {
        minX = Math.min(minX, item.positions[i]);
        maxX = Math.max(maxX, item.positions[i]);
        minY = Math.min(minY, item.positions[i + 1]);
        maxY = Math.max(maxY, item.positions[i + 1]);
      }
    }
    const width = host.clientWidth || 640;
    const height = host.clientHeight || 480;
    if (!Number.isFinite(minX) || maxX - minX <= 0 || maxY - minY <= 0) {
      panRef.current = { x: width / 2, y: height / 2 };
      onScaleChange(1);
      return;
    }
    const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min(width / (maxX - minX), height / (maxY - minY)) * 0.82));
    panRef.current = {
      x: width / 2 - ((minX + maxX) / 2) * next,
      y: height / 2 - ((minY + maxY) / 2) * next,
      // 见 bumpCamera：fit 之后 HTML 覆盖层要重排
    };
    onScaleChange(next);
  }, [onScaleChange]);

  useEffect(() => { fit(); }, [fitToken, fit, player]);

  /** Bone joints in stage space, for the overlay and for hit testing. */
  const boneGeometry = useCallback((current: Player) => {
    const joints: Array<[number, number]> = [];
    // 官方式样：每根骨骼画成"骨片"——从骨钉（关节）沿自身方向延伸 bone.length，根部宽、末端细；
    // 骨钉是关节处的圆环，选中的那根用橙红高亮（拨杆在 HTML 覆盖层里画在同一个点上）。
    const segments: BoneSegment[] = [];
    for (const bone of current.skeleton.bones) {
      const world = bone.world;
      joints.push([world[4], world[5]]);
      const scaleX = Math.hypot(world[0], world[1]) || 1;
      segments.push({
        x: world[4],
        y: world[5],
        angle: Math.atan2(world[1], world[0]),
        length: (bone.length ?? 0) * scaleX,
        selected: !!stateRef.current.selectedBones?.has(bone.name),
        // 悬停高亮（官方 ROLLOVER_BONE）：只影响这一根的绘制，不影响选中态。
        // 舞台内鼠标悬停与「场景树行 hover」的外部注入合并（§113）。
        hovered: hoverBoneRef.current === bone.name
          || (externalHoverRef.current?.kind === 'bone' && externalHoverRef.current.name === bone.name),
        hidden: hiddenBonesRef.current.has(bone.name),
      });
    }
    return { joints, segments };
  }, []);

  /** Nearest mesh vertex in screen space (weight painting). `reach` is the hit radius in CSS pixels. */
  const pickWeight = useCallback((clientX: number, clientY: number, reach = 14): { slot: string; vertex: number } | null => {
    const host = hostRef.current;
    if (!host) return null;
    const rect = host.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const s = scaleRef.current;
    const pan = panRef.current;
    let best: { slot: string; vertex: number } | null = null;
    let bestDistance = reach;
    for (const item of itemsRef.current) {
      if (item.kind !== 'mesh') continue;
      for (let v = 0; v * 2 + 1 < item.positions.length; v++) {
        const distance = Math.hypot(
          item.positions[v * 2] * s + pan.x - px,
          item.positions[v * 2 + 1] * s + pan.y - py,
        );
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { slot: item.slot, vertex: v };
        }
      }
    }
    return best;
  }, []);

  /** Nearest mesh edge in screen space (the "添加网格点" tool). */
  const pickMeshEdge = useCallback((clientX: number, clientY: number):
    { slot: string; index: number; a: number; b: number; t: number } | null => {
    const host = hostRef.current;
    const current = stateRef.current.player;
    if (!host || !current) return null;
    const rect = host.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const s = scaleRef.current;
    const pan = panRef.current;
    let best: { slot: string; index: number; a: number; b: number; t: number } | null = null;
    let bestDistance = 9;
    for (const item of itemsRef.current) {
      if (item.kind !== 'mesh') continue;
      const mesh = findMesh(current.skeleton.armature, item.slot);
      // dbbin 形态也能加点（几何层会同步烘焙点），所以这里不再排除它
      if (!mesh) continue;
      const pairs = meshEdges(mesh);
      for (let i = 0; i < pairs.length; i++) {
        const ax = item.positions[pairs[i][0] * 2] * s + pan.x - px;
        const ay = item.positions[pairs[i][0] * 2 + 1] * s + pan.y - py;
        const bx = item.positions[pairs[i][1] * 2] * s + pan.x - px;
        const by = item.positions[pairs[i][1] * 2 + 1] * s + pan.y - py;
        const vx = bx - ax;
        const vy = by - ay;
        const len2 = vx * vx + vy * vy;
        if (len2 < 1e-6) continue;
        const t = Math.min(1, Math.max(0, -(ax * vx + ay * vy) / len2));
        const distance = Math.hypot(ax + vx * t, ay + vy * t);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { slot: item.slot, index: i, a: pairs[i][0], b: pairs[i][1], t };
        }
      }
    }
    return best;
  }, []);

  /** Nearest hand-drawn edge in screen space ("手动绘制边线" tool). */
  const pickUserEdge = useCallback((clientX: number, clientY: number):
    { slot: string; index: number; a: number; b: number } | null => {
    const host = hostRef.current;
    const current = stateRef.current.player;
    if (!host || !current) return null;
    const rect = host.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const s = scaleRef.current;
    const pan = panRef.current;
    let best: { slot: string; index: number; a: number; b: number } | null = null;
    let bestDistance = 8;
    for (const item of itemsRef.current) {
      if (item.kind !== 'mesh') continue;
      const mesh = findMesh(current.skeleton.armature, item.slot);
      if (!mesh || isBakedMesh(mesh)) continue;
      const pairs = readUserEdges(mesh);
      for (let i = 0; i < pairs.length; i++) {
        const ax = item.positions[pairs[i][0] * 2] * s + pan.x - px;
        const ay = item.positions[pairs[i][0] * 2 + 1] * s + pan.y - py;
        const bx = item.positions[pairs[i][1] * 2] * s + pan.x - px;
        const by = item.positions[pairs[i][1] * 2 + 1] * s + pan.y - py;
        const vx = bx - ax;
        const vy = by - ay;
        const len2 = vx * vx + vy * vy;
        if (len2 < 1e-6) continue;
        const t = Math.min(1, Math.max(0, -(ax * vx + ay * vy) / len2));
        const distance = Math.hypot(ax + vx * t, ay + vy * t);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { slot: item.slot, index: i, a: pairs[i][0], b: pairs[i][1] };
        }
      }
    }
    return best;
  }, []);

  const pick = useCallback((clientX: number, clientY: number): string | null => {
    const host = hostRef.current;
    const current = stateRef.current.player;
    if (!host || !current) return null;
    const rect = host.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const s = scaleRef.current;
    const pan = panRef.current;
    if (stateRef.current.disableBonePick) return null;   // 舞台过滤器：骨骼可选 = 关
    const { joints } = boneGeometry(current);
    const locked = stateRef.current.lockedBones ?? new Set<string>();
    // 骨片优先：点到"关节 → 末端"那条线段（含楔形半宽）的距离。
    // 父子连线只是骨骼之间的关系，不参与拾取（官方也是点骨片才选中）。
    let bestPlate: string | null = null;
    let bestPlateDistance = Infinity;
    for (const bone of current.skeleton.bones) {
      if (locked.has(bone.name) || hiddenBonesRef.current.has(bone.name)) continue;
      const world = bone.world;
      const scaleX = Math.hypot(world[0], world[1]) || 1;
      const length = (bone.length ?? 0) * scaleX;
      const ax = world[4] * s + pan.x;
      const ay = world[5] * s + pan.y;
      const angle = Math.atan2(world[1], world[0]);
      const vx = Math.cos(angle) * length * s;
      const vy = Math.sin(angle) * length * s;
      const halfScreen = 8;
      const length2 = vx * vx + vy * vy;
      const tRaw = length2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / length2 : 0;
      const t = Math.max(0, Math.min(1, tRaw));
      const distance = Math.hypot(ax + vx * t - px, ay + vy * t - py);
      if (distance <= halfScreen + 2 && distance < bestPlateDistance) {
        bestPlateDistance = distance;
        bestPlate = bone.name;
      }
    }

    if (bestPlate) return bestPlate;
    // 骨片没命中再看骨钉（无长度的标记骨骼只有骨钉可点）
    let best: string | null = null;
    let bestDistance = 12;
    current.skeleton.bones.forEach((bone, index) => {
      if (locked.has(bone.name) || hiddenBonesRef.current.has(bone.name)) return;   // 锁定 / 隐藏的骨骼不可在舞台上选中
      const [x, y] = joints[index];
      const distance = Math.hypot(x * s + pan.x - px, y * s + pan.y - py);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = bone.name;
      }
    });

    return best;
  }, [boneGeometry]);
  /** 点在哪个插槽的图片上（官方：右键图片出插槽菜单）；取绘制顺序里最上层的那个。 */
  const pickSlot = useCallback((clientX: number, clientY: number): string | null => {
    const host = hostRef.current;
    if (!host) return null;
    const rect = host.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const s = scaleRef.current;
    const pan = panRef.current;
    const hidden = stateRef.current.hiddenSlots ?? new Set<string>();
    let best: string | null = null;
    for (const item of itemsRef.current) {   // items 的顺序就是绘制顺序，后面的在上
      if (hidden.has(item.slot)) continue;
      if (lockedSlotsRef.current.has(item.slot)) continue;   // 锁定的插槽不可在舞台上选中
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i + 1 < item.positions.length; i += 2) {
        minX = Math.min(minX, item.positions[i]);
        maxX = Math.max(maxX, item.positions[i]);
        minY = Math.min(minY, item.positions[i + 1]);
        maxY = Math.max(maxY, item.positions[i + 1]);
      }
      if (!Number.isFinite(minX)) continue;
      const x0 = minX * s + pan.x;
      const x1 = maxX * s + pan.x;
      const y0 = minY * s + pan.y;
      const y1 = maxY * s + pan.y;
      if (px < x0 || px > x1 || py < y0 || py > y1) continue;   // 便宜的包围盒预筛，先挡掉绝大多数
      // 再逐像素问 alpha：透明区域不触发鼠标事件（见 core/alphaHit.ts）
      const invS = s === 0 ? 1 : 1 / s;
      if (itemOpaqueAt(item, alphaMaskRef.current, (px - pan.x) * invS, (py - pan.y) * invS)) best = item.slot;
    }
    return best;
  }, []);


  // native wheel listener so the page does not scroll while zooming
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = host.getBoundingClientRect();
      const cx = event.clientX - rect.left;
      const cy = event.clientY - rect.top;
      const factor = Math.exp(-event.deltaY * 0.0016);
      const from = scaleRef.current;
      const to = Math.max(MIN_SCALE, Math.min(MAX_SCALE, from * factor));
      if (Math.abs(to - from) < 1e-6) return;
      const pan = panRef.current;
      const ratio = to / from;
      panRef.current = { x: cx - (cx - pan.x) * ratio, y: cy - (cy - pan.y) * ratio };
      onScaleChange(to);
      bumpCamera();
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, [onScaleChange]);

  /** Screen point -> armature space (undo pan + zoom). */
  const toArmature = (clientX: number, clientY: number): { x: number; y: number } => {
    const host = hostRef.current;
    const scaleNow = scaleRef.current || 1;
    if (!host) return { x: 0, y: 0 };
    const rect = host.getBoundingClientRect();
    return {
      x: (clientX - rect.left - panRef.current.x) / scaleNow,
      y: (clientY - rect.top - panRef.current.y) / scaleNow,
    };
  };

  /**
   * 从标尺拉出一条辅助线（官方 `MenuItem-ruler`「辅助标尺」）。
   * 位置按世界坐标记，所以缩放/平移舞台时线仍贴在同一个世界位置。
   */
  const createGuideFromRuler = (event: ReactPointerEvent<HTMLDivElement>, axis: 'x' | 'y') => {
    const host = hostRef.current;
    const rect = host?.getBoundingClientRect();
    if (!host || !rect) return;
    const stageScale = scaleRef.current || 1;
    const raw = axis === 'x'
      ? (event.clientX - rect.left - panRef.current.x) / stageScale
      : (event.clientY - rect.top - panRef.current.y) / stageScale;
    // 标尺在舞台之外，按下点的世界坐标可能落在可视区外 —— 先钳到可视边缘，
    // 这样线一出现就在画布边上，用户再拖到想要的位置（官方也是"从标尺拖出来"）。
    const pan = axis === 'x' ? panRef.current.x : panRef.current.y;
    const span = axis === 'x' ? rect.width : rect.height;
    const value = Math.min((span - pan) / stageScale, Math.max(-pan / stageScale, raw));
    const next = [...(stateRef.current.guides ?? []), { axis, value: Math.round(value * 100) / 100 }];
    stateRef.current.onGuidesChange?.(next);
    // 立刻进入拖动，让用户把线放到目标位置
    host.setPointerCapture(event.pointerId);
    dragRef.current = {
      mode: 'guide', guide: next.length - 1, guideAxis: axis,
      lastX: event.clientX, lastY: event.clientY, moved: false,
    };
  };

  /** 拖动已有辅助线。右键不拖，留给右键删除。 */
  const beginGuideDrag = (event: ReactPointerEvent<HTMLDivElement>, index: number) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    hostRef.current?.setPointerCapture(event.pointerId);
    dragRef.current = { mode: 'guide', guide: index, lastX: event.clientX, lastY: event.clientY, moved: false };
  };

  /** 右键删掉这一条辅助线，不把事件交给舞台菜单。 */
  const deleteGuide = (event: ReactMouseEvent<HTMLDivElement>, index: number) => {
    event.preventDefault();
    event.stopPropagation();
    stateRef.current.onGuidesChange?.(
      (stateRef.current.guides ?? []).filter((_, i) => i !== index),
    );
  };

  /** 按下骨骼拨杆：记住起点，后续 pointermove 按 gizmo 类型走旋转 / 缩放 / 平移 */
  /** 选中插槽的轮廓几何（有网格 → 网格外轮廓；没有网格 → 空轮廓）——舞台绘制与命中共用。 */
  const slotOutlineGeometry = useCallback((slot: string) => {
    const current = stateRef.current.player;
    const item = itemsRef.current.find((entry) => entry.slot === slot);
    if (!current || !item || item.positions.length < 6) return null;
    const mesh = findMesh(current.skeleton.armature, slot);
    return { positions: item.positions, outline: (mesh ? outlineEdges(mesh) : []) as Array<[number, number]> };
  }, []);

  /** 点中轮廓连接点 / 线条后出现的位移拨杆：拖它移动对应的网格点（线条 = 整条边的两端）。 */
  const startOutlineGizmo = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const current = stateRef.current.player;
    const picked = outlinePick;
    if (!current || !picked) return;
    const mesh = findMesh(current.skeleton.armature, picked.slot);
    if (!mesh) return;
    const { vertices } = readMesh(mesh);
    const group = picked.vertices.map((vertex) => {
      const local = vertices[vertex];
      const jacobian = current.skeleton.meshVertexJacobian(picked.slot, vertex);
      return {
        vertex,
        originX: local ? local[0] : 0,
        originY: local ? local[1] : 0,
        inv: jacobian ? invertLinear(jacobian) : null,
      };
    });
    const first = group[0];
    if (!first) return;
    stateRef.current.onBeginEdit?.();
    dragRef.current = {
      mode: 'outlineVertex',
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
      mesh: {
        slot: picked.slot,
        vertex: first.vertex,
        startX: event.clientX,
        startY: event.clientY,
        originX: first.originX,
        originY: first.originY,
        inv: first.inv,
        group,
      },
    };
    if (!first.inv) {
      // 几何被烘焙（dbbin）时没有雅可比：把原位置回显一次，宿主会说明为什么没动
      stateRef.current.onMeshVertexMove?.(picked.slot, first.vertex, first.originX, first.originY);
    }
  };

  const beginGizmoDrag = (
    clientX: number, clientY: number,
    kind: 'move' | 'move-x' | 'move-y' | 'rotate' | 'scale' | 'scale-free' | 'scale-x' | 'scale-y',
    boneName: string,
  ) => {
    const current = stateRef.current.player;
    const host = hostRef.current;
    if (!current || !host || current.playing) return;
    const bone = current.skeleton.bones.find((entry) => entry.name === boneName);
    if (!bone) return;
    const rect = host.getBoundingClientRect();
    const originScreenX = rect.left + bone.world[4] * scaleRef.current + panRef.current.x;
    const originScreenY = rect.top + bone.world[5] * scaleRef.current + panRef.current.y;
    const alongX = clientX - originScreenX;
    const alongY = clientY - originScreenY;
    const axis = (value: number) => (Math.abs(value) < 12 ? (value < 0 ? -12 : 12) : value);
    const along = kind === 'scale-y' ? alongY : alongX;
    stateRef.current.onBeginEdit?.(boneName);
    dragRef.current = {
      mode: 'bone', bone: boneName, lastX: clientX, lastY: clientY, moved: false,
      gizmo: kind,
      originScreenX,
      originScreenY,
      startAngle: Math.atan2(alongY, alongX),
      // 下限 60px：手柄离骨骼头很近，直接用实际距离会让整体缩放过于敏感
      startDistance: Math.max(60, Math.hypot(alongX, alongY)),
      startAxis: axis(along),
      startAxisY: axis(alongY),
      startValues: effectiveTransform(current, boneName, current.position),
    };
  };

  const beginSlotGizmo = (
    clientX: number, clientY: number,
    kind: 'move' | 'move-x' | 'move-y' | 'rotate' | 'scale' | 'scale-free' | 'scale-x' | 'scale-y',
    slotName: string,
  ) => {
    const current = stateRef.current.player;
    const host = hostRef.current;
    if (!current || !host || current.playing || !stateRef.current.anatomyMode) return;
    if (!slotPoseEditable(current, slotName)) return;
    const center = slotVisualCenter(current, slotName);
    const startValues = readSlotDisplayTransform(current, slotName);
    if (!center || !startValues) return;
    const rect = host.getBoundingClientRect();
    const originScreenX = rect.left + center.x * scaleRef.current + panRef.current.x;
    const originScreenY = rect.top + center.y * scaleRef.current + panRef.current.y;
    const alongX = clientX - originScreenX;
    const alongY = clientY - originScreenY;
    const axis = (value: number) => (Math.abs(value) < 12 ? (value < 0 ? -12 : 12) : value);
    const along = kind === 'scale-y' ? alongY : alongX;
    stateRef.current.onBeginEdit?.();
    dragRef.current = {
      mode: 'slot', slot: slotName, lastX: clientX, lastY: clientY, moved: false,
      gizmo: kind,
      originScreenX,
      originScreenY,
      startAngle: Math.atan2(alongY, alongX),
      startDistance: Math.max(60, Math.hypot(alongX, alongY)),
      startAxis: axis(along),
      startAxisY: axis(alongY),
      startValues,
      centerLocal: slotCenterLocal(current, slotName) ?? { x: 0, y: 0 },
    };
  };

  const startGizmo = (
    event: ReactPointerEvent<HTMLButtonElement>,
    kind: 'move' | 'move-x' | 'move-y' | 'rotate' | 'scale' | 'scale-free' | 'scale-x' | 'scale-y',
  ) => {
    event.stopPropagation();
    event.preventDefault();
    const name = stateRef.current.selectedBone;
    if (name) {
      beginGizmoDrag(event.clientX, event.clientY, kind, name);
      return;
    }
    const slotName = stateRef.current.selectedSlot;
    if (slotName && stateRef.current.anatomyMode) beginSlotGizmo(event.clientX, event.clientY, kind, slotName);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    try { target.setPointerCapture(event.pointerId); } catch { /* 指针已释放时捕获会抛错，拖动仍继续 */ }
    suppressContextMenuRef.current = false;
    const current = stateRef.current.player;
    // 右键、中键仍可平移看画面。播放中左手工具全部停用，只留适应窗口。
    if (event.button === 2 || event.button === 1 || (stateRef.current.tool === 'pan' && !current?.playing)) {
      dragRef.current = {
        mode: 'pan', lastX: event.clientX, lastY: event.clientY, moved: false,
        button: event.button, originClientX: event.clientX, originClientY: event.clientY,
      };
      return;
    }
    if (current?.playing) return;
    if (stateRef.current.sheetDrag && event.button === 0 && stateRef.current.sheetSlot) {
      const point = toArmature(event.clientX, event.clientY);
      const item = itemsRef.current.find((entry) => entry.slot === stateRef.current.sheetSlot);
      if (item && itemOpaqueAt(item, alphaMaskRef.current, point.x, point.y)) {
        stateRef.current.onBeginEdit?.();
        dragRef.current = { mode: 'sheet', lastX: event.clientX, lastY: event.clientY, moved: false };
        return;
      }
    }
    if (stateRef.current.weightBonePick && event.button === 0) {
      dragRef.current = { mode: 'pick', lastX: event.clientX, lastY: event.clientY, moved: false };
      return;
    }
    if (stateRef.current.ikTargetPick && event.button === 0) {
      // 拾取分支要在选中骨骼之前拦住：点中的骨骼只当约束目标，不改当前选中项
      dragRef.current = { mode: 'ikTarget', lastX: event.clientX, lastY: event.clientY, moved: false };
      return;
    }
    if (stateRef.current.tool === 'bone' && current && event.button === 0) {
      const from = toArmature(event.clientX, event.clientY);
      createFrom.current = from;
      createPreview.current = from;
      dragRef.current = { mode: 'create', lastX: event.clientX, lastY: event.clientY, moved: false, from };
      return;
    }
    const toolNow = stateRef.current.tool;
    if (current && stateRef.current.bboxMode && stateRef.current.selectedSlot && event.button === 0) {
      // 官方 BoundingBoxPanel.btn.create / btn.delete：在边界框上点边加点、点顶点删点
      const slotName = stateRef.current.selectedSlot;
      const display = boundingBoxOf(current.skeleton.armature, slotName);
      const pts = boundingBoxPoints(display);
      const slotRuntime = current.skeleton.slots.find((entry) => entry.name === slotName);
      const m = slotRuntime && slotRuntime.parentBone >= 0
        ? current.skeleton.bones[slotRuntime.parentBone].world
        : [1, 0, 0, 1, 0, 0];
      const world = pts.map(([lx, ly]) => [m[0] * lx + m[2] * ly + m[4], m[1] * lx + m[3] * ly + m[5]] as [number, number]);
      const at = toArmature(event.clientX, event.clientY);
      const threshold = 12 / Math.max(0.05, scaleRef.current);
      if (stateRef.current.bboxMode === 'delete') {
        let best = -1;
        let bestD = Infinity;
        world.forEach(([x, y], i) => {
          const d = Math.hypot(x - at.x, y - at.y);
          if (d < bestD) { bestD = d; best = i; }
        });
        if (best >= 0 && bestD <= threshold) stateRef.current.onBBoxDeletePoint?.(best);
        return;
      }
      // add：找最近的边，在中点插入
      let bestA = -1;
      let bestB = -1;
      let bestD = Infinity;
      for (let i = 0; i < world.length; i++) {
        const a = world[i];
        const b = world[(i + 1) % world.length];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const len2 = dx * dx + dy * dy || 1;
        let t = ((at.x - a[0]) * dx + (at.y - a[1]) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(at.x - (a[0] + t * dx), at.y - (a[1] + t * dy));
        if (d < bestD) { bestD = d; bestA = i; bestB = (i + 1) % world.length; }
      }
      if (bestA >= 0 && bestD <= threshold) stateRef.current.onBBoxAddEdge?.(bestA, bestB);
      return;
    }
    if (current && toolNow === 'meshOutline' && event.button === 0) {
      // 官方 TOOL_OUTLINE(3)：依次点轮廓点，点回起点（8px 内）闭合 → 重建网格
      const at = toArmature(event.clientX, event.clientY);
      const points = outlinePointsRef.current;
      if (points.length >= 3 && Math.hypot(at.x - points[0].x, at.y - points[0].y) < 8) {
        stateRef.current.onOutlineComplete?.(points);
        outlinePointsRef.current = [];
      } else {
        outlinePointsRef.current = [...points, at];
      }
      return;
    }
    if (current && toolNow === 'meshEdge' && event.button === 0) {
      // 官方 TOOL_ADD_EDGE(9)：点已有的线 = 删除；否则点两个顶点 = 画线
      const drawn = pickUserEdge(event.clientX, event.clientY);
      if (drawn) {
        stateRef.current.onMeshLineToggle?.(drawn.slot, drawn.a, drawn.b);
        pendingVertexRef.current = null;
        return;
      }
      const hit = pickWeight(event.clientX, event.clientY);
      const wasPending = pendingVertexRef.current;
      if (!hit) {
        pendingVertexRef.current = null;
      } else if (!wasPending || wasPending.slot !== hit.slot || wasPending.vertex === hit.vertex) {
        pendingVertexRef.current = { slot: hit.slot, vertex: hit.vertex };
      } else {
        stateRef.current.onMeshLineToggle?.(hit.slot, wasPending.vertex, hit.vertex);
        pendingVertexRef.current = null;
      }
      return;
    }
    if (current && toolNow === 'meshAdd' && event.button === 0) {
      const edge = pickMeshEdge(event.clientX, event.clientY);
      if (edge) {
        stateRef.current.onMeshEdgeAdd?.(edge.slot, edge.a, edge.b, edge.t);
        return;
      }
    }
    if (current && (toolNow === 'mesh' || toolNow === 'meshDelete') && event.button === 0) {
      const hit = pickWeight(event.clientX, event.clientY);
      if (hit && toolNow === 'meshDelete') {
        stateRef.current.onMeshVertexRemove?.(hit.slot, hit.vertex);
        return;
      }
      if (hit) {
        const mesh = findMesh(current.skeleton.armature, hit.slot);
        const local = mesh ? readMesh(mesh).vertices[hit.vertex] : null;
        if (local) {
          const jacobian = current.skeleton.meshVertexJacobian(hit.slot, hit.vertex);
          stateRef.current.onBeginEdit?.();
          dragRef.current = {
            mode: 'meshVertex', lastX: event.clientX, lastY: event.clientY, moved: false,
            mesh: {
              slot: hit.slot, vertex: hit.vertex,
              startX: event.clientX, startY: event.clientY,
              originX: local[0], originY: local[1],
              inv: jacobian ? invertLinear(jacobian) : null,
            },
          };
          // a null map means the geometry is baked (dbbin): echo the position back so the
          // host can explain why nothing moved
          if (!jacobian) stateRef.current.onMeshVertexMove?.(hit.slot, hit.vertex, local[0], local[1]);
          return;
        }
      }
    }
    const name = stateRef.current.selectedBone;
    if (current && name && (toolNow === 'move' || toolNow === 'pose' || toolNow === 'free' || toolNow === 'rotate' || toolNow === 'scale')) {
      const picked = pick(event.clientX, event.clientY);
      if (toolNow === 'pose' && (!picked || picked === name)) {
        beginGizmoDrag(event.clientX, event.clientY, 'rotate', name);
        return;
      }
      if (picked === name) {
        // 与官方一致（spec §7 / §72：X = 旋转、C = 缩放）—— 按 X 拖骨片是旋转，不再是等比缩放。
        const kind = toolNow === 'rotate' ? 'rotate' : toolNow === 'scale' ? 'scale-free' : 'move';
        beginGizmoDrag(event.clientX, event.clientY, kind, name);
        return;
      }
    }
    const slotName = stateRef.current.selectedSlot;
    if (
      current && !name && slotName && stateRef.current.anatomyMode
      && (toolNow === 'move' || toolNow === 'free' || toolNow === 'rotate' || toolNow === 'scale')
      && event.button === 0
    ) {
      const pickedSlot = pickSlot(event.clientX, event.clientY);
      if (pickedSlot === slotName) {
        const kind = toolNow === 'rotate' ? 'rotate' : toolNow === 'scale' ? 'scale-free' : 'move';
        beginSlotGizmo(event.clientX, event.clientY, kind, slotName);
        return;
      }
    }
    // 选中插槽时优先命中轮廓：点连接点 / 点线条都会选中它并给出「位移拨杆」，
    // 拖那个拨杆就移动对应的网格点（线条 = 整条边的两个端点）。
    if (current && event.button === 0 && toolNow === 'select' && stateRef.current.selectedSlot) {
      const slot = stateRef.current.selectedSlot;
      const geometry = slotOutlineGeometry(slot);
      const host = hostRef.current;
      if (geometry && host && geometry.outline.length > 0) {
        const rect = host.getBoundingClientRect();
        const px = event.clientX - rect.left;
        const py = event.clientY - rect.top;
        const view = { scale: scaleRef.current, panX: panRef.current.x, panY: panRef.current.y };
        const vertex = pickOutlineVertex(geometry.positions, geometry.outline, px, py, view);
        if (vertex != null) {
          setOutlinePick({ slot, kind: 'vertex', vertices: [vertex] });
          dragRef.current = { mode: 'outlinePick', lastX: event.clientX, lastY: event.clientY, moved: false };
          return;
        }
        const edge = pickOutlineEdge(geometry.positions, geometry.outline, px, py, view);
        if (edge) {
          setOutlinePick({ slot, kind: 'edge', vertices: [edge.a, edge.b] });
          dragRef.current = { mode: 'outlinePick', lastX: event.clientX, lastY: event.clientY, moved: false };
          return;
        }
      }
    }
    if (stateRef.current.tool === 'select' && event.button === 0) {
      // 点中已选骨片 = 平移；空白处按下开始拉框
      const host = hostRef.current;
      const rect = host?.getBoundingClientRect();
      const picked = pick(event.clientX, event.clientY);
      if (picked && picked === stateRef.current.selectedBone) {
        beginGizmoDrag(event.clientX, event.clientY, 'move', picked);
        return;
      }
      if (rect && !picked) {
        const slotUnder = pickSlot(event.clientX, event.clientY);
        if (slotUnder && stateRef.current.onSelectSlot && !stateRef.current.disableSlotPick) {
          dragRef.current = { mode: 'pick', lastX: event.clientX, lastY: event.clientY, moved: false };
          return;
        }
        const mx = event.clientX - rect.left;
        const my = event.clientY - rect.top;
        setMarquee({ x0: mx, y0: my, x1: mx, y1: my });
        dragRef.current = { mode: 'marquee', lastX: event.clientX, lastY: event.clientY, moved: false };
        return;
      }
    }
    dragRef.current = { mode: 'pick', lastX: event.clientX, lastY: event.clientY, moved: false };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) {
      const now = stateRef.current.tool;
      // 悬停在哪根骨片上（只有它才会画出与父级的连线 + 箭头）
      const hoveredBone = pick(event.clientX, event.clientY);
      setHoverBone(hoveredBone);
      hoverEdgeRef.current = now === 'meshAdd' ? pickMeshEdge(event.clientX, event.clientY) : null;
      hoverUserEdgeRef.current = now === 'meshEdge' ? pickUserEdge(event.clientX, event.clientY) : null;
      if (now === 'weight') {
        const hit = pickWeight(event.clientX, event.clientY, WEIGHT_PIE_HIT);
        const slot = stateRef.current.selectedSlot;
        const next = hit && hit.slot === slot ? hit.vertex : null;
        if (hoverWeightRef.current !== next) {
          hoverWeightRef.current = next;
          setWeightPointer(next != null);
        }
      } else if (hoverWeightRef.current != null) {
        hoverWeightRef.current = null;
        setWeightPointer(false);
      }
      // 插槽悬停（官方 `StageNotification.ROLLOVER_SLOT`）：只在选择类工具、且这个工具没有自己的
      // 悬停语义（网格加边 / 手绘边 / 权重顶点）时拾取。**骨骼优先** —— 骨片与贴图重叠时只高亮骨片，
      // 与 pointerdown 第 1079 行的判定同序，避免两层同时发白。只在值变化时 setState。
      const nextSlot = now === 'select'
        && !hoveredBone
        && !hoverEdgeRef.current
        && !hoverUserEdgeRef.current
        && hoverWeightRef.current == null
        && !stateRef.current.disableSlotPick
        ? pickSlot(event.clientX, event.clientY)
        : null;
      setHoverSlot((prev) => (prev === nextSlot ? prev : nextSlot));
      return;
    }
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    if (Math.abs(dx) > 0 || Math.abs(dy) > 0) drag.moved = true;
    if (drag.mode === 'guide' && drag.guide !== undefined) {
      const rect = hostRef.current?.getBoundingClientRect();
      const list = stateRef.current.guides ?? [];
      const axis = drag.guideAxis ?? list[drag.guide]?.axis;
      if (rect && axis) {
        const stageScale = scaleRef.current || 1;
        const value = axis === 'x'
          ? (event.clientX - rect.left - panRef.current.x) / stageScale
          : (event.clientY - rect.top - panRef.current.y) / stageScale;
        stateRef.current.onGuidesChange?.(
          list.map((guide, index) => (index === drag.guide ? { ...guide, value: Math.round(value * 100) / 100 } : guide)),
        );
      }
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      return;
    }
    if (drag.mode === 'marquee') {
      const host = hostRef.current;
      const rect = host?.getBoundingClientRect();
      if (rect) {
        const x1 = event.clientX - rect.left;
        const y1 = event.clientY - rect.top;
        setMarquee((m) => (m ? { ...m, x1, y1 } : m));
      }
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      return;
    }
    if (drag.mode === 'sheet') {
      const stageScale = scaleRef.current || 1;
      stateRef.current.onSheetDrag?.(dx / stageScale, dy / stageScale);
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      return;
    }
    if (drag.mode === 'pan') {
      if (drag.button === 2) {
        const dist = Math.hypot(event.clientX - (drag.originClientX ?? event.clientX), event.clientY - (drag.originClientY ?? event.clientY));
        if (dist < 4) return;
        suppressContextMenuRef.current = true;
      }
      panRef.current = { x: panRef.current.x + dx, y: panRef.current.y + dy };
      bumpCamera();
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      return;
    }
    if (drag.mode === 'create') {
      createPreview.current = toArmature(event.clientX, event.clientY);
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      return;
    }
    if (drag.mode === 'bone' && drag.bone) {
      const current = stateRef.current.player;
      if (current?.playing) {
        dragRef.current = null;
        return;
      }
      if (current) {
        // ---- 拨杆：红=旋转（改 skX/skY），绿=缩放（改 scX/scY）；黄=平移走下面 ----------------
        if (drag.gizmo === 'rotate' && drag.startValues) {
          const angle = Math.atan2(
            event.clientY - (drag.originScreenY ?? event.clientY),
            event.clientX - (drag.originScreenX ?? event.clientX),
          );
          const delta = ((angle - (drag.startAngle ?? 0)) * 180) / Math.PI;
          stateRef.current.onEditBone?.(drag.bone, {
            ...drag.startValues,
            skX: drag.startValues.skX + delta,
            skY: drag.startValues.skY + delta,
          });
          drag.moved = true;
          drag.lastX = event.clientX;
          drag.lastY = event.clientY;
          return;
        }
        if (drag.gizmo === 'scale' && drag.startValues) {
          const distance = Math.hypot(
            event.clientX - (drag.originScreenX ?? event.clientX),
            event.clientY - (drag.originScreenY ?? event.clientY),
          );
          const ratio = Math.max(0.05, distance / (drag.startDistance || 1));
          stateRef.current.onEditBone?.(drag.bone, {
            ...drag.startValues,
            scX: drag.startValues.scX * ratio,
            scY: drag.startValues.scY * ratio,
          });
          drag.moved = true;
          drag.lastX = event.clientX;
          drag.lastY = event.clientY;
          return;
        }
        if (drag.gizmo === 'scale-free' && drag.startValues) {
          const rx = (event.clientX - (drag.originScreenX ?? event.clientX)) / (drag.startAxis || 1);
          const ry = (event.clientY - (drag.originScreenY ?? event.clientY)) / (drag.startAxisY || 1);
          const scX = drag.startValues.scX * rx;
          const scY = drag.startValues.scY * ry;
          if (Number.isFinite(scX) && Number.isFinite(scY) && Math.abs(scX) >= 0.05 && Math.abs(scY) >= 0.05) {
            stateRef.current.onEditBone?.(drag.bone, { ...drag.startValues, scX, scY });
          }
          drag.moved = true;
          drag.lastX = event.clientX;
          drag.lastY = event.clientY;
          return;
        }
        if ((drag.gizmo === 'scale-x' || drag.gizmo === 'scale-y') && drag.startValues) {
          const origin = drag.gizmo === 'scale-x' ? drag.originScreenX : drag.originScreenY;
          const now = drag.gizmo === 'scale-x' ? event.clientX : event.clientY;
          const ratio = (now - (origin ?? now)) / (drag.startAxis || 1);
          const base = drag.gizmo === 'scale-x' ? drag.startValues.scX : drag.startValues.scY;
          const value = base * ratio;
          if (Number.isFinite(value) && Math.abs(value) >= 0.05) {
            stateRef.current.onEditBone?.(drag.bone, drag.gizmo === 'scale-x'
              ? { ...drag.startValues, scX: value }
              : { ...drag.startValues, scY: value });
          }
          drag.moved = true;
          drag.lastX = event.clientX;
          drag.lastY = event.clientY;
          return;
        }
        const index = current.skeleton.boneIndexByName.get(drag.bone) ?? -1;
        const bone = index >= 0 ? current.skeleton.bones[index] : null;
        const parent = bone && bone.parent >= 0 ? current.skeleton.bones[bone.parent].world : IDENTITY;
        const stageScale = scaleRef.current || 1;
        let worldDx = dx / stageScale;
        let worldDy = dy / stageScale;
        if (drag.gizmo === 'move-x') worldDy = 0;
        if (drag.gizmo === 'move-y') worldDx = 0;
        // 官方 TransformPanel 的三个坐标系（World / Parent / Local）只影响"拖动用哪个轴"：
        //   world  —— 骨骼在世界里精确跟手（父级线性部分的逆）
        //   parent —— 只按父级的缩放换算，不跟父级的旋转
        //   local  —— 按骨骼自身的旋转与缩放换算
        const space = stateRef.current.transformSpace ?? 'world';
        let lx: number;
        let ly: number;
        if (space === 'parent') {
          const sx = Math.hypot(parent[0], parent[1]) || 1;
          const sy = Math.hypot(parent[2], parent[3]) || 1;
          lx = worldDx / sx;
          ly = worldDy / sy;
        } else if (space === 'local' && bone) {
          [lx, ly] = applyLinear(invert(bone.world), worldDx, worldDy);
        } else {
          [lx, ly] = applyLinear(invert(parent), worldDx, worldDy);
        }
        // 基准要含编辑期临时姿态，否则第二次 pointermove 会从动画值重算，拖到哪里都跳回原处。
        const values = effectiveTransform(current, drag.bone, current.position);
        stateRef.current.onEditBone?.(drag.bone, { x: values.x + lx, y: values.y + ly });
      }
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      return;
    }
    if (drag.mode === 'slot' && drag.slot && drag.gizmo && drag.startValues) {
      const current = stateRef.current.player;
      if (!current || current.playing || !stateRef.current.anatomyMode) {
        dragRef.current = null;
        return;
      }
      const currentValues = readSlotDisplayTransform(current, drag.slot);
      const selfWorld = slotDisplayWorld(current.skeleton, drag.slot);
      if (currentValues && selfWorld) {
        const patch = poseFromGizmo({
          gizmo: drag.gizmo,
          clientX: event.clientX,
          clientY: event.clientY,
          dx, dy,
          stageScale: scaleRef.current || 1,
          originScreenX: drag.originScreenX ?? event.clientX,
          originScreenY: drag.originScreenY ?? event.clientY,
          startAngle: drag.startAngle ?? 0,
          startDistance: drag.startDistance || 1,
          startAxis: drag.startAxis || 1,
          startAxisY: drag.startAxisY || 1,
          startValues: drag.startValues,
          current: currentValues,
          parent: slotParentWorld(current, drag.slot),
          selfWorld,
          space: stateRef.current.transformSpace ?? 'world',
          centerLocal: drag.centerLocal,
        });
        if (patch) stateRef.current.onEditSlot?.(drag.slot, patch);
      }
      drag.moved = true;
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      return;
    }
    const groupDrag = drag.mesh;
    if (drag.mode === 'outlineVertex' && groupDrag?.group) {
      const stageScale = scaleRef.current || 1;
      if (stateRef.current.ffdMode) {
        const dx = (event.clientX - drag.lastX) / stageScale;
        const dy = (event.clientY - drag.lastY) / stageScale;
        for (const entry of groupDrag.group) {
          if (!entry.inv) continue;
          const [ia, ib, ic, id] = entry.inv;
          stateRef.current.onFfdVertexMove?.(
            groupDrag.slot, entry.vertex,
            ia * dx + ic * dy,
            ib * dx + id * dy,
          );
        }
      } else {
        const wx = (event.clientX - groupDrag.startX) / stageScale;
        const wy = (event.clientY - groupDrag.startY) / stageScale;
        for (const entry of groupDrag.group) {
          if (!entry.inv) continue;
          const [ia, ib, ic, id] = entry.inv;
          stateRef.current.onMeshVertexMove?.(
            groupDrag.slot, entry.vertex,
            entry.originX + ia * wx + ic * wy,
            entry.originY + ib * wx + id * wy,
          );
        }
      }
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      drag.moved = true;
      return;
    }
    const info = drag.mesh;
    if (drag.mode === 'meshVertex' && info?.inv) {
      const stageScale = scaleRef.current || 1;
      const [ia, ib, ic, id] = info.inv;
      if (stateRef.current.ffdMode) {
        // FFD 写的是「相对基础网格的偏移」，所以按本次移动的增量累加，而不是绝对坐标
        const dx = (event.clientX - drag.lastX) / stageScale;
        const dy = (event.clientY - drag.lastY) / stageScale;
        stateRef.current.onFfdVertexMove?.(info.slot, info.vertex, ia * dx + ic * dy, ib * dx + id * dy);
      } else {
        const wx = (event.clientX - info.startX) / stageScale;
        const wy = (event.clientY - info.startY) / stageScale;
        stateRef.current.onMeshVertexMove?.(
          info.slot, info.vertex,
          info.originX + ia * wx + ic * wy,
          info.originY + ib * wx + id * wy,
        );
      }
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      drag.moved = true;
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.mode === 'marquee') {
      const current = stateRef.current.player;
      if (current && marquee) {
        const left = Math.min(marquee.x0, marquee.x1);
        const right = Math.max(marquee.x0, marquee.x1);
        const top = Math.min(marquee.y0, marquee.y1);
        const bottom = Math.max(marquee.y0, marquee.y1);
        const inside: string[] = [];
        for (const bone of current.skeleton.bones) {
          const sx = bone.world[4] * scaleRef.current + panRef.current.x;
          const sy = bone.world[5] * scaleRef.current + panRef.current.y;
          if (sx >= left && sx <= right && sy >= top && sy <= bottom) inside.push(bone.name);
        }
        stateRef.current.onSelectBonesRect?.(inside);
      }
      setMarquee(null);
      dragRef.current = null;
      return;
    }
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (drag.mode === 'slot' && drag.slot && drag.moved) { props.onSlotDragEnd?.(drag.slot); return; }
    if (drag.mode === 'bone' && drag.bone && drag.moved) props.onBoneDragEnd?.(drag.bone);
    // 点轮廓只是「选中轮廓元素」，不该顺手把骨骼/插槽的选择清掉（官方点轮廓不会丢选择）
    if (drag.mode === 'outlinePick') return;
    if (drag.mode === 'create') {
      const from = createFrom.current;
      const to = toArmature(event.clientX, event.clientY);
      createFrom.current = null;
      createPreview.current = null;
      if (from && Math.hypot(to.x - from.x, to.y - from.y) >= 4) {
        stateRef.current.onCreateBone?.(from, to);
      }
      return;
    }
    if (drag.mode === 'ikTarget' && !drag.moved) {
      const hit = pick(event.clientX, event.clientY);
      if (hit) stateRef.current.onPickIkTarget?.(hit);
      return;
    }
    if (drag.mode === 'pick' && !drag.moved) {
      if (stateRef.current.weightBonePick) {
        const hit = pick(event.clientX, event.clientY);
        if (hit) stateRef.current.onAddWeightBone?.(hit);
        return;
      }
      if (tool === 'weight') {
        // 饼图优先改顶点。没点中饼图时可以点骨片：选中骨骼且保留当前插槽，方便在权重列表里解绑。
        const target = onPaintWeight ? pickWeight(event.clientX, event.clientY, WEIGHT_PIE_HIT) : null;
        if (target) {
          weightVertexRef.current = target.vertex;
          onPaintWeight?.(target.slot, target.vertex);
          return;
        }
        const boneHit = pick(event.clientX, event.clientY);
        if (boneHit) {
          weightVertexRef.current = null;
          stateRef.current.onClearWeightVertex?.();
          onSelectBone(boneHit);
          return;
        }
        const slotHit = pickSlot(event.clientX, event.clientY);
        const current = stateRef.current.player;
        const meshHit = !!(slotHit && current && findMesh(current.skeleton.armature, slotHit));
        if (meshHit && slotHit && stateRef.current.onSelectSlot && !stateRef.current.disableSlotPick) {
          weightVertexRef.current = null;
          stateRef.current.onSelectSlot(slotHit);
          return;
        }
        // 舞台空白处：取消当前选中的顶点，属性面板的权重列表随之还原成只读（无滑块）。
        weightVertexRef.current = null;
        stateRef.current.onClearWeightVertex?.();
        return;
      }
      const hit = pick(event.clientX, event.clientY);
      const slotHit = pickSlot(event.clientX, event.clientY);
      if (hit && (event.shiftKey || event.ctrlKey || event.metaKey)) stateRef.current.onToggleBone?.(hit);
      else if (hit) onSelectBone(hit);
      else if (slotHit && stateRef.current.onSelectSlot && !stateRef.current.disableSlotPick) stateRef.current.onSelectSlot(slotHit);
      else onSelectBone(null);
    }
  };

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!ready || !renderer || !player) return;
    let raf = 0;
    let last = performance.now();
    let fps = 0;
    let frameMs = 0;
    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      fps = fps * 0.9 + (1 / Math.max(dt, 1e-3)) * 0.1;
      player.step(dt);
      const started = performance.now();
      if (stateRef.current.tool !== 'meshOutline' && outlinePointsRef.current.length > 0) {
        outlinePointsRef.current = [];
      }
      const hidden = stateRef.current.hiddenSlots;
      let items = player.renderItems();
      if (hidden.size > 0) items = items.filter((item) => !hidden.has(item.slot));
      // 舞台过滤器「图片可见」：整条关掉时舞台上不画任何图片（骨骼线框仍由 showBones 决定）
      if (stateRef.current.hideImages) items = [];
      itemsRef.current = items;
      renderer.setCamera(scaleRef.current, panRef.current.x, panRef.current.y);
      syncView();
      renderer.draw(items);

      // 洋葱皮（官方 `Timeline.onion.tooltip`）：只在暂停时画前 / 后帧，避免播放时闪烁与额外开销。
      // 前 / 后帧的 items 必须先把骨架 update 到那一帧再取（getRenderItems 读的是运行时骨骼 / 槽位状态）。
      let ghostCount = 0;
      let ghostMeshCount = 0;
      // 两个开关独立（官方 `Sheet.onion.prev` / `Sheet.onion.next`）；没单独传就跟随总开关。
      const onionPrevOn = stateRef.current.onionPrev ?? !!stateRef.current.onion;
      const onionNextOn = stateRef.current.onionNext ?? !!stateRef.current.onion;
      if ((onionPrevOn || onionNextOn) && !player.playing && !player.setupPose && (player.duration ?? 0) > 0) {
        const at = player.position;
        const keep = (list: RenderItem[]) => (hidden.size > 0 ? list.filter((entry) => !hidden.has(entry.slot)) : list);
        const batches: Array<{ key: string; items: RenderItem[] }> = [];
        const collectGhost = (key: string, frame: number, tint: number, alpha: number) => {
          player.skeleton.update(player.animation, frame);
          const items: RenderItem[] = [];
          for (const entry of player.skeleton.getRenderItems(player.atlas, player.animation, frame)) {
            items.push({ ...entry, tint, alpha: entry.alpha * alpha } as RenderItem);
          }
          batches.push({ key, items: keep(items) });
        };
        const frames = onionFrames(at, player.duration ?? 0);
        if (frames) {
          // 范围内每一帧一批，越远越淡；前偏红、后偏蓝
          const before = Math.max(1, stateRef.current.onionBefore ?? 1);
          const after = Math.max(1, stateRef.current.onionAfter ?? 1);
          const fade = (step: number, count: number) => 0.3 * (1 - (step - 1) / (count + 1));
          const span = Math.max(1, Math.round(player.duration ?? 0));
          const wrap = (frame: number) => ((frame % span) + span) % span;
          if (onionPrevOn) for (let step = 1; step <= before; step++) collectGhost(`prev${step}`, step === 1 ? frames.prev : wrap(Math.round(at) - step), 0xff7a7a, fade(step, before));
          if (onionNextOn) for (let step = 1; step <= after; step++) collectGhost(`next${step}`, step === 1 ? frames.next : wrap(Math.round(at) + step), 0x7ab8ff, fade(step, after));
        }
        player.skeleton.update(player.animation, at);   // 恢复当前帧，别把主体姿态带偏
        // 每帧必须分批下发：共用同一个 mesh key 的话，后画的会把前一帧整个覆盖掉
        renderer.drawGhosts(batches);
        ghostCount = batches.reduce((sum, batch) => sum + batch.items.length, 0);
        ghostMeshCount = renderer.ghostVisibleCount();
      } else {
        renderer.drawGhosts([]);
      }

      // 显示边框（官方 `Sheet.showframe` → `_948/_951.as` 第 159-168 行）：勾上后给舞台上
      // 每个显示对象描一圈边框。签名带上帧号 / 版本 / 相机：图片随骨骼和帧移动，相机缩放
      // 又会改变「1 屏幕像素」的线宽，所以只有这些都静止时才跳过重建。
      const frameBorderSig = stateRef.current.showFrameBorder
        ? `${stateRef.current.version ?? 0}|${player.position.toFixed(3)}|${items.length}|${scaleRef.current.toFixed(4)}`
        : '';
      if (frameBorderSig !== frameBorderSigRef.current) {
        frameBorderSigRef.current = frameBorderSig;
        const frameEdges: Array<[number, number, number, number]> = [];
        if (stateRef.current.showFrameBorder) {
          for (const item of items) {
            const p = item.positions;
            if (item.kind === 'image' && p.length >= 8) {
              for (let i = 0; i < 4; i++) {
                const j = (i + 1) % 4;
                frameEdges.push([p[i * 2], p[i * 2 + 1], p[j * 2], p[j * 2 + 1]]);
              }
              continue;
            }
            // 网格显示对象：官方同样是画矩形框，这里取顶点包围盒
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            for (let i = 0; i + 1 < p.length; i += 2) {
              minX = Math.min(minX, p[i]);
              maxX = Math.max(maxX, p[i]);
              minY = Math.min(minY, p[i + 1]);
              maxY = Math.max(maxY, p[i + 1]);
            }
            if (Number.isFinite(minX)) {
              frameEdges.push(
                [minX, minY, maxX, minY], [maxX, minY, maxX, maxY],
                [maxX, maxY, minX, maxY], [minX, maxY, minX, minY],
              );
            }
          }
        }
        frameEdgeCountRef.current = frameEdges.length;
        renderer.drawFrameOverlay(frameEdges);
      }

      const { joints, segments } = boneGeometry(player);
      const preview = createPreview.current;
      const start = createFrom.current;
      if (preview && start) {
        const dx = preview.x - start.x;
        const dy = preview.y - start.y;
        segments.push({ x: start.x, y: start.y, angle: Math.atan2(dy, dx), length: Math.hypot(dx, dy), selected: true });
      }
      const selected = stateRef.current.selectedBone;
      const index = selected ? player.skeleton.boneIndexByName.get(selected) ?? -1 : -1;
      if (showBones) {
        const selectedIdx = stateRef.current.selectedBones
          ? [...stateRef.current.selectedBones]
              .map((boneName) => player.skeleton.boneIndexByName.get(boneName) ?? -1)
              .filter((i2) => i2 >= 0)
          : [];
        const marquee = marqueeRef.current;
        const marqueeWorld: [number, number, number, number] | undefined = marquee
          ? [
              (marquee.x0 - panRef.current.x) / Math.max(0.0001, scaleRef.current),
              (marquee.y0 - panRef.current.y) / Math.max(0.0001, scaleRef.current),
              (marquee.x1 - panRef.current.x) / Math.max(0.0001, scaleRef.current),
              (marquee.y1 - panRef.current.y) / Math.max(0.0001, scaleRef.current),
            ]
          : undefined;
        // 读 ref 而非 state：tick 的 effect 依赖里没有 hoverBone，闭包会拿到旧值（同第 313 行说明）。
        // 外部注入（场景树行 hover）与舞台内鼠标悬停同权，都要画它与父级的连线。
        const extBoneHover = externalHoverRef.current?.kind === 'bone' ? externalHoverRef.current.name : null;
        const linkName = hoverBoneRef.current ?? extBoneHover ?? selected;
        const bones = player.skeleton.bones;
        const seeds: number[] = [];
        if (index >= 0) seeds.push(index);
        for (const extra of selectedIdx) if (!seeds.includes(extra)) seeds.push(extra);
        const links: Array<{ joint: number; parent: number }> = [];
        const seen = new Set<number>();
        const childrenOf = new Map<number, number[]>();
        bones.forEach((bone, boneIndex) => {
          if (bone.parent < 0) return;
          const list = childrenOf.get(bone.parent);
          if (list) list.push(boneIndex);
          else childrenOf.set(bone.parent, [boneIndex]);
        });
        const addChain = (seed: number) => {
          let cursor = seed;
          while (cursor >= 0 && !seen.has(cursor)) {
            seen.add(cursor);
            const parent = bones[cursor].parent;
            if (parent >= 0) links.push({ joint: cursor, parent });
            cursor = parent;
          }
          const stack = [seed];
          while (stack.length > 0) {
            const node = stack.pop() as number;
            for (const child of childrenOf.get(node) ?? []) {
              if (seen.has(child)) continue;
              seen.add(child);
              links.push({ joint: child, parent: node });
              stack.push(child);
            }
          }
        };
        if (seeds.length > 0) {
          for (const seed of seeds) addChain(seed);
        } else if (linkName) {
          const hoverIndex = player.skeleton.boneIndexByName.get(linkName) ?? -1;
          const parent = hoverIndex >= 0 ? bones[hoverIndex].parent : -1;
          if (hoverIndex >= 0 && parent >= 0) links.push({ joint: hoverIndex, parent });
        }
        if (index >= 0 && segments[index]) {
          const active = stateRef.current.tool;
          if (active === 'rotate') segments[index].accent = 'red';
          else if (active === 'scale' || active === 'free') segments[index].accent = 'cyan';
        }
        renderer.drawBoneOverlay(
          segments,
          joints,
          links,
          selectedIdx,
          marqueeWorld,
        );
      } else if (index >= 0) {
        renderer.drawBoneOverlay([], [joints[index]]);
      } else {
        // keep the origin cross visible even with no selection / bones hidden
        renderer.drawBoneOverlay([], []);
      }
      // 边界框：把选中槽位的多边形投影到世界坐标（官方 BoundingBoxPanel 的编辑视图）
      const bboxSlotName = stateRef.current.selectedSlot;
      const bboxDisplay = bboxSlotName ? boundingBoxOf(player.skeleton.armature, bboxSlotName) : null;
      const bboxLocal = boundingBoxPoints(bboxDisplay);
      const bboxWorldPts: Array<[number, number]> = [];
      if (bboxLocal.length > 0 && bboxSlotName) {
        const bboxRuntime = player.skeleton.slots.find((entry) => entry.name === bboxSlotName);
        const bm = bboxRuntime && bboxRuntime.parentBone >= 0
          ? player.skeleton.bones[bboxRuntime.parentBone].world
          : [1, 0, 0, 1, 0, 0];
        for (const [lx, ly] of bboxLocal) {
          bboxWorldPts.push([bm[0] * lx + bm[2] * ly + bm[4], bm[1] * lx + bm[3] * ly + bm[5]]);
        }
      }
      const weightSlot = stateRef.current.tool === 'weight' ? stateRef.current.selectedSlot : null;
      if (!weightSlot) weightVertexRef.current = null;
      const weightItem = weightSlot
        ? items.find((item) => item.kind === 'mesh' && item.slot === weightSlot)
        : undefined;
      const weightSig = weightItem
        ? `weight|${weightSlot}|${stateRef.current.version ?? 0}|${player.position.toFixed(3)}|${scaleRef.current.toFixed(4)}|${panRef.current.x.toFixed(2)}|${panRef.current.y.toFixed(2)}|${weightVertexRef.current ?? -1}|h${hoverWeightRef.current ?? -1}|${weightItem.positions.length}`
        : '';
      const gridTool = bboxWorldPts.length > 0 || stateRef.current.tool === 'mesh' || stateRef.current.tool === 'meshAdd'
        || stateRef.current.tool === 'meshDelete' || stateRef.current.tool === 'meshEdge' || stateRef.current.tool === 'meshOutline';
      const overlaySig = gridTool
        ? `${stateRef.current.tool}|${stateRef.current.version ?? 0}|bb:${bboxWorldPts.length}|${outlinePointsRef.current.length}|${player.position.toFixed(3)}|`
          + `${scaleRef.current.toFixed(4)}|${panRef.current.x.toFixed(2)}|${panRef.current.y.toFixed(2)}|`
          + `${hoverEdgeRef.current?.slot ?? ''}:${hoverEdgeRef.current?.index ?? -1}|`
          + `${hoverUserEdgeRef.current?.slot ?? ''}:${hoverUserEdgeRef.current?.index ?? -1}|`
          + `${pendingVertexRef.current?.slot ?? ''}:${pendingVertexRef.current?.vertex ?? -1}|${items.length}`
        : '';
      if (weightItem && weightSig !== overlaySigRef.current) {
        overlaySigRef.current = weightSig;
        const mesh = findMesh(player.skeleton.armature, weightSlot!);
        const slices = mesh ? vertexWeightPies(player.skeleton.armature, weightSlot!) : [];
        const pies = slices.map((pie, vertex) => ({
          x: weightItem.positions[vertex * 2],
          y: weightItem.positions[vertex * 2 + 1],
          slices: pie,
        })).filter((pie) => Number.isFinite(pie.x) && Number.isFinite(pie.y));
        const contour: Array<[number, number, number, number]> = [];
        if (mesh) {
          for (const [a, b] of outlineEdges(mesh)) {
            if (b * 2 + 1 >= weightItem.positions.length) continue;
            contour.push([
              weightItem.positions[a * 2], weightItem.positions[a * 2 + 1],
              weightItem.positions[b * 2], weightItem.positions[b * 2 + 1],
            ]);
          }
        }
        weightPieCountRef.current = pies.length;
        renderer.drawMeshOverlay({
          edges: contour,
          pies,
          piePx: 1 / Math.max(0.05, Math.abs(scaleRef.current)),
          pieScreen: WEIGHT_PIE_PX,
          selectedPie: weightVertexRef.current ?? undefined,
          hoverPie: hoverWeightRef.current ?? undefined,
        });
      } else if (!weightSlot && gridTool && overlaySig !== overlaySigRef.current) {
        overlaySigRef.current = overlaySig;
        const meshLines: Array<[number, number, number, number]> = [];
        // 边界框轮廓
        for (let i = 0; i < bboxWorldPts.length; i++) {
          const j = (i + 1) % bboxWorldPts.length;
          meshLines.push([bboxWorldPts[i][0], bboxWorldPts[i][1], bboxWorldPts[j][0], bboxWorldPts[j][1]]);
        }
        // 官方 TOOL_OUTLINE：把正在画的轮廓点连成折线实时预览（闭合前）
        const outline = outlinePointsRef.current;
        for (let i = 1; i < outline.length; i++) {
          meshLines.push([outline[i - 1].x, outline[i - 1].y, outline[i].x, outline[i].y]);
        }
        if (outline.length >= 3) {
          meshLines.push([outline[outline.length - 1].x, outline[outline.length - 1].y, outline[0].x, outline[0].y]);
        }
        const userLines: Array<[number, number, number, number]> = [];
        const meshJoints: Array<[number, number]> = [];
        for (const [x, y] of bboxWorldPts) meshJoints.push([x, y]);
        const hover = hoverEdgeRef.current;
        const hoverUser = hoverUserEdgeRef.current;
        const pending = pendingVertexRef.current;
        let highlight = -1;
        let highlightUser: [number, number, number, number] | undefined;
        let pendingWorld: [number, number] | undefined;
        for (const item of items) {
          if (item.kind !== 'mesh') continue;
          const mesh = findMesh(player.skeleton.armature, item.slot);
          // dbbin 也能编辑，所以线框一样要画（只有「手绘边线」那条 userEdges 路径不适用）
          if (!mesh) continue;
          const base = meshLines.length;
          const pairs = meshEdges(mesh);
          for (const [a, b] of pairs) {
            meshLines.push([
              item.positions[a * 2], item.positions[a * 2 + 1],
              item.positions[b * 2], item.positions[b * 2 + 1],
            ]);
          }
          // Only the hovered edge shows its endpoints: drawing a dot per vertex every frame
          // costs a polygon per vertex and measurably drops the frame rate.
          for (const [a, b] of readUserEdges(mesh)) {
            const line: [number, number, number, number] = [
              item.positions[a * 2], item.positions[a * 2 + 1],
              item.positions[b * 2], item.positions[b * 2 + 1],
            ];
            userLines.push(line);
            if (hoverUser && hoverUser.slot === item.slot && hoverUser.index === userLines.length - 1) {
              highlightUser = line;
            }
          }
          if (pending && pending.slot === item.slot && pending.vertex * 2 + 1 < item.positions.length) {
            pendingWorld = [item.positions[pending.vertex * 2], item.positions[pending.vertex * 2 + 1]];
          }
          if (hover && hover.slot === item.slot && pairs[hover.index]) {
            const [ha, hb] = pairs[hover.index];
            meshJoints.push(
              [item.positions[ha * 2], item.positions[ha * 2 + 1]],
              [item.positions[hb * 2], item.positions[hb * 2 + 1]],
            );
            highlight = base + hover.index;
          }
        }
        renderer.drawMeshOverlay({
          edges: meshLines,
          userEdges: userLines,
          joints: meshJoints,
          highlightEdge: highlight >= 0 ? highlight : undefined,
          highlightUserEdge: highlightUser,
          pendingVertex: pendingWorld,
        });
      } else if (!weightSlot && !gridTool && overlaySigRef.current) {
        // Only leave the layer dirty when the grid tools are gone; a stable signature must
        // keep the drawn overlay (and the pending vertex) on screen.
        overlaySigRef.current = '';
        weightPieCountRef.current = 0;
        hoverEdgeRef.current = null;
        hoverUserEdgeRef.current = null;
        hoverWeightRef.current = null;
        pendingVertexRef.current = null;
        renderer.drawMeshOverlay();
      }
      // 选中槽位的轮廓（官方截图里的青色轮廓）：
      //   有网格 → 网格的外轮廓 + 轮廓顶点白点（内部顶点只在网格编辑工具下出现）
      //   没有网格 → 渲染项的矩形包围盒
      const outlineSlot = stateRef.current.selectedSlot;
      /** 某个插槽的轮廓几何（有网格给 edges+points，没有网格给 rect）——选中轮廓与悬停轮廓共用。 */
      const outlineOf = (slot: string) => {
        const out: {
          edges?: Array<[number, number, number, number]>;
          points?: Array<[number, number]>;
          rect?: [number, number, number, number];
        } = {};
        const item = items.find((entry) => entry.slot === slot);
        if (!item || item.positions.length < 6) return out;
        const mesh = findMesh(player.skeleton.armature, slot);
        const outline = mesh ? outlineEdges(mesh) : [];
        if (outline.length > 0) {
          const edges: Array<[number, number, number, number]> = [];
          const points: Array<[number, number]> = [];
          const seen = new Set<number>();
          for (const [a, b] of outline) {
            if (a * 2 + 1 >= item.positions.length || b * 2 + 1 >= item.positions.length) continue;
            edges.push([item.positions[a * 2], item.positions[a * 2 + 1], item.positions[b * 2], item.positions[b * 2 + 1]]);
            for (const v of [a, b]) {
              if (seen.has(v)) continue;
              seen.add(v);
              points.push([item.positions[v * 2], item.positions[v * 2 + 1]]);
            }
          }
          out.edges = edges;
          out.points = points;
        } else {
          let minX = Infinity;
          let minY = Infinity;
          let maxX = -Infinity;
          let maxY = -Infinity;
          for (let i = 0; i + 1 < item.positions.length; i += 2) {
            minX = Math.min(minX, item.positions[i]);
            maxX = Math.max(maxX, item.positions[i]);
            minY = Math.min(minY, item.positions[i + 1]);
            maxY = Math.max(maxY, item.positions[i + 1]);
          }
          if (Number.isFinite(minX)) out.rect = [minX, minY, maxX, maxY];
        }
        return out;
      };
      renderer.drawSlotOverlay(outlineSlot ? outlineOf(outlineSlot) : {});
      // 插槽悬停轮廓（官方 ROLLOVER_SLOT）：只描线、不给顶点白点；**已选中就不画**
      //（选中轮廓已经占了同一个位置，两条叠着画没有信息量）。传空对象即移出即消失。
      // 外部注入（场景树行 hover）与舞台内鼠标悬停合并：两者都是「临时的悬停轮廓」
      const hoverSlotName = hoverSlotRef.current
        ?? (externalHoverRef.current?.kind === 'slot' ? externalHoverRef.current.name : null);
      renderer.drawHoverOutline(
        hoverSlotName && hoverSlotName !== outlineSlot ? outlineOf(hoverSlotName) : {},
      );

      renderer.setAnatomyMode(anatomyRef.current);
      renderer.render();
      frameMs = frameMs * 0.85 + (performance.now() - started) * 0.15;
      stateRef.current.onStats?.({ items: items.length, fps, ms: frameMs });
      if (import.meta.env.DEV) {
        const first = items[0];
        (window as unknown as Record<string, unknown>).__boneStudio = {
          items: items.length,
          onion: !!stateRef.current.onion,
          ghosts: ghostCount,
          /** 显示边框（`Sheet.showframe`）当前画出的边框边数：0 = 没开或没有显示对象 */
          frameBorder: frameEdgeCountRef.current,
          frameBorderOn: !!stateRef.current.showFrameBorder,
          outlinePoints: outlinePointsRef.current.length,
          selectedBones: stateRef.current.selectedBones?.size ?? 0,
          ghostMeshes: ghostMeshCount,
          fps: Number(fps.toFixed(1)),
          ms: Number(frameMs.toFixed(2)),
          scale: Number(scaleRef.current.toFixed(4)),
          pan: { ...panRef.current },
          tool: stateRef.current.tool,
          weightPies: weightPieCountRef.current,
          anatomyMode: anatomyRef.current,
          /** 骨骼线框是否在画（网格编辑「隐藏其他」会连骨骼一起收起，见 App 的 stageShowBones） */
          showBones: !!showBones,
          /** 鼠标悬停命中的插槽（官方 `ROLLOVER_SLOT`，§112）——null 表示没有高亮 */
          hoverSlot: hoverSlotRef.current
            ?? (externalHoverRef.current?.kind === 'slot' ? externalHoverRef.current.name : null),
          /** 外部注入的悬停（场景树行 hover，§113）：`{kind,name}` 或 null */
          externalHover: externalHoverRef.current ? { ...externalHoverRef.current } : null,
          /** 悬停高亮的渲染侧证据（可见网格数 / alpha / 滤镜数 / tint）：0 表示画布上没画 */
          hoverMesh: renderer.hoverDebug(),
          hiddenBones: [...hiddenBonesRef.current],
          lockedBones: [...(stateRef.current.lockedBones ?? [])],
          // 运行时槽位顺序 = 绘制顺序（插槽层级菜单的判据读它）
          slotOrder: player.skeleton.slots.map((entry) => entry.name),
          /** 「层级」面板的实际绘制顺序（含未落帧的临时顺序，升序 = 从下层到上层） */
          drawOrder: drawOrder(player),
          // 插槽 → 挂点骨骼（§109 拖放判据：切片拖进舞台应挂到元件第一根骨骼）
          slotParents: (() => {
            const out: Record<string, string> = {};
            for (const entry of player.skeleton.armature.slot ?? []) out[entry.name] = entry.parent;
            return out;
          })(),
          // 骨骼名（顺序即数据顺序，`boneOrder[0]` 就是官方口径的根骨骼）
          boneOrder: player.skeleton.bones.map((entry) => entry.name),
          // 序列帧工程的帧数（第 0 个插槽的显示对象数）；非序列帧为 null。§109 拖放追加帧的判据。
          sheetFrames: (() => {
            const armature = player.skeleton.armature;
            if (!isSheetArmature(armature)) return null;
            const slotName = armature.slot?.[0]?.name;
            return (slotName ? player.skeleton.skinSlots.get(slotName)?.display?.length : 0) ?? 0;
          })(),
          hiddenSlots: [...(stateRef.current.hiddenSlots ?? [])],
          // 每个插槽当前显示对象的类型（「转换为网格 / 图片」的判据读它）
          displayKinds: (() => {
            const out: Record<string, string> = {};
            for (const slot of player.skeleton.slots) {
              const display = player.skeleton.skinSlots.get(slot.name)?.display?.[slot.displayIndex ?? 0];
              if (display) out[slot.name] = String(display.type ?? 'image');
            }
            return out;
          })(),
          lockedSlots: [...lockedSlotsRef.current],
          selectedSlots: [...selectedSlotsRef.current],
          worldAlpha: Number(renderer.world.alpha.toFixed(3)),
          pendingVertex: pendingVertexRef.current
            ? { slot: pendingVertexRef.current.slot, vertex: pendingVertexRef.current.vertex }
            : null,
          selected,
          frame: Number(player.position.toFixed(3)),
          bones: player.skeleton.bones.length,
          // 选中骨骼在当前动画里的关键帧数（headless 测试用来确认关键帧编辑有没有真的发生）
          selectedKeys: player.animation?.bone?.find((t) => t.name === selected)?.frame?.length ?? 0,
          // 选中骨骼所属 IK 约束的目标与角色，以及该约束的关键帧条数（「定位 / 设置目标 / k 帧」的判据）。
          // 用 `ikRoleOf`：选中**目标骨骼**时同样要能读到（官方对目标骨骼给「IK约束目标」组）。
          ikTarget: (() => {
            const entry = selected ? ikRoleOf(player.skeleton.armature, selected) : null;
            return entry?.constraint.target ?? null;
          })(),
          ikRole: (() => {
            const entry = selected ? ikRoleOf(player.skeleton.armature, selected) : null;
            return entry?.role ?? null;
          })(),
          ikKeys: (() => {
            const entry = selected ? ikRoleOf(player.skeleton.armature, selected) : null;
            const animation = player.animation;
            if (!entry || !animation) return 0;
            return ikTimelineOf(animation, entry.constraint.name)?.frame?.length ?? 0;
          })(),
          slots: player.skeleton.slots.length,
          // 每个插槽显示对象的**可视中心**（世界坐标）—— 序列帧帧定位的端到端判据（spec §103）：
          // 修剪图集的 `frameX/frameY` 决定它离舞台原点有多远
          slotCenters: (() => {
            const out: Record<string, number[]> = {};
            for (const slot of player.skeleton.slots) {
              const center = slotVisualCenter(player, slot.name);
              if (center) out[slot.name] = [center.x, center.y];
            }
            return out;
          })(),
          // 槽位显示对象的世界位置（headless 测试用来验证「子图片可控」的编辑期补偿）
          displayWorlds: (() => {
            const out: Record<string, number[]> = {};
            for (const slot of player.skeleton.slots) {
              const world = slotDisplayWorld(player.skeleton, slot.name);
              if (world) out[slot.name] = [world[4], world[5]];
            }
            return out;
          })(),
          // 选中骨骼的世界位置（headless 测试用来测量拖动的世界位移）
          selectedWorld: (() => {
            const bone = player.skeleton.bones.find((b) => b.name === selected);
            return bone ? [bone.world[4], bone.world[5]] : null;
          })(),
          // 每根骨骼的世界位置：脚本靠它把「世界坐标」换算成舞台上的点击点
          // （`.stage` 的 rect + `pan` + `scale` 复原 `toArmature`）
          boneWorlds: (() => {
            const out: Record<string, number[]> = {};
            for (const bone of player.skeleton.bones) out[bone.name] = [bone.world[4], bone.world[5]];
            return out;
          })(),
          // 选中槽位的轮廓摘要（headless 测试用来确认"有网格画网格轮廓、没网格画矩形"）
          // 每个插槽当前的 displayIndex（「切换显示对象」的判据读它）
          displayIndexes: (() => {
            const out: Record<string, number> = {};
            for (const slot of player.skeleton.slots) out[slot.name] = slot.displayIndex ?? 0;
            return out;
          })(),
          selectedSlot: stateRef.current.selectedSlot ?? null,
          // 拾取判据（alpha 命中）用：图集 url + 每个渲染项（按绘制顺序）的包围盒与图片四角 / UV。
          // 端到端脚本靠它算出一个「在包围盒内、但图集像素全透明」的点击点（spec §106）。
          atlasUrl: atlasUrlRef.current,
          alphaMaskReady: alphaMaskRef.current != null,
          pickItems: items.map((item) => {
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            for (let i = 0; i + 1 < item.positions.length; i += 2) {
              minX = Math.min(minX, item.positions[i]);
              maxX = Math.max(maxX, item.positions[i]);
              minY = Math.min(minY, item.positions[i + 1]);
              maxY = Math.max(maxY, item.positions[i + 1]);
            }
            return {
              slot: item.slot,
              kind: item.kind,
              bbox: Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null,
              positions: item.kind === 'image' ? Array.from(item.positions) : [],
              uvs: item.kind === 'image' ? Array.from(item.uvs) : [],
            };
          }),
          outlinePick: outlinePickRef.current
            ? { slot: outlinePickRef.current.slot, kind: outlinePickRef.current.kind, vertices: outlinePickRef.current.vertices }
            : null,
          slotOutline: (() => {
            const outline = outlineSlot ? outlineOf(outlineSlot) : {};
            return {
              edges: outline.edges?.length ?? 0,
              points: outline.points?.length ?? 0,
              rect: !!outline.rect,
              sample: outline.edges?.[0] ?? outline.rect ?? null,
              longestEdge: longestOutlineEdge(outline.edges),
            };
          })(),
          // 鼠标悬停命中的骨片（headless 测试用来确认"骨片可拾取、连线只在悬停时出现"）
          hoverBone: hoverBoneRef.current
            ?? (externalHoverRef.current?.kind === 'bone' ? externalHoverRef.current.name : null),
          // 选中骨骼当前姿态的旋转 / 缩放（headless 测试用来确认拨杆拖动落到数据上）
          selectedRotation: (() => {
            if (!selected) return null;
            const values = sampleTransform(player, selected, player.position);
            return Number(values.skX.toFixed(3));
          })(),
          selectedScale: (() => {
            if (!selected) return null;
            const values = sampleTransform(player, selected, player.position);
            return Number(values.scX.toFixed(4));
          })(),
          // 选中骨骼的运行时长度（headless 测试用来确认长度编辑落到 runtime 上）
          selectedLength: (() => {
            const bone = player.skeleton.bones.find((b) => b.name === selected);
            return bone ? bone.length : null;
          })(),
          // 关节世界坐标（headless 测试用来在舞台上瞄准某根骨骼）
          boneJoints: player.skeleton.bones.slice(0, 12).map((b) => [b.name, b.world[4], b.world[5]]),
          ik: player.skeleton.armature.ik?.length ?? 0,
          // 当前动画的 FFD 轨道概览（headless 测试用来看变形关键帧有没有被写进去）
          ffd: (player.animation?.ffd ?? []).map((t) => ({ slot: t.slot, frames: (t.frame ?? []).length })),
          animation: player.animation?.name ?? null,
          // 选中骨骼参与的 IK 约束详情（headless 测试用来确认属性编辑是否落到数据上）
          ikDetail: (() => {
            const list = player.skeleton.armature.ik ?? [];
            const parentOf = (name: string) => player.skeleton.armature.bone.find((b) => b.name === name)?.parent ?? null;
            const found = list.find((c) => c.bone === selected)
              ?? list.find((c) => (c.chain ?? 1) === 2 && parentOf(c.bone) === selected);
            return found ? { name: found.name, bendPositive: found.bendPositive ?? null, weight: found.weight ?? null } : null;
          })(),
          surfaces: player.skeleton.surfaceInfo(),
          blends: Object.fromEntries(items.map((item) => [item.slot, item.blend])),
          first: first
            ? {
              kind: first.kind,
              slot: first.slot,
              blend: first.blend,
              region: (first as { region?: { name?: string } }).region?.name ?? null,
              positions: Array.from(first.positions.slice(0, 6)),
            }
            : null,
          // DEV probe: deformed meshes (FFD) are not necessarily items[0], so
          // expose every mesh by slot for headless verification.
          meshes: items
            .filter((item) => item.kind === 'mesh')
            .map((item) => {
              const mesh = findMesh(player.skeleton.armature, item.slot);
              // dbbin 形态如今也支持网格编辑，所以边采样不再排除它
              const pairs = mesh ? meshEdges(mesh) : [];
              const drawn = mesh ? readUserEdges(mesh) : [];
              return {
                slot: item.slot,
                vertices: item.positions.length / 2,
                tris: item.triangles.length / 3,
                userEdges: drawn.length,
                outlineEdges: (mesh?.edges?.length ?? 0) / 2,
                // sample edges with their posed endpoints, so a headless client can aim at one
                edgeSamples: pairs.slice(0, 8).map(([a, b]) => [
                  item.positions[a * 2], item.positions[a * 2 + 1],
                  item.positions[b * 2], item.positions[b * 2 + 1],
                ]),
                positions: Array.from(item.positions.slice(0, 48)),
              };
            }),
        };
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready, player, showBones, selectedBone, boneGeometry, syncView]);

  const stepX = niceStep(view.scale, RULER_STEP_X);
  const stepY = niceStep(view.scale, RULER_STEP_Y);
  const ticksX = rulerTicks(view.scale, view.panX, view.w, stepX);
  const ticksY = rulerTicks(view.scale, view.panY, view.h, stepY);

  /** 轮廓拨杆的屏幕位置：连接点=该点；线条=两端点的中点。 */
  const outlineGizmoPos = (() => {
    if (!outlinePick) return null;
    const geometry = slotOutlineGeometry(outlinePick.slot);
    if (!geometry) return null;
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const v of outlinePick.vertices) {
      if (v * 2 + 1 >= geometry.positions.length) continue;
      sx += geometry.positions[v * 2] * view.scale + view.panX;
      sy += geometry.positions[v * 2 + 1] * view.scale + view.panY;
      n++;
    }
    return n > 0 ? { x: sx / n, y: sy / n } : null;
  })();
  return (
    <div className="stage-frame">
      <div className="stage-corner" />
      <div
        className="stage-ruler top"
        title="从这里往下拖可以拉出水平辅助线（官方「辅助标尺」）"
        onPointerDown={(event) => createGuideFromRuler(event, "y")}
      >
        {ticksX.map((tick, index) => (
          <span key={index} className={`tk${tick.major ? ' major' : ''}${tick.zero ? ' zero' : ''}`} style={{ left: tick.px }}>
            {tick.label ? <b className="lab">{tick.label}</b> : null}
          </span>
        ))}
      </div>
      <div
        className="stage-ruler left"
        title="从这里往右拖可以拉出竖直辅助线（官方「辅助标尺」）"
        onPointerDown={(event) => createGuideFromRuler(event, "x")}
      >
        {ticksY.map((tick, index) => (
          <span key={index} className={`tk${tick.major ? ' major' : ''}${tick.zero ? ' zero' : ''}`} style={{ top: tick.px }}>
            {tick.label ? <b className="lab">{tick.label}</b> : null}
          </span>
        ))}
      </div>
      <div
      className="stage"
      ref={hostRef}
      onPointerEnter={() => onFocusArea?.('stage')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { dragRef.current = null; }}
      onPointerLeave={() => { dragRef.current = null; setHoverBone(null); setHoverSlot(null); hoverWeightRef.current = null; setWeightPointer(false); }}
      onDragOver={onRegionDrop ? (event) => {
        // 只有资源树拖来的切片才认；其余（外部文件）交给根节点处理
        if (!event.dataTransfer.types.includes(REGION_DRAG_MIME)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      } : undefined}
      onDrop={onRegionDrop ? (event) => {
        const name = event.dataTransfer.getData(REGION_DRAG_MIME);
        if (!name) return;
        const host = hostRef.current;
        if (!host) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = host.getBoundingClientRect();
        const s = scaleRef.current;
        const pan = panRef.current;
        onRegionDrop(name, {
          x: (event.clientX - rect.left - pan.x) / s,
          y: (event.clientY - rect.top - pan.y) / s,
        });
      } : undefined}
      data-stage-drop={onRegionDrop ? '' : undefined}
      onContextMenu={(event) => {
        event.preventDefault();
        if (suppressContextMenuRef.current) {
          suppressContextMenuRef.current = false;
          return;
        }
        const hit = pick(event.clientX, event.clientY);
        // 官方：右键骨骼出骨骼菜单；右键图片（插槽）出插槽菜单
        const slot = hit ? null : pickSlot(event.clientX, event.clientY);
        onStageContextMenu?.({ x: event.clientX, y: event.clientY, bone: hit, slot });
      }}
      style={{ cursor: ikTargetPick ? 'crosshair' : weightBonePick ? 'crosshair' : tool === 'pan' ? 'grab' : weightPointer ? 'pointer' : 'default', background }}
      data-tool={tool}
    >
      {props.referenceOverlay && (
        <img
          className="stage-reference"
          data-stage-reference=""
          src={props.referenceOverlay.url}
          alt=""
          draggable={false}
          style={{
            position: 'absolute', pointerEvents: 'none', zIndex: 1, imageRendering: 'auto',
            left: view.panX - (props.referenceOverlay.originX / props.referenceOverlay.pxPerUnit) * view.scale,
            top: view.panY - (props.referenceOverlay.originY / props.referenceOverlay.pxPerUnit) * view.scale,
            width: (props.referenceOverlay.width / props.referenceOverlay.pxPerUnit) * view.scale,
            height: (props.referenceOverlay.height / props.referenceOverlay.pxPerUnit) * view.scale,
            opacity: props.referenceOverlay.opacity,
          }}
        />
      )}
      {handleGizmo && !player?.playing && (tool === 'move' || tool === 'scale' || tool === 'free') && (
        <div className="bone-gizmo" data-bone-gizmo={gizmo?.name} data-slot-gizmo={slotGizmo && !gizmo ? slotGizmo.name : undefined} data-gizmo-tool={tool} style={{ left: handleGizmo.x, top: handleGizmo.y }}>
          {tool === 'move' && (
            <>
              <button className="gizmo-handle gizmo-move-x" data-gizmo="move-x" title="平移 X" onPointerDown={(event) => startGizmo(event, 'move-x')} />
              <button className="gizmo-handle gizmo-move-y" data-gizmo="move-y" title="平移 Y" onPointerDown={(event) => startGizmo(event, 'move-y')} />
            </>
          )}
          {tool === 'scale' && (
            <>
              <button className="gizmo-handle gizmo-scale-x" data-gizmo="scale-x" title="宽度" onPointerDown={(event) => startGizmo(event, 'scale-x')} />
              <button className="gizmo-handle gizmo-scale-y" data-gizmo="scale-y" title="高度" onPointerDown={(event) => startGizmo(event, 'scale-y')} />
            </>
          )}
          {tool === 'free' && (
            <>
              <button className="gizmo-handle gizmo-stretch" data-gizmo="stretch" title="缩放" onPointerDown={(event) => startGizmo(event, 'scale')} />
              <button className="gizmo-handle gizmo-move-x" data-gizmo="move-x" title="平移 X" onPointerDown={(event) => startGizmo(event, 'move-x')} />
              <button className="gizmo-handle gizmo-move-y" data-gizmo="move-y" title="平移 Y" onPointerDown={(event) => startGizmo(event, 'move-y')} />
            </>
          )}
        </div>
      )}

      {outlinePick && outlineGizmoPos && (
        <button
          className="gizmo-outline-point"
          data-gizmo="slot-outline-point"
          data-outline-kind={outlinePick.kind}
          title={outlinePick.kind === 'edge' ? '拖动移动这条轮廓边' : '拖动移动这个轮廓点'}
          style={{ left: outlineGizmoPos.x, top: outlineGizmoPos.y }}
          onPointerDown={startOutlineGizmo}
        />
      )}
      {showGuides !== false && (guides ?? []).map((guide, index) => (
        <div
          key={`${guide.axis}-${index}`}
          data-guide={`${guide.axis}:${index}`}
          title="拖动可移动；右键删除"
          style={{
            position: 'absolute', zIndex: 10, pointerEvents: 'auto',
            ...(guide.axis === 'x'
              ? { left: guide.value * view.scale + view.panX - 3, top: 0, bottom: 0, width: 7, cursor: 'ew-resize' }
              : { top: guide.value * view.scale + view.panY - 3, left: 0, right: 0, height: 7, cursor: 'ns-resize' }),
          }}
          onPointerDown={(event) => beginGuideDrag(event, index)}
          onContextMenu={(event) => deleteGuide(event, index)}
        >
          <span
            style={{
              position: 'absolute', background: '#ff9f43', pointerEvents: 'none',
              ...(guide.axis === 'x'
                ? { left: 3, top: 0, bottom: 0, width: 1 }
                : { top: 3, left: 0, right: 0, height: 1 }),
            }}
          />
        </div>
      ))}
    </div>
    </div>
  );
}







