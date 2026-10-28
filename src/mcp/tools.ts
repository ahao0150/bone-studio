/**
 * MCP tool implementations. Each returns a JSON-serialisable payload; the transport layer
 * (`server.ts`) wraps it into MCP `content`. Kept separate so the tools can be unit-tested
 * without spinning up the server.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import { Player } from '../core/player';
import {
  keyFrames, meshWeightBones, removeKeyFrame, renameBone, restoreArmature, sampleTransform,
  setBoneTransform, snapshotArmature,
} from '../core/editing';
import { addBone, removeBone, setBoneLength, setBoneParent } from '../core/boneEdit';
import { capture, historyInfo, pushUndo, restore, stacksOf, type HistEntry, type HistItem } from './history';
import { setBoneBind, type BindPatch } from '../core/bindCompensate';
import { findMesh, meshEdges, readMesh } from '../core/meshEdit';
import { serializeSkeletonData } from '../core/parse/ske';
import { decodeDbbin } from '../core/parse/dbbinDecode';
import { encodeDbbin } from '../core/export/dbbin';
import type { DbSkeletonData } from '../core/types';
import { registerBuiltinCapabilities } from '../ai/capabilities';
import { applyAiCommands, planAiCommands } from '../ai/pluginApi';

export interface EditorState {
  player: Player | null;
  path: string;
  /** 会话历史（撤销 / 重做）快照栈；调用方不必初始化，第一个写操作会自建 */
  undo?: HistItem[];
  redo?: HistItem[];
  /** 因上限 / 内存预算被挤掉的最旧步数 */
  undoDropped?: number;
}

function requirePlayer(state: EditorState): Player {
  if (!state.player) throw new Error('no project open — call open_project first');
  return state.player;
}

function readDoc(file: string): DbSkeletonData {
  if (!existsSync(file)) throw new Error(`no such file: ${file}`);
  const bytes = readFileSync(file);
  return extname(file).toLowerCase() === '.dbbin'
    ? (decodeDbbin(bytes).json as DbSkeletonData)
    : (JSON.parse(bytes.toString('utf8')) as DbSkeletonData);
}

export function openProject(state: EditorState, args: { file: string; texture?: string; armature?: string; animation?: string }): unknown {
  const doc = readDoc(args.file);
  const textureJson = args.texture && existsSync(args.texture)
    ? (JSON.parse(readFileSync(args.texture, 'utf8')) as never)
    : null;
  const player = new Player(doc, textureJson);
  if (args.armature) player.setArmature(args.armature);
  if (args.animation) player.setAnimation(args.animation);
  state.player = player;
  state.path = args.file;
  return summaryOf(state);
}

export function summaryOf(state: EditorState): unknown {
  const player = requirePlayer(state);
  const armature = player.skeleton.armature;
  const skin = armature.skin?.[0];
  return {
    file: state.path,
    armature: armature.name,
    bones: armature.bone.length,
    slots: armature.slot?.length ?? 0,
    skins: armature.skin?.length ?? 0,
    displays: (skin?.slot ?? []).reduce((total, slot) => total + (slot.display?.length ?? 0), 0),
    ik: armature.ik?.length ?? 0,
    frameRate: player.frameRate,
    currentAnimation: player.animation?.name ?? null,
    animations: (armature.animation ?? []).map((animation) => ({
      name: animation.name,
      duration: animation.duration,
      bones: (animation.bone ?? []).length,
    })),
  };
}

export function bonesList(state: EditorState): unknown {
  const player = requirePlayer(state);
  const rows = player.skeleton.bones.map((bone, index) => ({
    index,
    name: bone.name,
    parent: bone.parent >= 0 ? player.skeleton.bones[bone.parent].name : null,
    length: Math.round(bone.length * 1000) / 1000,
    bind: player.skeleton.armature.bone[index]?.transform ?? {},
  }));
  return { count: rows.length, bones: rows };
}

export function animationsList(state: EditorState): unknown {
  const player = requirePlayer(state);
  return {
    current: player.animation?.name ?? null,
    names: player.animationNames(),
    duration: player.duration,
    frameRate: player.frameRate,
  };
}

export function boneTransformGet(state: EditorState, args: { bone: string; frame?: number }): unknown {
  const player = requirePlayer(state);
  const frame = args.frame ?? player.position;
  const index = player.skeleton.boneIndexByName.get(args.bone);
  if (index === undefined) throw new Error(`unknown bone: ${args.bone}`);
  return {
    bone: args.bone,
    frame,
    transform: sampleTransform(player, args.bone, frame),
    keys: keyFrames(player, args.bone).map((ref) => ref.frame),
    world: Array.from(player.skeleton.bones[index].world),
  };
}

export interface KeyframeArgs {
  bone: string;
  frame: number;
  remove?: boolean;
  transform?: Partial<{ x: number; y: number; skX: number; skY: number; scX: number; scY: number }>;
}

export function boneKeyframeSet(state: EditorState, args: KeyframeArgs): unknown {
  const player = requirePlayer(state);
  if (args.remove) {
    const snapshot = checkpoint(state);
    const removed = removeKeyFrame(player, args.bone, args.frame);
    if (!removed) rollback(state, snapshot);
    return { bone: args.bone, frame: args.frame, removed, keys: keyFrames(player, args.bone).map((ref) => ref.frame) };
  }
  // 历史缺陷：关键帧写入没进撤销栈（文档说「写入都可撤销」），history_undo 会跳过它
  const snapshot = checkpoint(state);
  const ok = setBoneTransform(player, args.bone, args.frame, args.transform ?? {});
  if (!ok) { rollback(state, snapshot); throw new Error(`could not key ${args.bone} at frame ${args.frame}`); }
  return {
    bone: args.bone,
    frame: args.frame,
    applied: args.transform ?? {},
    values: sampleTransform(player, args.bone, args.frame),
    keys: keyFrames(player, args.bone).map((ref) => ref.frame),
  };
}

export function skeletonExport(state: EditorState, args: { out: string; type?: 'json' | 'binary' }): unknown {
  const player = requirePlayer(state);
  const json = serializeSkeletonData(player.doc);
  if (args.type === 'binary') {
    const bytes = encodeDbbin(JSON.parse(json) as DbSkeletonData);
    writeFileSync(args.out, bytes);
    return { out: args.out, type: 'binary', bytes: bytes.length };
  }
  writeFileSync(args.out, json, 'utf8');
  return { out: args.out, type: 'json', bytes: json.length };
}
/* ------------------------------------------------------------------ *
 * 会话历史：撤销 / 重做
 *
 * MCP 服务是独立进程，没有 UI 的撤销栈，所以这里自己维护一份 armature 快照栈。
 * 每个写工具先 `checkpoint`，agent 因此总能回滚；失败时 `rollback` 丢弃那一步。
 * 快照用 `editing.ts` 的 `snapshotArmature` —— 与 UI 的撤销走同一套原语。
 * ------------------------------------------------------------------ */

const stacks = (state: EditorState) => stacksOf(state);

function checkpoint(state: EditorState): HistEntry | null {
  const snapshot = capture(state);
  if (!snapshot) return null;
  pushUndo(state, snapshot);
  stacks(state).redo.length = 0;
  return snapshot;
}

function rollback(state: EditorState, snapshot: HistEntry | null): void {
  if (snapshot && state.player) restore(state, snapshot);
  const { undo, redo } = stacks(state);
  if (undo.length > 0) undo.pop();
  redo.length = 0;
}

export function historyStatus(state: EditorState): unknown {
  return historyInfo(state);
}

export function historyUndo(state: EditorState): unknown {
  const player = requirePlayer(state);
  const { undo, redo } = stacks(state);
  const snapshot = undo.pop();
  if (!snapshot) return { undone: false, reason: (state.undoDropped ?? 0) > 0 ? `撤销栈已空（更早的 ${state.undoDropped} 步因上限被丢弃）` : '撤销栈是空的', ...historyInfo(state) };
  const current = capture(state);
  if (current) redo.push(current);
  restore(state, snapshot);
  return { undone: true, position: (state.player ?? player).position, ...historyInfo(state) };
}

export function historyRedo(state: EditorState): unknown {
  const player = requirePlayer(state);
  const { undo, redo } = stacks(state);
  const snapshot = redo.pop();
  if (!snapshot) return { redone: false, reason: '重做栈是空的', ...historyInfo(state) };
  const current = capture(state);
  if (current) pushUndo(state, current);
  restore(state, snapshot);
  return { redone: true, position: (state.player ?? player).position, ...historyInfo(state) };
}

/** 写工具统一收尾：结果 + 当前历史深度，agent 据此决定要不要回滚。 */
function withHistory(state: EditorState, payload: Record<string, unknown>): Record<string, unknown> {
  return { ...payload, ...(historyStatus(state) as Record<string, unknown>) };
}

/* ------------------------------------------------------------------ *
 * 结构只读
 * ------------------------------------------------------------------ */

export function bonesTree(state: EditorState): unknown {
  const player = requirePlayer(state);
  const byIndex = player.skeleton.bones;
  const rows = player.boneTree().map((entry) => {
    const bone = byIndex[entry.index];
    return {
      name: entry.name,
      depth: entry.depth,
      index: entry.index,
      parent: bone.parent >= 0 ? byIndex[bone.parent]?.name ?? null : null,
      length: Math.round(bone.length * 1000) / 1000,
      hasTimeline: entry.hasTimeline,
    };
  });
  return { count: rows.length, bones: rows };
}

export function slotsList(state: EditorState): unknown {
  const player = requirePlayer(state);
  const armature = player.skeleton.armature;
  const skin = armature.skin?.[0];
  const rows = (armature.slot ?? []).map((slot, index) => {
    const skinSlot = (skin?.slot ?? []).find((entry) => entry.name === slot.name);
    return {
      index,
      name: slot.name,
      parent: slot.parent,
      displayIndex: slot.displayIndex ?? 0,
      displays: skinSlot?.display?.length ?? 0,
      z: slot.z ?? 0,
      blendMode: slot.blendMode ?? 'normal',
      color: slot.color ?? null,
    };
  });
  return { count: rows.length, slots: rows };
}

export function animationDetail(state: EditorState, args: { animation?: string }): unknown {
  const player = requirePlayer(state);
  const armature = player.skeleton.armature;
  const wanted = args.animation ?? player.animation?.name;
  const animation = (armature.animation ?? []).find((entry) => entry.name === wanted) ?? player.animation;
  if (!animation) throw new Error(`unknown animation: ${args.animation ?? '(none)'}`);
  const bones = (animation.bone ?? []).map((timeline) => {
    let at = 0;
    const frames = (timeline.frame ?? []).map((frame) => {
      const row = {
        frame: at,
        duration: frame.duration ?? 0,
        transform: frame.transform ?? {},
        tweenEasing: frame.tweenEasing ?? null,
      };
      at += typeof frame.duration === 'number' ? frame.duration : 1;
      return row;
    });
    return { bone: timeline.name, keyCount: frames.length, frames };
  });
  // 槽位 / FFD / IK 时间轴在 JSON 与二进制形态下字段名不完全一致，这里只取名字与键数。
  const tally = (list: unknown): Array<{ name: string; keys: number }> =>
    (Array.isArray(list) ? list : []).map((entry) => {
      const item = entry as { name?: string; slot?: string; frame?: unknown[] };
      return { name: item.name ?? item.slot ?? '?', keys: item.frame?.length ?? 0 };
    });
  return {
    name: animation.name,
    duration: animation.duration,
    frameRate: player.frameRate,
    bones,
    slots: tally(animation.slot),
    ffd: tally(animation.ffd),
    ik: tally(animation.ik),
  };
}

export function meshDetail(state: EditorState, args: { slot: string }): unknown {
  const player = requirePlayer(state);
  const armature = player.skeleton.armature;
  const display = findMesh(armature, args.slot);
  if (!display) throw new Error(`slot ${args.slot} 没有网格显示对象`);
  const { vertices, triangles } = readMesh(display);
  return {
    slot: args.slot,
    name: display.name ?? null,
    path: display.path ?? null,
    vertexCount: vertices.length,
    triangleCount: Math.floor(triangles.length / 3),
    vertices,
    triangles,
    edges: meshEdges(display),
    weightBones: meshWeightBones(armature, args.slot),
  };
}
/* ------------------------------------------------------------------ *
 * 结构编辑（写；每个都先 checkpoint，失败即回滚）
 * ------------------------------------------------------------------ */

export interface BoneCreateArgs {
  name?: string;
  parent?: string | null;
  transform?: Partial<{ x: number; y: number; skX: number; skY: number; scX: number; scY: number }>;
  length?: number;
}

export function boneCreate(state: EditorState, args: BoneCreateArgs): unknown {
  const player = requirePlayer(state);
  const snapshot = checkpoint(state);
  const created = addBone(player, {
    name: args.name,
    parent: args.parent ?? null,
    transform: args.transform as never,
    length: args.length,
  });
  if (!created) {
    rollback(state, snapshot);
    throw new Error('创建骨骼失败：父级骨骼不存在');
  }
  return withHistory(state, { created, bones: player.skeleton.bones.length });
}

export function boneDelete(state: EditorState, args: { bone: string }): unknown {
  const player = requirePlayer(state);
  const snapshot = checkpoint(state);
  if (!removeBone(player, args.bone)) {
    rollback(state, snapshot);
    throw new Error(`删除失败：${args.bone} 不存在，或它是最后一根骨骼`);
  }
  return withHistory(state, { removed: args.bone, bones: player.skeleton.bones.length });
}

export function boneUpdate(state: EditorState, args: {
  bone: string;
  rename?: string;
  parent?: string | null;
  length?: number;
  /** 绑定变换（相对父级）：x/y/rotation(度)/skX/skY/scX/scY，只改给出的分量 */
  transform?: BindPatch;
  /** true = 子骨骼与挂在本骨骼上的槽位保持世界位置不变（默认 false：子级跟着动） */
  keepChildren?: boolean;
  /** 继承开关（§10.3-8）：rotation / scale / translation / reflection */
  inherit?: Partial<Record<'rotation' | 'scale' | 'translation' | 'reflection', boolean>>;
}): unknown {
  const player = requirePlayer(state);
  const armature = player.skeleton.armature;
  if (!armature.bone.some((entry) => entry.name === args.bone)) throw new Error(`unknown bone: ${args.bone}`);
  const snapshot = checkpoint(state);
  const target = args.rename?.trim() || args.bone;
  const changed: Record<string, unknown> = {};

  if (args.rename && args.rename !== args.bone) {
    if (!renameBone(player, args.bone, args.rename)) {
      rollback(state, snapshot);
      throw new Error(`重命名失败：${args.bone} → ${args.rename}`);
    }
    changed.name = args.rename;
  }
  if (args.parent !== undefined) {
    if (!setBoneParent(player, target, args.parent)) {
      rollback(state, snapshot);
      throw new Error(`改父级失败：${target} → ${args.parent ?? '（根）'}`);
    }
    changed.parent = args.parent;
  }
  if (typeof args.length === 'number') {
    if (!setBoneLength(armature, target, args.length)) {
      rollback(state, snapshot);
      throw new Error(`改骨骼长度失败：${target}`);
    }
    player.rebuildSkeleton();
    changed.length = args.length;
  }
  if (args.transform && Object.keys(args.transform).length) {
    try {
      changed.transform = setBoneBind(armature, target, args.transform, args.keepChildren === true);
      changed.keepChildren = args.keepChildren === true;
    } catch (error) {
      rollback(state, snapshot);
      throw error;
    }
    player.rebuildSkeleton();
  }
  if (args.inherit && Object.keys(args.inherit).length) {
    const bone = armature.bone.find((entry) => entry.name === target)!;
    const keyOf = { rotation: 'inheritRotation', scale: 'inheritScale', translation: 'inheritTranslation', reflection: 'inheritReflection' } as const;
    for (const [k, v] of Object.entries(args.inherit)) {
      const field = keyOf[k as keyof typeof keyOf];
      if (!field || typeof v !== 'boolean') { rollback(state, snapshot); throw new Error(`bad inherit.${k}`); }
      if (v) delete (bone as unknown as Record<string, unknown>)[field]; else (bone as unknown as Record<string, unknown>)[field] = false;
    }
    changed.inherit = args.inherit;
    player.rebuildSkeleton();
  }
  return withHistory(state, { bone: target, changed });
}
/* ------------------------------------------------------------------ *
 * AI 扩展（M6）：自然语言 → 命令清单 → 应用（与 UI 同一条编辑路径）
 * ------------------------------------------------------------------ */

export async function aiPlan(state: EditorState, args: { prompt: string; capability?: string }): Promise<unknown> {
  const player = requirePlayer(state);
  registerBuiltinCapabilities();
  const commands = await planAiCommands(player, args.prompt, args.capability);
  return { count: commands.length, commands: commands.map((entry) => ({ id: entry.id, label: entry.label })) };
}

export async function aiApply(state: EditorState, args: { prompt: string; capability?: string }): Promise<unknown> {
  const player = requirePlayer(state);
  registerBuiltinCapabilities();
  const before = capture(state);
  const commands = await planAiCommands(player, args.prompt, args.capability);
  const applied = applyAiCommands(player, commands);
  if (applied > 0) {
    const hist = stacks(state);
    if (before) { pushUndo(state, before); hist.redo.length = 0; }
    player.rebuildSkeleton();
  }
  return {
    applied,
    labels: commands.map((entry) => entry.label),
    ...(historyStatus(state) as Record<string, unknown>),
  };
}