import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Player } from '../src/core/player';
import { meshWeightBones } from '../src/core/editing';
import { WEIGHT_COLORS, vertexWeightPies } from '../src/core/weightPie';

const SAMPLES = process.env.BONESTUDIO_SAMPLES
  ?? 'samples';

describe('weight pies', () => {
  it('colors each vertex by the weight-bone list order', () => {
    const root = join(SAMPLES, 'Rooster_Ani');
    const player = new Player(
      JSON.parse(readFileSync(join(root, 'Rooster_An_ske.json'), 'utf8')),
      JSON.parse(readFileSync(join(root, 'Rooster_An_tex.json'), 'utf8')),
    );
    const slot = player.skeleton.slots.find((entry) => meshWeightBones(player.skeleton.armature, entry.name).length > 1);
    expect(slot).toBeTruthy();
    const pies = vertexWeightPies(player.skeleton.armature, slot!.name);
    expect(pies.length).toBeGreaterThan(0);
    const mixed = pies.find((slices) => slices.length > 1);
    expect(mixed).toBeTruthy();
    const sum = mixed!.reduce((total, slice) => total + slice.weight, 0);
    expect(sum).toBeGreaterThan(0.9);
    expect(sum).toBeLessThan(1.1);
    for (const slice of mixed!) expect(WEIGHT_COLORS).toContain(slice.color);
  });
});
