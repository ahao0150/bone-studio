/**
 * Spine 绑定姿态 → DB 骨骼/插槽/皮肤。
 *
 * 与 Node 版 `pipelineImport` 的差异（都是为了像素正确）：
 * - region 显示对象带上 `scX/scY = attachment.width / 原图宽`，atlas `scale: 0.5` 的资产不会
 *   只有一半大。
 * - mesh 的 uvs 从「整页归一化」换算成「区域归一化」（DB 运行时按 `region.x + u * region.width`
 *   取样）。没有图集信息（Node 的 images/ 目录）时保持原值，兼容既有导入行为。
 */
import type { SpineJson, SpineAttachment, SpineSkeleton } from './spineCommon';
import { attachmentNames, inheritFlags, r2 } from './spineCommon';

/** 一张贴图在 atlas 页里的位置（页面像素；`width/height` 是未旋转的逻辑尺寸）。 */
export interface RegionInfo {
  x: number;
  y: number;
  width: number;
  height: number;
  frameX: number;
  frameY: number;
  frameWidth: number;
  frameHeight: number;
  rotate?: number;
  pageWidth: number;
  pageHeight: number;
  /** atlas 页级 `scale:`（缺省 1） */
  scale?: number;
}

export type RegionMap = Map<string, RegionInfo>;

/** 所有 UV 是否都落在该区域在页面上的存储矩形里（±1px）。不配对时返回 false，改用顶点反推。 */
function uvsInsideRegion(uvs: number[], r: RegionInfo): boolean {
  const transposed = (((r.rotate ?? 0) % 180) + 180) % 180 === 90;
  const maxX = r.x + (transposed ? r.height : r.width);
  const maxY = r.y + (transposed ? r.width : r.height);
  for (let i = 0; i < uvs.length; i += 2) {
    const px = uvs[i] * r.pageWidth;
    const py = uvs[i + 1] * r.pageHeight;
    if (px < r.x - 1 || px > maxX + 1 || py < r.y - 1 || py > maxY + 1) return false;
  }
  return true;
}

/** 世界坐标（Spine y 向上）→ 插槽父骨骼的附件空间。 */
function attachmentSpace(runtime: SpineSkeleton, slotName: string, wx: number, wy: number): [number, number] {
  const slot = runtime.slots.find((s) => s.data.name === slotName);
  if (!slot) return [wx, wy];
  const b = slot.bone;
  const det = b.a * b.d - b.b * b.c || 1;
  const dx = wx - b.worldX;
  const dy = wy - b.worldY;
  return [(b.d * dx - b.b * dy) / det, (-b.c * dx + b.a * dy) / det];
}

/** 顶点在附件矩形里的归一化 UV（Spine 的网格顶点与纹理线性对应）。 */

/** 页面归一化 UV → 区域归一化 UV（0..1），含旋转与 trim 偏移。 */
export function pageUvToRegionUv(u: number, v: number, r: RegionInfo): [number, number] {
  const rot = (((r.rotate ?? 0) % 360) + 360) % 360;
  const transposed = rot === 90 || rot === 270;
  const storedW = transposed ? r.height : r.width;
  const storedH = transposed ? r.width : r.height;
  const sx = u * r.pageWidth - r.x;
  const sy = v * r.pageHeight - r.y;
  let lx = sx;
  let ly = sy;
  if (rot === 90) { lx = sy; ly = storedH - sx; }
  else if (rot === 180) { lx = storedW - sx; ly = storedH - sy; }
  else if (rot === 270) { lx = storedW - sy; ly = sx; }
  const frameW = r.frameWidth || r.width;
  const frameH = r.frameHeight || r.height;
  return [
    (r.frameX + lx) / frameW,
    (frameH - r.frameY - r.height + ly) / frameH,
  ];
}

interface DisplayTransform {
  x?: number;
  y?: number;
  skX?: number;
  skY?: number;
  scX?: number;
  scY?: number;
}

function mergeScale(t: DisplayTransform, scX: number, scY: number): void {
  const kx = t.scX ?? 1;
  const ky = t.scY ?? 1;
  const nx = kx * scX;
  const ny = ky * scY;
  if (Math.abs(nx - 1) > 1e-6) t.scX = +nx.toFixed(4);
  if (Math.abs(ny - 1) > 1e-6) t.scY = +ny.toFixed(4);
}

export interface BindResult {
  bone: unknown[];
  slot: unknown[];
  skin: unknown[];
}

export function convertBindPose(sk: SpineJson, runtime: SpineSkeleton, regions?: RegionMap): BindResult {
  const bone = (sk.bones ?? []).map((b) => {
    const t: DisplayTransform = {
      x: r2(b.x || 0), y: r2(-(b.y || 0)),
      ...(b.rotation ? { skX: -b.rotation - (b.shearY || 0), skY: -b.rotation } : b.shearY ? { skX: -b.shearY, skY: 0 } : {}),
      ...(b.scaleX != null && b.scaleX !== 1 ? { scX: b.scaleX } : {}),
      ...(b.scaleY != null && b.scaleY !== 1 ? { scY: b.scaleY } : {}),
    };
    return {
      name: b.name, ...(b.parent ? { parent: b.parent } : {}), length: b.length || 0,
      ...(b.inherit && b.inherit !== 'normal' ? inheritFlags(b.inherit) : b.transform && b.transform !== 'normal' ? inheritFlags(b.transform) : {}),
      transform: t,
    };
  });
  const slot = (sk.slots ?? []).map((q) => {
    const o: Record<string, unknown> = { name: q.name, parent: q.bone };
    const disp = attachmentNames(sk, q.name);
    const idx = q.attachment ? disp.indexOf(q.attachment) : -1;
    if (idx !== 0) o.displayIndex = idx;
    if (q.color && q.color.toLowerCase() !== 'ffffffff') o.color = hexToDbColor(q.color);
    if (q.blend && q.blend !== 'normal') o.blendMode = q.blend === 'additive' ? 'add' : q.blend;
    return o;
  });

  const skin = (sk.skins ?? []).map((sn) => ({
    name: sn.name ?? '',
    slot: Object.entries(sn.attachments ?? {}).map(([slotName, as]) => ({
      name: slotName,
      display: attachmentNames(sk, slotName).map((an) => buildDisplay(sk, as[an], an, slotName, runtime, regions)),
    })),
  }));
  return { bone, slot, skin };
}

function hexToDbColor(hex: string): Record<string, number> {
  const c = (i: number) => Math.round((parseInt(hex.slice(i, i + 2), 16) / 255) * 100);
  return { rM: c(0), gM: c(2), bM: c(4), aM: hex.length >= 8 ? c(6) : 100 };
}

function buildDisplay(
  sk: SpineJson,
  a: SpineAttachment | undefined,
  an: string,
  slotName: string,
  runtime: SpineSkeleton,
  regions?: RegionMap,
): Record<string, unknown> {
  if (!a) return { name: an };
  const tn = a.path ?? an;
  const type = a.type ?? 'region';
  if (type !== 'mesh' && type !== 'linkedmesh') {
    const rot = Number(a.rotation || 0);
    const t: DisplayTransform = {
      x: r2(Number(a.x || 0)),
      y: r2(-Number(a.y || 0)),
      ...(rot ? { skX: -rot, skY: -rot } : {}),
    };
    const info = regions?.get(tn);
    const fw = info?.frameWidth || Number(a.width) || 0;
    const fh = info?.frameHeight || Number(a.height) || 0;
    const aw = Number(a.width) || (info ? fw * (info.scale ?? 1) : fw);
    const ah = Number(a.height) || (info ? fh * (info.scale ?? 1) : fh);
    if (fw > 0 && fh > 0) mergeScale(t, aw / fw, ah / fh);
    mergeScale(t, Number(a.scaleX ?? 1), Number(a.scaleY ?? 1));
    return { name: tn, transform: t };
  }
  const uvs = ((a.uvs as number[] | undefined) ?? []).slice();
  const info = regions?.get(tn);
  const verts = (a.vertices as number[] | undefined) ?? [];
  const nv = uvs.length / 2;
  const triangles = a.triangles as number[] | undefined;
  const weighted = verts.length !== nv * 2;
  const vs: number[] = [];
  const ws: number[] = [];
  const world: number[] = [];
  const ap: number[] = [];
  const bonePose: number[] = [];
  if (!weighted) {
    for (let i = 0; i < nv; i++) ap.push(verts[i * 2], verts[i * 2 + 1]);
  } else {
    const usedB = new Set<number>();
    let k = 0;
    for (let v = 0; v < nv; v++) {
      const n = verts[k++];
      let x = 0;
      let y = 0;
      ws.push(n);
      for (let j = 0; j < n; j++) {
        const b = verts[k];
        const lx = verts[k + 1];
        const ly = verts[k + 2];
        const w = verts[k + 3];
        k += 4;
        const B = runtime.bones[b];
        x += (B.a * lx + B.b * ly + B.worldX) * w;
        y += (B.c * lx + B.d * ly + B.worldY) * w;
        ws.push(b, w);
        usedB.add(b);
      }
      world.push(x, y);
      vs.push(r2(x), r2(-y));
    }
    for (const b of [...usedB].sort((p, q) => p - q)) {
      const B = runtime.bones[b];
      bonePose.push(b, B.a, -B.c, -B.b, B.d, r2(B.worldX), r2(-B.worldY));
    }
  }
  if (info) {
    if (uvsInsideRegion(uvs, info)) {
      for (let i = 0; i < uvs.length; i += 2) {
        const [u, v] = pageUvToRegionUv(uvs[i], uvs[i + 1], info);
        uvs[i] = +u.toFixed(6);
        uvs[i + 1] = +v.toFixed(6);
      }
    } else {
      // JSON 与图集不配对（图集被重排过或来自另一版本）：页面 UV 没有意义，
      // 按顶点的包围盒把网格铺满区域图，至少每个部件显示的是同名图片。
      const lp: number[] = [];
      for (let i = 0; i < nv; i++) {
        if (weighted) {
          const [x, y] = attachmentSpace(runtime, slotName, world[i * 2], world[i * 2 + 1]);
          lp.push(x, y);
        } else {
          lp.push(ap[i * 2], ap[i * 2 + 1]);
        }
      }
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < lp.length; i += 2) {
        minX = Math.min(minX, lp[i]); maxX = Math.max(maxX, lp[i]);
        minY = Math.min(minY, lp[i + 1]); maxY = Math.max(maxY, lp[i + 1]);
      }
      const wspan = maxX - minX || 1;
      const hspan = maxY - minY || 1;
      for (let i = 0; i < nv; i++) {
        uvs[i * 2] = +((lp[i * 2] - minX) / wspan).toFixed(6);
        uvs[i * 2 + 1] = +((maxY - lp[i * 2 + 1]) / hspan).toFixed(6);
      }
    }
  }
  if (!weighted) {
    return { type: 'mesh', name: tn, width: a.width, height: a.height, vertices: verts.map((v, i) => r2(i % 2 ? -v : v)), uvs, triangles, edges: [], userEdges: [] };
  }
  return { type: 'mesh', name: tn, width: a.width, height: a.height, vertices: vs, uvs, triangles, weights: ws, slotPose: [1, 0, 0, 1, 0, 0], bonePose, edges: [], userEdges: [] };

}
