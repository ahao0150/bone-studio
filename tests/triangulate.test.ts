import { describe, expect, it } from 'vitest';
import {
  hasEdge, signedArea, triangleAreaSum, triangulateMesh, type IndexEdge, type Point2,
} from '../src/core/triangulate';

const square: Point2[] = [[0, 0], [2, 0], [2, 2], [0, 2]];
const squareEdges: IndexEdge[] = [[0, 1], [1, 2], [2, 3], [3, 0]];
// L 形（凹多边形，逆时针），面积 3
const lShape: Point2[] = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]];
const lEdges: IndexEdge[] = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]];

describe('三角形面积与朝向', () => {
  it('reports signed area with the right sign', () => {
    expect(signedArea(square)).toBeCloseTo(4, 9);          // 逆时针为正
    expect(signedArea([...square].reverse())).toBeCloseTo(-4, 9);
  });
});

describe('约束三角化（官方 _653._5674 的契约）', () => {
  it('triangulates a convex square so that every outline edge survives', () => {
    const triangles = triangulateMesh(square, squareEdges);
    expect(triangles.length).toBe(2);
    expect(triangleAreaSum(square, triangles)).toBeCloseTo(4, 9);
    for (const [a, b] of squareEdges) expect(hasEdge(triangles, a, b)).toBe(true);
  });

  it('handles a concave L-shape without spilling outside the polygon', () => {
    const triangles = triangulateMesh(lShape, lEdges);
    expect(triangles.length).toBeGreaterThan(0);
    // 面积和必须正好等于多边形面积（多一个三角形就会盖到外面）
    expect(triangleAreaSum(lShape, triangles)).toBeCloseTo(3, 9);
    for (const [a, b] of lEdges) expect(hasEdge(triangles, a, b)).toBe(true);
  });

  it('inserts interior vertices and keeps the covered area identical', () => {
    // 正方形 + 一个内部点（下标 4）+ 一个落在外面的点（下标 5，应当被忽略）。
    // 内部点刻意避开对角线 y=x —— 落在三角形边上会切出退化三角形，那是另一回事。
    const vertices: Point2[] = [...square, [0.6, 1.3], [9, 9]];
    const triangles = triangulateMesh(vertices, squareEdges);
    expect(triangles.length).toBe(4);
    expect(triangleAreaSum(vertices, triangles)).toBeCloseTo(4, 9);
    expect(triangles.some((cell) => cell.includes(4))).toBe(true);
    expect(triangles.some((cell) => cell.includes(5))).toBe(false);
  });

  it('accepts clockwise outlines and falls back to vertex order without an edge list', () => {
    const cw = triangulateMesh([...square].reverse(), [[0, 1], [1, 2], [2, 3], [3, 0]]);
    expect(cw.length).toBe(2);
    expect(triangleAreaSum([...square].reverse(), cw)).toBeCloseTo(4, 9);

    const noEdges = triangulateMesh(square);
    expect(noEdges.length).toBe(2);
  });

  it('returns nothing for degenerate input', () => {
    expect(triangulateMesh([[0, 0], [1, 1]])).toEqual([]);
    expect(triangulateMesh([[0, 0], [1, 0], [2, 0]], [[0, 1], [1, 2], [2, 0]])).toEqual([]);
  });
});