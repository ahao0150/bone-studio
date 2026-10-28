/**
 * Slot edits for the M2 editing kernel: create / delete / rename plus the slot
 * properties DragonBones exposes (official `pose-slot.md`: 名称 / 颜色 /
 * 混合模式 / 不透明度 / 显示资源 / 坐标变换).
 *
 * Blend-mode ids and names are taken from the shipped runtime, not invented:
 * `DragonBones/src/dragonBones/core/DragonBones.ts` (`const enum BlendMode`) and
 * `parser/DataParser.ts#_getBlendMode`. The JSON authoring form stores the *string*
 * name, the binary form the numeric id.
 */
import type { DbArmatureData, DbColorTransform, DbDisplayData, DbSlotData, DbSlotFrame, DbSlotTimeline } from './types';
import type { Player } from './player';
import { sampleSlotTimeline } from './runtime/animation';

export interface BlendModeEntry {
  id: number;
  /** JSON / binary-with-string name (lower case, as `_getBlendMode` expects) */
  name: string;
  label: string;
  /** closest Pixi v8 blend mode; modes with no equivalent fall back to `normal` */
  pixi: string;
}

/** Official `BlendMode` order (id === enum value). */
export const BLEND_MODES: BlendModeEntry[] = [
  { id: 0, name: 'normal', label: '正常', pixi: 'normal' },
  { id: 1, name: 'add', label: '叠加', pixi: 'add' },
  { id: 2, name: 'alpha', label: '透明', pixi: 'normal' },
  { id: 3, name: 'darken', label: '变暗', pixi: 'darken' },
  { id: 4, name: 'difference', label: '差值', pixi: 'difference' },
  { id: 5, name: 'erase', label: '擦除', pixi: 'normal' },
  { id: 6, name: 'hardlight', label: '强光', pixi: 'hard-light' },
  { id: 7, name: 'invert', label: '反相', pixi: 'normal' },
  { id: 8, name: 'layer', label: '图层', pixi: 'normal' },
  { id: 9, name: 'lighten', label: '变亮', pixi: 'lighten' },
  { id: 10, name: 'multiply', label: '正片叠底', pixi: 'multiply' },
  { id: 11, name: 'overlay', label: '覆盖', pixi: 'overlay' },
  { id: 12, name: 'screen', label: '滤色', pixi: 'screen' },
  { id: 13, name: 'subtract', label: '减去', pixi: 'normal' },
];

/** Accepts either authoring form (string name / numeric id) and clamps to the enum. */
export function blendModeIndex(value: number | string | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(BLEND_MODES.length - 1, Math.round(value)));
  }
  if (typeof value === 'string' && value.length > 0) {
    const wanted = value.toLowerCase();
    const found = BLEND_MODES.find((entry) => entry.name === wanted);
    if (found) return found.id;
  }
  return 0;
}

export function blendModeName(value: number | string | undefined): string {
  return BLEND_MODES[blendModeIndex(value)].name;
}

export function blendModeLabel(value: number | string | undefined): string {
  return BLEND_MODES[blendModeIndex(value)].label;
}

/** Pixi v8 blend string for a DragonBones blend mode. */
export function blendModePixi(value: number | string | undefined): string {
  return BLEND_MODES[blendModeIndex(value)].pixi;
}

export function uniqueSlotName(armature: DbArmatureData, wanted: string): string {
  const base = wanted.trim() || 'slot';
  if (!armature.slot.some((entry) => entry.name === base)) return base;
  for (let i = 1; i < 1000; i++) {
    const candidate = `${base}_${i}`;
    if (!armature.slot.some((entry) => entry.name === candidate)) return candidate;
  }
  return `${base}_x`;
}

export function slotData(armature: DbArmatureData, name: string): DbSlotData | undefined {
  return armature.slot.find((entry) => entry.name === name);
}

export function slotNames(armature: DbArmatureData | undefined | null): string[] {
  return (armature?.slot ?? []).map((entry) => entry.name);
}

/** Official 「创建插槽」: an empty slot under `bone` (created *after* every sibling). */
export function addSlot(player: Player | null, bone: string, name = 'slot'): string | null {
  if (!player) return null;
  const armature = player.skeleton.armature;
  if (!armature.bone.some((entry) => entry.name === bone)) return null;
  const unique = uniqueSlotName(armature, name);
  armature.slot.push({ name: unique, parent: bone, displayIndex: -1, blendMode: 'normal' });
  for (const skin of armature.skin ?? []) (skin.slot ??= []).push({ name: unique, display: [] });
  return unique;
}

/**
 * Official 「删除插槽」 from the properties panel / Delete key. The skin entry and
 * every animation timeline for that slot go with it, otherwise the document would
 * keep dangling references.
 */
export function removeSlot(player: Player | null, name: string): boolean {
  if (!player) return false;
  const armature = player.skeleton.armature;
  const index = armature.slot.findIndex((entry) => entry.name === name);
  if (index < 0) return false;
  armature.slot.splice(index, 1);
  for (const skin of armature.skin ?? []) {
    const at = (skin.slot ?? []).findIndex((entry) => entry.name === name);
    if (at >= 0) skin.slot.splice(at, 1);
  }
  for (const animation of armature.animation ?? []) {
    const at = (animation.slot ?? []).findIndex((entry) => entry.name === name);
    if (at >= 0) animation.slot!.splice(at, 1);
  }
  return true;
}

/** Rename a slot and every reference to it (skins, timelines, raw action frames). */
export function renameSlot(player: Player | null, from: string, to: string): boolean {
  if (!player) return false;
  const armature = player.skeleton.armature;
  const target = to.trim();
  if (!target || target === from) return false;
  const entry = slotData(armature, from);
  if (!entry) return false;
  if (armature.slot.some((other) => other.name === target)) return false;
  entry.name = target;
  for (const skin of armature.skin ?? []) {
    for (const skinSlot of skin.slot ?? []) if (skinSlot.name === from) skinSlot.name = target;
  }
  for (const animation of armature.animation ?? []) {
    for (const timeline of animation.slot ?? []) if (timeline.name === from) timeline.name = target;
  }
  // action frames keep raw authoring objects, so walk them for `slot` references
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { for (const child of node) walk(child); return; }
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (record.slot === from) record.slot = target;
    for (const value of Object.values(record)) if (value && typeof value === 'object') walk(value);
  };
  for (const animation of armature.animation ?? []) walk(animation.frame);
  return true;
}

export function setSlotBlendMode(player: Player | null, name: string, mode: number | string): boolean {
  const entry = player ? slotData(player.skeleton.armature, name) : undefined;
  if (!entry) return false;
  const next = blendModeName(mode);
  if (entry.blendMode === next) return false;
  entry.blendMode = next;
  return true;
}

/** Official 「修改插槽的显示资源」: index into the skin's display list (-1 = nothing). */
export function setSlotDisplayIndex(player: Player | null, name: string, index: number): boolean {
  const entry = player ? slotData(player.skeleton.armature, name) : undefined;
  if (!entry || !Number.isFinite(index)) return false;
  const next = Math.round(index);
  if (entry.displayIndex === next) return false;
  entry.displayIndex = next;
  return true;
}

const DEFAULT_COLOR: DbColorTransform = { aM: 100, rM: 100, gM: 100, bM: 100, aO: 0, rO: 0, gO: 0, bO: 0 };

/** Read the authored (bind-pose) colour of a slot, filled in with format defaults. */
export function readSlotColor(player: Player | null, name: string): DbColorTransform | null {
  const entry = player ? slotData(player.skeleton.armature, name) : undefined;
  if (!entry) return null;
  return { ...DEFAULT_COLOR, ...(entry.color ?? {}) };
}

export function setSlotColor(player: Player | null, name: string, color: DbColorTransform): boolean {
  const entry = player ? slotData(player.skeleton.armature, name) : undefined;
  if (!entry) return false;
  const next = { ...DEFAULT_COLOR, ...color };
  entry.color = next;
  return true;
}

/** 乘算 0–100 → 色块 0–255，与运行时 `colorToTint` 同一公式。 */
export function channelToByte(multiply: number | undefined): number {
  const value = multiply ?? 100;
  return Math.round(Math.min(255, Math.max(0, (value / 100) * 255)));
}

/** 色块 0–255 → 乘算 0–100。255 回到 100，0 回到 0。 */
export function byteToChannel(byte: number): number {
  const clamped = Math.min(255, Math.max(0, Math.round(byte)));
  return Math.round((clamped / 255) * 100);
}

function frameSpan(frame: { duration?: number }): number {
  return typeof frame.duration === 'number' ? frame.duration : 1;
}

function slotTimeline(player: Player, name: string): DbSlotTimeline | undefined {
  return player.animation?.slot?.find((entry) => entry.name === name);
}

/** 采样走分量时间轴时，颜色必须写 `colorFrame`，写 `frame.color` 会被忽略。 */
function componentSlotTimeline(timeline: DbSlotTimeline): boolean {
  return (timeline.displayFrame?.length ?? 0) > 0 || (timeline.colorFrame?.length ?? 0) > 0;
}

function ensureSlotTimeline(player: Player, name: string): DbSlotTimeline | null {
  const animation = player.animation;
  if (!animation) return null;
  if (!player.skeleton.armature.slot.some((entry) => entry.name === name)) return null;
  if (!animation.slot) animation.slot = [];
  let timeline = animation.slot.find((entry) => entry.name === name);
  if (!timeline) {
    timeline = { name, frame: [] };
    animation.slot.push(timeline);
  }
  return timeline;
}

function indexStarting<T extends { duration?: number }>(frames: T[], at: number): number {
  let cursor = 0;
  for (let i = 0; i < frames.length; i++) {
    if (cursor === at) return i;
    const span = frameSpan(frames[i]);
    if (at < cursor + span) return -1;
    cursor += span;
  }
  return -1;
}

function cloneColor(color: DbColorTransform): DbColorTransform {
  return { ...DEFAULT_COLOR, ...color };
}

/**
 * 播放头上的颜色：有颜色时间轴就采样，否则回退绑定姿态。
 * 补间出的缺省通道用格式默认值补齐，面板读到的是完整 8 字段。
 */
export function slotColorAt(player: Player | null, name: string, frame: number): DbColorTransform | null {
  const bind = readSlotColor(player, name);
  if (!bind || !player) return bind;
  const entry = slotData(player.skeleton.armature, name);
  const sample = sampleSlotTimeline(slotTimeline(player, name), Math.max(0, frame), entry?.displayIndex ?? 0);
  if (!sample.color) return bind;
  return { ...DEFAULT_COLOR, ...sample.color };
}

function hasComponentColor(frame: { value?: DbColorTransform; color?: DbColorTransform }): boolean {
  return frame.value !== undefined || frame.color !== undefined;
}

/** 当前帧是不是颜色关键帧的起点（区间中间的补间不算）。 */
export function colorKeyAt(player: Player | null, name: string, frame: number): boolean {
  if (!player) return false;
  const timeline = slotTimeline(player, name);
  if (!timeline) return false;
  const at = Math.max(0, Math.round(frame));
  if (componentSlotTimeline(timeline)) {
    const frames = timeline.colorFrame ?? [];
    const index = indexStarting(frames, at);
    return index >= 0 && hasComponentColor(frames[index]);
  }
  const frames = timeline.frame ?? [];
  const index = indexStarting(frames, at);
  return index >= 0 && Boolean(frames[index].color);
}

/**
 * 在 `frame` 写入颜色关键帧。`insert === false` 时只改当前帧已经存在的键。
 * 新键 `tweenEasing: 0`（线性）。切开区间时，新颜色从这一帧开始生效。
 */
export function setSlotColorKeyframe(
  player: Player | null,
  name: string,
  frame: number,
  color: DbColorTransform,
  insert = true,
): boolean {
  if (!player) return false;
  const timeline = ensureSlotTimeline(player, name);
  if (!timeline) return false;
  const at = Math.max(0, Math.round(frame));
  const stored = cloneColor(color);
  if (componentSlotTimeline(timeline)) return writeComponentColor(timeline, at, stored, insert);
  return writeMergedColor(timeline, at, stored, insert);
}

function writeComponentColor(timeline: DbSlotTimeline, at: number, color: DbColorTransform, insert: boolean): boolean {
  const frames = timeline.colorFrame ?? (timeline.colorFrame = []);
  let cursor = 0;
  for (let i = 0; i < frames.length; i++) {
    const span = frameSpan(frames[i]);
    if (cursor === at) {
      if (!hasComponentColor(frames[i]) && !insert) return false;
      frames[i] = { ...frames[i], value: color, color, tweenEasing: frames[i].tweenEasing ?? 0 };
      return true;
    }
    if (at < cursor + span) {
      if (!insert) return false;
      const head = at - cursor;
      frames.splice(i, 1, { ...frames[i], duration: head }, {
        duration: span - head, tweenEasing: 0, value: color, color,
      });
      return true;
    }
    cursor += span;
  }
  if (!insert) return false;
  if (frames.length > 0 && cursor < at) {
    const last = frames[frames.length - 1];
    last.duration = frameSpan(last) + (at - cursor);
  } else if (frames.length === 0 && at > 0) {
    frames.push({ duration: at, tweenEasing: 0 });
  }
  frames.push({ duration: 1, tweenEasing: 0, value: color, color });
  return true;
}

function writeMergedColor(timeline: DbSlotTimeline, at: number, color: DbColorTransform, insert: boolean): boolean {
  const frames = timeline.frame ?? (timeline.frame = []);
  let cursor = 0;
  for (let i = 0; i < frames.length; i++) {
    const span = frameSpan(frames[i]);
    if (cursor === at) {
      if (!frames[i].color && !insert) return false;
      frames[i] = { ...frames[i], color, tweenEasing: frames[i].tweenEasing ?? 0 };
      return true;
    }
    if (at < cursor + span) {
      if (!insert) return false;
      const head = at - cursor;
      const kept: DbSlotFrame = { ...frames[i], duration: head };
      frames.splice(i, 1, kept, { ...frames[i], duration: span - head, tweenEasing: 0, color });
      return true;
    }
    cursor += span;
  }
  if (!insert) return false;
  if (frames.length > 0 && cursor < at) {
    const last = frames[frames.length - 1];
    last.duration = frameSpan(last) + (at - cursor);
  } else if (frames.length === 0 && at > 0) {
    frames.push({ duration: at, tweenEasing: 0 });
  }
  frames.push({ duration: 1, tweenEasing: 0, color });
  return true;
}

function dropFrame<T extends { duration?: number }>(frames: T[], index: number): void {
  if (frames.length === 1) {
    frames.pop();
    return;
  }
  const removed = frames[index];
  if (index + 1 < frames.length) {
    frames[index + 1].duration = frameSpan(frames[index + 1]) + frameSpan(removed);
  } else {
    frames[index - 1].duration = frameSpan(frames[index - 1]) + frameSpan(removed);
  }
  frames.splice(index, 1);
}

/** 删掉当前帧的颜色键。合并帧上若还带着 `displayIndex`，只去掉 `color`。 */
export function removeSlotColorKeyframe(player: Player | null, name: string, frame: number): boolean {
  if (!player) return false;
  const timeline = slotTimeline(player, name);
  if (!timeline) return false;
  const at = Math.max(0, Math.round(frame));
  if (componentSlotTimeline(timeline)) {
    const frames = timeline.colorFrame ?? [];
    const index = indexStarting(frames, at);
    if (index < 0 || !hasComponentColor(frames[index])) return false;
    dropFrame(frames, index);
    return true;
  }
  const frames = timeline.frame ?? [];
  const index = indexStarting(frames, at);
  if (index < 0 || !frames[index].color) return false;
  if (frames[index].displayIndex !== undefined) {
    const next = { ...frames[index] };
    delete next.color;
    frames[index] = next;
    return true;
  }
  dropFrame(frames, index);
  return true;
}

/** `true` when the colour is the format identity (so it can be dropped on write). */
export function isIdentityColor(color: DbColorTransform | null | undefined): boolean {
  if (!color) return true;
  return (color.aM ?? 100) === 100 && (color.rM ?? 100) === 100 && (color.gM ?? 100) === 100
    && (color.bM ?? 100) === 100 && (color.aO ?? 0) === 0 && (color.rO ?? 0) === 0
    && (color.gO ?? 0) === 0 && (color.bO ?? 0) === 0;
}

/**
 * 替换图片（官方 `Property.display.changeAsset` / 菜单 `MenuItem-swapImage` / `SwapImageWindow`）：
 * 把某个显示对象引用的图集区域换成 `regionName`。
 *
 * 语义沿用官方的 `path` 字段（运行时用 `display.path ?? display.name` 查区域）：
 * 换到别的区域时写 `path`，换回与 `name` 相同的区域时把 `path` 删掉，保持 JSON 干净。
 * 导出会原样带上 `path`，所以换完的工程在官方运行时里也是新图。
 */
export function swapDisplayImage(
  player: Player | null,
  slotName: string,
  displayIndex: number,
  regionName: string,
): boolean {
  if (!player || !regionName) return false;
  const armature = player.skeleton.armature;
  if (!armature.slot.some((entry) => entry.name === slotName)) return false;
  const skinSlot = player.skeleton.currentSkin()?.slot.find((entry) => entry.name === slotName);
  const display = skinSlot?.display?.[displayIndex];
  if (!display) return false;
  if ((display.path ?? display.name) === regionName) return false;
  if (regionName === display.name) delete display.path;
  else display.path = regionName;
  player.rebuildSkeleton();
  return true;
}
/**
 * 给槽位写一个「显示对象切换」关键帧（M6 AI 扩展里的口型要用）。
 *
 * 语义与骨骼关键帧一致：落在已有区间的中间会把该区间**切开**，落在已有帧上则直接改值。
 * 返回是否写入成功。
 */
export function setSlotDisplayKeyframe(
  player: Player | null,
  slotName: string,
  frame: number,
  displayIndex: number,
): boolean {
  if (!player) return false;
  const animation = player.animation;
  if (!animation) return false;
  const armature = player.skeleton.armature;
  if (!armature.slot.some((entry) => entry.name === slotName)) return false;
  const at = Math.max(0, Math.round(frame));
  if (!animation.slot) animation.slot = [];
  let timeline = animation.slot.find((entry) => entry.name === slotName);
  if (!timeline) {
    timeline = { name: slotName, frame: [] };
    animation.slot.push(timeline);
  }
  const frames = timeline.frame ?? (timeline.frame = []);
  const total = (list: typeof frames) =>
    list.reduce((sum, entry) => sum + (typeof entry.duration === 'number' ? entry.duration : 1), 0);

  let cursor = 0;
  for (let i = 0; i < frames.length; i++) {
    const duration = typeof frames[i].duration === 'number' ? frames[i].duration : 1;
    if (cursor + duration <= at) { cursor += duration; continue; }
    if (cursor === at) {
      frames[i] = { ...frames[i], displayIndex };
      return true;
    }
    const head = at - cursor;
    const tail = cursor + duration - at;
    const next = { ...frames[i] };
    frames[i] = { ...frames[i], duration: head, displayIndex };
    frames.splice(i + 1, 0, { ...next, duration: Math.max(0, tail) });
    return true;
  }
  if (cursor === at && frames.length > 0) {
    frames[frames.length - 1] = { ...frames[frames.length - 1], displayIndex };
    return true;
  }
  frames.push({ duration: Math.max(1, at - cursor), displayIndex });
  void total;
  return true;
}
/** 把一份显示对象追加到插槽的显示列表（官方 `MenuItem-pasteDisplay`「粘贴」显示对象）。 */
export function appendSlotDisplay(player: Player | null, name: string, display: DbDisplayData): boolean {
  const list = player?.skeleton.armature?.skin?.[0]?.slot.find((entry) => entry.name === name)?.display;
  if (!list || !display) return false;
  list.push(JSON.parse(JSON.stringify(display)) as DbDisplayData);
  return true;
}

/**
 * 删除插槽当前显示对象（官方 `MenuItem-deleteDisplay`）：只剩一个时拒绝（避免空插槽），
 * 删完把 `displayIndex` 夹回合法范围。
 */
export function removeSlotDisplay(player: Player | null, name: string): boolean {
  const armature = player?.skeleton.armature;
  const entry = armature ? slotData(armature, name) : undefined;
  const list = armature?.skin?.[0]?.slot.find((each) => each.name === name)?.display;
  if (!armature || !entry || !list) return false;
  if (list.length <= 1) return false;
  const index = Math.max(0, Math.min(list.length - 1, Math.round(entry.displayIndex ?? 0)));
  list.splice(index, 1);
  const next = Math.min(index, list.length - 1);
  if (entry.displayIndex !== next) entry.displayIndex = next;
  return true;
}

/**
 * 官方 `MenuItem-convertToSymbol`「转换为元件...」：把当前显示对象换成对**另一个骨架（元件）**的引用。
 * 图片与网格数据会一并清掉 —— 元件引用不需要它们。
 */
export function convertDisplayToArmature(display: DbDisplayData | null | undefined, symbolName: string): boolean {
  const name = symbolName.trim();
  if (!display || !name) return false;
  display.type = 'armature';
  display.name = name;
  delete display.path;
  delete display.width;
  delete display.height;
  delete display.pivot;
  delete display.vertices;
  delete display.uvs;
  delete display.triangles;
  delete display.edges;
  delete display.userEdges;
  delete display.weights;
  delete display.bonePose;
  delete display.bindOffsets;
  delete display.weightBones;
  delete display.slotPose;
  delete display.offset;
  return true;
}


/** 插槽时间轴的帧起始位置（按 duration 累加）。 */
function slotFrameStarts(frames: Array<{ duration?: number }> | undefined): number[] {
  const out: number[] = [];
  if (!frames) return out;
  let at = 0;
  for (const frame of frames) {
    out.push(at);
    at += frame.duration ?? 1;
  }
  return out;
}

/**
 * 插槽「显示资源」（displayIndex）这一帧是不是**显式打了键** —— 属性面板旗杆的红/白判据。
 * 组件形式看 `displayFrame`；4.x 合成形式看 `frame[]` 里有没有写 `displayIndex`。
 */
export function displayKeyAt(player: Player | null, slotName: string, frame: number): boolean {
  const timeline = player?.animation?.slot?.find((entry) => entry.name === slotName);
  if (!timeline) return false;
  const at = Math.max(0, Math.round(frame));
  if ((timeline.displayFrame?.length ?? 0) > 0) {
    return slotFrameStarts(timeline.displayFrame).some((value) => Math.abs(value - at) < 1e-4);
  }
  const frames = timeline.frame ?? [];
  const index = slotFrameStarts(frames).findIndex((value) => Math.abs(value - at) < 1e-4);
  return index >= 0 && frames[index].displayIndex !== undefined;
}

/** 删掉插槽「显示资源」在当前帧的键（旗杆再点一次）。 */
export function removeSlotDisplayKeyframe(player: Player | null, slotName: string, frame: number): boolean {
  const timeline = player?.animation?.slot?.find((entry) => entry.name === slotName);
  if (!timeline) return false;
  const at = Math.max(0, Math.round(frame));
  const drop = <T extends { duration?: number }>(list: T[] | undefined): boolean => {
    if (!list || list.length === 0) return false;
    const index = slotFrameStarts(list).findIndex((value) => Math.abs(value - at) < 1e-4);
    if (index < 0) return false;
    if (list.length === 1) { list.splice(0, 1); return true; }
    const removed = list[index];
    if (index + 1 < list.length) list[index + 1].duration = (list[index + 1].duration ?? 1) + (removed.duration ?? 1);
    else list[index - 1].duration = (list[index - 1].duration ?? 1) + (removed.duration ?? 1);
    list.splice(index, 1);
    return true;
  };
  if ((timeline.displayFrame?.length ?? 0) > 0) return drop(timeline.displayFrame);
  const frames = timeline.frame ?? [];
  const index = slotFrameStarts(frames).findIndex((value) => Math.abs(value - at) < 1e-4);
  if (index < 0 || frames[index].displayIndex === undefined) return false;
  delete frames[index].displayIndex;
  return true;
}