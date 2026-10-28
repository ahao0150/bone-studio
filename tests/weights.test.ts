/**
 * Mesh weight editing (M4): painting a vertex must re-skin immediately and
 * keep the document exportable.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { Player } from '../src/core/player';
import { addMeshWeightBone, meshWeightBones, removeMeshWeightBone, setVertexWeight } from '../src/core/editing';
import { encodeDbbin } from '../src/core/export/dbbin';
import { decodeDbbin } from '../src/core/parse/dbbinDecode';

const ORACLE = 'samples';
const SKELETON = `${ORACLE}/out-new/Rooster_An_ske.json`;
const TEXTURE = `${ORACLE}/out-new/Rooster_An_tex.json`;
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const hasFixture = existsSync(SKELETON) && existsSync(TEXTURE);

type Doc = {
  armature: Array<{
    bone: Array<{ name: string }>;
    skin?: Array<{ slot?: Array<{ name: string; display?: Array<{ type?: unknown; vertices?: number[]; weights?: number[]; bonePose?: number[]; bindOffsets?: number[]; weightBones?: number[] }> }> }>;
  }>;
};

/** Find a weighted mesh in the first armature. */
function findWeightedMesh(doc: Doc) {
  for (const skin of doc.armature[0].skin ?? []) {
    for (const slot of skin.slot ?? []) {
      for (const display of slot.display ?? []) {
        if ((display.type === 'mesh' || display.type === 2) && (display.weights?.length ?? 0) > 0) {
          return { slot: slot.name, display };
        }
      }
    }
  }
  return null;
}

describe.skipIf(!hasFixture)('mesh weight editing', () => {
  it('paints a vertex and re-skins immediately', () => {
    const doc = readJson(SKELETON) as Doc;
    const target = findWeightedMesh(doc);
    expect(target).not.toBeNull();
    const texture = readJson(TEXTURE) as never;
    const player = new Player(doc, texture);
    player.setAnimation('rooster_idle_anim');
    player.seek(0);
    const before = player.renderItems().map((item) => Array.from(item.positions));

    // pick a bone that is not yet influencing vertex 0
    const weights = target!.display.weights!;
    const present = new Set<number>();
    let cursor = 0;
    for (let v = 0; v < weights[cursor]; v++) { /* noop */ }
    cursor = 1;
    for (let k = 0; k < weights[0]; k++) { present.add(weights[cursor]); cursor += 2; }
    const bone = doc.armature[0].bone.find((_, i) => !present.has(i))!;
    const painted = setVertexWeight(doc as never, { slot: target!.slot, vertex: 0, bone: bone.name, weight: 1 });
    expect(painted).toBeGreaterThan(0);

    player.seek(0);
    const after = player.renderItems().map((item) => Array.from(item.positions));
    let moved = 0;
    for (let i = 0; i < before.length; i++) {
      for (let k = 0; k < before[i].length; k++) moved = Math.max(moved, Math.abs(after[i][k] - before[i][k]));
    }
    expect(moved).toBeGreaterThan(0);
  });

  it('keeps the document exportable and renormalised', () => {
    const doc = readJson(SKELETON) as Doc;
    const target = findWeightedMesh(doc)!;
    const bone = doc.armature[0].bone[0];
    expect(setVertexWeight(doc as never, { slot: target.slot, vertex: 0, bone: bone.name, weight: 1 })).toBeGreaterThan(0);
    // vertex 0 now sums to 1
    const weights = target.display.weights!;
    let cursor = 1;
    let sum = 0;
    for (let k = 0; k < weights[0]; k++) { sum += weights[cursor + 1]; cursor += 2; }
    expect(sum).toBeCloseTo(1, 5);
    // still encodable and decodable
    const bytes = Buffer.from(encodeDbbin(doc));
    const decoded = decodeDbbin(bytes);
    expect(decoded.stats.weightedMeshes).toBeGreaterThan(0);
  });
});

/** Vertex count of a display, from its `vertices` array. */
function vertexCountOf(display: { vertices?: number[] }): number {
  return Math.floor((display.vertices?.length ?? 0) / 2);
}

/** Sum of one vertex's influences, read straight out of the packed `weights` array. */
function vertexWeightSum(weights: number[], vertex: number): number {
  let cursor = 0;
  for (let v = 0; v < vertex; v++) {
    const count = weights[cursor++] ?? 0;
    cursor += count * 2;
  }
  const count = weights[cursor++] ?? 0;
  let sum = 0;
  for (let k = 0; k < count; k++) { sum += weights[cursor + 1] ?? 0; cursor += 2; }
  return sum;
}

describe.skipIf(!hasFixture)('mesh bind-bone list (official 权重骨骼列表)', () => {
  it('lists the bones the mesh is skinned to', () => {
    const doc = readJson(SKELETON) as Doc;
    const target = findWeightedMesh(doc)!;
    const names = meshWeightBones(doc.armature[0] as never, target.slot);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(doc.armature[0].bone.some((bone) => bone.name === name)).toBe(true);
    }
  });

  it('binds a new bone without touching the skin, and is idempotent', () => {
    const doc = readJson(SKELETON) as Doc;
    const target = findWeightedMesh(doc)!;
    const armature = doc.armature[0] as never;
    const before = JSON.stringify(target.display.weights);
    const bound = new Set(meshWeightBones(armature, target.slot));
    const candidate = doc.armature[0].bone.find((bone) => !bound.has(bone.name))!;

    expect(addMeshWeightBone(armature, target.slot, candidate.name)).toBe(true);
    expect(meshWeightBones(armature, target.slot)).toContain(candidate.name);
    // a fresh bind starts at zero influence — no vertex weight changes
    expect(JSON.stringify(target.display.weights)).toBe(before);
    expect(addMeshWeightBone(armature, target.slot, candidate.name)).toBe(false);
    // the bind reference is registered so the document stays exportable
    expect((target.display.bonePose?.length ?? 0) % 7).toBe(0);
    expect(Buffer.from(encodeDbbin(doc)).length).toBeGreaterThan(0);
  });

  it('drops a bone and renormalises the surviving influences', () => {
    const doc = readJson(SKELETON) as Doc;
    const target = findWeightedMesh(doc)!;
    const armature = doc.armature[0] as never;
    const victim = meshWeightBones(armature, target.slot)[0];

    expect(removeMeshWeightBone(armature, target.slot, victim)).toBe(true);
    expect(meshWeightBones(armature, target.slot)).not.toContain(victim);
    expect(removeMeshWeightBone(armature, target.slot, victim)).toBe(false);

    const weights = target.display.weights!;
    const vertices = vertexCountOf(target.display);
    for (let v = 0; v < vertices; v++) {
      const sum = vertexWeightSum(weights, v);
      if (sum > 0) expect(sum).toBeCloseTo(1, 4);
    }
    expect(Buffer.from(encodeDbbin(doc)).length).toBeGreaterThan(0);
    expect(decodeDbbin(Buffer.from(encodeDbbin(doc))).stats.weightedMeshes).toBeGreaterThan(0);
  });
});

/**
 * 解绑必须在**两种数据形态**下都「真的删掉」并返回 `true`。
 *
 * 历史缺陷：返回值只认 `bonePose`，而 `*_ske.dbbin` 解码的网格没有 `bonePose`
 * （绑定存在 `bindOffsets` / `weights` 里），于是数据删了却返回 `false` ——
 * `App.tsx#runSlotEdit` 拿到 `false` 就不刷新、不记历史，还误报「不在权重骨骼列表里」。
 */
describe.skipIf(!hasFixture)('mesh weight unbind 真的生效（JSON 与 dbbin 两种形态）', () => {
  const jsonDoc = (): Doc => readJson(SKELETON) as Doc;
  /** 真跑一遍「导出 → 解码」，拿到 dbbin 形态（无 `bonePose`，绑定走 `bindOffsets`）的文档 */
  const bakedDoc = (): Doc => decodeDbbin(Buffer.from(encodeDbbin(jsonDoc()))).json as unknown as Doc;

  it('JSON 形态：删第一根 / 中间 / 最后一根都返回 true 且列表同步', () => {
    const doc = jsonDoc();
    const target = findWeightedMesh(doc)!;
    const armature = doc.armature[0] as never;
    const names = meshWeightBones(armature, target.slot);
    expect(names.length).toBeGreaterThan(0);
    const victims = [...new Set([names[0], names[Math.floor(names.length / 2)], names[names.length - 1]])];
    for (const victim of victims) {
      expect(removeMeshWeightBone(armature, target.slot, victim)).toBe(true);
      expect(meshWeightBones(armature, target.slot)).not.toContain(victim);
      // 再删一次：已经没东西可删了
      expect(removeMeshWeightBone(armature, target.slot, victim)).toBe(false);
    }
    // 存活影响仍归一化到 1（网格形状不变形）
    for (let v = 0; v < vertexCountOf(target.display); v++) {
      const sum = vertexWeightSum(target.display.weights ?? [], v);
      if (sum > 0) expect(sum).toBeCloseTo(1, 4);
    }
  });

  it('dbbin 形态：没有 bonePose 也能解绑，列表与 weightBones 同步，导出不抛错', () => {
    const doc = bakedDoc();
    const target = findWeightedMesh(doc)!;
    const armature = doc.armature[0] as never;
    expect(target.display.bonePose).toBeUndefined();
    expect(target.display.bindOffsets?.length ?? 0).toBeGreaterThan(0);

    const names = meshWeightBones(armature, target.slot);
    expect(names.length).toBeGreaterThan(0);
    const victim = names[0];

    expect(removeMeshWeightBone(armature, target.slot, victim)).toBe(true);
    const after = meshWeightBones(armature, target.slot);
    expect(after).not.toContain(victim);
    expect(after.length).toBe(names.length - 1);
    expect(removeMeshWeightBone(armature, target.slot, victim)).toBe(false);

    // 导出→再解码：解掉的骨骼不该复活，且整个流程不该抛错
    const again = decodeDbbin(Buffer.from(encodeDbbin(doc))).json as unknown as Doc;
    expect(meshWeightBones(again.armature[0] as never, target.slot)).not.toContain(victim);
  });

  it('dbbin 形态：加绑定骨骼不再让列表塌缩，导出仍然成立', () => {
    const doc = bakedDoc();
    const target = findWeightedMesh(doc)!;
    const armature = doc.armature[0] as never;
    const before = meshWeightBones(armature, target.slot);
    const candidate = (doc.armature[0].bone as Array<{ name: string }>)
      .find((bone) => !before.includes(bone.name));
    expect(candidate).toBeDefined();

    expect(addMeshWeightBone(armature, target.slot, candidate!.name)).toBe(true);
    const after = meshWeightBones(armature, target.slot);
    // 历史缺陷：`if (out.length > 0) return out` 会短路成「只剩新加那一根」
    expect(after.length).toBe(before.length + 1);
    for (const name of before) expect(after).toContain(name);
    // 新骨骼没有任何顶点影响，导出照样成功（不写空引用、也不抛 DbbinExportError）
    expect(Buffer.from(encodeDbbin(doc)).length).toBeGreaterThan(0);
  });
});