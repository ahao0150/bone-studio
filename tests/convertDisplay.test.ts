/**
 * 「转换为图片」（官方 MenuItem-convertToImage）：网格显示对象丢掉网格与权重数据，退化成图片。
 */
import { describe, expect, it } from 'vitest';
import { convertMeshToImage, isMeshDisplay } from '../src/core/meshEdit';
import type { DbDisplayData } from '../src/core/types';

const mesh = (): DbDisplayData => ({
  name: 'art', path: 'art', type: 'mesh', width: 16, height: 16,
  vertices: [0, 0, 16, 0, 16, 16, 0, 16],
  uvs: [0, 0, 1, 0, 1, 1, 0, 1],
  triangles: [0, 1, 2, 0, 2, 3],
  edges: [0, 1, 1, 2, 2, 3, 3, 0],
  weights: [1, 0, 1],
  bonePose: [1, 0, 0, 1, 0, 0],
  bindOffsets: [1, 0, 0],
  weightBones: [0],
  slotPose: [1, 0, 0, 1, 0, 0],
  offset: 7,
});

describe('转换为图片（官方 MenuItem-convertToImage）', () => {
  it('turns a mesh display into a plain image and drops the mesh data', () => {
    const display = mesh();
    expect(isMeshDisplay(display)).toBe(true);
    expect(convertMeshToImage(display)).toBe(true);
    expect(display.type).toBe('image');
    for (const key of ['vertices', 'uvs', 'triangles', 'edges', 'weights', 'bonePose', 'bindOffsets', 'weightBones', 'slotPose', 'offset'] as const) {
      expect(display[key]).toBeUndefined();
    }
    // 图片本身的信息要留着
    expect(display.name).toBe('art');
    expect(display.path).toBe('art');
    expect(display.width).toBe(16);
    expect(isMeshDisplay(display)).toBe(false);
  });

  it('refuses to convert a display that is not a mesh', () => {
    expect(convertMeshToImage({ name: 'art', type: 'image' })).toBe(false);
    expect(convertMeshToImage(null)).toBe(false);
  });
});