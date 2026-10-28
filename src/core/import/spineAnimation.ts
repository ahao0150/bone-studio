/**
 * Spine 动画 → DB 关键帧（逐帧烘焙）。
 *
 * 用官方运行时把每条动画按 `fps` 采样成 DB 的 rotate/translate/scale/display/color 帧，
 * IK 与 transform 约束的结果都烘进骨骼姿态里，DB 侧不需要再求解。
 * 与 Node 版 `pipelineImport` 的采样逻辑一致，只多了进度回调。
 */
import type { SpineJson, SpineModule, SpineSkeleton, SpineSkeletonData } from './spineCommon';
import { attachmentNames, r2 } from './spineCommon';

export interface BakeOptions {
  fps?: number;
  /** 每烘焙完一条动画调用一次 */
  onProgress?: (done: number, total: number) => void;
}

export interface BakeResult {
  animation: unknown[];
  frames: number;
}

export function bakeSpineAnimations(
  spine: SpineModule,
  sk: SpineJson,
  data: SpineSkeletonData,
  runtime: SpineSkeleton,
  options: BakeOptions = {},
): BakeResult {
  const fps = options.fps ?? 24;
  const s = runtime;
  let frames = 0;
  const total = data.animations.length;
  const animation = data.animations.map((an, animIndex) => {
    const st = new spine.AnimationState(new spine.AnimationStateData(data));
    st.setAnimation(0, an.name, false);
    const n = Math.max(1, Math.round(an.duration * fps));
    frames += n + 1;
    const rec: Record<string, number[][]> = {};
    const sl: Record<string, number[][]> = {};
    for (let f = 0; f <= n; f++) {
      if (f) st.update(1 / fps);
      s.setToSetupPose();
      st.apply(s);
      s.updateWorldTransform(spine.Physics.none);
      s.bones.forEach((b) => {
        const d = b.data;
        (rec[d.name] ??= []).push([b.arotation - d.rotation, b.ax - d.x, b.ay - d.y, b.ascaleX / (d.scaleX || 1), b.ascaleY / (d.scaleY || 1)]);
      });
      s.slots.forEach((q) => {
        const a = q.getAttachment();
        const names = attachmentNames(sk, q.data.name);
        (sl[q.data.name] ??= []).push([a ? names.indexOf(a.name) : -1, q.color.r, q.color.g, q.color.b, q.color.a]);
      });
    }
    const o: Record<string, unknown> & { bone: unknown[]; slot: unknown[] } = {
      name: an.name, duration: n, playTimes: /idle|walk|run/.test(an.name) ? 0 : 1, bone: [], slot: [],
    };
    for (const [bn, rr] of Object.entries(rec)) {
      const e: Record<string, unknown> = { name: bn };
      const ch = (k: number, def: number) => rr.some((x) => Math.abs(x[k] - def) > 0.01);
      const fr = (fn: (x: number[]) => Record<string, number>) =>
        rr.map((x, i) => ({ duration: i < rr.length - 1 ? 1 : 0, tweenEasing: 0, ...fn(x) }));
      if (ch(0, 0)) e.rotateFrame = fr((x) => ({ rotate: r2(-x[0]) }));
      if (ch(1, 0) || ch(2, 0)) e.translateFrame = fr((x) => ({ x: r2(x[1]), y: r2(-x[2]) }));
      if (ch(3, 1) || ch(4, 1)) e.scaleFrame = fr((x) => ({ x: +x[3].toFixed(4), y: +x[4].toFixed(4) }));
      if (Object.keys(e).length > 1) o.bone.push(e);
    }
    for (const [sn, rr] of Object.entries(sl)) {
      const e: Record<string, unknown> = { name: sn };
      const slotJson = (sk.slots ?? []).find((q) => q.name === sn);
      const names = attachmentNames(sk, sn);
      const setup = slotJson?.attachment ? Math.max(0, names.indexOf(slotJson.attachment)) : 0;
      if (rr.some((x) => x[0] !== setup)) {
        const segs: Array<{ duration: number; value: number }> = [];
        rr.forEach((x, i) => {
          const last = segs[segs.length - 1];
          if (last && last.value === x[0] && i < rr.length - 1) last.duration++;
          else segs.push({ duration: i < rr.length - 1 ? 1 : 0, value: x[0] });
        });
        e.displayFrame = segs;
      }
      if (rr.some((x) => x.slice(1).some((c) => Math.abs(c - 1) > 0.01))) {
        e.colorFrame = rr.map((x, i) => ({
          duration: i < rr.length - 1 ? 1 : 0, tweenEasing: 0,
          value: { rM: Math.round(x[1] * 100), gM: Math.round(x[2] * 100), bM: Math.round(x[3] * 100), aM: Math.round(x[4] * 100) },
        }));
      }
      if (Object.keys(e).length > 1) o.slot.push(e);
    }
    const dro = (sk.animations?.[an.name] as { drawOrder?: Array<{ time?: number; offsets?: Array<{ slot: string; offset: number }> }> } | undefined)?.drawOrder;
    if (dro?.length) {
      const si = new Map((sk.slots ?? []).map((q, i) => [q.name, i]));
      const fr: Array<Record<string, unknown>> = [];
      const keys = dro.map((k) => ({ f: Math.round((k.time ?? 0) * fps), z: (k.offsets ?? []).flatMap((q) => [si.get(q.slot) ?? 0, q.offset]) }));
      if (keys[0].f > 0) fr.push({ duration: keys[0].f });
      keys.forEach((k, i) => {
        const nf = i < keys.length - 1 ? keys[i + 1].f : n;
        fr.push({ duration: Math.max(0, nf - k.f), ...(k.z.length ? { zOrder: k.z } : {}) });
      });
      o.zOrder = { frame: fr };
    }
    options.onProgress?.(animIndex + 1, total);
    return o;
  });
  return { animation, frames };
}
