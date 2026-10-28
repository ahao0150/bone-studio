/** 右键「移到上一层 / 下一层 / 最上层 / 最下层」：数据、zOrder 时间轴改写、渲染器子节点顺序。 */
import { describe, expect, it } from 'vitest';
import { Player } from '../src/core/player';
import { reorderSlot } from '../src/core/editing';
import { setBindOrder } from '../src/core/zorderEdit';
import { authoringToOrder, sampleZOrder } from '../src/core/runtime/animation';
import { syncChildOrder } from '../src/render/childOrder';

const NAMES = ['a', 'b', 'c', 'd'];
function doc() {
  return {
    name: 't', version: '5.5', frameRate: 24,
    armature: [{
      type: 'Armature', name: 'arm', frameRate: 24,
      bone: [{ name: 'root' }],
      slot: NAMES.map((name) => ({ name, parent: 'root' })),
      skin: [{ slot: [] }],
      animation: [
        // 帧 0 没有层级键；帧 10：d 挪到最下层（[3,-3]）
        { name: 'anim', duration: 20, zOrder: { frame: [{ duration: 10 }, { duration: 10, zOrder: [3, -3] }] } },
        { name: 'plain', duration: 10 },
      ],
    }],
  };
}
const slotNames = (p: Player) => p.skeleton.armature.slot.map((s) => s.name);
/** 某一帧的绝对绘制顺序（自下而上的槽位名） */
const orderAt = (p: Player, anim: string, frame: number) => {
  const a = (p.skeleton.armature.animation ?? []).find((x) => x.name === anim);
  const names = slotNames(p);
  const order = sampleZOrder(a ?? null, frame, names.length);
  return order ? order.map((i) => names[i]) : names;
};

describe('reorderSlot (stage context menu)', () => {
  it('forward / backward / front / bottom change the setup order', () => {
    const p = new Player(doc(), null);
    expect(reorderSlot(p, 'b', 'forward')).toBe(true);
    expect(slotNames(p)).toEqual(['a', 'c', 'b', 'd']);
    expect(reorderSlot(p, 'b', 'backward')).toBe(true);
    expect(slotNames(p)).toEqual(['a', 'b', 'c', 'd']);
    expect(reorderSlot(p, 'a', 'front')).toBe(true);
    expect(slotNames(p)).toEqual(['b', 'c', 'd', 'a']);
    expect(reorderSlot(p, 'a', 'bottom')).toBe(true);
    expect(slotNames(p)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('returns false at the edges (no history entry / no rebuild)', () => {
    const p = new Player(doc(), null);
    expect(reorderSlot(p, 'd', 'front')).toBe(false);
    expect(reorderSlot(p, 'd', 'forward')).toBe(false);
    expect(reorderSlot(p, 'a', 'bottom')).toBe(false);
    expect(reorderSlot(p, 'zzz', 'front')).toBe(false);
    expect(slotNames(p)).toEqual(NAMES);
  });
  it('keyed zOrder frames keep their absolute order; un-keyed time follows the new setup', () => {
    const p = new Player(doc(), null);
    expect(orderAt(p, 'anim', 12)).toEqual(['d', 'a', 'b', 'c']);
    reorderSlot(p, 'a', 'front');                                   // setup: b c d a
    expect(slotNames(p)).toEqual(['b', 'c', 'd', 'a']);
    expect(orderAt(p, 'anim', 2)).toEqual(['b', 'c', 'd', 'a']);    // 无键时段跟随新 setup
    expect(orderAt(p, 'anim', 12)).toEqual(['d', 'a', 'b', 'c']);   // 关键帧处不变
    const frame = p.skeleton.armature.animation![0].zOrder!.frame![1];
    expect(authoringToOrder(frame.zOrder, 4)!.map((i) => slotNames(p)[i])).toEqual(['d', 'a', 'b', 'c']);
  });
  it('setBindOrder (layer panel) remaps the same way', () => {
    const p = new Player(doc(), null);
    expect(setBindOrder(p, ['d', 'c', 'b', 'a'])).toBe(true);
    expect(orderAt(p, 'anim', 12)).toEqual(['d', 'a', 'b', 'c']);
    expect(orderAt(p, 'anim', 0)).toEqual(['d', 'c', 'b', 'a']);
  });
});

describe('syncChildOrder (renderer)', () => {
  it('reorders cached meshes to the frame draw order and keeps unseen children last', () => {
    type Node = { label: string; parent?: unknown };
    const layer = { children: [] as Node[], removeChildren() { this.children = []; }, addChild(x: Node) { x.parent = layer; this.children.push(x); } };
    const [a, b, c, hidden] = ['a', 'b', 'c', 'h'].map((label) => { const x: Node = { label }; layer.addChild(x); return x; });
    syncChildOrder(layer, [a, b, c]);
    expect(layer.children.map((x) => x.label)).toEqual(['a', 'b', 'c', 'h']);
    syncChildOrder(layer, [c, a, b]);
    expect(layer.children.map((x) => x.label)).toEqual(['c', 'a', 'b', 'h']);
    expect(hidden.parent).toBe(layer);
  });
});

describe('encodeOrder', () => {
  it('round-trips every permutation of 4 (falls back when the minimal form is lossy)', async () => {
    const { encodeOrder } = await import('../src/core/zorderRemap');
    const perms = (xs: number[]): number[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((r) => [x, ...r])));
    for (const order of perms([0, 1, 2, 3])) {
      const pairs = encodeOrder(order, 4);
      expect(pairs ? authoringToOrder(pairs, 4) : [0, 1, 2, 3]).toEqual(order);
    }
  });
});
