/**
 * M2 bone hierarchy edits: create (the "创建骨骼" tool), delete and re-parent.
 *
 * The fixture is a small synthetic armature so every reference (children, slot
 * parents, timelines, IK constraints) is visible in the assertions.
 */
import { describe, expect, it } from 'vitest';
import { Player } from '../src/core/player';
import { bindWorlds } from '../src/core/editing';
import { addBone, addBoneBetween, removeBone, setBoneParent, uniqueBoneName } from '../src/core/boneEdit';
import { encodeDbbin } from '../src/core/export/dbbin';
import { decodeDbbin } from '../src/core/parse/dbbinDecode';

function makeDoc() {
  return {
    name: 'boneEditTest',
    version: '5.5',
    compatibleVersion: '5.5',
    frameRate: 24,
    armature: [{
      name: 'A',
      type: 'armature',
      frameRate: 24,
      aabb: { x: 0, y: 0, width: 100, height: 100 },
      bone: [
        { name: 'root' },
        { name: 'torso', parent: 'root', transform: { x: 50, y: 60 } },
        { name: 'arm', parent: 'torso', transform: { x: 20, y: -10, skX: 30, skY: 30 }, length: 40 },
      ],
      slot: [{ name: 'art', parent: 'arm' }],
      ik: [{ name: 'ik_arm', bone: 'arm', target: 'torso', chain: 1, bendPositive: true, weight: 1 }],
      skin: [{ name: 'default', slot: [{ name: 'art', display: [{ type: 'image', name: 'art', path: 'art' }] }] }],
      animation: [{
        name: 'anim',
        duration: 10,
        bone: [
          { name: 'torso', frame: [{ duration: 10, tweenEasing: 0, x: 50, y: 60, skX: 0, skY: 0, scX: 1, scY: 1 }] },
          { name: 'arm', frame: [{ duration: 10, tweenEasing: 0, x: 20, y: -10, skX: 30, skY: 30, scX: 1, scY: 1 }] },
        ],
      }],
    }],
  };
}

const TEXTURE = {
  name: 'tex', imagePath: 'tex.png', width: 16, height: 16,
  SubTexture: [{ name: 'art', x: 0, y: 0, width: 16, height: 16 }],
};

function makePlayer(): Player {
  return new Player(JSON.parse(JSON.stringify(makeDoc())), JSON.parse(JSON.stringify(TEXTURE)) as never);
}

const armatureOf = (player: Player) => player.skeleton.armature;

describe('bone creation', () => {
  it('adds a bone with a unique name under the requested parent', () => {
    const player = makePlayer();
    const created = addBone(player, { name: 'arm', parent: 'torso', transform: { x: 5, y: 5 } });
    expect(created).toBe('arm_1');
    const armature = armatureOf(player);
    expect(armature.bone.length).toBe(4);
    const bone = armature.bone.find((entry) => entry.name === 'arm_1')!;
    expect(bone.parent).toBe('torso');
    expect(bone.transform?.x).toBe(5);
    // the runtime was rebuilt, so the new bone is live
    expect(player.skeleton.boneIndexByName.has('arm_1')).toBe(true);
    expect(player.skeleton.bones.length).toBe(4);
  });

  it('refuses an unknown parent', () => {
    const player = makePlayer();
    expect(addBone(player, { name: 'x', parent: 'nope' })).toBeNull();
    expect(armatureOf(player).bone.length).toBe(3);
  });

  it('draws a bone from two armature-space points (official gesture)', () => {
    const player = makePlayer();
    // start at the armature origin, 40px to the right, parented to the root bone
    const created = addBoneBetween(player, { x: 60, y: 60 }, { x: 100, y: 60 }, 'root');
    expect(created).toBe('bone');
    const armature = armatureOf(player);
    const bone = armature.bone.find((entry) => entry.name === 'bone')!;
    expect(bone.parent).toBe('root');
    expect(bone.length).toBeCloseTo(40, 6);
    // a zero rotation is a default and is therefore omitted (sparse authoring)
    expect(bone.transform?.skY ?? 0).toBeCloseTo(0, 6);
    const world = bindWorlds(armature.bone).get('bone')!;
    expect(world[4]).toBeCloseTo(60, 4);
    expect(world[5]).toBeCloseTo(60, 4);
  });

  it('maps the drawn segment into parent space', () => {
    const player = makePlayer();
    // torso sits at (50,60); drawing in armature space must be stored as local
    const created = addBoneBetween(player, { x: 50, y: 60 }, { x: 50, y: 100 }, 'torso');
    expect(created).toBe('bone');
    const bone = armatureOf(player).bone.find((entry) => entry.name === 'bone')!;
    // torso sits at (50,60) in armature space, so the drawn start is its origin
    expect(bone.transform?.x ?? 0).toBeCloseTo(0, 6);
    expect(bone.transform?.y ?? 0).toBeCloseTo(0, 6);
    expect(bone.transform?.skY ?? 0).toBeCloseTo(90, 6);
    expect(bone.length).toBeCloseTo(40, 6);
    const world = bindWorlds(armatureOf(player).bone).get('bone')!;
    expect(world[4]).toBeCloseTo(50, 4);
    expect(world[5]).toBeCloseTo(60, 4);
  });
});

describe('bone deletion', () => {
  it('re-parents children and slots and drops the matching timelines', () => {
    const player = makePlayer();
    expect(removeBone(player, 'torso')).toBe(true);
    const armature = armatureOf(player);
    expect(armature.bone.map((entry) => entry.name)).toEqual(['root', 'arm']);
    expect(armature.bone.find((entry) => entry.name === 'arm')?.parent).toBe('root');
    expect(armature.animation?.[0].bone?.map((entry) => entry.name)).toEqual(['arm']);
    expect(player.skeleton.bones.length).toBe(2);
  });

  it('re-points slots and removes IK constraints that referenced the bone', () => {
    const player = makePlayer();
    expect(removeBone(player, 'arm')).toBe(true);
    const armature = armatureOf(player);
    expect(armature.bone.map((entry) => entry.name)).toEqual(['root', 'torso']);
    expect(armature.slot[0].parent).toBe('torso');
    expect(armature.ik ?? []).toEqual([]);
    expect(armature.animation?.[0].bone?.map((entry) => entry.name)).toEqual(['torso']);
  });

  it('keeps at least one bone', () => {
    const player = makePlayer();
    expect(removeBone(player, 'arm')).toBe(true);
    expect(removeBone(player, 'torso')).toBe(true);
    expect(removeBone(player, 'root')).toBe(false);
    expect(armatureOf(player).bone.length).toBe(1);
  });

  it('reports unknown bones', () => {
    const player = makePlayer();
    expect(removeBone(player, 'ghost')).toBe(false);
  });
});

describe('bone re-parenting', () => {
  it('keeps the bind world pose', () => {
    const player = makePlayer();
    const before = bindWorlds(armatureOf(player).bone).get('arm')!;
    expect(setBoneParent(player, 'arm', 'root')).toBe(true);
    const after = bindWorlds(armatureOf(player).bone).get('arm')!;
    for (let i = 0; i < 6; i++) expect(after[i]).toBeCloseTo(before[i], 4);
    expect(armatureOf(player).bone.find((entry) => entry.name === 'arm')?.parent).toBe('root');
  });

  it('can detach to the armature root', () => {
    const player = makePlayer();
    expect(setBoneParent(player, 'arm', null)).toBe(true);
    expect(armatureOf(player).bone.find((entry) => entry.name === 'arm')?.parent).toBeUndefined();
    expect(player.skeleton.boneIndexByName.get('arm')).toBe(2);
  });

  it('refuses cycles and self-parenting', () => {
    const player = makePlayer();
    expect(setBoneParent(player, 'torso', 'arm')).toBe(false);
    expect(setBoneParent(player, 'torso', 'torso')).toBe(false);
    expect(setBoneParent(player, 'torso', 'ghost')).toBe(false);
    expect(armatureOf(player).bone.find((entry) => entry.name === 'torso')?.parent).toBe('root');
  });
});

describe('edited armature still exports', () => {
  it('round-trips the new hierarchy through *_ske.dbbin', () => {
    const player = makePlayer();
    const created = addBoneBetween(player, { x: 10, y: 10 }, { x: 50, y: 10 }, 'root');
    expect(created).toBe('bone');
    const bytes = encodeDbbin(armatureOf(player) ? { armature: [armatureOf(player)], frameRate: 24, name: 'boneEditTest' } : {});
    const decoded = decodeDbbin(bytes);
    const doc = decoded.json as { armature: Array<{ bone: Array<{ name: string; parent?: string }> }> };
    expect(doc.armature[0].bone.map((entry) => entry.name)).toContain('bone');
    expect(doc.armature[0].bone.find((entry) => entry.name === 'bone')?.parent).toBe('root');
  });

  it('names never collide', () => {
    const player = makePlayer();
    const armature = armatureOf(player);
    expect(uniqueBoneName(armature, 'arm')).toBe('arm_1');
    expect(uniqueBoneName(armature, 'leg')).toBe('leg');
  });
});
