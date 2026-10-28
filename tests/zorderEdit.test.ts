/**
 * 「层级」（绘制顺序）编辑内核 —— 官方 `_857/DrawOrderPanel` + `_555/_558` 的等价物。
 *
 * 夹具 `samples/out-zorder-new` 是 Bicycle 工程加了一条人工写的 z-order 时间轴
 * （`zOrder: [[0, 22]]` → 槽位 0 挪到绘制顺序的最上层），它的二进制产物由随程序发布的工具链产出。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { Player } from '../src/core/player';
import { authoringToOrder, longestIncreasingSubsequence, orderToAuthoring, sampleZOrder } from '../src/core/runtime/animation';
import {
  bindOrder, drawOrder, moveSlotOrder, namesToOrder, orderMarks, removeZOrderKeyframe,
  setBindOrder, setZOrderKeyframe, zOrderKeyed, zOrderKeyStatus,
} from '../src/core/zorderEdit';
import { emptySkeleton } from '../src/core/project/newProject';

const ORACLE = 'samples/out-zorder-new';
const SKELETON = `${ORACLE}/Bicycle_ske.json`;
const TEXTURE = `${ORACLE}/Bicycle_tex.json`;
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const hasFixture = existsSync(SKELETON) && existsSync(TEXTURE);
const SLOT_COUNT = 23;

/** 单槽位挪到最上层之后的顺序：`[1,2,…,22,0]`。 */
const MOVED_ORDER = [...Array(SLOT_COUNT - 1).keys()].map((i) => i + 1).concat(0);

describe('z-order 顺序与授权形态的互逆', () => {
  it('authoringToOrder 把 [0,22] 展开成「槽位 0 画在最上层」', () => {
    expect(authoringToOrder([0, 22], SLOT_COUNT)).toEqual(MOVED_ORDER);
  });

  it('orderToAuthoring 写出**最小**对数 —— 单个槽位移动就只有一对', () => {
    expect(orderToAuthoring(MOVED_ORDER, SLOT_COUNT)).toEqual([0, 22]);
  });

  it('任意排列都能往返（含置顶 / 置底 / 交换 / 还原）', () => {
    const cases: number[][] = [
      MOVED_ORDER,
      // 槽位 22 挪到最下层
      [SLOT_COUNT - 1, ...Array(SLOT_COUNT - 1).keys()],
      [1, 0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22],
      swap(SLOT_COUNT, 3, 17),
      [...Array(SLOT_COUNT).keys()],
    ];
    for (const order of cases) {
      const pairs = orderToAuthoring(order, SLOT_COUNT);
      // 空对数 = 「恢复原始顺序」，运行时按绑定顺序画 ⇒ 等价于恒等排列
      const restored = authoringToOrder(pairs ?? undefined, SLOT_COUNT) ?? [...Array(SLOT_COUNT).keys()];
      expect(restored).toEqual(order);
    }
    // 本来就是绑定顺序 => 不需要任何对数（运行时「恢复原始顺序」）
    expect(orderToAuthoring([...Array(SLOT_COUNT).keys()], SLOT_COUNT)).toBeNull();
  });

  it('LIS 挑出「没动过」的那些（官方 _10669 的等价物）', () => {
    expect(longestIncreasingSubsequence(MOVED_ORDER)).toEqual([...Array(SLOT_COUNT - 1).keys()]);
    // 官方口径：值序列升序（`_10670` 从最优末尾往回走、从后往前写回数组）
    expect(longestIncreasingSubsequence([1, 0, 2])).toEqual([0, 2]);
  });

  it('位移箭头：比绑定顺序靠前画上箭头、靠后画下箭头、没动过不画', () => {
    const bind = Array.from({ length: SLOT_COUNT }, (_, i) => `s${i}`);
    const marks = orderMarks(bind, MOVED_ORDER);
    expect(marks.get('s0')).toBe(-1);
    expect(marks.size).toBe(1);
    expect(marks.get('s5')).toBeUndefined();
    // 反向：槽位 22 挪到最下层
    const down = orderMarks(bind, [22, ...Array(SLOT_COUNT - 1).keys()]);
    expect(down.get('s22')).toBe(1);
    expect(down.size).toBe(1);
  });

  it('moveSlotOrder 的四个动作（越界时不动）', () => {
    const bind = ['a', 'b', 'c', 'd'];
    const base = [0, 1, 2, 3];
    expect(moveSlotOrder(bind, base, 'b', 'forward')).toEqual([0, 2, 1, 3]);
    expect(moveSlotOrder(bind, base, 'c', 'backward')).toEqual([0, 2, 1, 3]);
    expect(moveSlotOrder(bind, base, 'b', 'front')).toEqual([0, 2, 3, 1]);
    expect(moveSlotOrder(bind, base, 'c', 'bottom')).toEqual([2, 0, 1, 3]);
    expect(moveSlotOrder(bind, base, 'd', 'forward')).toBeNull();
    expect(moveSlotOrder(bind, base, 'a', 'backward')).toBeNull();
  });
});

describe('运行时：授权 zOrder 对（JSON 形态）也要生效', () => {
  it.skipIf(!hasFixture)('画到最上层的槽位换了位置，帧 2 的「恢复」帧还原', () => {
    const player = new Player(readJson(SKELETON), readJson(TEXTURE) as never);
    const bind = bindOrder(player);
    expect(bind).toHaveLength(SLOT_COUNT);

    player.seek(0);
    const reordered = drawOrder(player);
    expect(reordered).not.toEqual(bind);
    // 槽位 0 被挪到绘制顺序的最后一格（画在最上层）
    expect(reordered[reordered.length - 1]).toBe(bind[0]);
    expect(reordered[0]).toBe(bind[1]);

    player.seek(36);
    expect(drawOrder(player)).toEqual(bind);
  });

  it.skipIf(!hasFixture)('关键帧位置与旗杆状态（0 / 27 有键，10 没有）', () => {
    const player = new Player(readJson(SKELETON), readJson(TEXTURE) as never);
    expect(zOrderKeyed(player, 0)).toBe(true);
    expect(zOrderKeyed(player, 27)).toBe(true);
    expect(zOrderKeyed(player, 10)).toBe(false);
    expect(zOrderKeyStatus(false, true)).toBe(1);
    expect(zOrderKeyStatus(true, true)).toBe(2);
    expect(zOrderKeyStatus(false, false)).toBe(0);
    expect(sampleZOrder(player.animation, 0, SLOT_COUNT)).toEqual(MOVED_ORDER);
  });
});

describe('落帧与删除（编辑器写出的授权形态）', () => {
  const makePlayer = () => {
    const doc = emptySkeleton() as { armature: Array<Record<string, unknown>> };
    const armature = doc.armature[0];
    armature.slot = [
      { name: 'a', parent: 'root' },
      { name: 'b', parent: 'root' },
      { name: 'c', parent: 'root' },
    ];
    armature.animation = [{ name: 'Animation1', duration: 24, bone: [], slot: [], ffd: [] }];
    return new Player(doc);
  };

  it('setZOrderKeyframe 写出最小对数；删掉后回到绑定顺序', () => {
    const player = makePlayer();
    expect(drawOrder(player)).toEqual(['a', 'b', 'c']);

    // 拖到「c 画在最下层」= 顺序 [2,0,1]
    expect(setZOrderKeyframe(player, [2, 0, 1])).toBe(true);
    const frames = player.animation?.zOrder?.frame ?? [];
    expect(frames).toHaveLength(1);
    expect(frames[0].duration).toBe(24);
    expect(frames[0].zOrder).toEqual([2, -2]);
    expect(frames[0].order).toBeUndefined();
    expect(drawOrder(player)).toEqual(['c', 'a', 'b']);

    expect(removeZOrderKeyframe(player, 0)).toBe(true);
    expect(player.animation?.zOrder).toBeUndefined();
    expect(drawOrder(player)).toEqual(['a', 'b', 'c']);
    expect(removeZOrderKeyframe(player, 0)).toBe(false);
  });

  it('同一帧再打一次是覆盖，中间帧各自带自己的时长', () => {
    const player = makePlayer();
    setZOrderKeyframe(player, [2, 0, 1]);
    player.seek(12);
    setZOrderKeyframe(player, [0, 2, 1]);
    let frames = player.animation?.zOrder?.frame ?? [];
    expect(frames.map((frame) => frame.duration)).toEqual([12, 12]);
    player.seek(0);
    setZOrderKeyframe(player, [1, 0, 2]);
    frames = player.animation?.zOrder?.frame ?? [];
    expect(frames).toHaveLength(2);
    // 顺序 [1,0,2] 的最小对数 = 槽位 0 挪到第 1 格（LIS 保留 1、2）
    expect(frames[0].zOrder).toEqual([0, 1]);
    expect(frames[0].duration).toBe(12);
  });

  it('装配模式把绑定顺序整体写回 armature.slot', () => {
    const player = makePlayer();
    expect(setBindOrder(player, ['c', 'a', 'b'])).toBe(true);
    expect(bindOrder(player)).toEqual(['c', 'a', 'b']);
    expect(drawOrder(player)).toEqual(['c', 'a', 'b']);
    expect(setBindOrder(player, ['c', 'a'])).toBe(false);
  });

  it('namesToOrder 是 bindOrder 的逆', () => {
    expect(namesToOrder(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual([2, 0, 1]);
  });
});

function swap(count: number, i: number, j: number): number[] {
  const out = [...Array(count).keys()];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
