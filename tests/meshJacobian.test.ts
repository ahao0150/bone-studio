/**
 * M4 舞台空间 ↔ 槽位局部空间的线性映射（`Skeleton.meshVertexJacobian`）。
 *
 * 对 JSON 与 dbbin 两种形态都用**渲染器做数值对拍**：有限差分必须与 J 一致，
 * 而且移动局部顶点必须真的带动渲染 —— 后者正是 dbbin 形态的关键（烘焙点没同步的话渲染不动）。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { Player } from '../src/core/player';
import { findMesh, moveMeshVertex, readMesh } from '../src/core/meshEdit';
import { decodeDbbin } from '../src/core/parse/dbbinDecode';
import type { DbArmatureData } from '../src/core/types';

const HOME = '.';
const ORACLE = `${HOME}/samples`;
const SKELETON = `${ORACLE}/out-new/Rooster_An_ske.json`;
const TEXTURE = `${ORACLE}/out-new/Rooster_An_tex.json`;
const BINARY = `${ORACLE}/out-binary/Rooster_An_ske.dbbin`;
const hasFixture = existsSync(SKELETON) && existsSync(TEXTURE);
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

const SLOT = 'hood';
const VERTEX = 7;
const EPS = 0.1;

function posedPlayer(): Player {
  const player = new Player(readJson(SKELETON), readJson(TEXTURE) as never);
  player.setAnimation('rooster_idle_anim');
  player.seek(6);
  return player;
}

function binaryPlayer(): Player {
  const player = new Player(decodeDbbin(readFileSync(BINARY)).json, readJson(TEXTURE) as never);
  player.setAnimation('rooster_idle_anim');
  player.seek(6);
  return player;
}

/** 顶点在舞台（世界）空间的位置，直接取自渲染器。 */
function worldVertex(player: Player, slot: string, vertex: number): [number, number] {
  const item = player.renderItems().find((entry) => entry.slot === slot && entry.kind === 'mesh');
  if (!item) throw new Error(`no mesh item for slot ${slot}`);
  return [item.positions[vertex * 2], item.positions[vertex * 2 + 1]];
}

const bindWorldOf = (player: Player) => (index: number) => player.skeleton.bindWorld[index] ?? null;

describe.skipIf(!hasFixture)('meshVertexJacobian', () => {
  it('JSON 形态：J 与渲染位置的有限差分一致', () => {
    const player = posedPlayer();
    const armature = player.skeleton.armature as DbArmatureData;
    const jacobian = player.skeleton.meshVertexJacobian(SLOT, VERTEX);
    expect(jacobian).not.toBeNull();
    const [a, b, c, d] = jacobian as [number, number, number, number];

    const origin = worldVertex(player, SLOT, VERTEX);
    const column = (dx: number, dy: number): [number, number] => {
      moveMeshVertex(armature, SLOT, VERTEX, dx, dy);
      const moved = worldVertex(player, SLOT, VERTEX);
      moveMeshVertex(armature, SLOT, VERTEX, -dx, -dy);
      return [moved[0] - origin[0], moved[1] - origin[1]];
    };
    const [wx, wy] = column(EPS, 0);
    const [zx, zy] = column(0, EPS);

    expect(Math.abs(a * EPS - wx)).toBeLessThan(1e-4);
    expect(Math.abs(b * EPS - wy)).toBeLessThan(1e-4);
    expect(Math.abs(c * EPS - zx)).toBeLessThan(1e-4);
    expect(Math.abs(d * EPS - zy)).toBeLessThan(1e-4);
    // 姿态不是绑定姿态，所以这不是平凡通过
    expect(Math.abs(a - 1) + Math.abs(b) + Math.abs(c) + Math.abs(d - 1)).toBeGreaterThan(1e-4);
  });

  it('dbbin 形态：J 可用，且移动顶点会同步烘焙点、真的带动渲染', () => {
    const player = binaryPlayer();
    const armature = player.skeleton.armature as DbArmatureData;
    const mesh = findMesh(armature, SLOT)!;
    expect((mesh.bindOffsets ?? []).length).toBeGreaterThan(0);

    // 挑一个真的带权重（= 有烘焙记录）的顶点
    let vertex = -1;
    let cursor = 0;
    const weights = mesh.weights ?? [];
    for (let v = 0; v < 24; v++) {
      const count = weights[cursor++] ?? 0;
      if (count > 0) { vertex = v; break; }
      cursor += count * 2;
    }
    expect(vertex).toBeGreaterThanOrEqual(0);

    const jacobian = player.skeleton.meshVertexJacobian(SLOT, vertex);
    expect(jacobian).not.toBeNull();
    const [a, b] = jacobian as [number, number, number, number];

    const origin = worldVertex(player, SLOT, vertex);
    const before = readMesh(mesh).vertices[vertex];
    expect(moveMeshVertex(armature, SLOT, vertex, EPS, 0, { bindWorld: bindWorldOf(player) })).toBe(true);
    const after = worldVertex(player, SLOT, vertex);
    // 若没有同步 bindOffsets，这里 after 会等于 origin（渲染不动）—— 测试正是要抓住这一点
    expect(Math.abs(a * EPS - (after[0] - origin[0]))).toBeLessThan(1e-3);
    expect(Math.abs(b * EPS - (after[1] - origin[1]))).toBeLessThan(1e-3);

    // 移回去应当回到原位
    expect(moveMeshVertex(armature, SLOT, vertex, -EPS, 0, { bindWorld: bindWorldOf(player) })).toBe(true);
    const restored = worldVertex(player, SLOT, vertex);
    expect(restored[0]).toBeCloseTo(origin[0], 3);
    expect(restored[1]).toBeCloseTo(origin[1], 3);
    // vertices 按 1/1000 取整，所以与原 Float32 值会有 1e-3 以内的差，这属预期
    expect(readMesh(mesh).vertices[vertex][0]).toBeCloseTo(before[0], 3);
  });

  it('缺少绑定矩阵时拒绝移动（宁可不动，也不做半更新）', () => {
    const player = binaryPlayer();
    const armature = player.skeleton.armature as DbArmatureData;
    expect(moveMeshVertex(armature, SLOT, 0, 1, 1)).toBe(false);
  });

  it('越界与未知插槽返回 null', () => {
    const player = posedPlayer();
    expect(player.skeleton.meshVertexJacobian(SLOT, -1)).toBeNull();
    expect(player.skeleton.meshVertexJacobian(SLOT, 9999)).toBeNull();
    expect(player.skeleton.meshVertexJacobian('nope', 0)).toBeNull();
  });
});
