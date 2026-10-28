/**
 * Spine 4.x JSON 导出（4.2 默认，4.1 可选）。Spine 4.x JSON exporter (4.2 default, 4.1 optional).
 *
 * 与 `spine.ts`（3.6 形态，保留做 legacy）的区别 / differences from the 3.6 writer:
 *   - `skins` 是数组 `[{ name, attachments }]`，第一个皮肤必须叫 `default`
 *   - 骨骼时间轴值字段统一为 `value`（rotate）或 `x/y`；曲线是 bezier 数组 `[cx1,cy1,cx2,cy2]`（每通道一组，
 *     cx 为秒、cy 为通道的实际值），`"stepped"` 表示阶梯，缺省为线性
 *   - 插槽颜色时间轴叫 `rgba`
 *   - 4.2 用 `inherit`，4.1 用 `transform` 表示继承方式
 *   - 加权网格展开为 `[boneCount, boneIndex, x, y, weight, ...]`（骨骼局部坐标），非加权为插槽骨骼局部坐标
 *   - 绘制顺序（zOrder）、事件、IK 一并导出
 * 坐标系：DragonBones y 向下、顺时针为正；Spine y 向上、逆时针为正 → 世界与局部坐标 y 取反、角度取反。
 */
import type {
  DbAnimationData, DbArmatureData, DbBoneData, DbColorTransform, DbDisplayData, DbSkeletonData,
  DbTextureAtlasData, DbTransform,
} from '../types';
import { Skeleton } from '../runtime/skeleton';
import { apply, invert, matFromTransform, multiply, type Mat2D } from '../runtime/math';
import { frameProgress } from '../runtime/animation';

export type SpineTargetVersion = '4.2' | '4.1';

export interface Spine4Options {
  /** 目标版本（默认 4.2） */
  version?: SpineTargetVersion;
  /** 写进 `skeleton.spine` 的完整版本串（默认 4.2.43 / 4.1.24） */
  versionString?: string;
  /** 图集（用来查原图宽高、写 .atlas） */
  texture?: DbTextureAtlasData | null;
  /** 图片目录（`skeleton.images`） */
  images?: string;
  /**
   * 补间曲线：'auto'（默认）= 能用一段 bezier 精确表达就写 bezier，否则（多段曲线 / 余弦缓动 / 与编辑器采样表偏差 >0.002）逐帧烘焙；
   * 'bezier' = 总是写单段 bezier（旧行为，可能和编辑器预览有偏差）；'bake' = 所有非线性补间都逐帧烘焙。
   */
  curves?: 'auto' | 'bezier' | 'bake';
}

const r = (v: number, p = 4) => { const n = Number(v.toFixed(p)); return Object.is(n, -0) ? 0 : n; };
const on = (v: unknown) => v === undefined || v === null ? true : !(v === false || v === 0 || v === '0' || v === 'false');

export function spine4Color(color: DbColorTransform | undefined): string {
  const ch = (v: number | undefined) => Math.max(0, Math.min(255, Math.round((v ?? 100) * 2.55))).toString(16).padStart(2, '0');
  return `${ch(color?.rM)}${ch(color?.gM)}${ch(color?.bM)}${ch(color?.aM)}`;
}

function inheritName(bone: DbBoneData): string {
  const rot = on(bone.inheritRotation), scale = on(bone.inheritScale);
  if (rot && scale) return 'normal';
  if (rot && !scale) return 'noScale';
  if (!rot && scale) return 'noRotationOrReflection';
  return 'onlyTranslation';
}

/** DB 补间 → 归一化 bezier 控制点 [x1,y1,x2,y2]；null=线性，'stepped'=阶梯 */
export function normalizedCurve(frame: { tweenEasing?: number | null; curve?: number[] }): number[] | 'stepped' | null {
  const c = frame.curve;
  if (c && c.length >= 4) {
    if (c.length % 3 === 1 && c.length > 4) return [c[0], c[1], c[c.length - 2], c[c.length - 1]]; // 多段 → 近似首尾
    return [c[0], c[1], c[2], c[3]];
  }
  const e = frame.tweenEasing;
  if (e === null || e === undefined || e === 0) return null;
  if (Number.isNaN(e)) return 'stepped';
  if (e < 0) { const k = Math.min(1, -e); return [1 / 3, (1 / 3) * (1 - k), 2 / 3, 2 / 3 - k / 3]; }
  if (e <= 1) return [1 / 3, 1 / 3 + e / 3, 2 / 3, 2 / 3 + e / 3];
  const k = Math.min(1, e - 1); return [1 / 3, (1 / 3) * (1 - k), 2 / 3, 2 / 3 + k / 3];
}

/** 一组通道的 Spine 4 曲线：`[cx1,cy1,cx2,cy2]×通道` */
function spine4Curve(norm: number[] | 'stepped' | null, t0: number, t1: number, from: number[], to: number[]): unknown {
  if (norm === null) return undefined;
  if (norm === 'stepped') return 'stepped';
  const out: number[] = [];
  for (let i = 0; i < from.length; i++) {
    const dv = to[i] - from[i];
    out.push(r(t0 + norm[0] * (t1 - t0)), r(from[i] + norm[1] * dv), r(t0 + norm[2] * (t1 - t0)), r(from[i] + norm[3] * dv));
  }
  return out;
}

interface Key { time: number; values: number[]; norm: number[] | 'stepped' | null; bake?: { frames: number; fps: number; progress: (t: number) => number } }

/** 解析单段 bezier（端点 (0,0)/(1,1)）在 x=t 处的 y */
function bezierAt(c: number[], t: number): number {
  let lo = 0, hi = 1, y = t;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2, l = 1 - m;
    const x = 3 * l * l * m * c[0] + 3 * l * m * m * c[2] + m * m * m;
    y = 3 * l * l * m * c[1] + 3 * l * m * m * c[3] + m * m * m;
    if (x < t) lo = m; else hi = m;
  }
  return y;
}

/** 曲线导出容差（进度 0..1）：DB 运行时（采样表 / 多段 / 余弦）与 Spine 单段 bezier 的差超过它就逐帧烘焙 */
export const CURVE_BAKE_TOLERANCE = 0.002;
let curveMode: 'auto' | 'bezier' | 'bake' = 'auto';

/**
 * 判断这一帧的补间能否用一段 Spine bezier 精确表达；不能就返回逐帧烘焙用的进度函数（与编辑器预览同一套 frameProgress）。
 * 修复 rig-bot 反馈的「导出器 bezier 曲线 bug」：多段曲线以前被「近似首尾」压成一段、tweenEasing>1（余弦缓入缓出）
 * 被当成二次 bezier、陡峭曲线与 DB 的采样表差得较多 → Spine 里的动画和编辑器预览对不上。
 */
function bakeFor(frame: { duration?: number; tweenEasing?: number | null; curve?: number[] }, norm: number[] | 'stepped' | null): ((t: number) => number) | null {
  const dur = Math.max(0, Math.round(frame.duration ?? 0));
  if (norm === null || norm === 'stepped' || dur < 2 || curveMode === 'bezier') return null;
  const f = { duration: dur, tweenEasing: frame.tweenEasing, curve: frame.curve };
  const progress = (t: number) => frameProgress(f, t);
  if (curveMode === 'bake') return progress;
  for (let j = 1; j < dur * 4; j++) {
    const t = j / (dur * 4);
    if (Math.abs(progress(t) - bezierAt(norm, t)) > CURVE_BAKE_TOLERANCE) return progress;
  }
  return null;
}

/** 通用：DB 帧列表 → [{time,...values,curve}] */
function emitKeys(keys: Key[], names: string[]): Record<string, unknown>[] {
  return keys.map((k, i): Record<string, unknown>[] => {
    const o: Record<string, unknown> = {};
    if (k.time) o.time = k.time;
    names.forEach((n, j) => { if (k.values[j] !== 0 || n === 'value' || true) o[n] = r(k.values[j]); });
    const next = keys[i + 1];
    if (next && k.bake) {
      // 逐帧烘焙：每个整数帧一个线性键，值 = 编辑器运行时的缓动进度
      const out = [o];
      for (let j = 1; j < k.bake.frames; j++) {
        const p = k.bake.progress(j / k.bake.frames);
        const m: Record<string, unknown> = { time: r(k.time + j / k.bake.fps) };
        names.forEach((n, q) => { m[n] = r(k.values[q] + (next.values[q] - k.values[q]) * p); });
        out.push(m);
      }
      return out;
    }
    if (next) { const c = spine4Curve(k.norm, k.time, next.time, k.values, next.values); if (c !== undefined) o.curve = c; }
    return [o];
  }).flat();
}

function keysOf<F extends { duration?: number; tweenEasing?: number | null; curve?: number[] }>(
  frames: F[] | undefined, fps: number, values: (f: F) => number[],
): Key[] {
  const out: Key[] = [];
  let t = 0;
  for (const f of frames ?? []) {
    const norm = normalizedCurve(f);
    const progress = bakeFor(f, norm);
    out.push({ time: t / fps, values: values(f), norm, ...(progress ? { bake: { frames: Math.round(f.duration ?? 0), fps, progress } } : {}) });
    t += f.duration ?? 0;
  }
  return out;
}

function boneTimelines(anim: DbAnimationData, fps: number): Record<string, unknown> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const tl of anim.bone ?? []) {
    const e: Record<string, unknown> = {};
    const comp = (tl.translateFrame?.length ?? 0) + (tl.rotateFrame?.length ?? 0) + (tl.scaleFrame?.length ?? 0) > 0;
    if (comp) {
      if (tl.translateFrame?.length) e.translate = emitKeys(keysOf(tl.translateFrame, fps, (f) => [f.x ?? 0, -(f.y ?? 0)]), ['x', 'y']);
      if (tl.rotateFrame?.length) {
        e.rotate = emitKeys(keysOf(tl.rotateFrame, fps, (f) => [-(f.rotate ?? 0)]), ['value']);
        if (tl.rotateFrame.some((f) => (f.skew ?? 0) !== 0)) e.sheary = emitKeys(keysOf(tl.rotateFrame, fps, (f) => [-(f.skew ?? 0)]), ['value']);
      }
      if (tl.scaleFrame?.length) e.scale = emitKeys(keysOf(tl.scaleFrame, fps, (f) => [f.x ?? 1, f.y ?? 1]), ['x', 'y']);
    } else if (tl.frame?.length) {
      const fr = tl.frame as Array<{ duration?: number; transform?: DbTransform; tweenEasing?: number | null; curve?: number[] }>;
      const tf = (f: { transform?: DbTransform }) => f.transform ?? {};
      e.translate = emitKeys(keysOf(fr, fps, (f) => [tf(f).x ?? 0, -(tf(f).y ?? 0)]), ['x', 'y']);
      e.rotate = emitKeys(keysOf(fr, fps, (f) => [-(tf(f).skY ?? 0)]), ['value']);
      if (fr.some((f) => (tf(f).skX ?? 0) !== (tf(f).skY ?? 0))) e.sheary = emitKeys(keysOf(fr, fps, (f) => [-((tf(f).skX ?? 0) - (tf(f).skY ?? 0))]), ['value']);
      e.scale = emitKeys(keysOf(fr, fps, (f) => [tf(f).scX ?? 1, tf(f).scY ?? 1]), ['x', 'y']);
    }
    if (Object.keys(e).length) out[tl.name] = e;
  }
  return out;
}

function slotTimelines(anim: DbAnimationData, fps: number, displaysOf: (slot: string) => DbDisplayData[]): Record<string, unknown> {
  const out: Record<string, Record<string, unknown>> = {};
  const attName = (slot: string, idx: number | undefined) => {
    if (idx === undefined || idx === null) idx = 0;
    if (idx < 0) return null;
    const d = displaysOf(slot)[idx];
    return d ? (d.name ?? d.path ?? null) : null;
  };
  type CF = { duration?: number; tweenEasing?: number | null; curve?: number[]; value?: DbColorTransform; color?: DbColorTransform };
  for (const tl of anim.slot ?? []) {
    const e: Record<string, unknown> = {};
    let disp: Array<{ duration?: number; idx?: number }> = [];
    let cols: CF[] = [];
    if ((tl.displayFrame?.length ?? 0) || (tl.colorFrame?.length ?? 0)) {
      disp = (tl.displayFrame ?? []).map((f) => ({ duration: f.duration, idx: f.value }));
      cols = (tl.colorFrame ?? []) as CF[];
    } else if (tl.frame?.length) {
      const fr = tl.frame as Array<CF & { displayIndex?: number }>;
      disp = fr.map((f) => ({ duration: f.duration, idx: f.displayIndex }));
      if (fr.some((f) => f.color)) cols = fr;
    }
    if (disp.length) {
      let t = 0;
      e.attachment = disp.map((f) => { const o: Record<string, unknown> = { name: attName(tl.name, f.idx) }; if (t) o.time = t / fps; t += f.duration ?? 0; return o; });
    }
    if (cols.length) {
      const keys = keysOf(cols, fps, (f) => { const c = f.value ?? f.color ?? {}; return [(c.rM ?? 100) / 100, (c.gM ?? 100) / 100, (c.bM ?? 100) / 100, (c.aM ?? 100) / 100]; });
      e.rgba = keys.map((k, i) => {
        const o: Record<string, unknown> = {};
        if (k.time) o.time = k.time;
        o.color = k.values.map((v) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0')).join('');
        const next = keys[i + 1];
        if (next) { const c = spine4Curve(k.norm, k.time, next.time, k.values, next.values); if (c !== undefined) o.curve = c; }
        return o;
      });
    }
    if (Object.keys(e).length) out[tl.name] = e;
  }
  return out;
}

/** 区域原始尺寸（裁切前） */
function regionSize(tex: DbTextureAtlasData | null | undefined, name: string): { width: number; height: number; sub?: DbTextureAtlasData['SubTexture'][number] } {
  const sub = tex?.SubTexture?.find((s) => s.name === name);
  if (!sub) return { width: 0, height: 0 };
  return { width: sub.frameWidth ?? sub.width, height: sub.frameHeight ?? sub.height, sub };
}

function hullCount(display: DbDisplayData, vertexCount: number): number {
  // DB 网格的轮廓边：edges 里出现的顶点即轮廓，通常是前 N 个
  const edges = display.edges ?? [];
  if (edges.length >= 6) {
    const set = new Set(edges);
    let n = 0;
    while (set.has(n)) n++;
    if (n >= 3) return n;
  }
  return vertexCount;
}

export interface Spine4Result {
  json: Record<string, unknown>;
  atlas: string;
}

export function buildSpine4Skeleton(armature: DbArmatureData, doc: DbSkeletonData, options: Spine4Options = {}): Record<string, unknown> {
  const version = options.version ?? '4.2';
  const versionString = options.versionString ?? (version === '4.2' ? '4.2.43' : '4.1.24');
  const fps = (armature.frameRate && armature.frameRate > 0) ? armature.frameRate : (doc.frameRate ?? 24);
  const tex = options.texture ?? null;

  // 骨骼：保证父在前；记录 DB 下标 → Spine 下标
  const dbBones = armature.bone ?? [];
  const order: number[] = [];
  const placed = new Set<string>();
  let guard = 0;
  while (order.length < dbBones.length && guard++ < dbBones.length + 2) {
    dbBones.forEach((b, i) => {
      if (placed.has(b.name)) return;
      if (!b.parent || placed.has(b.parent) || !dbBones.some((x) => x.name === b.parent)) { order.push(i); placed.add(b.name); }
    });
  }
  const spIndex = new Map<number, number>(order.map((dbi, spi) => [dbi, spi]));
  const bones = order.map((i) => {
    const b = dbBones[i];
    const t = b.transform ?? {};
    const o: Record<string, unknown> = { name: b.name };
    if (b.parent) o.parent = b.parent;
    if (b.length) o.length = r(b.length);
    if (t.x) o.x = r(t.x);
    if (t.y) o.y = r(-t.y);
    if (t.skY) o.rotation = r(-t.skY);
    if (t.scX !== undefined && t.scX !== 1) o.scaleX = r(t.scX);
    if (t.scY !== undefined && t.scY !== 1) o.scaleY = r(t.scY);
    const shearY = -((t.skX ?? 0) - (t.skY ?? 0));
    if (Math.abs(shearY) > 1e-6) o.shearY = r(shearY);
    const inh = inheritName(b);
    if (inh !== 'normal') o[version === '4.2' ? 'inherit' : 'transform'] = inh;
    return o;
  });

  // 绑定世界矩阵（DB 坐标），用来把网格顶点换算到骨骼局部
  const runtime = new Skeleton(armature);
  const bindWorld: Mat2D[] = runtime.bindWorld;
  const boneIdxByName = new Map(dbBones.map((b, i) => [b.name, i]));

  // 插槽：按 z（若有）排序，否则文档顺序
  const dbSlots = [...(armature.slot ?? [])].map((s, i) => ({ s, i })).sort((a, b) => ((a.s.z ?? a.i) - (b.s.z ?? b.i)) || (a.i - b.i));
  const skinsIn = armature.skin ?? [];
  const defaultSkin = skinsIn[0];
  const displaysOf = (slot: string) => defaultSkin?.slot?.find((x) => x.name === slot)?.display ?? [];
  const slots = dbSlots.map(({ s }) => {
    const o: Record<string, unknown> = { name: s.name, bone: s.parent };
    const idx = s.displayIndex ?? 0;
    const d = idx >= 0 ? displaysOf(s.name)[idx] : undefined;
    if (d) o.attachment = d.name ?? d.path;
    if (s.color) { const c = spine4Color(s.color); if (c !== 'ffffffff') o.color = c; }
    const blend = String(s.blendMode ?? 'normal').toLowerCase();
    const map: Record<string, string> = { add: 'additive', additive: 'additive', multiply: 'multiply', screen: 'screen' };
    if (map[blend]) o.blend = map[blend];
    return o;
  });

  const attachment = (slotName: string, display: DbDisplayData): Record<string, unknown> | null => {
    const path = display.path ?? display.name ?? '';
    const size = regionSize(tex, path);
    const isMesh = display.type === 'mesh' || display.type === 2;
    const slotData = armature.slot?.find((x) => x.name === slotName);
    if (isMesh && display.vertices && display.uvs && display.triangles) {
      const vc = display.vertices.length / 2;
      const o: Record<string, unknown> = { type: 'mesh' };
      if (display.path && display.path !== display.name) o.path = display.path;
      o.uvs = display.uvs.map((v) => r(v, 6));
      o.triangles = [...display.triangles];
      const dt = display.transform && Object.keys(display.transform).length ? matFromTransform(display.transform) : null;
      const vertices: number[] = [];
      if (display.weights && display.weights.length > 0) {
        const pose = new Map<number, Mat2D>();
        const bp = display.bonePose ?? [];
        for (let i = 0; i + 6 < bp.length; i += 7) pose.set(bp[i], [bp[i + 1], bp[i + 2], bp[i + 3], bp[i + 4], bp[i + 5], bp[i + 6]]);
        const sp = display.slotPose && display.slotPose.length >= 6 ? display.slotPose as unknown as Mat2D : null;
        let k = 0;
        for (let v = 0; v < vc; v++) {
          let x = display.vertices[v * 2], y = display.vertices[v * 2 + 1];
          if (sp) [x, y] = apply(sp, x, y);
          const n = display.weights[k++];
          vertices.push(n);
          for (let j = 0; j < n; j++) {
            const bi = display.weights[k++], w = display.weights[k++];
            const bind = pose.get(bi) ?? bindWorld[bi];
            const [lx, ly] = apply(invert(bind), x, y);
            vertices.push(spIndex.get(bi) ?? bi, r(lx), r(-ly), r(w, 6));
          }
        }
      } else {
        for (let v = 0; v < vc; v++) {
          let x = display.vertices[v * 2], y = display.vertices[v * 2 + 1];
          if (dt) [x, y] = apply(dt, x, y);
          vertices.push(r(x), r(-y));
        }
      }
      o.vertices = vertices;
      o.hull = hullCount(display, vc);
      if (display.width || size.width) { o.width = display.width ?? size.width; o.height = display.height ?? size.height; }
      void slotData; void boneIdxByName;
      return o;
    }
    if (isMesh) return null;
    if (display.type !== undefined && display.type !== 'image' && display.type !== 0) return null;
    const t = display.transform ?? {};
    const w = display.width ?? size.width, h = display.height ?? size.height;
    // DB 四边形从 -pivot 开始；Spine 区域附件以中心定位
    const px = w * (display.pivot?.x ?? 0.5), py = h * (display.pivot?.y ?? 0.5);
    const local = matFromTransform(t);
    const [cx, cy] = apply(local, w / 2 - px, h / 2 - py);
    const o: Record<string, unknown> = {};
    if (display.path && display.path !== display.name) o.path = display.path;
    if (cx) o.x = r(cx);
    if (cy) o.y = r(-cy);
    if (t.skY) o.rotation = r(-t.skY);
    if (t.scX !== undefined && t.scX !== 1) o.scaleX = r(t.scX);
    if (t.scY !== undefined && t.scY !== 1) o.scaleY = r(t.scY);
    o.width = r(w, 2); o.height = r(h, 2);
    return o;
  };

  const skins = skinsIn.map((skin, si) => {
    const attachments: Record<string, Record<string, unknown>> = {};
    for (const slot of skin.slot ?? []) {
      const m: Record<string, unknown> = {};
      for (const d of slot.display ?? []) {
        const key = d.name ?? d.path;
        if (!key) continue;
        const a = attachment(slot.name, d);
        if (a) m[key] = a;
      }
      if (Object.keys(m).length) attachments[slot.name] = m;
    }
    return { name: si === 0 ? 'default' : (skin.name || `skin${si}`), attachments };
  });
  if (skins.length === 0) skins.push({ name: 'default', attachments: {} });

  // IK
  const ik = (armature.ik ?? []).map((c, i) => {
    const end = c.bone;
    const chain = c.chain ?? 0;
    const parent = dbBones.find((b) => b.name === end)?.parent;
    const list = chain >= 1 && parent ? [parent, end] : [end];
    const o: Record<string, unknown> = { name: c.name ?? `ik${i}`, order: i, bones: list, target: c.target };
    // DragonBones 是 y 向下坐标，导出 Spine（y 向上）时镜像翻转，弯曲方向随之取反
    const bendDb = c.bendPositive === undefined ? true : String(c.bendPositive) !== 'false';
    if (bendDb) o.bendPositive = false;
    if (c.weight !== undefined && c.weight !== 1) o.mix = c.weight;
    return o;
  });

  // 事件
  const eventNames = new Set<string>();
  const slotIndexDb = new Map((armature.slot ?? []).map((s, i) => [i, s.name]));
  const animations: Record<string, unknown> = {};
  for (const anim of armature.animation ?? []) {
    const a: Record<string, unknown> = {};
    const bt = boneTimelines(anim, fps); if (Object.keys(bt).length) a.bones = bt;
    const st = slotTimelines(anim, fps, displaysOf); if (Object.keys(st).length) a.slots = st;
    // drawOrder
    const zf = anim.zOrder?.frame ?? [];
    if (zf.length) {
      let t = 0;
      a.drawOrder = zf.map((f) => {
        const o: Record<string, unknown> = {};
        if (t) o.time = t / fps;
        t += f.duration ?? 0;
        const pairs = f.zOrder ?? [];
        if (pairs.length) {
          const offs: Array<{ slot: string; offset: number }> = [];
          for (let i = 0; i + 1 < pairs.length; i += 2) offs.push({ slot: slotIndexDb.get(pairs[i]) ?? String(pairs[i]), offset: pairs[i + 1] });
          o.offsets = offs;
        }
        return o;
      });
    }
    // events（动作帧里的 events）
    const evs: Record<string, unknown>[] = [];
    let t = 0;
    for (const f of anim.frame ?? []) {
      const fromActions = ((f.actions ?? []) as Array<{ name?: string; gotoAndPlay?: string; sound?: string; type?: number }>)
        .filter((x) => x.name && !x.gotoAndPlay).map((x) => ({ name: x.name as string, value: undefined as string | undefined }));
      for (const ev of [...(f.events ?? []), ...fromActions]) {
        if (!ev.name) continue;
        eventNames.add(ev.name);
        const o: Record<string, unknown> = { name: ev.name };
        if (t) o.time = t / fps;
        if (ev.value) o.string = ev.value;
        evs.push(o);
      }
      t += f.duration ?? 0;
    }
    if (evs.length) a.events = evs;
    // 保留时长：Spine 动画时长 = 最后一个关键帧；末尾无键时补一个占位 rotate 键到根骨骼
    const dur = (anim.duration ?? 0) / fps;
    if (dur > 0 && bones.length) {
      const root = String(bones[0].name);
      const ab = (a.bones ?? (a.bones = {})) as Record<string, Record<string, unknown[]>>;
      const rb = ab[root] ?? (ab[root] = {});
      const last = (arr?: unknown[]) => arr && arr.length ? Number((arr[arr.length - 1] as { time?: number }).time ?? 0) : -1;
      const maxT = Math.max(...Object.values(ab).flatMap((tl) => Object.values(tl).map(last)), -1);
      if (maxT < dur - 1e-4) {
        const rot = (rb.rotate ?? []) as Array<Record<string, unknown>>;
        const lastVal = rot.length ? Number(rot[rot.length - 1].value ?? 0) : 0;
        if (!rot.length) rot.push({ value: 0 });
        rot.push({ time: r(dur), value: lastVal });
        rb.rotate = rot;
      }
    }
    animations[anim.name] = a;
  }

  const events: Record<string, unknown> = {};
  for (const n of eventNames) events[n] = {};

  const aabb = armature.aabb;
  const out: Record<string, unknown> = {
    skeleton: {
      hash: '', spine: versionString,
      x: r(aabb?.x ?? 0), y: r(-((aabb?.y ?? 0) + (aabb?.height ?? 0))), width: r(aabb?.width ?? 0), height: r(aabb?.height ?? 0),
      fps, images: options.images ?? './images/', audio: '',
    },
    bones, slots,
  };
  if (ik.length) out.ik = ik;
  out.skins = skins;
  if (Object.keys(events).length) out.events = events;
  out.animations = animations;
  return out;
}

/** Spine 4.x `.atlas`（libGDX 新格式） */
export function serializeSpine4Atlas(tex: DbTextureAtlasData, pageName?: string): string {
  const lines: string[] = [];
  lines.push(pageName ?? tex.imagePath);
  lines.push(`size:${tex.width ?? 0},${tex.height ?? 0}`);
  lines.push('filter:Linear,Linear');
  for (const s of tex.SubTexture ?? []) {
    lines.push(s.name);
    lines.push(`bounds:${s.x},${s.y},${s.width},${s.height}`);
    if (s.frameWidth !== undefined && (s.frameWidth !== s.width || s.frameHeight !== s.height || s.frameX || s.frameY)) {
      const left = -(s.frameX ?? 0), top = -(s.frameY ?? 0);
      const bottom = (s.frameHeight ?? s.height) - s.height - top;
      lines.push(`offsets:${left},${bottom},${s.frameWidth},${s.frameHeight}`);
    }
  }
  return lines.join('\n') + '\n';
}

export function exportSpine4(doc: DbSkeletonData, options: Spine4Options & { armature?: string } = {}): Spine4Result {
  const arm = (doc.armature ?? []).find((a) => a.name === options.armature) ?? doc.armature?.[0];
  if (!arm) throw new Error('no armature');
  const prev = curveMode;
  curveMode = options.curves ?? 'auto';
  let json: Record<string, unknown>;
  try { json = buildSpine4Skeleton(arm, doc, options); } finally { curveMode = prev; }
  return { json, atlas: options.texture ? serializeSpine4Atlas(options.texture) : '' };
}

void multiply;
