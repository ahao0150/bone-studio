/**
 * 用官方 spine-core 4.2 运行时加载导出的 JSON，逐帧对拍 BoneStudio 运行时（node 专用）。
 * Validates a Spine 4.x export by loading it in the official @esotericsoftware/spine-core runtime and
 * comparing bone world positions and mesh / region vertices against BoneStudio's own Player.
 */
import * as spine42 from '@esotericsoftware/spine-core';

type SpineModule = typeof spine42;
let spine: SpineModule = spine42;
import { Player } from '../core/player';
import type { DbTextureAtlasData } from '../core/types';

export interface SpineValidation {
  ok: boolean;
  spineRuntime: string;
  bones: number; slots: number; skins: number; animations: Array<{ name: string; duration: number; frames: number; maxBoneError: number; maxVertexError: number; worst?: string }>;
  maxBoneError: number;
  maxVertexError: number;
}

function nullTexture(mod: SpineModule, w: number, h: number) {
  class NullTexture extends mod.Texture {
    setFilters(): void {}
    setWraps(): void {}
    dispose(): void {}
  }
  return new NullTexture({ width: w, height: h } as never);
}

export function loadSpine(json: unknown, atlasText: string, mod: SpineModule = spine42): spine42.SkeletonData {
  spine = mod;
  const atlas = new spine.TextureAtlas(atlasText);
  for (const page of atlas.pages) page.setTexture(nullTexture(mod, page.width, page.height));
  const loader = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas));
  return loader.readSkeletonData(json as never);
}

export function validateSpineExport(
  json: Record<string, unknown>, atlasText: string,
  dbDoc: unknown, dbTex: DbTextureAtlasData | null, opts: { tolerance?: number; maxFrames?: number; runtime?: unknown; runtimeName?: string } = {},
): SpineValidation {
  const mod = (opts.runtime ?? spine42) as SpineModule;
  const data = loadSpine(json, atlasText, mod);
  const sk = new spine.Skeleton(data);
  const player = new Player(JSON.parse(JSON.stringify(dbDoc)), dbTex);
  const tol = opts.tolerance ?? 1.0;
  const result: SpineValidation = {
    ok: true, spineRuntime: opts.runtimeName ?? '4.2', bones: data.bones.length, slots: data.slots.length, skins: data.skins.length,
    animations: [], maxBoneError: 0, maxVertexError: 0,
  };
  const fps = Number((json.skeleton as { fps?: number })?.fps ?? player.frameRate);
  for (const anim of data.animations) {
    player.setAnimation(anim.name);
    const frames = Math.max(1, player.duration);
    const step = Math.max(1, Math.ceil(frames / (opts.maxFrames ?? 60)));
    let mb = 0, mv = 0, n = 0; let worst = '';
    for (let f = 0; f < frames; f += step) {
      n++;
      sk.setToSetupPose();
      // spine-core 把时间存成 Float32：在关键帧边界上加一点点，和 DB 的「整帧即生效」对齐
      anim.apply(sk, 0, f / fps + 1e-5, false, [], 1, spine.MixBlend.setup, spine.MixDirection.mixIn);
      (sk.updateWorldTransform as (p?: unknown) => void)((spine as { Physics?: { none: unknown } }).Physics?.none);
      player.seek(f);
      player.applyPose();
      const items = player.renderItems();
      for (const b of sk.bones) {
        const i = player.skeleton.boneIndexByName.get(b.data.name);
        if (i === undefined) continue;
        const w = player.skeleton.bones[i].world;
        const e = Math.hypot(w[4] - b.worldX, w[5] + b.worldY);
        if (e > mb) mb = e;
      }
      for (const item of items) {
        const slot = sk.findSlot(item.slot);
        const att = slot?.getAttachment();
        if (!slot || !att) continue;
        let verts: Float32Array;
        if (att instanceof spine.MeshAttachment) {
          verts = new Float32Array(att.worldVerticesLength);
          att.computeWorldVertices(slot, 0, att.worldVerticesLength, verts, 0, 2);
        } else if (att instanceof spine.RegionAttachment) {
          verts = new Float32Array(8);
          att.computeWorldVertices(slot, verts, 0, 2);
          // spine 顺序 BL,UL,UR,BR（y 上）→ 对齐 DB 的 TL,TR,BR,BL（y 下）：比较点集的最近距离
          const P = item.positions;
          for (let k = 0; k < 4; k++) {
            let best = Infinity;
            for (let j = 0; j < 4; j++) best = Math.min(best, Math.hypot(P[k * 2] - verts[j * 2], P[k * 2 + 1] + verts[j * 2 + 1]));
            if (best > mv) { mv = best; worst = `${item.slot}@${f}`; }
          }
          continue;
        } else continue;
        const P = item.positions;
        if (P.length !== verts.length) { mv = Math.max(mv, 1e9); continue; }
        for (let k = 0; k < P.length; k += 2) {
          const e = Math.hypot(P[k] - verts[k], P[k + 1] + verts[k + 1]);
          if (e > mv) { mv = e; worst = `${item.slot}@${f}`; }
        }
      }
    }
    result.animations.push({ name: anim.name, duration: Number(anim.duration.toFixed(4)), frames: n, maxBoneError: Number(mb.toFixed(4)), maxVertexError: Number(mv.toFixed(4)), ...(worst ? { worst } : {}) });
    result.maxBoneError = Math.max(result.maxBoneError, mb);
    result.maxVertexError = Math.max(result.maxVertexError, mv);
  }
  result.ok = result.maxBoneError <= tol && result.maxVertexError <= tol;
  return result;
}
