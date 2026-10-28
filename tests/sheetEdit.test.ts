import { describe, expect, it } from 'vitest';
import type { DbArmatureData, DbDisplayData } from '../src/core/types';
import {
  appendSheetFrame, compareFrameNames, frameAnchorWorld, frameNameTokens, isLooping, isSheetArmature,
  readSheetFrames, removeFrame, sortFramesByName,
  setFrameAnchorWorld, setFrameRate, setLoop, setPlayTimes,
  SHEET_ANCHORS, SHEET_CELL_DEFAULT, SHEET_SCROLLBAR, applyFrameToAll, flipFrame, readFrameValues,
  setFramePivot, setFramePosition, sheetCellSize, sheetThumbBox, sheetThumbScale,
  pivotFromUi, uiFromPivot,
} from '../src/core/sheetEdit';
import { IDENTITY, type Mat2D } from '../src/core/runtime/math';

/** 复刻官方样例 FramesAnimation 的结构（type=sheet / frameRate=6 / 3 帧，真实是 7 帧）。 */
const sample = (): DbArmatureData => ({
  name: 'boy-fall',
  type: 'sheet',
  frameRate: 6,
  bone: [{ name: 'root' }],
  slot: [{ name: 'sheetSlot', parent: 'root' }],
  skin: [{
    name: '',
    slot: [{
      name: 'sheetSlot',
      display: [
        { name: 'f0', path: 'f0', type: 'image' },
        { name: 'f1', path: 'f1', type: 'image' },
        { name: 'f2', path: 'f2', type: 'image' },
      ],
    }],
  }],
  animation: [{
    name: 'boy-fall',
    duration: 3,
    slot: [{
      name: 'sheetSlot',
      frame: [
        { duration: 1, tweenEasing: null },
        { duration: 1, tweenEasing: null, displayIndex: 1 },
        { duration: 1, tweenEasing: null, displayIndex: 2 },
      ],
    }],
  }],
});

const indices = (armature: DbArmatureData) => armature.animation![0].slot![0].frame!.map((f) => f.displayIndex);
const names = (armature: DbArmatureData) => armature.skin[0].slot[0].display.map((d) => d.name);

describe('序列帧工程识别与读取（官方 type="sheet"）', () => {
  it('只有 type=sheet 才算序列帧工程', () => {
    expect(isSheetArmature(sample())).toBe(true);
    expect(isSheetArmature({ ...sample(), type: 'Armature' })).toBe(false);
    expect(isSheetArmature({ ...sample(), type: undefined })).toBe(false);
    expect(isSheetArmature(null)).toBe(false);
  });

  it('读出槽位 / 帧 / 帧频 / 时间轴', () => {
    const sheet = readSheetFrames(sample())!;
    expect(sheet.slot).toBe('sheetSlot');
    expect(sheet.frames.length).toBe(3);
    expect(sheet.frameRate).toBe(6);
    expect(sheet.animation?.name).toBe('boy-fall');
    expect(sheet.timeline?.frame?.length).toBe(3);
    expect(readSheetFrames({ ...sample(), type: 'Armature' })).toBeNull();
  });
});

describe('按名字排序（官方 `_13390` / `_13391` 自然排序 + `RESET_SHEET_ORDER`）', () => {
  it('切词：数字段 / 字符串段交替，数字段转 int', () => {
    expect(frameNameTokens('4_fall_1')).toEqual([4, '_fall_', 1]);
    expect(frameNameTokens('f10')).toEqual(['f', 10]);
    expect(frameNameTokens('')).toEqual([]);
  });

  it('自然排序：f2 在 f10 之前（按数字比，不是按字符串比）', () => {
    expect(compareFrameNames('f2', 'f10')).toBeLessThan(0);
    expect(compareFrameNames('f10', 'f2')).toBeGreaterThan(0);
    expect(compareFrameNames('4_fall_2', '4_fall_10')).toBeLessThan(0);
    expect(compareFrameNames('a', 'a')).toBe(0);
    expect(compareFrameNames('a', 'ab')).toBeLessThan(0);   // 短前缀在前
  });

  it('排序只重排 display 数组，displayIndex 完全不变（官方 `_13198`）', () => {
    const armature = sample();
    armature.skin[0].slot[0].display = [
      { name: 'f10', path: 'f10', type: 'image' },
      { name: 'f2', path: 'f2', type: 'image' },
      { name: 'f1', path: 'f1', type: 'image' },
    ];
    expect(indices(armature)).toEqual([undefined, 1, 2]);
    expect(sortFramesByName(armature, 'sheetSlot', true)).toBe(true);
    expect(names(armature)).toEqual(['f1', 'f2', 'f10']);    // 自然序，不是 f1/f10/f2
    expect(indices(armature)).toEqual([undefined, 1, 2]);    // 时间轴引用一个都没动
    expect(sortFramesByName(armature, 'sheetSlot', false)).toBe(true);
    expect(names(armature)).toEqual(['f10', 'f2', 'f1']);
  });

  it('顺序没变 / 单帧 / 槽位不存在时返回 false', () => {
    const armature = sample();                                // 已经是 f0 / f1 / f2
    expect(sortFramesByName(armature, 'sheetSlot', true)).toBe(false);
    const single = sample();
    single.skin[0].slot[0].display = [{ name: 'only', type: 'image' }];
    expect(sortFramesByName(single, 'sheetSlot', true)).toBe(false);
    expect(sortFramesByName(sample(), 'nope', true)).toBe(false);
  });
});

describe('帧操作', () => {
  it('删除帧会摘掉该切换点、后续索引前移、时长减一', () => {
    const armature = sample();
    expect(removeFrame(armature, 'sheetSlot', 1)).toBe(true);
    expect(names(armature)).toEqual(['f0', 'f2']);
    expect(indices(armature)).toEqual([undefined, 1]);
    expect(armature.animation![0].duration).toBe(2);
  });

  it('追加一帧：display、displayIndex、时长一起加一', () => {
    const armature = sample();
    armature.animation!.push({
      name: 'extra',
      duration: 3,
      slot: [{ name: 'sheetSlot', frame: [{ duration: 1, tweenEasing: null }] }],
    });
    expect(appendSheetFrame(armature, 'f3')).toBe(3);
    expect(names(armature)).toEqual(['f0', 'f1', 'f2', 'f3']);
    expect(indices(armature)).toEqual([undefined, 1, 2, 3]);
    expect(armature.animation![0].duration).toBe(4);
    expect(armature.animation![1].slot![0].frame!.at(-1)?.displayIndex).toBe(3);
    expect(armature.animation![1].duration).toBe(4);
    expect(appendSheetFrame({ ...sample(), type: 'Armature' }, 'x')).toBeNull();
  });

  it('锚点世界坐标写 (10, -4) 再读回', () => {
    const frame: DbDisplayData = { name: 'f', type: 'image', transform: { x: 1, y: 2 } };
    const turned: Mat2D = [0, 1, -1, 0, 3, 5];
    expect(setFrameAnchorWorld(frame, IDENTITY, 10, -4)).toBe(true);
    const identity = frameAnchorWorld(IDENTITY, frame);
    expect(Math.abs(identity.x - 10)).toBeLessThan(1e-4);
    expect(Math.abs(identity.y - (-4))).toBeLessThan(1e-4);
    expect(setFrameAnchorWorld(frame, turned, 10, -4)).toBe(true);
    const world = frameAnchorWorld(turned, frame);
    expect(Math.abs(world.x - 10)).toBeLessThan(1e-4);
    expect(Math.abs(world.y - (-4))).toBeLessThan(1e-4);
    expect(setFrameAnchorWorld(frame, IDENTITY, Number.NaN, 0)).toBe(false);
  });

  it('只剩一帧时不允许删除', () => {
    const armature = sample();
    armature.skin[0].slot[0].display = [{ name: 'only', type: 'image' }];
    expect(removeFrame(armature, 'sheetSlot', 0)).toBe(false);
  });
});

describe('帧频 / 循环 / 播放次数', () => {
  it('帧频按官方面板限制在 1..99 的整数', () => {
    const armature = sample();
    expect(setFrameRate(armature, 12.4)).toBe(true);
    expect(armature.frameRate).toBe(12);
    expect(setFrameRate(armature, 0)).toBe(true);
    expect(armature.frameRate).toBe(1);
    expect(setFrameRate(armature, 500)).toBe(true);
    expect(armature.frameRate).toBe(99);
    expect(setFrameRate(armature, 99)).toBe(false);   // 没变就不算改动
  });

  it('循环 = playTimes 0；取消循环回到次数', () => {
    const armature = sample();
    const animation = armature.animation![0];
    expect(isLooping(animation)).toBe(true);          // 缺省按循环
    expect(setPlayTimes(animation, 3)).toBe(true);
    expect(animation.playTimes).toBe(3);
    expect(isLooping(animation)).toBe(false);
    expect(setLoop(animation, true)).toBe(true);
    expect(animation.playTimes).toBe(0);
    expect(isLooping(animation)).toBe(true);
    expect(setLoop(animation, false)).toBe(true);
    expect(animation.playTimes).toBe(1);
    expect(setPlayTimes(null, 3)).toBe(false);
  });
});
// 官方 `_953/_13221.as`（位置 / 轴心 / 翻转 / 应用所有帧）与 `_935/_13217.as`（九宫格轴心）
describe('帧编辑条：位置 / 轴心 / 翻转 / 应用所有帧', () => {
  const frame = (): DbDisplayData => ({ name: 'f', type: 'image' });

  it('缺省值与运行时一致（位置 0、轴心 0.5/0.5、未翻转）', () => {
    expect(readFrameValues(frame())).toEqual({ x: 0, y: 0, pivotX: 0.5, pivotY: 0.5, flipX: false, flipY: false });
    expect(readFrameValues(undefined).pivotX).toBe(0.5);
  });

  it('位置 X/Y 夹在 ±999999（官方 MAX_POSITION）', () => {
    const a = frame();
    expect(setFramePosition(a, 'x', 12.5)).toBe(true);
    expect(a.transform?.x).toBe(12.5);
    expect(setFramePosition(a, 'y', 1e9)).toBe(true);
    expect(a.transform?.y).toBe(999999);
    expect(setFramePosition(a, 'y', 999999)).toBe(false);
    expect(setFramePosition(a, 'x', NaN)).toBe(false);
  });

  it('轴心：九宫格 9 个取值 + 手动 X/Y', () => {
    expect(SHEET_ANCHORS.length).toBe(9);
    expect(SHEET_ANCHORS[0]).toEqual({ id: 'LEFT_TOP', x: 0.5, y: 0.5 });
    expect(SHEET_ANCHORS[8]).toEqual({ id: 'RIGHT_BOTTOM', x: -0.5, y: -0.5 });
    const a = frame();
    expect(setFramePivot(a, 0.5, -0.5)).toBe(true);
    expect(a.pivot).toEqual({ x: 0.5, y: -0.5 });
    expect(setFramePivot(a, 0.5, -0.5)).toBe(false);
  });

  it('九宫格 UI 值 ↔ pivot 换算（官方 pivot = 0.5 - uiValue）', () => {
    // 官方 `_13335()`：UI (0.5, 0.5) = 左上、UI (0, 0) = 中心
    expect(uiFromPivot(0.5)).toBe(0);
    expect(uiFromPivot(0)).toBe(0.5);
    expect(pivotFromUi(0.5)).toBe(0);
    expect(pivotFromUi(0)).toBe(0.5);
    // 点「左上」→ 数据 pivot (0, 0)（原点在图片左上角）
    const leftTop = SHEET_ANCHORS.find((entry) => entry.id === 'LEFT_TOP')!;
    expect(pivotFromUi(leftTop.x)).toBe(0);
    expect(pivotFromUi(leftTop.y)).toBe(0);
    // 点「中心」→ 数据 pivot (0.5, 0.5)
    const middle = SHEET_ANCHORS.find((entry) => entry.id === 'MIDDLE_MIDDLE')!;
    expect(pivotFromUi(middle.x)).toBe(0.5);
    expect(pivotFromUi(middle.y)).toBe(0.5);
    // 往返
    expect(uiFromPivot(pivotFromUi(0.25))).toBeCloseTo(0.25, 12);
    expect(pivotFromUi(uiFromPivot(-0.5))).toBeCloseTo(-0.5, 12);
  });

  it('翻转是把缩放取反，再翻回来恢复正数', () => {
    const a = frame();
    expect(flipFrame(a, 'x')).toBe(true);
    expect(a.transform?.scX).toBe(-1);
    expect(readFrameValues(a).flipX).toBe(true);
    expect(flipFrame(a, 'x')).toBe(true);
    expect(a.transform?.scX).toBe(1);
    expect(flipFrame(a, 'y')).toBe(true);
    expect(a.transform?.scY).toBe(-1);
  });

  it('应用所有帧：把源帧的变换与轴心抄给其余帧', () => {
    const frames: DbDisplayData[] = [{ name: 'a', type: 'image' }, { name: 'b', type: 'image' }, { name: 'c', type: 'image' }];
    setFramePosition(frames[0], 'x', 30);
    setFramePivot(frames[0], 0, -0.5);
    expect(applyFrameToAll(frames, 0)).toBe(2);
    expect(frames[1].transform?.x).toBe(30);
    expect(frames[2].pivot).toEqual({ x: 0, y: -0.5 });
    expect(applyFrameToAll(frames, 9)).toBe(0);
  });
});

/**
 * 删帧必须覆盖**两种时间轴形式**：JSON 工程用 4.x 的合并 `frame[]`，
 * `*_ske.dbbin` 解码后是 5.x 的 `displayFrame[]`（官方把同一个 `frame[]` 拆成
 * `SlotDisplay(20)` + `SlotColor(21)`，见 §103）。只处理前者会让二进制工程删帧后
 * 时间轴仍指向旧下标（实测：删了第 1 帧，时间轴还是 `[0,1,2,3,4,5,6]`）。
 */
describe('删帧：5.x 组件时间轴形式（dbbin 解码后）', () => {
  const displayFrameForm = (): DbArmatureData => {
    const armature = sample();
    const timeline = armature.animation![0].slot![0];
    timeline.displayFrame = [
      { duration: 1, tweenEasing: Number.NaN, value: 0 },
      { duration: 1, tweenEasing: Number.NaN, value: 1 },
      { duration: 1, tweenEasing: Number.NaN, value: 2 },
    ];
    delete timeline.frame;
    return armature;
  };
  const values = (armature: DbArmatureData) =>
    armature.animation![0].slot![0].displayFrame!.map((frame) => frame.value ?? 0);

  it('删中间一帧：display 前移、value 重排、时长减一', () => {
    const armature = displayFrameForm();
    expect(removeFrame(armature, 'sheetSlot', 1)).toBe(true);
    expect(names(armature)).toEqual(['f0', 'f2']);
    expect(values(armature)).toEqual([0, 1]);
    expect(armature.animation![0].duration).toBe(2);
  });

  it('value 归零时删掉字段（与官方「缺省 = 0」的表达一致）', () => {
    const armature = displayFrameForm();
    expect(removeFrame(armature, 'sheetSlot', 0)).toBe(true);
    const frames = armature.animation![0].slot![0].displayFrame!;
    expect(frames).toHaveLength(2);
    expect(frames[0].value).toBeUndefined();
    expect(values(armature)).toEqual([0, 1]);
  });

  it('两种形式同时在场时都重排', () => {
    const armature = displayFrameForm();
    armature.animation![0].slot![0].frame = [
      { duration: 1, tweenEasing: null },
      { duration: 1, tweenEasing: null, displayIndex: 1 },
      { duration: 1, tweenEasing: null, displayIndex: 2 },
    ];
    expect(removeFrame(armature, 'sheetSlot', 1)).toBe(true);
    expect(indices(armature)).toEqual([undefined, 1]);
    expect(values(armature)).toEqual([0, 1]);
  });

  it('颜色轨被裁到与 display 轨同长（并列轨不会悬空）', () => {
    const armature = displayFrameForm();
    armature.animation![0].slot![0].colorFrame = [
      { duration: 1, tweenEasing: Number.NaN, value: { aM: 100 } },
      { duration: 1, tweenEasing: Number.NaN, value: { aM: 90 } },
      { duration: 1, tweenEasing: Number.NaN, value: { aM: 80 } },
    ];
    removeFrame(armature, 'sheetSlot', 1);
    expect(armature.animation![0].slot![0].colorFrame).toHaveLength(2);
  });
});

/** 绑定的 `slot.displayIndex` 指向被删帧时要跟着走，否则运行时索引越界。 */
describe('删帧后绑定 displayIndex 的重定位', () => {
  it('删掉的正是绑定值 → 落到同一下标（那里现在是原来的下一帧）', () => {
    const armature = sample();
    armature.slot![0].displayIndex = 1;
    removeFrame(armature, 'sheetSlot', 1);
    expect(armature.slot![0].displayIndex).toBe(1);
  });

  it('绑定值是 0 且被删的也是 0 → 回落缺省（0 用缺省表达）', () => {
    const armature = sample();
    armature.slot![0].displayIndex = 0;
    removeFrame(armature, 'sheetSlot', 0);
    expect(armature.slot![0].displayIndex).toBeUndefined();
  });

  it('绑定值在删除点之后 → 前移一位', () => {
    const armature = sample();
    armature.slot![0].displayIndex = 2;
    removeFrame(armature, 'sheetSlot', 1);
    expect(armature.slot![0].displayIndex).toBe(1);
  });

  it('绑定值越界 → 夹回最后一帧', () => {
    const armature = sample();
    armature.slot![0].displayIndex = 2;             // 删掉最后一帧后只剩 2 帧（下标 0..1）
    removeFrame(armature, 'sheetSlot', 2);
    expect(armature.slot![0].displayIndex).toBe(1);
  });
});

/**
 * 帧格子尺寸 —— 官方 `_13215`（列表项）/ `_13213`（列表）/ `_13211`（缩略图）三组常量与算式。
 * 「高度对齐」的判据就落在这里：格子边长只由布局高决定，与实际显示内容无关。
 */
describe('帧格子尺寸与缩略图换算（官方 _13215 / _13213 / _13211）', () => {
  it('边长 = clamp(80, 可用高, 200)；NaN 回退缺省 100', () => {
    expect(sheetCellSize(120)).toBe(120);
    expect(sheetCellSize(80)).toBe(80);
    expect(sheetCellSize(200)).toBe(200);
    expect(sheetCellSize(50)).toBe(80);              // 低于 MIN
    expect(sheetCellSize(400)).toBe(200);            // 高于 MAX
    expect(sheetCellSize(Number.NaN)).toBe(SHEET_CELL_DEFAULT);
  });

  it('缩略图盒 = 格子 − IMAGE_GAP(30)', () => {
    expect(sheetThumbBox(100)).toBe(70);
    expect(sheetThumbBox(200)).toBe(170);
    expect(sheetThumbBox(20)).toBe(1);               // 不出现 0/负值
  });

  it('缩略图按最长边适配且**不放大**（官方 k ≤ 1）', () => {
    expect(sheetThumbScale(170, 50, 40)).toBe(1);                    // 小图保持原尺寸
    expect(sheetThumbScale(170, 340, 100)).toBeCloseTo(0.5, 12);     // 按宽
    expect(sheetThumbScale(170, 100, 340)).toBeCloseTo(0.5, 12);     // 按高
    expect(sheetThumbScale(170, 0, 0)).toBe(1);                      // 无尺寸信息
  });

  it('滚动条预留常量与 CSS 的 10px 一致（格子按它留安全区）', () => {
    expect(SHEET_SCROLLBAR).toBe(10);
  });
});