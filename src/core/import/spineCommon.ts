/**
 * Spine 4.x JSON → DragonBones 转换的公共片段（纯逻辑，Node 与浏览器共用）。
 *
 * 只有「结构 + 调用官方运行时」这两件事在这里做；绑定姿态与动画烘焙分别在
 * spineBind / spineAnimation 里。spine-core 由调用方传入，避免把 300KB+ 的运行时
 * 静态拖进入口 chunk。
 */
import type * as SpineTypes from '@esotericsoftware/spine-core';

export type SpineModule = typeof SpineTypes;
export type SpineSkeleton = InstanceType<SpineModule['Skeleton']>;
export type SpineSkeletonData = InstanceType<SpineModule['SkeletonData']>;

export interface SpineAttachment {
  type?: string;
  path?: string;
  [key: string]: unknown;
}

export interface SpineSkin {
  name?: string;
  attachments?: Record<string, Record<string, SpineAttachment>>;
}

export interface SpineBoneJson {
  name: string;
  parent?: string;
  length?: number;
  x?: number;
  y?: number;
  rotation?: number;
  shearY?: number;
  scaleX?: number;
  scaleY?: number;
  inherit?: string;
  transform?: string;
}

export interface SpineJson {
  skeleton?: { width?: number; height?: number; fps?: number };
  bones?: SpineBoneJson[];
  slots?: Array<{ name: string; bone: string; attachment?: string; color?: string; blend?: string }>;
  skins?: SpineSkin[];
  animations?: Record<string, unknown>;
}

export const r2 = (v: number) => {
  const n = Math.round(v * 100) / 100;
  return Object.is(n, -0) ? 0 : n;
};

export function inheritFlags(mode: string): Record<string, boolean> {
  switch (mode) {
    case 'onlyTranslation': return { inheritRotation: false, inheritScale: false };
    case 'noRotationOrReflection': return { inheritRotation: false };
    case 'noScale': case 'noScaleOrReflection': return { inheritScale: false };
    default: return {};
  }
}

export function hexToDb(hex: string): Record<string, number> {
  const c = (i: number) => Math.round((parseInt(hex.slice(i, i + 2), 16) / 255) * 100);
  return { rM: c(0), gM: c(2), bM: c(4), aM: hex.length >= 8 ? c(6) : 100 };
}

/** 一个插槽在默认皮肤里的附件名（作为 DB 显示对象列表，按出现顺序；所有类型都算，保持与既有 Node 导入一致）。 */
export function attachmentNames(sk: SpineJson, slot: string): string[] {
  const out: string[] = [];
  for (const skin of sk.skins ?? []) for (const n of Object.keys(skin.attachments?.[slot] ?? {})) if (!out.includes(n)) out.push(n);
  return out;
}

/** skins 里真正需要贴图的附件（region 缺省类型也算；boundingbox/clipping/path/point 跳过），返回 `path ?? name`，去重保序。 */
export function collectTextureAttachments(sk: SpineJson): Array<{ name: string; path: string; attachment: SpineAttachment }> {
  const out: Array<{ name: string; path: string; attachment: SpineAttachment }> = [];
  const seen = new Set<string>();
  for (const skin of sk.skins ?? []) {
    for (const as of Object.values(skin.attachments ?? {})) {
      for (const [name, att] of Object.entries(as)) {
        const type = att.type ?? 'region';
        if (type !== 'region' && type !== 'mesh' && type !== 'linkedmesh') continue;
        const path = att.path ?? name;
        if (seen.has(path)) continue;
        seen.add(path);
        out.push({ name, path, attachment: att });
      }
    }
  }
  return out;
}

/**
 * 深拷贝 → 4.1 `transform` 继承字段映射成 4.2 的 `inherit` → 交给官方运行时。
 * 图集文本由调用方合成（每贴图一页），这里只挂 FakeTexture：导入只取几何，不取像素。
 */
export function loadSpineData(spine: SpineModule, json: SpineJson, atlasText: string): SpineSkeletonData {
  const forRuntime = JSON.parse(JSON.stringify(json)) as SpineJson;
  for (const b of forRuntime.bones ?? []) if (b.transform && !b.inherit) b.inherit = b.transform;
  const atlas = new spine.TextureAtlas(atlasText);
  const fake = new spine.FakeTexture(null);
  for (const page of atlas.pages) page.setTexture(fake);
  return new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(forRuntime as never);
}

/** 合成 spine-core 用的图集文本：每张贴图一页、区域占满整页。 */
export function synthAtlasText(images: Array<{ path: string; width: number; height: number }>): string {
  return images
    .map((p) => `${p.path}.png\nsize:${p.width},${p.height}\nfilter:Linear,Linear\n${p.path}\nbounds:0,0,${p.width},${p.height}\n`)
    .join('\n');
}
