/**
 * 序列帧（Sheet）工程的编辑内核。
 *
 * 格式验证：官方序列帧工程用 `armature.type === "sheet"` 标记（样例
 * `samples/FramesAnimation/FramesAnimation_ske.json`：`type:"sheet"`、`frameRate:6`、
 * 1 个动画 `boy-fall`(`duration:7`)、1 个槽位 `sheetSlot` 的 skin 里有 7 个 display，
 * slot 时间轴是 7 个 `duration:1` 的关键帧，逐个把 `displayIndex` 指到 0..6）。
 * 面板文案见 `界面文案表` 第 1367-1381 行（`Sheet.*`）。
 */
import type {
  DbAnimationData, DbArmatureData, DbDisplayData, DbSkinSlotData, DbSlotDisplayFrame, DbSlotFrame, DbSlotTimeline,
} from './types';
import { apply, invert, type Mat2D } from './runtime/math';

/* -------- 帧格子尺寸（官方 `_13212/_13215.as` 第 13-22 行的五个常量） -------- */

/** 官方 `_13215.DEFUALT_HEIGHT`（原文拼写如此） */
export const SHEET_CELL_DEFAULT = 100;
/** 官方 `_13215.MIN_HEIGHT` */
export const SHEET_CELL_MIN = 80;
/** 官方 `_13215.MAX_HEIGHT` */
export const SHEET_CELL_MAX = 200;
/** 官方 `_13215.IMAGE_GAP`：缩略图盒 = 格子 - 这个值（左右各 15） */
export const SHEET_IMAGE_GAP = 30;
/** 官方 `_13215._2422`：格子间距（`_13213` 的 HorizontalLayout gap） */
export const SHEET_CELL_GAP = 4;
/**
 * 横向滚动条占位高度（px）。**必须与 `styles.css` 里 `.sheet-frames::-webkit-scrollbar`
 * 的 `height` 一致** —— 格子边长按「容器高 − 这个值」算，所以滚动条出现/消失不会改变格子尺寸。
 */
export const SHEET_SCROLLBAR = 10;

/**
 * 帧格子边长 —— 官方 `_13213._5823()`：列表高落在 `[MIN, MAX]` 时把 `_13215._13415`（全列表共享的
 * 格子边长）更新为 `列表高 - 16`，否则沿用上一次的值（初值 `DEFUALT_HEIGHT`）。
 *
 * 这里用等价的静态形式：直接夹进 `[MIN, MAX]`。避开官方的「沿用上一次」是为了去掉路径依赖 ——
 * 尺寸只由当前布局高决定，才好在门禁里复算（`work/cdp-sheet-panel.mjs` 用同一条式子断言）。
 *
 * `listHeight` 传**列表的内容盒高**（即已扣掉容器 padding 的那 16px），与官方 `height - 16` 同义 ——
 * 所以格子在竖直方向正好填满可用高度，这就是「高度对齐」。
 */
export function sheetCellSize(listHeight: number): number {
  if (!Number.isFinite(listHeight)) return SHEET_CELL_DEFAULT;
  const raw = listHeight;
  if (raw < SHEET_CELL_MIN || raw > SHEET_CELL_MAX) {
    return Math.max(SHEET_CELL_MIN, Math.min(SHEET_CELL_MAX, raw));
  }
  return raw;
}

/** 缩略图盒边长（官方 `_13215.data` setter：`_13425.width/height = 格子 - IMAGE_GAP`）。 */
export function sheetThumbBox(cell: number): number {
  return Math.max(1, cell - SHEET_IMAGE_GAP);
}

/**
 * 缩略图缩放系数 —— 官方 `_13211.draw()`：`k = min(盒宽/图宽, 盒高/图高)`，
 * **`k > 1` 时夹回 1**（官方不放大），然后以自身原点为中心绘制
 * （`tx = -w*k/2`、`drawRect(-w*k/2, -h*k/2, ...)`）。
 */
export function sheetThumbScale(box: number, width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return 1;
  return Math.min(1, box / width, box / height);
}


export interface SheetFrames {
  /** 承载帧的槽位 */
  slot: string;
  frames: DbDisplayData[];
  /** 官方面板「帧频」（armature.frameRate；样例是 6） */
  frameRate: number;
  animation: DbAnimationData | null;
  timeline: DbSlotTimeline | null;
}

export function isSheetArmature(armature: DbArmatureData | null | undefined): boolean {
  return String(armature?.type ?? '').trim().toLowerCase() === 'sheet';
}

function skinSlotOf(armature: DbArmatureData, slotName: string): DbSkinSlotData | undefined {
  for (const skin of armature.skin ?? []) {
    const found = skin.slot?.find((entry) => entry.name === slotName);
    if (found) return found;
  }
  return undefined;
}

/** 读序列帧工程的帧列表；不是 sheet 工程（或没有槽位）返回 null。 */
export function readSheetFrames(armature: DbArmatureData | null | undefined, animationName?: string): SheetFrames | null {
  if (!armature || !isSheetArmature(armature)) return null;
  const slot = armature.slot?.[0]?.name;
  if (!slot) return null;
  const skinSlot = skinSlotOf(armature, slot);
  if (!skinSlot) return null;
  const animations = armature.animation ?? [];
  const animation = animationName ? animations.find((entry) => entry.name === animationName) ?? null : animations[0] ?? null;
  const timeline = animation?.slot?.find((entry) => entry.name === slot) ?? null;
  return {
    slot,
    frames: skinSlot.display ?? [],
    frameRate: armature.frameRate ?? 24,
    animation,
    timeline,
  };
}

/** 显示对象的排序键（官方 `_13230`，即显示对象的名字）。 */
export function frameName(display: DbDisplayData | undefined): string {
  return display?.name ?? display?.path ?? '';
}

/**
 * 名字切词（官方 `_648/_13209.as` 第 219-282 行 `_13391`）：
 * 把名字切成「数字段 / 字符串段」交替的数组，数字段转成整数。
 * 例：`"4_fall_1"` → `[4, "_fall_", 1]`、`"f10"` → `["f", 10]`。
 */
export function frameNameTokens(name: string): Array<string | number> {
  const tokens: Array<string | number> = [];
  let buffer = '';
  let digits = name.length > 0 && name.charAt(0) >= '0' && name.charAt(0) <= '9';
  for (let i = 0; i < name.length; i++) {
    const ch = name.charAt(i);
    const isDigit = ch >= '0' && ch <= '9';
    if (!isDigit) {
      if (!digits) buffer += ch;
      else { tokens.push(parseInt(buffer, 10)); buffer = ch; }
      digits = false;
    } else {
      if (digits) buffer += ch;
      else { tokens.push(buffer); buffer = ch; }
      digits = true;
    }
  }
  if (buffer !== '') tokens.push(digits ? parseInt(buffer, 10) : buffer);
  return tokens;
}

/**
 * 名字比较器（官方 `_648/_13209.as` 第 180-216 行 `_13390`）：逐段比，**数字段排在字符串段之前**，
 * 一方先耗尽则**短的在前**。这是自然排序 —— `f2 < f10`（按数字比，不是按字符串比）。
 */
export function compareFrameNames(a: string, b: string): number {
  const left = frameNameTokens(a);
  const right = frameNameTokens(b);
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i++) {
    if (left.length <= i) return -1;
    if (right.length <= i) return 1;
    const x = left[i];
    const y = right[i];
    const xNum = typeof x === 'number';
    const yNum = typeof y === 'number';
    if (xNum && !yNum) return -1;
    if (!xNum && yNum) return 1;
    if (xNum) {
      if ((x as number) < (y as number)) return -1;
      if ((x as number) > (y as number)) return 1;
    } else {
      if ((x as string) < (y as string)) return -1;
      if ((x as string) > (y as string)) return 1;
    }
  }
  return 0;
}

/**
 * 按名字重排整个帧列表（官方 `SheetPanel` 的 sortUp / sortDown → `RESET_SHEET_ORDER`）。
 *
 * 官方 `_13191/_13198.as` 第 18-49 行只把新顺序的显示对象数组整体写回 `slot.display`，
 * **完全不触碰 `displayIndex`** —— 序列帧按数组顺序播放，所以排序会真实改变播放顺序。
 * 顺序没变时返回 false（不写历史、不刷新）。
 */
export function sortFramesByName(armature: DbArmatureData, slotName: string, asc = true): boolean {
  const skinSlot = skinSlotOf(armature, slotName);
  const frames = skinSlot?.display;
  if (!skinSlot || !frames || frames.length <= 1) return false;
  const sorted = frames.slice().sort((a, b) => {
    const cmp = compareFrameNames(frameName(a), frameName(b));
    return asc ? cmp : -cmp;
  });
  if (sorted.every((frame, index) => frame === frames[index])) return false;
  skinSlot.display = sorted;
  return true;
}

/** 一帧切换记录里指向 display 的字段（`frame[]` 的 `displayIndex` / `displayFrame[]` 的 `value`）。 */
function displayRefOf(frame: { displayIndex?: number; value?: number }): number {
  return frame.displayIndex ?? frame.value ?? 0;      // 缺省 = 0（见 sampleSlotTimeline 的格式验证）
}

/**
 * 删除一帧（官方 `SheetEvent.DELETE_FRAME` → `_555/_13201.as` `_13294` → `DEL_SHEET_FRAMES`
 * → `_13191/_13193.as`：从骨架数据里移除该显示对象并重排，tooltip 复用 `ScenePanel.removeBtn.tooltip`）。
 *
 * 指向该帧的切换关键帧会被移除、后续索引整体前移、动画时长减 1。
 *
 * **两种时间轴形式都要处理**：JSON 工程是 4.x 的合并 `frame[]`，而 `*_ske.dbbin` 解码后是
 * 5.x 的 `displayFrame[]`（官方解析器把同一个 `frame[]` 拆成 `SlotDisplay(20)` + `SlotColor(21)`
 * 两条组件时间轴，见 §103）。只改 `frame[]` 会让二进制工程删帧后时间轴仍指向旧下标。
 */
export function removeFrame(armature: DbArmatureData, slotName: string, index: number): boolean {
  const skinSlot = skinSlotOf(armature, slotName);
  const frames = skinSlot?.display ?? [];
  if (!skinSlot || index < 0 || index >= frames.length || frames.length <= 1) return false;
  frames.splice(index, 1);
  for (const animation of armature.animation ?? []) {
    const timeline = animation.slot?.find((entry) => entry.name === slotName);
    if (!timeline) continue;
    let touched = false;
    if (timeline.frame && timeline.frame.length > 0) {
      const kept: DbSlotFrame[] = [];
      for (const frame of timeline.frame) {
        const at = displayRefOf(frame);
        if (at === index) continue;                     // 该切换点随帧一起删掉
        const copy = { ...frame };
        const next = at > index ? at - 1 : at;
        if (next === 0) delete copy.displayIndex; else copy.displayIndex = next;
        kept.push(copy);
      }
      timeline.frame = kept;
      touched = true;
    }
    if (timeline.displayFrame && timeline.displayFrame.length > 0) {
      const kept: DbSlotDisplayFrame[] = [];
      for (const frame of timeline.displayFrame) {
        const at = displayRefOf(frame);
        if (at === index) continue;
        const copy = { ...frame };
        const next = at > index ? at - 1 : at;
        // `DbSlotDisplayFrame` 没有 `displayIndex` 字段；解码器理论上不会塞进来，
        // 但两条轨同时在场时以 `displayIndex` 优先（`displayRefOf`），所以这里一并清掉。
        delete (copy as { displayIndex?: number }).displayIndex;
        if (next === 0) delete copy.value; else copy.value = next;
        kept.push(copy);
      }
      timeline.displayFrame = kept;
      touched = true;
    }
    // 颜色轨与 display 下标无关，但要与 display 轨保持同样的长度（官方 `SheetColor` 是并列轨）
    if (touched && timeline.colorFrame && timeline.colorFrame.length > timelineDisplayLength(timeline)) {
      timeline.colorFrame = timeline.colorFrame.slice(0, timelineDisplayLength(timeline));
    }
    if (touched) animation.duration = Math.max(1, (animation.duration ?? 1) - 1);
  }
  // 绑定的 displayIndex 指向被删帧时要跟着走，否则运行时索引越界
  for (const slot of armature.slot ?? []) {
    if (slot.name !== slotName || slot.displayIndex === undefined) continue;
    const last = Math.max(0, frames.length - 1);
    // 被删的正是绑定值 → 落到同一下标（那里现在是原来的下一帧）；
    // 在删除点之后 → 前移一位；两种情况都要夹进有效范围。
    const next = slot.displayIndex > index ? slot.displayIndex - 1 : slot.displayIndex;
    const clamped = Math.max(0, Math.min(last, next));
    if (clamped === 0) delete slot.displayIndex;
    else slot.displayIndex = clamped;
  }
  return true;
}

/** 删帧后 display 轨的有效帧数（用于把并列的颜色轨裁到同长）。 */
function timelineDisplayLength(timeline: DbSlotTimeline): number {
  if (timeline.frame) return timeline.frame.length;
  return timeline.displayFrame?.length ?? 0;
}

/**
 * 把一张图追加成序列帧的新一帧（资源树展开切片）。
 * 每个动画的 slot 时间轴末尾加一帧 `duration: 1`，`displayIndex` 指向新图，时长加 1。
 * 返回新帧下标；不是序列帧或没有槽位时返回 null。
 */
export function appendSheetFrame(armature: DbArmatureData, imageName: string): number | null {
  if (!isSheetArmature(armature) || !imageName) return null;
  const slotName = armature.slot?.[0]?.name;
  if (!slotName) return null;
  const skinSlot = skinSlotOf(armature, slotName);
  if (!skinSlot) return null;
  const index = skinSlot.display.length;
  skinSlot.display.push({ name: imageName, path: imageName, type: 'image' });
  for (const animation of armature.animation ?? []) {
    animation.slot = animation.slot ?? [];
    let timeline = animation.slot.find((entry) => entry.name === slotName);
    if (!timeline) {
      timeline = { name: slotName, frame: [] };
      animation.slot.push(timeline);
    }
    timeline.frame = timeline.frame ?? [];
    const key: DbSlotFrame = { duration: 1, tweenEasing: null };
    if (index > 0) key.displayIndex = index;
    timeline.frame.push(key);
    animation.duration = (animation.duration ?? 0) + 1;
  }
  return index;
}

/** 锚点（显示对象局部原点）在舞台上的位置：父骨骼世界矩阵 × `transform` 平移。 */
export function frameAnchorWorld(boneWorld: Mat2D, frame: DbDisplayData | undefined): { x: number; y: number } {
  const [x, y] = apply(boneWorld, frame?.transform?.x ?? 0, frame?.transform?.y ?? 0);
  return { x, y };
}

/** 把锚点放到世界坐标 (x, y)：反解父骨骼世界矩阵，写回 `transform` 的平移。 */
export function setFrameAnchorWorld(frame: DbDisplayData, boneWorld: Mat2D, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const [lx, ly] = apply(invert(boneWorld), x, y);
  const movedX = setFramePosition(frame, 'x', lx);
  const movedY = setFramePosition(frame, 'y', ly);
  return movedX || movedY;
}

/** 官方「帧频」输入框：`restrict="0-9"`、`maxChars=2` → 1..99 的整数。 */
export function setFrameRate(armature: DbArmatureData, value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const next = Math.max(1, Math.min(99, Math.round(value)));
  if (armature.frameRate === next) return false;
  armature.frameRate = next;
  return true;
}

/**
 * 官方「循环」复选框与「播放次数」输入框：勾上循环时次数输入框变灰。
 * DragonBones 运行时的语义是 `playTimes === 0` 表示无限循环。
 */
export function setLoop(animation: DbAnimationData | null, loop: boolean): boolean {
  if (!animation) return false;
  const next = loop ? 0 : Math.max(1, animation.playTimes && animation.playTimes > 0 ? animation.playTimes : 1);
  if (animation.playTimes === next) return false;
  animation.playTimes = next;
  return true;
}

export function setPlayTimes(animation: DbAnimationData | null, times: number): boolean {
  if (!animation || !Number.isFinite(times)) return false;
  const next = Math.max(1, Math.min(99, Math.round(times)));
  if (animation.playTimes === next) return false;
  animation.playTimes = next;
  return true;
}

/** 当前是否无限循环（官方「循环」勾选态）。 */
export function isLooping(animation: DbAnimationData | null): boolean {
  return !animation?.playTimes;            // undefined / 0 都按循环处理
}
/* ---------------- 帧编辑条（官方 `_953/_13221.as` + `_935/_13217.as`） ---------------- */

/**
 * 九宫格 / 轴心输入框的 UI 值 ↔ 数据里 `pivot` 的换算。
 *
 * 官方 `_13221.as` 第 313-352 行 `_13335()` 反查：UI 值域是 **-0.5..0.5**、`0` 表示图片中心
 * （`(0.5, 0.5)` = 左上、`(0, 0)` = 中心、`(-0.5, -0.5)` = 右下）；
 * 而 `dragonBones57.js` 第 12469-12477 行 `_parsePivot` 里 `pivot` 的值域是 **0..1**、
 * `0` 表示原点在图片左上角。两者相差一个 `0.5 - v`。
 */
export function uiFromPivot(pivot: number): number {
  return 0.5 - pivot;
}

export function pivotFromUi(ui: number): number {
  return 0.5 - ui;
}

/**
 * 官方九宫格轴心（`_13217` 的 9 个 RadioButton）。
 * x / y 就是**官方输入框的 UI 值**（0 表示图片中心，x 向右为负、y 向下为负）；
 * 写进数据前要用 `pivotFromUi` 换算成 `pivot`。
 */
export const SHEET_ANCHORS = [
  { id: 'LEFT_TOP', x: 0.5, y: 0.5 },
  { id: 'MIDDLE_TOP', x: 0, y: 0.5 },
  { id: 'RIGHT_TOP', x: -0.5, y: 0.5 },
  { id: 'LEFT_MIDDLE', x: 0.5, y: 0 },
  { id: 'MIDDLE_MIDDLE', x: 0, y: 0 },
  { id: 'RIGHT_MIDDLE', x: -0.5, y: 0 },
  { id: 'LEFT_BOTTOM', x: 0.5, y: -0.5 },
  { id: 'MIDDLE_BOTTOM', x: 0, y: -0.5 },
  { id: 'RIGHT_BOTTOM', x: -0.5, y: -0.5 },
] as const;

export interface SheetFrameValues {
  x: number;
  y: number;
  pivotX: number;
  pivotY: number;
  flipX: boolean;
  flipY: boolean;
}

/** 当前帧的显示对象变换（缺省与运行时一致：位置 0、轴心 0.5/0.5、未翻转）。 */
export function readFrameValues(frame: DbDisplayData | undefined): SheetFrameValues {
  const scaleX = frame?.transform?.scX ?? 1;
  const scaleY = frame?.transform?.scY ?? 1;
  return {
    x: frame?.transform?.x ?? 0,
    y: frame?.transform?.y ?? 0,
    pivotX: frame?.pivot?.x ?? 0.5,
    pivotY: frame?.pivot?.y ?? 0.5,
    flipX: scaleX < 0,
    flipY: scaleY < 0,
  };
}

/** 位置 X/Y（官方 `_4781` / `_4780`，范围 ±999999）。 */
export function setFramePosition(frame: DbDisplayData, axis: 'x' | 'y', value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const next = Math.max(-999999, Math.min(999999, value));
  frame.transform = { ...(frame.transform ?? {}) };
  if (frame.transform[axis] === next) return false;
  frame.transform[axis] = next;
  return true;
}

/**
 * 轴心 X/Y（官方 `_6648` / `_6650` 与九宫格）。运行时缺省是 (0.5, 0.5)
 * （`runtime/skeleton.ts` 第 424 行 `display.pivot?.x ?? 0.5`）。
 */
export function setFramePivot(frame: DbDisplayData, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const next = { x, y };
  if (frame.pivot && frame.pivot.x === x && frame.pivot.y === y) return false;
  frame.pivot = next;
  return true;
}

/** 水平 / 垂直翻转 = 把缩放取反（官方 `TransformEvent.FLIPX_CHANGE` / `FLIPY_CHANGE`）。 */
export function flipFrame(frame: DbDisplayData, axis: 'x' | 'y'): boolean {
  const current = readFrameValues(frame);
  frame.transform = { ...(frame.transform ?? {}) };
  if (axis === 'x') frame.transform.scX = current.flipX ? Math.abs(frame.transform.scX ?? 1) : -Math.abs(frame.transform.scX ?? 1);
  else frame.transform.scY = current.flipY ? Math.abs(frame.transform.scY ?? 1) : -Math.abs(frame.transform.scY ?? 1);
  return true;
}

/**
 * 官方 `Sheet.apply.all`「应用所有帧」：把源帧的变换 / 轴心抄给其余帧。
 * `which` 决定抄哪一部分（编辑条上的两组控件共用这一个入口）。
 */
export function applyFrameToAll(
  frames: DbDisplayData[],
  fromIndex: number,
  which: 'transform' | 'pivot' | 'all' = 'all',
): number {
  const source = frames[fromIndex];
  if (!source) return 0;
  let changed = 0;
  frames.forEach((frame, index) => {
    if (index === fromIndex) return;
    if (which === 'transform' || which === 'all') {
      if (source.transform) frame.transform = JSON.parse(JSON.stringify(source.transform));
      else delete frame.transform;
    }
    if (which === 'pivot' || which === 'all') {
      if (source.pivot) frame.pivot = { ...source.pivot };
      else delete frame.pivot;
    }
    changed++;
  });
  return changed;
}