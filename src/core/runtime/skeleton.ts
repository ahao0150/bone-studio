import type {
  DbAnimationData, DbArmatureData, DbColorTransform, DbDisplayData, DbIkConstraintData, DbSkinData, DbSkinSlotData, DbTransform,
} from '../types';
import type { TextureAtlas, TextureRegion } from '../parse/texture';
import {
  IDENTITY, apply, composeInherited, decomposeMatrix, matFromTransform, multiply, invert,
  type InheritFlags, type Mat2D,
} from './math';
import {
  sampleBoneTransform, sampleComponentFrames, sampleFfd, sampleIkFrames, sampleSlotTimeline,
  sampleSurface, sampleZOrder,
} from './animation';
import { solveIk } from './ik';
import { SurfaceRuntime, composeSurfaceChild } from './surface';
import { blendModePixi } from '../slotEdit';

export interface ImageRenderItem {
  kind: 'image';
  slot: string;
  region: TextureRegion;
  /** stage-space quad corners: [x0,y0, x1,y0, x1,y1, x0,y1] */
  positions: Float32Array;
  /** atlas pixel-space uvs matching `positions` */
  uvs: Float32Array;
  alpha: number;
  tint: number;
  /** Pixi v8 blend mode resolved from the slot's DragonBones blend mode */
  blend: string;
}

export interface MeshRenderItem {
  kind: 'mesh';
  slot: string;
  region: TextureRegion;
  /** stage-space vertex positions */
  positions: Float32Array;
  /** atlas pixel-space uvs */
  uvs: Float32Array;
  triangles: Uint16Array;
  alpha: number;
  tint: number;
  /** Pixi v8 blend mode resolved from the slot's DragonBones blend mode */
  blend: string;
}

export type RenderItem = ImageRenderItem | MeshRenderItem;

/**
 * Local vertex origin of an image display, expressed exactly like the official slot pivot
 * (`Slot._pivotX/_pivotY`, dragonBones57.js:5735-5748):
 *
 *     pivotX = display.pivot.x * width + frameX
 *
 * `width` is `display.width ?? region.frameWidth ?? region.width` — the vendor uses
 * `textureData.frame.width` (i.e. `frameWidth`) whenever the atlas shipped a trim rectangle,
 * and only falls back to the region size when it did not (line 5738-5739). The renderer then
 * turns the pivot into the quad origin via `anchorOffsetX = _pivotX` (line 16065), so the
 * corners start at `-pivotX`. The `frameX/frameY` term is **added** — `frame` is the trim
 * rectangle and the vendor negates the whole sum (spec §103).
 */
export function displayPivotOffset(display: DbDisplayData, region: TextureRegion): { x: number; y: number } {
  const width = display.width ?? region.frameWidth ?? region.width;
  const height = display.height ?? region.frameHeight ?? region.height;
  return {
    x: width * (display.pivot?.x ?? 0.5) + (region.frameX ?? 0),
    y: height * (display.pivot?.y ?? 0.5) + (region.frameY ?? 0),
  };
}

interface BoneRuntime {
  name: string;
  parent: number;
  /** bone length, needed by the two-bone IK solve */
  length: number;
  local: Mat2D;
  world: Mat2D;
  /** an IK solve wrote this world matrix directly; `resolveWorlds` must not recompose it */
  worldOverride?: Mat2D;
  /** inherit* switches from BoneData; all default to true (spec §14) */
  inherit: InheritFlags;
  /** present when this bone is a \`type: "surface"\` deformable grid (spec §19) */
  surface?: SurfaceRuntime;
}

interface SlotRuntime {
  name: string;
  parentBone: number;
  displayIndex: number;
  color?: DbColorTransform;
}

interface WeightedMesh {
  /** per vertex, pairs of (armature bone index, weight) */
  vertices: Array<Array<[number, number]>>;
  /** bind matrices keyed by armature bone index (JSON exports) */
  bind: Map<number, Mat2D>;
  /**
   * per vertex, per pair bind-space coordinates (*_ske.dbbin exports, which
   * bake inverse(bonePose) * slotPose * vertex instead of shipping matrices).
   */
  bindPoints?: Array<Array<[number, number]>>;
  slotBind: Mat2D;
}

function parseWeightedMesh(display: DbDisplayData, vertexCount: number): WeightedMesh | null {
  const raw = display.weights;
  if (!raw) return null;
  const vertices: Array<Array<[number, number]>> = [];
  let cursor = 0;
  for (let v = 0; v < vertexCount; v++) {
    const count = raw[cursor++];
    const pairs: Array<[number, number]> = [];
    for (let k = 0; k < count && cursor + 1 < raw.length; k++) {
      pairs.push([raw[cursor], raw[cursor + 1]]);
      cursor += 2;
    }
    vertices.push(pairs);
  }

  // `*_ske.dbbin`: bind offsets are baked per (vertex, bone) pair, no matrices
  const bindOffsets = display.bindOffsets;
  if (bindOffsets && bindOffsets.length > 0) {
    const bindPoints: Array<Array<[number, number]>> = [];
    let offset = 0;
    for (let v = 0; v < vertexCount; v++) {
      const count = bindOffsets[offset++];
      const pairs: Array<[number, number]> = [];
      for (let k = 0; k < count; k++) {
        pairs.push([bindOffsets[offset++], bindOffsets[offset++]]);
      }
      bindPoints.push(pairs);
    }
    return { vertices, bind: new Map(), bindPoints, slotBind: [...IDENTITY] };
  }

  const bonePose = display.bonePose;
  if (!bonePose) return null;
  const bind = new Map<number, Mat2D>();
  for (let i = 0; i + 6 < bonePose.length; i += 7) {
    const boneIndex = bonePose[i];
    bind.set(boneIndex, [
      bonePose[i + 1], bonePose[i + 2], bonePose[i + 3],
      bonePose[i + 4], bonePose[i + 5], bonePose[i + 6],
    ]);
  }
  const sp = display.slotPose;
  const slotBind: Mat2D = sp && sp.length >= 6
    ? [sp[0], sp[1], sp[2], sp[3], sp[4], sp[5]]
    : [...IDENTITY];
  return { vertices, bind, slotBind };
}

function nearIdentity(m: Mat2D): boolean {
  return Math.abs(m[0] - 1) < 1e-8 && Math.abs(m[1]) < 1e-8
    && Math.abs(m[2]) < 1e-8 && Math.abs(m[3] - 1) < 1e-8
    && Math.abs(m[4]) < 1e-8 && Math.abs(m[5]) < 1e-8;
}

export class Skeleton {
  readonly armature: DbArmatureData;
  readonly bones: BoneRuntime[] = [];
  readonly slots: SlotRuntime[] = [];
  readonly boneIndexByName = new Map<string, number>();
  readonly skinSlots = new Map<string, DbSkinSlotData>();
  /** 当前皮肤名（官方 `Armature.getSkin(name)`）：只影响显示对象映射，不影响骨架与动画 */
  skinName?: string;
  readonly ik: DbIkConstraintData[];
  readonly frameRate: number;

  /**
   * 绑定姿态（无动画）下每根骨骼的世界矩阵。JSON 形态的 `display.bonePose` 里显式存了这个矩阵，
   * 而 dbbin 形态把它烘进了 `bindOffsets`；网格编辑要反算烘焙点位移就得用它。
   * 语义由 tests/meshBindWorld.test.ts 用官方 JSON 的 bonePose 交叉验证。
   */
  readonly bindWorld: Mat2D[] = [];

  /**
   * 编辑期显示补偿（**不落盘**）：槽位名 → 追加在 `display.transform` 之前的矩阵。
   *
   * 官方 `StageFilterBar` 的「子图片可控」（`_1844._2968`）只作用于编辑期运行时姿态
   * （`_226/_14062.as` 第 134-145 行），而 DragonBones 的图片姿态 = 骨骼世界 × `display.transform`，
   * 其中 `display.transform` 是**跨帧的基础变换** —— 直接改数据会污染其它帧，所以这里用运行时覆盖表达。
   */
  readonly displayOverrides = new Map<string, Mat2D>();

  setDisplayOverride(slot: string, matrix: Mat2D | null): void {
    if (matrix) this.displayOverrides.set(slot, matrix);
    else this.displayOverrides.delete(slot);
  }

  /**
   * 编辑期临时绘制顺序（**不落盘**）：`order[i]` = 画在第 `i` 个位置的原始槽位下标。
   * 官方「层级」面板在动画模式下改序**不写骨架**，只落在临时缓存里，等「添加层级关键帧」
   * 旗杆才落帧（`_573/_574.as:376-392` 的 `ADD_ZORDER_FRAME_CACHE`）—— 这就是那份缓存的等价物。
   * 为 null 时按 `ZOrder(1)` 时间轴采样（`sampleZOrder`）。
   */
  zOrderOverride: number[] | null = null;

  /**
   * 编辑期临时骨骼姿态（**不落盘**）：骨骼名 → 绝对 local 变换（`x/y/skX/skY/scX/scY`）。
   *
   * 官方骨骼变换命令 `_416/_418.as:66-83` 在 `autoKey` 关时走 `_3402`，把姿态写进
   * `bone._2002`（`_51/_52.as:37,118-120,320` 的 current transform 覆盖）—— 只改当前显示、
   * 不写关键帧；`_639/_12462.as:8` 的 `propertyList` 里 `autoKey` 默认就是 false。
   * 这份 map 就是那个覆盖的等价物，实体挂在 `Player` 上（`rebuildSkeleton` 会换 Skeleton 实例）。
   */
  localOverrides = new Map<string, DbTransform>();

  private bindInverse = new Map<number, Mat2D>();

  constructor(armature: DbArmatureData, skinName?: string) {
    this.armature = armature;
    this.ik = armature.ik ?? [];
    this.frameRate = armature.frameRate ?? 24;

    armature.bone.forEach((bone, index) => {
      this.boneIndexByName.set(bone.name, index);
      const surfaceX = bone.segmentX ?? 0;
      const surfaceY = bone.segmentY ?? 0;
      const isSurface = (bone.type === 'surface' || bone.type === 1)
        && (bone.vertices?.length ?? 0) > 0 && surfaceX > 0 && surfaceY > 0;
      this.bones.push({
        name: bone.name,
        parent: bone.parent ? this.boneIndexByName.get(bone.parent) ?? -1 : -1,
        length: bone.length ?? 0,
        local: matFromTransform(bone.transform),
        world: [...IDENTITY],
        surface: isSurface ? new SurfaceRuntime(surfaceX, surfaceY, bone.vertices ?? []) : undefined,
        inherit: {
          inheritTranslation: bone.inheritTranslation,
          inheritRotation: bone.inheritRotation,
          inheritScale: bone.inheritScale,
          inheritReflection: bone.inheritReflection,
        },
      });
    });

    // the sparse export drops an empty/absent `skin`, so a skinless armature is valid
    const skins = armature.skin ?? [];
    const skin = (skinName ? skins.find((s) => s.name === skinName) : skins[0]) ?? skins[0];
    this.skinName = skin?.name;
    for (const slot of skin?.slot ?? []) this.skinSlots.set(slot.name, slot);

    for (const slot of armature.slot ?? []) {
      this.slots.push({
        name: slot.name,
        parentBone: this.boneIndexByName.get(slot.parent) ?? -1,
        displayIndex: slot.displayIndex ?? 0,
        color: slot.color,
      });
    }
    this.update(null, 0);
    // update(null, 0) 之后的 world 就是绑定姿态；快照一份，之后动画怎么跑都不影响它
    for (const bone of this.bones) this.bindWorld.push([...bone.world]);
  }

  /** Re-derive every world matrix from the local transforms, parent-first. */
  private resolveWorlds(): void {
    const resolved = new Array<Mat2D | null>(this.bones.length).fill(null);
    const resolve = (index: number): Mat2D => {
      const cached = resolved[index];
      if (cached) return cached;
      const bone = this.bones[index];
      const parentWorld = bone.parent >= 0 ? resolve(bone.parent) : null;
      const parentSurface = bone.parent >= 0 ? this.bones[bone.parent].surface ?? null : null;

      // A surface owns no transform of its own: its grid is placed through the
      // parent space, then a matrix is fitted through the deformed corners.
      if (bone.surface) {
        const anchor = parentSurface ? parentSurface.anchor : bone.parent;
        bone.surface.anchor = anchor;
        if (anchor >= 0) {
          const anchorWorld = this.bones[anchor].world;
          const scale = decomposeMatrix(anchorWorld);
          bone.surface.anchorScaleX = scale.scaleX;
          bone.surface.anchorScaleY = scale.scaleY;
        } else {
          bone.surface.anchorScaleX = 1;
          bone.surface.anchorScaleY = 1;
        }
        bone.surface.updateVertices(parentWorld, parentSurface);
        bone.surface.updateMatrix();
        bone.surface.updateHull();
        resolved[index] = bone.surface.matrix;
        bone.world = bone.surface.matrix;
        return bone.surface.matrix;
      }

      const world = bone.worldOverride ?? (parentSurface
        ? composeSurfaceChild(parentSurface, bone.local, bone.inherit)
        : parentWorld
          ? composeInherited(parentWorld, bone.local, bone.inherit)
          : bone.local);
      resolved[index] = world;
      bone.world = world;
      return world;
    };
    for (let i = 0; i < this.bones.length; i++) resolve(i);
  }

  /**
   * Runtime view of every \`type: "surface"\` grid: vertex count, the largest
   * current deform offset and the first child bone it warps. Used by the editor's
   * DEV probe so a browser check can see the deform without a texture.
   */
  surfaceInfo(): Array<{
    name: string; vertices: number; deformMax: number; child: string | null; childX: number; childY: number;
  }> {
    const out: Array<{
      name: string; vertices: number; deformMax: number; child: string | null; childX: number; childY: number;
    }> = [];
    for (let i = 0; i < this.bones.length; i++) {
      const bone = this.bones[i];
      if (!bone.surface) continue;
      let deformMax = 0;
      for (const value of bone.surface.deform) deformMax = Math.max(deformMax, Math.abs(value));
      const childIndex = this.bones.findIndex((entry) => entry.parent === i);
      const child = childIndex >= 0 ? this.bones[childIndex] : null;
      out.push({
        name: bone.name,
        vertices: Math.floor(bone.surface.base.length / 2),
        deformMax,
        child: child ? child.name : null,
        childX: child ? child.world[4] : 0,
        childY: child ? child.world[5] : 0,
      });
    }
    return out;
  }

  animationNames(): string[] {
    return (this.armature.animation ?? []).map((a) => a.name);
  }

  getAnimation(name: string | undefined): DbAnimationData | null {
    const list = this.armature.animation ?? [];
    if (list.length === 0) return null;
    return list.find((a) => a.name === name) ?? list[0];
  }

  /** Apply an animation pose at `position` (in frames, may be fractional). */
  update(animation: DbAnimationData | null, position: number): void {
    for (const bone of this.bones) bone.worldOverride = undefined;
    for (let i = 0; i < this.bones.length; i++) {
      const bone = this.bones[i];
      const timeline = animation?.bone?.find((t) => t.name === bone.name);
      // An empty timeline means "not animated" — the official runtime falls back
      // to the bind pose, so only timelines that actually carry frames count.
      // (Official 5.5/binary exports drop these empty placeholders entirely.)
      const hasFullFrames = Boolean(timeline && (timeline.frame?.length ?? 0) > 0);
      const componentPose = timeline && !hasFullFrames
        ? sampleComponentFrames(timeline, position)
        : null;
      const animated = hasFullFrames || Boolean(componentPose);
      const bind = this.armature.bone[i].transform;
      let local: Mat2D;
      if (hasFullFrames && timeline) {
        // BoneAll frames carry the same bind-relative semantics as the component
        // timelines (the official converter copies them verbatim), so compose.
        const pose = sampleBoneTransform(timeline, position);
        local = matFromTransform({
          x: (bind?.x ?? 0) + (pose.x ?? 0),
          y: (bind?.y ?? 0) + (pose.y ?? 0),
          skY: (bind?.skY ?? 0) + (pose.skY ?? 0),
          skX: (bind?.skX ?? 0) + (pose.skX ?? 0),
          scX: (bind?.scX ?? 1) * (pose.scX ?? 1),
          scY: (bind?.scY ?? 1) * (pose.scY ?? 1),
        });
      } else if (componentPose) {
        // 5.x component timelines are bind-relative offsets
        const bindX = bind?.x ?? 0;
        const bindY = bind?.y ?? 0;
        const bindSkY = bind?.skY ?? 0;
        const bindSkX = bind?.skX ?? 0;
        const bindScX = bind?.scX ?? 1;
        const bindScY = bind?.scY ?? 1;
        local = matFromTransform({
          x: bindX + componentPose.x,
          y: bindY + componentPose.y,
          skY: bindSkY + componentPose.rotation,
          skX: bindSkX + componentPose.rotation + componentPose.skew,
          scX: bindScX * componentPose.scaleX,
          scY: bindScY * componentPose.scaleY,
        });
      } else {
        local = matFromTransform(bind);
      }
      const poseOverride = this.localOverrides.get(bone.name);
      bone.local = poseOverride ? matFromTransform(poseOverride) : local;
      // bones are authored parent-first; fall back to a second pass if not
      const parent = bone.parent >= 0 ? this.bones[bone.parent] : null;
      bone.world = parent ? multiply(parent.world, bone.local) : bone.local;
    }
    // surface deform timelines feed the grids before any world matrix is resolved
    for (const bone of this.bones) {
      if (!bone.surface) continue;
      const timeline = animation?.surface?.find((entry) => entry.name === bone.name);
      const values = timeline ? sampleSurface(timeline, position, bone.surface.base.length) : null;
      if (values) {
        for (let i = 0; i < bone.surface.deform.length; i++) bone.surface.deform[i] = values[i] ?? 0;
      } else {
        bone.surface.deform.fill(0);
      }
    }
    this.resolveWorlds();
    // IK constraints run after the bone timelines, in data order (spec §13).
    if (this.ik.length > 0) {
      let overrides: Map<string, { bendPositive?: boolean; weight?: number }> | undefined;
      if (animation?.ik?.length) {
        overrides = new Map();
        for (const timeline of animation.ik) {
          const sample = sampleIkFrames(timeline.frame, position);
          if (sample) overrides.set(timeline.name, sample);
        }
      }
      solveIk(this.bones, this.ik, this.boneIndexByName, () => this.resolveWorlds(), overrides);
    }

    for (const slot of this.slots) {
      const timeline = animation?.slot?.find((t) => t.name === slot.name);
      const slotData = this.armature.slot.find((s) => s.name === slot.name);
      const sample = sampleSlotTimeline(timeline, position, slotData?.displayIndex ?? 0);
      slot.displayIndex = sample.displayIndex ?? 0;
      slot.color = sample.color ?? slotData?.color;
    }

    // bind pose inverse for weighted meshes (used on demand)
    this.bindInverse.clear();
  }

  /** 皮肤列表（官方 `Armature.skin[]`；名字可能是空串，表示默认皮肤）。 */
  skins(): Array<{ name: string; index: number; current: boolean }> {
    return (this.armature.skin ?? []).map((skin, index) => ({
      name: skin.name ?? '',
      index,
      current: (skin.name ?? '') === (this.skinName ?? ''),
    }));
  }

  currentSkin(): DbSkinData | null {
    const skins = this.armature.skin ?? [];
    return skins.find((entry) => (entry.name ?? '') === (this.skinName ?? '')) ?? skins[0] ?? null;
  }

  /**
   * 切皮肤（官方 `Armature.getDisplay(skinName, slotName, displayName)` 的运行时等价物）：
   * 只替换 `skinSlots` 映射 —— 骨架、时间轴、动画数据一律不动。
   */
  setSkin(name: string): boolean {
    const skins = this.armature.skin ?? [];
    const skin = skins.find((entry) => (entry.name ?? '') === name);
    if (!skin) return false;
    this.skinSlots.clear();
    for (const slot of skin.slot ?? []) this.skinSlots.set(slot.name, slot);
    this.skinName = skin.name;
    return true;
  }

  getRenderItems(atlas: TextureAtlas | null, animation: DbAnimationData | null, position: number): RenderItem[] {
    const items: RenderItem[] = [];
    const itemSlot: number[] = [];
    for (let slotIndex = 0; slotIndex < this.slots.length; slotIndex++) {
      const slot = this.slots[slotIndex];
      const slotData = this.armature.slot.find((s) => s.name === slot.name);
      const blend = blendModePixi(slotData?.blendMode);
      if (slot.displayIndex < 0) continue;
      const skinSlot = this.skinSlots.get(slot.name);
      const display = skinSlot?.display?.[slot.displayIndex];
      if (!display) continue;
      const regionName = display.path ?? display.name;
      const region = atlas && regionName ? atlas.byName.get(regionName) : undefined;
      if (!region) continue;
      const alpha = Math.min(1, Math.max(0, (slot.color?.aM ?? 100) / 100));
      const tint = colorToTint(slot.color);

      if (display.vertices && display.triangles && display.uvs && display.uvs.length > 0) {
        const item = this.buildMesh(slot, display, region, alpha, tint, blend, animation, position);
        if (item) { items.push(item); itemSlot.push(slotIndex); }
        continue;
      }

      const slotWorld = slot.parentBone >= 0 ? this.bones[slot.parentBone].world : IDENTITY;
      let displayMatrix = matFromTransform(display.transform);
      // 编辑期补偿（见上面 displayOverrides 的说明）：只影响渲染，不写进工程数据
      const override = this.displayOverrides.get(slot.name);
      if (override) displayMatrix = multiply(override, displayMatrix);
      // 官方 `Slot._pivotX/_pivotY` = `width * pivot + frameX`，quad 原点取其负（spec §103）
      const pivot = displayPivotOffset(display, region);
      const x0 = -pivot.x;
      const y0 = -pivot.y;
      const x1 = x0 + region.width;
      const y1 = y0 + region.height;
      const corners = [x0, y0, x1, y0, x1, y1, x0, y1];
      const positions = new Float32Array(8);
      for (let i = 0; i < 4; i++) {
        const [lx, ly] = apply(displayMatrix, corners[i * 2], corners[i * 2 + 1]);
        const [wx, wy] = apply(slotWorld, lx, ly);
        positions[i * 2] = wx;
        positions[i * 2 + 1] = wy;
      }
      items.push({
        kind: 'image',
        slot: slot.name,
        region,
        positions,
        uvs: new Float32Array([
          region.x, region.y,
          region.x + region.width, region.y,
          region.x + region.width, region.y + region.height,
          region.x, region.y + region.height,
        ]),
        alpha,
        tint,
        blend,
      });
      itemSlot.push(slotIndex);
    }
    // `ZOrder(1)`: re-emit the drawables in the authored slot order. 编辑期未落帧的
    // 临时顺序（「层级」面板）优先；没有它才按时间轴采样。
    const order = this.zOrderOverride ?? sampleZOrder(animation, position, this.slots.length);
    if (!order) return items;
    const rank = new Map<number, number>();
    order.forEach((original, at) => rank.set(original, at));
    return items
      .map((item, i) => ({ item, rank: rank.get(itemSlot[i]) ?? itemSlot[i] }))
      .sort((a, b) => a.rank - b.rank)
      .map((entry) => entry.item);
  }

  private buildMesh(
    slot: SlotRuntime,
    display: DbDisplayData,
    region: TextureRegion,
    alpha: number,
    tint: number,
    blend: string,
    animation: DbAnimationData | null,
    position: number,
  ): MeshRenderItem | null {
    const uvs = display.uvs!;
    const triangles = display.triangles!;
    const positions = this.poseMeshWorld(slot, display, animation, position);
    // 单位显示变换不改顶点，闭包样本的网格坐标保持原值。
    this.applyRigidDisplay(slot, display, positions);

    const atlasUvs = new Float32Array(uvs.length);
    for (let i = 0; i < uvs.length; i += 2) {
      atlasUvs[i] = region.x + uvs[i] * region.width;
      atlasUvs[i + 1] = region.y + uvs[i + 1] * region.height;
    }

    return {
      kind: 'mesh',
      slot: slot.name,
      region,
      positions,
      uvs: atlasUvs,
      triangles: Uint16Array.from(triangles),
      alpha,
      tint,
      blend,
    };
  }

  /**
   * Linear part of "world per slot-local" for one mesh vertex under the current pose, as
   * `[a, b, c, d]` (world = [a c; b d] * local). The editor inverts it so a stage-space drag
   * delta becomes the slot-local delta that `moveMeshVertex` expects. Returns null for the
   * baked (dbbin) form, where the local vertex list does not drive the posed position.
   */
  meshVertexJacobian(slotName: string, vertex: number): [number, number, number, number] | null {
    const slot = this.slots.find((entry) => entry.name === slotName);
    const display = this.skinSlots.get(slotName)?.display?.[slot?.displayIndex ?? 0];
    const vertices = display?.vertices;
    if (!slot || !display || !vertices) return null;
    if (display.type !== 'mesh' && display.type !== 2) return null;
    const vertexCount = Math.floor(vertices.length / 2);
    if (vertex < 0 || vertex >= vertexCount) return null;

    const weighted = parseWeightedMesh(display, vertexCount);
    if (!weighted) {
      const slotWorld = slot.parentBone >= 0 ? this.bones[slot.parentBone].world : IDENTITY;
      return this.composeDisplayJacobian(slot, display, [slotWorld[0], slotWorld[1], slotWorld[2], slotWorld[3]]);
    }
    // 两种形态都是「local → bindSpace → world」的仿射复合：JSON 用 bonePose 里的矩阵，
    // dbbin 用同一个绑定矩阵（只是它没随文件存，由 bindWorld 提供）。
    const slotPose = display.slotPose;
    const slotBind: Mat2D = slotPose && slotPose.length >= 6
      ? [slotPose[0], slotPose[1], slotPose[2], slotPose[3], slotPose[4], slotPose[5]]
      : [...IDENTITY];
    let a = 0;
    let b = 0;
    let c = 0;
    let d = 0;
    for (const [boneIndex, weight] of weighted.vertices[vertex] ?? []) {
      const bone = this.bones[boneIndex];
      const bind = weighted.bind.get(boneIndex) ?? this.bindWorld[boneIndex];
      if (!bone || !bind) continue;
      const m = multiply(multiply(bone.world, this.getBindInverse(boneIndex, bind)), slotBind);
      a += m[0] * weight;
      b += m[1] * weight;
      c += m[2] * weight;
      d += m[3] * weight;
    }
    return this.composeDisplayJacobian(slot, display, [a, b, c, d]);
  }

  /**
   * 网格在套上 `display.transform` 之前的世界坐标。
   * 和 `buildMesh` 共用，避免拨杆中心和画面各算一套。
   */
  private poseMeshWorld(
    slot: SlotRuntime,
    display: DbDisplayData,
    animation: DbAnimationData | null,
    position: number,
  ): Float32Array {
    const vertices = display.vertices!;
    const vertexCount = vertices.length / 2;
    const ffdTimeline = animation?.ffd?.find((t) => t.slot === slot.name);
    const ffd = sampleFfd(ffdTimeline, position, ffdTimeline?.offset ?? 0, vertices.length);
    const base = new Float32Array(vertices.length);
    for (let i = 0; i < vertices.length; i++) base[i] = vertices[i] + (ffd ? ffd[i] : 0);
    const positions = new Float32Array(vertices.length);
    const weighted = parseWeightedMesh(display, vertexCount);
    if (weighted) {
      const slotBind = weighted.slotBind;
      const bindSpace = new Float32Array(vertices.length);
      for (let v = 0; v < vertexCount; v++) {
        const [x, y] = apply(slotBind, base[v * 2], base[v * 2 + 1]);
        bindSpace[v * 2] = x;
        bindSpace[v * 2 + 1] = y;
      }
      for (let v = 0; v < vertexCount; v++) {
        let px = 0;
        let py = 0;
        const pairs = weighted.vertices[v] ?? [];
        for (let k = 0; k < pairs.length; k++) {
          const [boneIndex, weight] = pairs[k];
          const bone = this.bones[boneIndex];
          if (!bone) continue;
          const baked = weighted.bindPoints?.[v]?.[k];
          let x: number;
          let y: number;
          if (baked) {
            [x, y] = apply(bone.world, baked[0], baked[1]);
          } else {
            const bind = weighted.bind.get(boneIndex);
            if (!bind) continue;
            const inv = this.getBindInverse(boneIndex, bind);
            const blended = multiply(bone.world, inv);
            [x, y] = apply(blended, bindSpace[v * 2], bindSpace[v * 2 + 1]);
          }
          px += x * weight;
          py += y * weight;
        }
        positions[v * 2] = px;
        positions[v * 2 + 1] = py;
      }
      return positions;
    }
    const slotWorld = slot.parentBone >= 0 ? this.bones[slot.parentBone].world : IDENTITY;
    for (let v = 0; v < vertexCount; v++) {
      const [x, y] = apply(slotWorld, base[v * 2], base[v * 2 + 1]);
      positions[v * 2] = x;
      positions[v * 2 + 1] = y;
    }
    return positions;
  }

  /** 父骨骼空间里的刚体变换。单位矩阵直接跳过，避免浮点把闭包样本搅动。 */
  private applyRigidDisplay(slot: SlotRuntime, display: DbDisplayData, positions: Float32Array): void {
    const placed = this.displayOnParent(slot, display);
    if (!placed) return;
    const parent = slot.parentBone >= 0 ? this.bones[slot.parentBone].world : IDENTITY;
    const inv = invert(parent);
    for (let i = 0; i + 1 < positions.length; i += 2) {
      const [lx, ly] = apply(inv, positions[i], positions[i + 1]);
      const [wx, wy] = apply(placed, lx, ly);
      positions[i] = wx;
      positions[i + 1] = wy;
    }
  }

  /** `P * D`；D 为单位（含编辑期覆盖）时返回 null。 */
  private displayOnParent(slot: SlotRuntime, display: DbDisplayData): Mat2D | null {
    let displayMatrix = matFromTransform(display.transform);
    const override = this.displayOverrides.get(slot.name);
    if (override) displayMatrix = multiply(override, displayMatrix);
    if (nearIdentity(displayMatrix)) return null;
    const parent = slot.parentBone >= 0 ? this.bones[slot.parentBone].world : IDENTITY;
    return multiply(parent, displayMatrix);
  }

  private composeDisplayJacobian(
    slot: SlotRuntime,
    display: DbDisplayData,
    jacobian: [number, number, number, number],
  ): [number, number, number, number] {
    const placed = this.displayOnParent(slot, display);
    if (!placed) return jacobian;
    const parent = slot.parentBone >= 0 ? this.bones[slot.parentBone].world : IDENTITY;
    const m = multiply(placed, invert(parent));
    const [ja, jb, jc, jd] = jacobian;
    return [
      m[0] * ja + m[2] * jb,
      m[1] * ja + m[3] * jb,
      m[0] * jc + m[2] * jd,
      m[1] * jc + m[3] * jd,
    ];
  }

  /** 网格可见包围盒中心，在父骨骼局部、套显示变换之前。拨杆绕这个点缩放。 */
  meshParentLocalCenter(slotName: string): { x: number; y: number } | null {
    const slot = this.slots.find((entry) => entry.name === slotName);
    const display = this.skinSlots.get(slotName)?.display?.[slot?.displayIndex ?? 0];
    if (!slot || !display?.vertices || display.vertices.length < 2) return null;
    if (display.type !== 'mesh' && display.type !== 2) return null;
    const positions = this.poseMeshWorld(slot, display, null, 0);
    const parent = slot.parentBone >= 0 ? this.bones[slot.parentBone].world : IDENTITY;
    const inv = invert(parent);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i + 1 < positions.length; i += 2) {
      const [x, y] = apply(inv, positions[i], positions[i + 1]);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    if (!Number.isFinite(minX)) return null;
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  }

  private getBindInverse(index: number, bind: Mat2D): Mat2D {
    let inv = this.bindInverse.get(index);
    if (!inv) {
      inv = invert(bind);
      this.bindInverse.set(index, inv);
    }
    return inv;
  }
}

export function colorToTint(color: DbColorTransform | undefined): number {
  if (!color) return 0xffffff;
  const r = Math.round(Math.min(255, Math.max(0, ((color.rM ?? 100) / 100) * 255)));
  const g = Math.round(Math.min(255, Math.max(0, ((color.gM ?? 100) / 100) * 255)));
  const b = Math.round(Math.min(255, Math.max(0, ((color.bM ?? 100) / 100) * 255)));
  return (r << 16) | (g << 8) | b;
}

/**
 * 槽位当前显示对象的世界矩阵（已含编辑期 `displayOverrides` 补偿）。
 * 渲染路径与 `renderItems` 用的是同一个算式 —— 给 headless 测试与调试用。
 */
export function slotDisplayWorld(skeleton: Skeleton, slotName: string): Mat2D | null {
  const slot = skeleton.slots.find((entry) => entry.name === slotName);
  if (!slot) return null;
  const display = skeleton.currentSkin()?.slot.find((entry) => entry.name === slotName)?.display?.[slot.displayIndex];
  if (!display) return null;
  const slotWorld = slot.parentBone >= 0 ? skeleton.bones[slot.parentBone].world : IDENTITY;
  let displayMatrix = matFromTransform(display.transform);
  const override = skeleton.displayOverrides.get(slotName);
  if (override) displayMatrix = multiply(override, displayMatrix);
  return multiply(slotWorld, displayMatrix);
}

export function boneWorldMatrix(skeleton: Skeleton, name: string): Mat2D | null {
  const index = skeleton.boneIndexByName.get(name);
  if (index === undefined) return null;
  return skeleton.bones[index].world;
}








