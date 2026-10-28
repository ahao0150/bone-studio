import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { Player } from '../src/core/player';
import { parseDbbin } from '../src/core/parse/dbbin';
import { decodeDbbin } from '../src/core/parse/dbbinDecode';
import { boneTimeline, keyFrames, materializeComponentTimeline, sampleTransform, setBoneTransform } from '../src/core/editing';
import type { DbDisplayData, DbSkeletonData } from '../src/core/types';

const ORACLE = process.env.BONESTUDIO_ORACLE
  ?? 'samples/out-binary/Rooster_An_ske.dbbin';
const SOURCE = process.env.BONESTUDIO_BIN_SOURCE
  ?? 'samples/Rooster_Ani/Rooster_An_ske.json';
const NEW_JSON = process.env.BONESTUDIO_NEW_JSON
  ?? 'samples/out-new/Rooster_An_ske.json';
const TEXTURE = process.env.BONESTUDIO_BIN_TEXTURE
  ?? 'samples/Rooster_Ani/Rooster_An_tex.json';

const hasOracle = existsSync(ORACLE) && existsSync(SOURCE);
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

function meshesOf(doc: DbSkeletonData): Array<{ key: string; display: DbDisplayData }> {
  const out: Array<{ key: string; display: DbDisplayData }> = [];
  for (const armature of doc.armature ?? []) {
    for (const skin of armature.skin ?? []) {
      for (const slot of skin.slot ?? []) {
        for (const display of slot.display ?? []) {
          if (display.type === 'mesh' || display.type === 2) {
            out.push({ key: `${slot.name}/${display.name ?? ''}`, display });
          }
        }
      }
    }
  }
  return out;
}

describe.skipIf(!hasOracle)('*_ske.dbbin produced by the shipped official tool', () => {
  it('matches the documented container layout', () => {
    const bytes = readFileSync(ORACLE);
    const container = parseDbbin(bytes);
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe('DBDT');
    // offset 4 holds the literal bytes 00 00 00 02 (binary major version 2)
    expect([bytes[4], bytes[5], bytes[6], bytes[7]]).toEqual([0, 0, 0, 2]);
    expect(container.meta.binaryVersion).toBe(2);
    expect(container.meta.jsonStart).toBe(12);
    expect(container.meta.arraysStart % 4).toBe(0);
    expect(container.meta.jsonLength).toBeGreaterThan(0);
    const sectionBytes = container.meta.arrays.reduce((sum, array) => sum + array.byteLength, 0);
    expect(container.meta.arraysStart + sectionBytes).toBe(bytes.length);
    expect(container.meta.arrays.map((array) => array.name)).toEqual([
      'intArray', 'floatArray', 'frameIntArray', 'frameFloatArray', 'frameArray', 'timelineArray', 'colorArray',
    ]);
  });

  it('re-inflates mesh geometry identical to the JSON export', () => {
    const decoded = decodeDbbin(readFileSync(ORACLE));
    const source = readJson(SOURCE) as DbSkeletonData;
    const decodedDoc = decoded.json as DbSkeletonData;
    const sourceMeshes = meshesOf(source);
    const decodedMeshes = meshesOf(decodedDoc);
    expect(decoded.stats.meshes).toBe(sourceMeshes.length);
    expect(decoded.stats.weightedMeshes).toBeGreaterThan(0);
    expect(decodedMeshes.length).toBe(sourceMeshes.length);

    let comparedVertices = 0;
    for (const sourceMesh of sourceMeshes) {
      const match = decodedMeshes.find((entry) => entry.key === sourceMesh.key);
      expect(match, `mesh ${sourceMesh.key} must survive the round trip`).toBeTruthy();
      const a = sourceMesh.display;
      const b = match!.display;
      expect(b.triangles?.length).toBe(a.triangles?.length);
      expect(b.uvs?.length).toBe(a.uvs?.length);
      expect(b.vertices?.length).toBe(a.vertices?.length);
      // the binary normalises weighted mesh vertices into slot space
      // (decoded == slotPose * source), so the expectations follow that convention
      const weighted = Boolean(a.weights && a.weights.length > 0);
      const sp = a.slotPose;
      const vertexCount = (a.vertices?.length ?? 0) / 2;
      for (let v = 0; v < vertexCount; v++) {
        const x = a.vertices![v * 2];
        const y = a.vertices![v * 2 + 1];
        const [ex, ey] = weighted && sp && sp.length >= 6
          ? [sp[0] * x + sp[2] * y + sp[4], sp[1] * x + sp[3] * y + sp[5]]
          : [x, y];
        expect(b.vertices![v * 2]).toBeCloseTo(ex, 2);
        expect(b.vertices![v * 2 + 1]).toBeCloseTo(ey, 2);
      }
      for (let i = 0; i < (a.triangles?.length ?? 0); i++) {
        expect(b.triangles![i]).toBe(a.triangles![i]);
      }
      for (let i = 0; i < (a.uvs?.length ?? 0); i++) {
        expect(b.uvs![i]).toBeCloseTo(a.uvs![i], 4);
      }
      comparedVertices += a.vertices?.length ?? 0;
      if (a.weights && a.weights.length > 0) {
        // the binary keeps per-pair bind offsets instead of bonePose matrices
        expect(b.bonePose).toBeUndefined();
        expect(b.bindOffsets && b.bindOffsets.length).toBeGreaterThan(0);
        const pairs = (a.weights.length - (a.vertices!.length / 2)) / 2;
        expect(b.bindOffsets!.length).toBe((a.vertices!.length / 2) + pairs * 2);
      }
    }
    const expectedVertices = sourceMeshes.reduce((sum, mesh) => sum + (mesh.display.vertices?.length ?? 0), 0);
    expect(comparedVertices).toBe(expectedVertices);
    expect(expectedVertices).toBeGreaterThan(500);
  });

  it('plays bone timelines decoded from the binary exactly like the JSON export', () => {
    const texture = readJson(TEXTURE) as never;
    const jsonPlayer = new Player(readJson(existsSync(NEW_JSON) ? NEW_JSON : SOURCE), texture);
    const decoded = decodeDbbin(readFileSync(ORACLE));
    const binPlayer = new Player(decoded.json, texture);

    expect(decoded.stats.timelines).toBeGreaterThan(20);
    expect(decoded.stats.frames).toBeGreaterThan(100);
    expect(binPlayer.skeleton.bones.length).toBe(jsonPlayer.skeleton.bones.length);
    expect(binPlayer.animationNames()).toEqual(jsonPlayer.animationNames());

    let comparedFrames = 0;
    for (const animation of binPlayer.animationNames()) {
      jsonPlayer.setAnimation(animation);
      binPlayer.setAnimation(animation);
      expect(binPlayer.duration).toBe(jsonPlayer.duration);
      const duration = binPlayer.duration;
      for (const ratio of [0, 0.13, 0.37, 0.5, 0.79, 0.99]) {
        const frame = duration * ratio;
        jsonPlayer.seek(frame);
        binPlayer.seek(frame);
        const a = jsonPlayer.renderItems();
        const b = binPlayer.renderItems();
        expect(b.length).toBe(a.length);
        for (let i = 0; i < a.length; i++) {
          expect(b[i].slot).toBe(a[i].slot);
          const max = Math.max(...Array.from(a[i].positions, (value) => Math.abs(value)));
          // The binary stores float32 radians; IK then amplifies that rounding
          // non-linearly, so allow 1.5 units (~0.25% of the 600-unit bounds).
          const tolerance = Math.max(1.5, max * 1e-3);
          for (let k = 0; k < a[i].positions.length; k++) {
            expect(Math.abs(b[i].positions[k] - a[i].positions[k])).toBeLessThan(tolerance);
          }
        }
        comparedFrames++;
      }
    }
    expect(comparedFrames).toBe(30);
  });
});


describe.skipIf(!hasOracle || !existsSync(NEW_JSON))('official 5.0 -> 5.5 normalisation (evidence)', () => {
  it('drops bone timelines that carry no authored values in any frame', () => {
    const source = readJson(SOURCE) as any;
    const next = readJson(NEW_JSON) as any;
    const container = parseDbbin(readFileSync(ORACLE));
    const binaryBones = Object.keys((container.json as any).armature[0].animation[0].bone ?? {});

    const sourceTimelines: any[] = source.armature[0].animation[0].bone ?? [];
    const nextTimelines: any[] = next.armature[0].animation[0].bone ?? [];
    expect(sourceTimelines.length).toBe(63);
    expect(nextTimelines.length).toBe(39);
    expect(binaryBones.length).toBe(39);

    const kept = new Set(nextTimelines.map((timeline) => timeline.name));
    const dropped = sourceTimelines.filter((timeline) => !kept.has(timeline.name));
    expect(dropped.length).toBe(24);
    for (const timeline of dropped) {
      // every frame is "no change of the bind pose" (empty transform / bind values)
      const empty = (timeline.frame ?? []).every((frame: any) => {
        const keys = Object.keys(frame.transform ?? {});
        return keys.length === 0;
      });
      expect(empty, `${timeline.name} must only contain default frames`).toBe(true);
    }
  });
});



describe.skipIf(!hasOracle)('component timelines stay editable', () => {
  it('exposes component keyframes, materialises them and writes new keys', () => {
    const decoded = decodeDbbin(readFileSync(ORACLE));
    const player = new Player(decoded.json, readJson(TEXTURE) as never);
    const name = 'body_bone';
    const refs = keyFrames(player, name);
    expect(refs.length).toBeGreaterThan(1);
    const before = sampleTransform(player, name, 5);
    expect(materializeComponentTimeline(player, name)).toBe(true);
    const timeline = boneTimeline(player, name)!;
    expect(timeline.frame?.length).toBeGreaterThan(1);
    expect(timeline.translateFrame).toBeUndefined();
    const after = sampleTransform(player, name, 5);
    expect(after.x).toBeCloseTo(before.x, 2);
    expect(after.y).toBeCloseTo(before.y, 2);
    expect(after.skY).toBeCloseTo(before.skY, 2);
    const edited = after.x + 12;
    player.seek(7);
    expect(setBoneTransform(player, name, 7, { x: edited })).toBe(true);
    expect(keyFrames(player, name).some((ref) => Math.abs(ref.frame - 7) < 1e-6)).toBe(true);
    expect(sampleTransform(player, name, 7).x).toBeCloseTo(edited, 2);
  });
});
