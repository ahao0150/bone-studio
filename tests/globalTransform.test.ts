/** 官方 `dragonBones.Transform` 复刻（§101：IK 跨帧 `global` 状态的载体）。 */
import { describe, expect, it } from 'vitest';
import {
  globalFromMatrix, globalToMatrix, identityGlobal, type GlobalTransform,
} from '../src/core/runtime/globalTransform';
import type { Mat2D } from '../src/core/runtime/math';

const gt = (patch: Partial<GlobalTransform> = {}): GlobalTransform => ({ ...identityGlobal(), ...patch });
const close = (a: Mat2D, b: Mat2D) => {
  for (let i = 0; i < 6; i++) expect(a[i]).toBeCloseTo(b[i], 9);
};

describe('official Transform port', () => {
  it('toMatrix keeps the zero-rotation / zero-skew shortcuts', () => {
    const m = globalToMatrix(gt({ x: 3, y: -2, scaleX: 2, scaleY: 3 }));
    close(m, [2, 0, 0, 3, 3, -2] as Mat2D);
  });

  it('round-trips positive-scale transforms', () => {
    for (const rotation of [-2.5, -0.7, 0, 0.4, 1.9, 3.0]) {
      for (const skew of [-1.2, 0, 0.55, 2.4]) {
        const a = globalToMatrix(gt({ rotation, skew, scaleX: 1.7, scaleY: 0.8, x: 5, y: -9 }));
        const t = gt();
        globalFromMatrix(t, a);
        close(globalToMatrix(t), a);
      }
    }
  });

  it('uses the previous scale as backupScale (the stateful vendor branch)', () => {
    // a<0 且 b 很小 → atan(b/a) 落在 (-PI_Q, PI_Q)，scaleX 分解为负值。
    const m: Mat2D = [-2, 0.1, 0.3, 2, 7, -3];
    const fresh = gt({ scaleX: 1, scaleY: 1 });
    globalFromMatrix(fresh, m);
    expect(fresh.scaleX).toBeGreaterThan(0);
    expect(fresh.rotation).toBeLessThan(-Math.PI / 2);
    close(globalToMatrix(fresh), m);

    const alreadyNegative = gt({ scaleX: -1, scaleY: -1 });
    globalFromMatrix(alreadyNegative, m);
    expect(alreadyNegative.scaleX).toBeLessThan(0);
    expect(alreadyNegative.rotation).toBeGreaterThan(-Math.PI / 2);
    close(globalToMatrix(alreadyNegative), m);
  });

  it('applies the same backup rule to scaleY / skew', () => {
    // d<0 → skewX 落在 (-PI_Q, PI_Q) 但 scaleY 分解为负值。
    const m: Mat2D = [-2, 0.1, 0.3, -2, 0, 0];
    const fresh = gt({ scaleX: 1, scaleY: 1 });
    globalFromMatrix(fresh, m);
    expect(fresh.scaleY).toBeGreaterThan(0);
    close(globalToMatrix(fresh), m);

    const alreadyNegative = gt({ scaleX: -1, scaleY: -1 });
    globalFromMatrix(alreadyNegative, m);
    expect(alreadyNegative.scaleY).toBeLessThan(0);
    close(globalToMatrix(alreadyNegative), m);
  });
});
