/**
 * Spine JSON → DragonBones 5.5 的编排器（纯逻辑）：绑定姿态 + 动画烘焙 + 文档组装。
 * Node 的 `pipelineImport` 与浏览器导入器共用这一条转换路径。
 */
import type { DbSkeletonData } from '../types';
import type { SpineJson, SpineModule } from './spineCommon';
import { collectTextureAttachments, loadSpineData } from './spineCommon';
import { convertBindPose, type RegionMap } from './spineBind';
import { bakeSpineAnimations } from './spineAnimation';

export interface SpineConvertOptions {
  name: string;
  fps?: number;
  onProgress?: (done: number, total: number) => void;
  /** 图集区域信息：给了才会重算 mesh UV、修正 region 显示尺寸 */
  regions?: RegionMap;
}

export interface SpineConvertResult {
  ske: DbSkeletonData;
  /** skin 实际引用的贴图路径（`path ?? name`，去重保序） */
  textures: string[];
  animations: number;
  /** 采样出的总帧数（含每条动画的起始帧） */
  frames: number;
  warnings: string[];
}

export function convertSpineRuntime(
  spine: SpineModule,
  sk: SpineJson,
  atlasText: string,
  options: SpineConvertOptions,
): SpineConvertResult {
  const fps = options.fps ?? 24;
  const data = loadSpineData(spine, sk, atlasText);
  const runtime = new spine.Skeleton(data);
  runtime.setToSetupPose();
  runtime.updateWorldTransform(spine.Physics.none);

  const bind = convertBindPose(sk, runtime, options.regions);
  const baked = bakeSpineAnimations(spine, sk, data, runtime, { fps, onProgress: options.onProgress });
  const textures = collectTextureAttachments(sk).map((t) => t.path);

  const warnings: string[] = [];
  const anims = Object.values(sk.animations ?? {}) as Array<Record<string, unknown>>;
  if (anims.some((a) => a.deform || a.attachments)) warnings.push('deform / 换装时间轴未导入');
  if (collectTextureAttachments(sk).some((t) => t.attachment.type === 'linkedmesh')) warnings.push('linkedmesh 按普通网格导入');

  const W = sk.skeleton?.width ?? 0;
  const H = sk.skeleton?.height ?? 0;
  const ske = {
    frameRate: fps,
    name: options.name,
    version: '5.5',
    compatibleVersion: '5.5',
    armature: [{
      type: 'Armature', frameRate: fps, name: 'armature',
      aabb: { x: -W / 2, y: -H, width: W, height: H },
      bone: bind.bone, slot: bind.slot, skin: bind.skin, animation: baked.animation,
      defaultActions: [{ gotoAndPlay: (baked.animation[0] as { name?: string } | undefined)?.name ?? '' }],
    }],
  } as unknown as DbSkeletonData;

  return { ske, textures, animations: baked.animation.length, frames: baked.frames, warnings };
}

/** 只做结构识别，供 UI 在加载重型编排器之前判断文件类型。 */
export { classifyJsonFile } from './spineDetect';
