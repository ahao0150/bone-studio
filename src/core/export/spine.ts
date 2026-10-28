/**
 * 导出 Spine（官方工具链 `Tools/src/action/toSpine.ts` 的等价物，清洁室重写）。
 *
 * **规格来源**（只读开源语料，未搬运实现）：
 *   - 骨骼：`x = t.x`、`y = -t.y`、`rotation = -t.skY`、`shearX = 0`、`shearY = -(t.skX - t.skY)`、
 *     `scaleX / scaleY` 原样；`inheritRotation / inheritScale` →
 *     `transform: normal | noScale | noRotationOrReflection | onlyTranslation`
 *   - 插槽：`color` 用 `rgbaToHex(round(rM*2.55), …)`；`blend` 由 `blendMode` 映射；`attachment` 写当前显示对象名
 *   - 图片附件（RegionAttachment）：`x`、`y = -y`、`rotation = -skY`、`scaleX / scaleY`、`name`、`path`、
 *     `width / height`（从图集切片查）
 *   - 网格附件（MeshAttachment）：`uvs / triangles / edges`（triangles 推出边 + `userEdges*2`）、`hull`
 *   - 时间轴：`time` 从 0 按 `duration / frameRate` 累加并四舍五入到 4 位；translate 的 y 取反；
 *     rotate 产出 `angle = -rotate` 且同时产出 `shear.y = -skew`；scale 原样
 *   - 曲线：末帧不写；有 `curve` 时取 `[c0, c1, c[n-2], c[n-1]]`；`tweenEasing` 是 NaN → `'stepped'`，否则 `'linear'`
 *
 * 本文件覆盖主干（骨架 / 插槽 / 皮肤 / 骨骼与插槽动画）；IK、FFD(deform)、drawOrder 见 `格式规范` §55 的边界。
 */
import type {
  DbAnimationData, DbArmatureData, DbBoneFrame, DbDisplayData, DbSkeletonData, DbSlotFrame, DbTransform,
} from '../types';

export interface SpineRegionSize {
  width: number;
  height: number;
}

export interface SpineExportOptions {
  /** Spine 元数据版本号（官方转换器默认写 3.6.52） */
  version?: string;
  /** 按显示对象的 path/name 查图集切片尺寸 */
  regionOf?: (path: string) => SpineRegionSize | null;
}

/** `rgbaToHex`：DragonBones 的 0-100 通道 → Spine 的 8 位 hex（大写）。 */
export function spineColor(color: { aM?: number; rM?: number; gM?: number; bM?: number } | undefined): string {
  const channel = (value: number | undefined) => {
    const n = Math.round((value ?? 100) * 2.55);
    return Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  };
  return `${channel(color?.rM)}${channel(color?.gM)}${channel(color?.bM)}${channel(color?.aM)}`.toUpperCase();
}

/** 官方 `inheritRotation / inheritScale` → Spine 的 `transform` 名。 */
export function spineTransformName(inheritRotation: unknown, inheritScale: unknown): string {
  const rotation = Boolean(inheritRotation);
  const scale = Boolean(inheritScale);
  if (rotation && scale) return 'normal';
  if (rotation && !scale) return 'noScale';
  if (!rotation && scale) return 'noRotationOrReflection';
  return 'onlyTranslation';
}

const BLEND: Record<string, string> = {
  normal: 'normal', add: 'additive', additive: 'additive', multiply: 'multiply', screen: 'screen',
};

/** 当前帧曲线 → Spine 的 `curve` 字段（末帧不写）。 */
export function spineCurve(frame: { curve?: number[]; tweenEasing?: number | null } | undefined, isLast: boolean): unknown {
  if (isLast || !frame) return undefined;
  const curve = frame.curve ?? [];
  if (curve.length > 0) {
    return [curve[0] || 0, curve[1] || 0, curve[curve.length - 2] || 0, curve[curve.length - 1] || 1];
  }
  return Number.isNaN(frame.tweenEasing) ? 'stepped' : 'linear';
}

const round4 = (value: number) => Number(value.toFixed(4));

/** 骨骼的绑定变换 → Spine 字段（Y 与旋转取反，shearY 由 skX/skY 之差得到）。 */
export function spineBoneTransform(bone: { transform?: DbTransform; inheritRotation?: unknown; inheritScale?: unknown; name?: string; parent?: string; length?: number }) {
  const t: DbTransform = bone.transform ?? {};
  return {
    inheritRotation: bone.inheritRotation,
    inheritScale: bone.inheritScale,
    length: bone.length,
    x: t.x,
    y: t.y === undefined ? undefined : -(t.y),
    rotation: t.skY === undefined ? undefined : -(t.skY),
    shearX: 0,
    shearY: t.skX === undefined && t.skY === undefined ? undefined : -(((t.skX ?? 0)) - ((t.skY ?? 0))),
    scaleX: t.scX,
    scaleY: t.scY,
    name: bone.name,
    parent: bone.parent,
    transform: spineTransformName(bone.inheritRotation, bone.inheritScale),
  };
}
/** 图片 / 网格显示对象 → Spine 附件。 */
export function spineAttachment(display: DbDisplayData, options: SpineExportOptions = {}): Record<string, unknown> {
  const t = display.transform ?? {};
  const size = options.regionOf?.(display.path ?? display.name ?? '') ?? null;
  const isMesh = display.type === 'mesh' || display.type === 2;
  if (isMesh) {
    const triangles = display.triangles ?? [];
    const edges: number[] = [];
    // 官方由 triangles 顺序推出边（不去重），再接上 userEdges
    for (const index of triangles) edges.push(index * 2);
    const hull = edges.length / 2;
    for (const index of display.userEdges ?? []) edges.push(index * 2);
    return {
      type: 'mesh',
      name: display.name,
      path: display.path,
      uvs: display.uvs ?? [],
      triangles,
      edges,
      hull,
      // 加权网格的 Spine 顶点展开（boneCount/boneIndex/weight）尚未实现 —— 见 docs §55 边界
      vertices: (display.weights?.length ?? 0) > 0 ? [] : (display.vertices ?? []),
      width: size?.width ?? 0,
      height: size?.height ?? 0,
    };
  }
  return {
    x: t.x,
    y: t.y === undefined ? undefined : -t.y,
    rotation: t.skY === undefined ? undefined : -t.skY,
    scaleX: t.scX,
    scaleY: t.scY,
    name: display.name,
    path: display.path,
    width: size?.width ?? 0,
    height: size?.height ?? 0,
  };
}

/** 骨骼时间轴：一个合并帧同时产出 translate / rotate / shear / scale 四个通道（官方内部就是分离的）。 */
function spineBoneTimelines(animation: DbAnimationData, frameRate: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const timeline of animation.bone ?? []) {
    const translate: unknown[] = [];
    const rotate: unknown[] = [];
    const shear: unknown[] = [];
    const scale: unknown[] = [];
    const component = (timeline.translateFrame?.length ?? 0) > 0 || (timeline.rotateFrame?.length ?? 0) > 0 || (timeline.scaleFrame?.length ?? 0) > 0;
    if (component) {
      // 5.x 组件时间轴（我们自己的 `*_ske.json` / 二进制导出就是这一形态）：每个通道各自从 0 累计时间
      let t0 = 0;
      (timeline.translateFrame ?? []).forEach((frame, index) => {
        translate.push({ time: t0, x: frame.x ?? 0, y: -(frame.y ?? 0), curve: spineCurve(frame, index === (timeline.translateFrame?.length ?? 0) - 1) });
        t0 = round4(t0 + (frame.duration ?? 0) / frameRate);
      });
      let t1 = 0;
      (timeline.rotateFrame ?? []).forEach((frame, index) => {
        const isLast = index === (timeline.rotateFrame?.length ?? 0) - 1;
        const curve = spineCurve(frame, isLast);
        rotate.push({ time: t1, angle: -(frame.rotate ?? 0), curve });
        shear.push({ time: t1, x: 0, y: -(frame.skew ?? 0), curve });
        t1 = round4(t1 + (frame.duration ?? 0) / frameRate);
      });
      let t2 = 0;
      (timeline.scaleFrame ?? []).forEach((frame, index) => {
        scale.push({ time: t2, x: frame.x ?? 1, y: frame.y ?? 1, curve: spineCurve(frame, index === (timeline.scaleFrame?.length ?? 0) - 1) });
        t2 = round4(t2 + (frame.duration ?? 0) / frameRate);
      });
      out[timeline.name] = { translate, rotate, shear, scale };
      continue;
    }
    const frames = (timeline.frame ?? []) as DbBoneFrame[];
    let time = 0;
    frames.forEach((frame, index) => {
      const isLast = index === frames.length - 1;
      const curve = spineCurve(frame, isLast);
      // 合并帧把变换放在 `transform` 里（`DbBoneFrame.transform`，含义见 docs §3）
      const t = frame.transform ?? {};
      translate.push({ time, x: t.x ?? 0, y: -(t.y ?? 0), curve });
      rotate.push({ time, angle: -(t.skY ?? 0), curve });
      shear.push({ time, x: 0, y: -((t.skX ?? 0) - (t.skY ?? 0)), curve });
      scale.push({ time, x: t.scX ?? 1, y: t.scY ?? 1, curve });
      time = round4(time + (frame.duration ?? 0) / frameRate);
    });
    out[timeline.name] = { translate, rotate, shear, scale };
  }
  return out;
}

/** 插槽时间轴：附件切换（displayFrame / 合并 frame 的 displayIndex）与颜色。 */
function spineSlotTimelines(animation: DbAnimationData, frameRate: number, skinSlotOf: (name: string) => DbDisplayData[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const timeline of animation.slot ?? []) {
    const displays = skinSlotOf(timeline.name);
    const attachment: unknown[] = [];
    const color: unknown[] = [];
    const merged = (timeline.frame ?? []) as DbSlotFrame[];
    type SlotFrameLike = { duration?: number; displayIndex?: number; color?: { aM?: number; rM?: number; gM?: number; bM?: number }; curve?: number[]; tweenEasing?: number | null };
    const displayFrames: SlotFrameLike[] = merged.length > 0
      ? merged
      : (timeline.displayFrame ?? []).map((f) => ({ duration: f.duration, displayIndex: f.value, curve: f.curve, tweenEasing: f.tweenEasing }));
    const colorFrames: SlotFrameLike[] = merged.length > 0
      ? merged
      : (timeline.colorFrame ?? []).map((f) => ({ duration: f.duration, color: f.color, curve: f.curve, tweenEasing: f.tweenEasing }));
    let time = 0;
    displayFrames.forEach((frame, index) => {
      const at = frame.displayIndex;
      attachment.push({ time, name: at === undefined || at < 0 ? '' : (displays[at]?.name ?? '') , curve: spineCurve(frame, index === displayFrames.length - 1) });
      time = round4(time + ((frame.duration ?? 0) / frameRate));
    });
    time = 0;
    colorFrames.forEach((frame, index) => {
      color.push({ time, color: spineColor(frame.color), curve: spineCurve(frame, index === colorFrames.length - 1) });
      time = round4(time + ((frame.duration ?? 0) / frameRate));
    });
    out[timeline.name] = { attachment, color };
  }
  return out;
}

export interface SpineResult {
  spines: unknown[];
  /** 官方转换器还会顺带生成 .atlas 文本；这里留给调用方用 `serializeSpineAtlas` 拼 */
  textureAtlas: string;
}

/** 单个 armature → Spine 骨架对象。 */
export function buildSpineSkeleton(armature: DbArmatureData, skeletonData: DbSkeletonData, options: SpineExportOptions = {}): Record<string, unknown> {
  const frameRate = (armature.frameRate && armature.frameRate > 0) ? armature.frameRate : (skeletonData.frameRate ?? 24);
  const defaultSkin = (armature.skin ?? [])[0];
  const slotMap: Record<string, unknown> = {};
  for (const slot of defaultSkin?.slot ?? []) {
    const attachments: Record<string, unknown> = {};
    for (const display of slot.display ?? []) {
      const key = display.name ?? display.path;
      if (key) attachments[key] = spineAttachment(display, options);
    }
    slotMap[slot.name] = attachments;
  }
  const skins: Record<string, unknown> = { [defaultSkin?.name ?? 'default']: slotMap };
  const animations: Record<string, unknown> = {};
  for (const animation of armature.animation ?? []) {
    animations[animation.name] = {
      bones: spineBoneTimelines(animation, frameRate),
      slots: spineSlotTimelines(animation, frameRate, (name) => defaultSkin?.slot.find((s) => s.name === name)?.display ?? []),
      deform: {},
      events: [],
      drawOrder: [],
    };
  }
  return {
    skeleton: {
      width: armature.aabb?.width ?? 0,
      height: armature.aabb?.height ?? 0,
      fps: frameRate,
      spine: options.version ?? '3.6.52',
      hash: ' ',
      images: './images/',
      name: armature.name,
    },
    bones: (armature.bone ?? []).map(spineBoneTransform),
    slots: (armature.slot ?? []).map((slot) => ({
      name: slot.name,
      bone: slot.parent,
      color: spineColor(slot.color),
      dark: 'FFFFFF',
      blend: BLEND[String(slot.blendMode ?? 'normal').toLowerCase()] ?? 'normal',
      attachment: '',
    })),
    ik: [],
    transform: [],
    path: [],
    skins,
    animations,
    events: [],
  };
}

/** 整个骨架文件 → `{spines, textureAtlas}`（与官方转换器同形，便于对拍）。 */
export function serializeSpineSkeleton(skeletonData: DbSkeletonData, options: SpineExportOptions = {}): SpineResult {
  return {
    spines: (skeletonData.armature ?? []).map((armature) => buildSpineSkeleton(armature, skeletonData, options)),
    textureAtlas: '',
  };
}