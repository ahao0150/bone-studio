import { describe, expect, it } from 'vitest';
import { outlineVertexIndices, pickOutlineEdge, pickOutlineVertex } from '../src/core/slotOutlinePick';

/** 一个 4 顶点方块：世界坐标 → 屏幕坐标是 ×scale + pan。 */
const positions = [0, 0, 100, 0, 100, 60, 0, 60];
const outline: Array<[number, number]> = [[0, 1], [1, 2], [2, 3], [3, 0]];
const view = { scale: 2, panX: 10, panY: 20 };
// 屏幕坐标：v0=(10,20) v1=(210,20) v2=(210,140) v3=(10,140)

describe('插槽轮廓命中：连接点', () => {
  it('lists every outline vertex once, in edge order', () => {
    expect(outlineVertexIndices(outline)).toEqual([0, 1, 2, 3]);
    expect(outlineVertexIndices([[1, 0], [0, 2]])).toEqual([1, 0, 2]);
  });

  it('picks the nearest connection point inside the threshold', () => {
    expect(pickOutlineVertex(positions, outline, 12, 23, view)).toBe(0);
    expect(pickOutlineVertex(positions, outline, 208, 138, view)).toBe(2);
  });

  it('returns null when the click is nowhere near a connection point', () => {
    expect(pickOutlineVertex(positions, outline, 110, 80, view)).toBeNull();
  });
});

describe('插槽轮廓命中：线条', () => {
  it('picks the nearest edge together with its parameter t', () => {
    expect(pickOutlineEdge(positions, outline, 110, 21, view)).toEqual({ a: 0, b: 1, t: 0.5 });
  });

  it('clamps t at the segment end and ignores edges that are too far', () => {
    expect(pickOutlineEdge([0, 0, 50, 0], [[0, 1]], 52, 0, { scale: 1, panX: 0, panY: 0 }))
      .toEqual({ a: 0, b: 1, t: 1 });
    expect(pickOutlineEdge(positions, outline, 110, 80, view)).toBeNull();
  });
});