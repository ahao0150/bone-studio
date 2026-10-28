/**
 * MCP 会话撤销栈（tools.ts 与 studio.ts 共用）。
 *
 * 改进点（rig-bot 反馈：100 步上限，长会话里 history_undo 不可靠）：
 * - 上限默认 1000 步（BONESTUDIO_UNDO_LIMIT 可调），另有总字节预算（BONESTUDIO_UNDO_MB，默认 512MB）防止内存爆；
 * - 被挤掉的步数记在 undoDropped，history_status 会报出来，agent 能知道「最早还能回到哪」；
 * - 快照同时记录图集（tex + page 引用），焊接 / image_add / region_erase 之类改图集的操作也能正确撤销
 *   （之前只回滚 armature，图集仍是新的 → 撤销后显示对象和区域对不上）。
 */
import { Player } from '../core/player';
import { serializeSkeletonData } from '../core/parse/ske';
import { restoreArmature, snapshotArmature } from '../core/editing';
import type { DbTextureAtlasData } from '../core/types';
import type { RasterImage } from '../tools/png';

export interface HistEntry { arm: string; atlas?: { tex: DbTextureAtlasData | null | undefined; page: RasterImage | null | undefined } }
export type HistItem = HistEntry | string;

export interface HistState {
  player: Player | null;
  undo?: HistItem[];
  redo?: HistItem[];
  undoDropped?: number;
  tex?: DbTextureAtlasData | null;
  page?: RasterImage | null;
}

export const undoLimit = (): number => Math.max(1, Number(process.env.BONESTUDIO_UNDO_LIMIT) || 1000);
export const undoBudget = (): number => Math.max(1, Number(process.env.BONESTUDIO_UNDO_MB) || 512) * 1024 * 1024;

const sizeOf = (e: HistItem) => (typeof e === 'string' ? e.length : e.arm.length) * 2;

export function stacksOf(state: HistState): { undo: HistItem[]; redo: HistItem[] } {
  state.undo ??= []; state.redo ??= [];
  return { undo: state.undo, redo: state.redo };
}

export function capture(state: HistState): HistEntry | null {
  const arm = snapshotArmature(state.player);
  if (!arm) return null;
  return 'page' in state || 'tex' in state ? { arm, atlas: { tex: state.tex, page: state.page } } : { arm };
}

/** 压栈并按上限 / 字节预算从最旧处裁剪 */
export function pushUndo(state: HistState, entry: HistItem): void {
  const { undo } = stacksOf(state);
  undo.push(entry);
  const limit = undoLimit(), budget = undoBudget();
  let bytes = undo.reduce((t, e) => t + sizeOf(e), 0);
  while (undo.length > 1 && (undo.length > limit || bytes > budget)) {
    bytes -= sizeOf(undo.shift()!);
    state.undoDropped = (state.undoDropped ?? 0) + 1;
  }
}

/** 恢复一个快照（含图集；图集变了就用旧图集重建 Player） */
export function restore(state: HistState, entry: HistItem): void {
  if (!state.player) return;
  const e: HistEntry = typeof entry === 'string' ? { arm: entry } : entry;
  restoreArmature(state.player, e.arm);
  if (e.atlas && (e.atlas.tex !== state.tex || e.atlas.page !== state.page)) {
    state.tex = e.atlas.tex ?? null; state.page = e.atlas.page ?? null;
    const p = state.player;
    const anim = p.animation?.name, pos = p.position, setup = p.setupPose;
    const next = new Player(JSON.parse(serializeSkeletonData(p.doc)), state.tex ?? null);
    if (anim) next.setAnimation(anim);
    next.setupPose = setup; next.seek(pos);
    state.player = next;
  }
}

export function historyInfo(state: HistState): Record<string, unknown> {
  const { undo, redo } = stacksOf(state);
  return { undoDepth: undo.length, redoDepth: redo.length, undoLimit: undoLimit(), undoDropped: state.undoDropped ?? 0 };
}
