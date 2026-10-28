/** 「转换为元件...」（官方 MenuItem-convertToSymbol）：显示对象换成对另一个骨架的引用。 */
import { describe, expect, it } from 'vitest';
import { convertDisplayToArmature } from '../src/core/slotEdit';
import type { DbDisplayData } from '../src/core/types';

const image = (): DbDisplayData => ({ type: 'image', name: 'art', path: 'art', width: 16, height: 16, pivot: { x: 0.5, y: 0.5 } });
const mesh = (): DbDisplayData => ({
  type: 'mesh', name: 'art', path: 'art', width: 16, height: 16,
  vertices: [0, 0, 1, 0, 1, 1], uvs: [0, 0, 1, 0, 1, 1], triangles: [0, 1, 2],
  edges: [0, 1, 1, 2, 2, 0], weights: [1, 0, 1], bonePose: [1, 0, 0, 1, 0, 0], offset: 3,
});

describe('转换为元件（官方 MenuItem-convertToSymbol）', () => {
  it('turns an image display into an armature reference', () => {
    const display = image();
    expect(convertDisplayToArmature(display, 'boy-win')).toBe(true);
    expect(display.type).toBe('armature');
    expect(display.name).toBe('boy-win');
    expect(display.path).toBeUndefined();
    expect(display.width).toBeUndefined();
    expect(display.pivot).toBeUndefined();
  });

  it('drops mesh data too', () => {
    const display = mesh();
    convertDisplayToArmature(display, 'girl-stand');
    for (const key of ['vertices', 'uvs', 'triangles', 'edges', 'weights', 'bonePose', 'offset'] as const) {
      expect(display[key]).toBeUndefined();
    }
  });

  it('refuses an empty symbol name or a missing display', () => {
    expect(convertDisplayToArmature(image(), '   ')).toBe(false);
    expect(convertDisplayToArmature(null, 'boy-win')).toBe(false);
  });
});