/**
 * M4 DoD: weights painted in the editor must survive a `*_ske.dbbin` round
 * trip and re-skin identically.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { Player } from '../src/core/player';
import { setVertexWeight } from '../src/core/editing';
import { encodeDbbin } from '../src/core/export/dbbin';
import { decodeDbbin } from '../src/core/parse/dbbinDecode';

const ORACLE = 'samples';
const SKELETON = ORACLE + '/out-new/Rooster_An_ske.json';
const TEXTURE = ORACLE + '/out-new/Rooster_An_tex.json';
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const hasFixture = existsSync(SKELETON) && existsSync(TEXTURE);

type Doc = {
  armature: Array<{
    bone: Array<{ name: string }>;
    skin?: Array<{ slot?: Array<{ name: string; display?: Array<{ type?: unknown; weights?: number[] }> }> }>;
  }>;
};

function findWeightedMesh(doc: Doc): { slot: string } | null {
  for (const skin of doc.armature[0].skin ?? []) {
    for (const slot of skin.slot ?? []) {
      for (const display of slot.display ?? []) {
        if ((display.type === 'mesh' || display.type === 2) && (display.weights?.length ?? 0) > 0) {
          return { slot: slot.name };
        }
      }
    }
  }
  return null;
}

describe.skipIf(!hasFixture)('painted weights survive the binary round trip', () => {
  it('re-skins identically after export and decode', () => {
    const doc = readJson(SKELETON) as Doc;
    const target = findWeightedMesh(doc)!;
    expect(target).not.toBeNull();
    const bone = doc.armature[0].bone[0].name;
    const texture = readJson(TEXTURE) as never;

    const edited = new Player(doc, texture);
    edited.setAnimation('rooster_idle_anim');
    edited.seek(12);
    for (let v = 0; v < 6; v++) {
      expect(setVertexWeight(doc as never, { slot: target.slot, vertex: v, bone, weight: 1 })).toBeGreaterThan(0);
    }
    edited.seek(12);
    const before = edited.renderItems().map((item) => Array.from(item.positions));

    const decoded = decodeDbbin(Buffer.from(encodeDbbin(doc)));
    const reloaded = new Player(decoded.json, texture);
    reloaded.setAnimation('rooster_idle_anim');
    reloaded.seek(12);
    const after = reloaded.renderItems().map((item) => Array.from(item.positions));

    expect(after.length).toBe(before.length);
    let worst = 0;
    for (let i = 0; i < before.length; i++) {
      for (let k = 0; k < before[i].length; k++) {
        worst = Math.max(worst, Math.abs(after[i][k] - before[i][k]));
      }
    }
    expect(worst).toBeLessThan(0.5);
  });
});
