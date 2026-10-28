/**
 * 资产流水线导入（node 专用）：把 asset-canvas 生成的角色包转成 BoneStudio 可编辑工程。
 * Pipeline importer: turns asset-canvas character packages into BoneStudio projects.
 *
 *   - DragonBones 目录（`*_ske.json` + `*_tex.json` + `*_tex.png`，toDB.js 产物）→ 原样载入
 *   - Spine 目录（`skeleton.json` + `images/*.png`，4.0–4.2）→ 用官方 spine-core 运行时逐帧采样成 DB 关键帧
 *   - 分层数据（`layers.json` = {width,height,layers:[{name,file,left,top,width,height}]}）→ 未绑定的分层工程
 *   - 角色根目录（`chars/<id>`）→ 自动挑 `out/*_dragonbones`，再退到 `out/*_spine`，再退到 `layers.json`
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import * as spine from '@esotericsoftware/spine-core';
import { packAtlas, serializeTextureAtlas } from '../core/export/atlas';
import type { DbSkeletonData, DbTextureAtlasData } from '../core/types';
import { convertSpineRuntime } from '../core/import/spineConvert';
import { collectTextureAttachments, r2, synthAtlasText, type SpineJson } from '../core/import/spineCommon';
import { blitRaster, decodePng, encodePng, type RasterImage } from './png';

export interface ImportedPackage {
  name: string;
  source: 'dragonbones' | 'spine' | 'layers';
  from: string;
  ske: DbSkeletonData;
  tex: DbTextureAtlasData;
  png: Uint8Array;
}


function packImages(name: string, images: Array<{ name: string; img: RasterImage }>): { tex: DbTextureAtlasData; png: Uint8Array } {
  const packed = packAtlas(images.map((i) => ({ name: i.name, width: i.img.width, height: i.img.height })), { padding: 2, maxWidth: 2048 });
  const page: RasterImage = { width: packed.width, height: packed.height, rgba: new Uint8Array(packed.width * packed.height * 4) };
  packed.placements.forEach((p, k) => blitRaster(page, images[k].img, p.x, p.y));
  const tex = serializeTextureAtlas(packed, { imagePath: `${name}_tex.png`, name });
  return { tex, png: encodePng(page) };
}

export function importDragonBonesDir(dir: string, name?: string): ImportedPackage {
  const files = readdirSync(dir);
  const ske = files.find((f) => /_ske\.json$/i.test(f));
  if (!ske) throw new Error(`no *_ske.json in ${dir}`);
  const stem = ske.replace(/_ske\.json$/i, '');
  const texFile = files.find((f) => f === `${stem}_tex.json`) ?? files.find((f) => /_tex\.json$/i.test(f));
  if (!texFile) throw new Error(`no *_tex.json in ${dir}`);
  const tex = JSON.parse(readFileSync(join(dir, texFile), 'utf8')) as DbTextureAtlasData;
  const pngFile = files.includes(tex.imagePath) ? tex.imagePath : files.find((f) => /_tex\.png$/i.test(f));
  if (!pngFile) throw new Error(`no atlas png in ${dir}`);
  const n = name ?? stem;
  return {
    name: n, source: 'dragonbones', from: dir,
    ske: JSON.parse(readFileSync(join(dir, ske), 'utf8')), tex: { ...tex, imagePath: `${n}_tex.png` },
    png: readFileSync(join(dir, pngFile)),
  };
}

/** Spine JSON（4.x）+ images → DB 工程。转换逻辑在 src/core/import/，与浏览器导入共用。 */
export function importSpineDir(dir: string, name?: string, fps = 24): ImportedPackage {
  const jsonFile = existsSync(join(dir, 'skeleton.json')) ? 'skeleton.json' : readdirSync(dir).find((f) => f.endsWith('.json') && !/log/i.test(f));
  if (!jsonFile) throw new Error(`no skeleton json in ${dir}`);
  const sk = JSON.parse(readFileSync(join(dir, jsonFile), 'utf8')) as SpineJson;
  const imgDir = join(dir, 'images');
  const images = new Map<string, RasterImage>();
  for (const t of collectTextureAttachments(sk)) {
    const f = join(imgDir, `${t.path}.png`);
    if (existsSync(f)) images.set(t.path, decodePng(readFileSync(f)));
  }
  const NAME = name ?? basename(dir).replace(/_spine$/, '');
  // 每张贴图一页，官方运行时只需要 region 名与尺寸（像素从 images/ 来，不从这张合成图集来）
  const atlasText = synthAtlasText([...images.entries()].map(([p, img]) => ({ path: p, width: img.width, height: img.height })));
  const result = convertSpineRuntime(spine, sk, atlasText, { name: NAME, fps });
  const used = result.textures.filter((p) => images.has(p)).map((p) => ({ name: p, img: images.get(p)! }));
  const { tex, png } = packImages(NAME, used);
  return { name: NAME, source: 'spine', from: dir, ske: result.ske, tex, png };
}


/** 分层 PNG + layers.json → 未绑定的分层工程（root 骨骼 + 每层一个槽位，原点在画布底边中点）。 */
export function importLayersJson(file: string, name?: string): ImportedPackage {
  const meta = JSON.parse(readFileSync(file, 'utf8')) as { width: number; height: number; layers: Array<{ name: string; file?: string; url?: string; left: number; top: number; width: number; height: number }> };
  const base = file.replace(/[^/\\]+$/, '');
  const NAME = name ?? basename(base.replace(/[/\\]$/, ''));
  const imgs: Array<{ name: string; img: RasterImage }> = [];
  const slot: unknown[] = [], skinSlots: unknown[] = [];
  meta.layers.forEach((l, i) => {
    const rel = l.url ?? join('layers', l.file ?? `${l.name}.png`);
    const path = join(base, rel);
    if (!existsSync(path)) return;
    const img = decodePng(readFileSync(path));
    const tn = `${String(i).padStart(2, '0')}_${l.name}`;
    imgs.push({ name: tn, img });
    slot.push({ name: tn, parent: 'root' });
    skinSlots.push({ name: tn, display: [{ name: tn, transform: { x: r2(l.left + img.width / 2 - meta.width / 2), y: r2(l.top + img.height / 2 - meta.height) } }] });
  });
  const { tex, png } = packImages(NAME, imgs);
  const ske = {
    frameRate: 24, name: NAME, version: '5.5', compatibleVersion: '5.5',
    armature: [{ type: 'Armature', frameRate: 24, name: 'armature', aabb: { x: -meta.width / 2, y: -meta.height, width: meta.width, height: meta.height }, bone: [{ name: 'root', transform: {} }], slot, skin: [{ name: '', slot: skinSlots }], animation: [{ name: 'idle', duration: 24, playTimes: 0, bone: [], slot: [] }], defaultActions: [{ gotoAndPlay: 'idle' }] }],
  } as unknown as DbSkeletonData;
  return { name: NAME, source: 'layers', from: file, ske, tex, png };
}

/** 自动识别：DB 目录 / Spine 目录 / layers.json / 角色根目录 */
export function importCharacter(path: string, opts: { name?: string; prefer?: 'dragonbones' | 'spine' | 'layers' } = {}): ImportedPackage {
  if (!existsSync(path)) throw new Error(`no such path: ${path}`);
  if (statSync(path).isFile()) {
    if (/layers.*\.json$/i.test(path)) return importLayersJson(path, opts.name);
    if (/_ske\.json$/i.test(path)) return importDragonBonesDir(path.replace(/[^/\\]+$/, ''), opts.name);
    return importSpineDir(path.replace(/[^/\\]+$/, ''), opts.name);
  }
  const files = readdirSync(path);
  if (files.some((f) => /_ske\.json$/i.test(f))) return importDragonBonesDir(path, opts.name);
  if (files.includes('skeleton.json')) return importSpineDir(path, opts.name);
  const id = basename(path);
  const out = join(path, 'out');
  const dirs = existsSync(out) ? readdirSync(out).filter((d) => statSync(join(out, d)).isDirectory()) : [];
  const db = dirs.find((d) => /_dragonbones$/.test(d) && !/editor/.test(d));
  const sp = dirs.find((d) => /_spine$/.test(d));
  const prefer = opts.prefer ?? 'dragonbones';
  if (prefer === 'layers' && existsSync(join(path, 'layers.json'))) return importLayersJson(join(path, 'layers.json'), opts.name ?? id);
  if (prefer === 'spine' && sp) return importSpineDir(join(out, sp), opts.name ?? id);
  if (db) return importDragonBonesDir(join(out, db), opts.name ?? id);
  if (sp) return importSpineDir(join(out, sp), opts.name ?? id);
  if (existsSync(join(path, 'layers.json'))) return importLayersJson(join(path, 'layers.json'), opts.name ?? id);
  throw new Error(`nothing importable in ${path}`);
}
