/**
 * DragonBones 5.x data format types (as written by DragonBones exports).
 * Derived from the public DragonBones data format. See 格式规范.
 * Coordinates are pixels, y-down. Rotations/skews are DEGREES in JSON.
 */

export interface DbTransform {
  x?: number;
  y?: number;
  skX?: number;
  skY?: number;
  scX?: number;
  scY?: number;
}

export interface DbColorTransform {
  aM?: number; rM?: number; gM?: number; bM?: number;
  aO?: number; rO?: number; gO?: number; bO?: number;
}

export interface DbBoneData {
  name: string;
  parent?: string;
  length?: number;
  /** `"surface"` marks a deformable vertex grid (DragonBones 5.6+/Live2D import) */
  type?: number | string;
  /** surface grid segment counts; the vertex grid is `(segmentX + 1) * (segmentY + 1)` */
  segmentX?: number;
  segmentY?: number;
  /** surface grid vertices, `[x0, y0, x1, y1, ...]` (binary: moved into `floatArray`) */
  vertices?: number[];
  /** binary-only: `intArray` offset of the geometry record */
  offset?: number;
  /** official writer emits boolean `false` *or* numeric `0` for "off" */
  inheritScale?: boolean | number;
  inheritTranslation?: boolean | number;
  inheritRotation?: boolean | number;
  inheritReflection?: boolean | number;
  transform?: DbTransform;
}

export interface DbSlotData {
  name: string;
  parent: string;
  displayIndex?: number;
  /** JSON authoring form is a string name, the binary form a numeric id */
  blendMode?: number | string;
  z?: number;
  color?: DbColorTransform;
}

export type DbDisplayType = 'image' | 'mesh' | 'armature' | 'boundingBox' | number;

export interface DbDisplayData {
  name?: string;
  path?: string;
  type?: DbDisplayType;
  transform?: DbTransform;
  pivot?: { x: number; y: number };
  width?: number;
  height?: number;
  /** mesh: flat vertex list in slot space [x0,y0,x1,y1,...] */
  vertices?: number[];
  /** mesh: flat uv list, values in [0,1] relative to the sub-texture rect */
  uvs?: number[];
  /** mesh: triangle index list */
  triangles?: number[];
  edges?: number[];
  userEdges?: number[];
  /** mesh skinning: per vertex [boneCount, boneIndex, weight, ...] */
  weights?: number[];
  /** bind matrices (6 floats each) for the bones referenced by `weights` */
  bonePose?: number[];
  /**
   * `*_ske.dbbin` bind offsets (BoneStudio extension, 格式规范):
   * per vertex `[count, bx, by, bx, by, ...]` in pair order, where bx/by are the
   * bind-space coordinates of that vertex for the pair's bone. The binary stores
   * these instead of `bonePose` matrices.
   */
  bindOffsets?: number[];
  /** armature bone indices in the order they appear in the binary weight block */
  weightBones?: number[];
  /** slot bind matrix (6 floats) */
  slotPose?: number[];
  /**
   * index into the `*_ske.dbbin` intArray where this display's descriptor lives
   * (mesh vertex/triangle counts, float offset, weight offset, vertex indices).
   */
  offset?: number;
}

export interface DbSkinSlotData {
  name: string;
  display: DbDisplayData[];
}

export interface DbSkinData {
  name?: string;
  slot: DbSkinSlotData[];
}

export interface DbTweenFrame {
  /** frames (not seconds) until the next frame */
  duration: number;
  /** null/0 = linear, <0 quad-in, (0,1] quad-out, >1 quad-in-out, NaN = stepped */
  tweenEasing?: number | null;
  /** bezier control points; length % 3 === 1 means a joined multi-segment curve */
  curve?: number[];
  /** sampled easing table read from `*_ske.dbbin` (values already scaled to 0..1) */
  curveSamples?: number[];
}

export interface DbBoneFrame extends DbTweenFrame {
  transform?: DbTransform;
}

/** 5.x component bone frames (bind-relative offsets, see 格式规范). */
export interface DbBoneTranslateFrame extends DbTweenFrame { x?: number; y?: number }
export interface DbBoneRotateFrame extends DbTweenFrame {
  rotate?: number;
  skew?: number;
  /** whole turns the tween adds; expanded at parse time (spec §14) */
  clockwise?: number;
}
export interface DbBoneScaleFrame extends DbTweenFrame { x?: number; y?: number }

export interface DbBoneTimeline {
  name: string;
  frame?: DbBoneFrame[];
  /** Spine-style component timelines (accepted on import) */
  rotate?: Array<{ time: number; angle: number; curve?: unknown }>;
  translate?: Array<{ time: number; x: number; y: number; curve?: unknown }>;
  scale?: Array<{ time: number; x: number; y: number; curve?: unknown }>;
  /** DragonBones 5.x component timelines: bind-relative offsets (binary + `new` export) */
  translateFrame?: DbBoneTranslateFrame[];
  rotateFrame?: DbBoneRotateFrame[];
  scaleFrame?: DbBoneScaleFrame[];
  /** set by the `.dbbin` decoder: rotations already carry the `clockwise` turns */
  rotateExpanded?: boolean;
}

export interface DbSlotFrame extends DbTweenFrame {
  displayIndex?: number;
  color?: DbColorTransform;
}

/** 5.x component slot frames: display switching (stepped) and colour tweens. */
export interface DbSlotDisplayFrame extends DbTweenFrame { value?: number }
export interface DbSlotColorFrame extends DbTweenFrame {
  value?: DbColorTransform;
  color?: DbColorTransform;
}

export interface DbSlotTimeline {
  name: string;
  /** Spine/4.x single-track form (`displayIndex` + `color` on one frame list) */
  frame?: DbSlotFrame[];
  /** DragonBones 5.x / binary component form */
  displayFrame?: DbSlotDisplayFrame[];
  colorFrame?: DbSlotColorFrame[];
}

export interface DbFfdFrame extends DbTweenFrame {
  /** index into the deform value list where this frame's window starts */
  offset?: number;
  vertices?: number[];
}

/**
 * 5.x z-order timeline (`TimelineType.ZOrder` = 1). The authoring JSON stores
 * `zOrder` as `[slotIndex, offset, ...]` pairs; the binary stores the resulting
 * slot permutation one entry per slot.
 */
export interface DbZOrderFrame extends DbTweenFrame {
  /** authoring form: `[slotIndex, zOrderOffset, ...]` pairs */
  zOrder?: number[];
  /** decoded binary form: original slot index occupying each draw position */
  order?: number[];
}

export interface DbZOrderTimeline {
  frame?: DbZOrderFrame[];
}

/** 5.x IK constraint timeline (binary `TimelineType.IKConstraint` = 30). */
export interface DbIkFrame extends DbTweenFrame {
  bendPositive?: boolean;
  /** 0..1; the binary stores \`round(weight * 100)\` */
  weight?: number;
}

export interface DbIkTimeline {
  name: string;
  scale?: number;
  offset?: number;
  frame?: DbIkFrame[];
}

/**
 * 5.6 surface bone timeline (`TimelineType.Surface` = 50). The deform axis is
 * the surface's own vertex list; a key frame stores one window of it.
 */
export interface DbSurfaceFrame extends DbFfdFrame {
  /** authoring form: the full per-vertex deform axis */
  value?: number[];
}

export interface DbSurfaceTimeline {
  name: string;
  scale?: number;
  /** binary-only: `timelineArray` offset of the emitted record */
  offset?: number;
  frame?: DbSurfaceFrame[];
  /** shared constant head/tail of the deform axis (see `DbFfdTimeline`) */
  axisHead?: number[];
  axisTail?: number[];
}

export interface DbFfdTimeline {
  /** mesh display name inside the skin (`folder/name`) */
  name?: string;
  skin?: string;
  slot: string;
  scale?: number;
  offset?: number;
  frame?: DbFfdFrame[];
  /**
   * Constant deform values the official writer factors out of the axis: the head
   * covers indices `[0, begin)` and the tail `[begin + valueCount, count)`.
   * Dropping them silently changes playback whenever a border vertex deforms.
   */
  axisHead?: number[];
  axisTail?: number[];
}

export interface DbActionEvent {
  name: string;
  value?: string;
  time?: number;
}

export interface DbActionFrame extends DbTweenFrame {
  events?: DbActionEvent[];
  gotoAndPlay?: string;
  /** 5.x authoring form: raw action objects (collected into `armature.actions`) */
  actions?: unknown[];
}

export interface DbAnimationData {
  name: string;
  duration: number;
  playTimes?: number;
  bone?: DbBoneTimeline[];
  slot?: DbSlotTimeline[];
  ffd?: DbFfdTimeline[];
  /** surface deform timelines (authoring side of the binary `timeline` array) */
  surface?: DbSurfaceTimeline[];
  /** IK constraint timelines, keyed by the constraint name */
  ik?: DbIkTimeline[];
  /** slot draw-order timeline */
  zOrder?: DbZOrderTimeline;
  frame?: DbActionFrame[];
}

export interface DbAabb {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DbIkConstraintData {
  name: string;
  bone: string;
  target: string;
  chain?: number;
  /** authoring form may be a string (`"false"`, `"0"`) — see `parseBoolean` */
  bendPositive?: boolean | number | string;
  weight?: number;
  /** parsed from the JSON key `scale`; controls whether the chain keeps scale */
  scale?: boolean;
}

export interface DbArmatureData {
  name: string;
  type?: string | number;
  frameRate?: number;
  aabb?: DbAabb;
  bone: DbBoneData[];
  slot: DbSlotData[];
  skin: DbSkinData[];
  ik?: DbIkConstraintData[];
  animation?: DbAnimationData[];
  defaultActions?: Array<{ gotoAndPlay?: string }>;
}

export interface DbSkeletonData {
  name?: string;
  version?: string;
  compatibleVersion?: string;
  frameRate?: number;
  isGlobal?: number | boolean;
  armature: DbArmatureData[];
}

export interface DbSubTexture {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  frameX?: number;
  frameY?: number;
  frameWidth?: number;
  frameHeight?: number;
}

export interface DbTextureAtlasData {
  name?: string;
  imagePath: string;
  width?: number;
  height?: number;
  SubTexture: DbSubTexture[];
}

export interface BoneStudioProject {
  /** format marker for the editor's own project file */
  format: 'bone-studio-project';
  formatVersion: 1;
  skeleton: DbSkeletonData;
  textures: DbTextureAtlasData[];
  /** imagePath -> data URL or absolute path */
  images: Record<string, string>;
}










