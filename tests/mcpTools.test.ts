/**
 * MCP tool layer (M6 「AI 扩展接口」). The tools are the same code path the UI uses, so the
 * assertions here also pin the agent-facing contract: open -> inspect -> key -> export.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  animationDetail, animationsList, boneCreate, boneDelete, boneKeyframeSet, boneTransformGet, boneUpdate,
  bonesList, bonesTree, historyRedo, historyUndo, openProject, skeletonExport, slotsList, summaryOf,
  type EditorState,
} from '../src/mcp/tools';

const HOME = '.';
const SKELETON = `${HOME}/samples/out-new/Rooster_An_ske.json`;
const TEXTURE = `${HOME}/samples/out-new/Rooster_An_tex.json`;
const BINARY = `${HOME}/samples/out-binary/Rooster_An_ske.dbbin`;
const hasFixture = existsSync(SKELETON) && existsSync(TEXTURE);

const fresh = (): EditorState => ({ player: null, path: '' });

describe.skipIf(!hasFixture)('MCP tools', () => {
  it('opens a project and reports its shape', () => {
    const state = fresh();
    const opened = openProject(state, { file: SKELETON, texture: TEXTURE }) as { armature: string; bones: number; slots: number; ik: number };
    expect(opened.armature).toBe('armatureName');
    expect(opened.bones).toBe(63);
    expect(opened.slots).toBe(14);
    expect(opened.ik).toBe(2);

    const summary = summaryOf(state) as { animations: unknown[]; frameRate: number };
    expect(summary.animations.length).toBe(5);
    expect(summary.frameRate).toBe(24);
  });

  it('lists bones and animations', () => {
    const state = fresh();
    openProject(state, { file: SKELETON, texture: TEXTURE });
    const bones = bonesList(state) as { count: number; bones: Array<{ name: string; parent: string | null }> };
    expect(bones.count).toBe(63);
    expect(bones.bones[0].parent).toBeNull();
    expect(bones.bones.some((bone) => bone.name === 'head_bone_01' && bone.parent === 'neck_bone_02')).toBe(true);

    const animations = animationsList(state) as { names: string[]; current: string };
    expect(animations.names.length).toBe(5);
    expect(animations.current).toBe('rooster_idle_anim');
  });

  it('reads a bone transform and can add then remove a keyframe', () => {
    const state = fresh();
    openProject(state, { file: SKELETON, texture: TEXTURE });
    const before = boneTransformGet(state, { bone: 'head_bone_01', frame: 12 }) as { keys: number[] };
    expect(before.keys).not.toContain(12);

    // `setBoneTransform` splits the covering span, so the key count grows by one.
    const added = boneKeyframeSet(state, { bone: 'head_bone_01', frame: 12, transform: { skX: 25 } }) as { keys: number[]; values: { skX: number } };
    expect(added.keys).toContain(12);
    expect(added.keys.length).toBe(before.keys.length + 1);
    expect(added.values.skX).toBeCloseTo(25, 3);

    // `removeKeyFrame` gives the removed span back to a neighbour (the official behaviour),
    // so the key *count* returns to the original even though positions shift.
    const removed = boneKeyframeSet(state, { bone: 'head_bone_01', frame: 12, remove: true }) as { removed: boolean; keys: number[] };
    expect(removed.removed).toBe(true);
    expect(removed.keys.length).toBe(before.keys.length);
  });

  it('exports json and binary, and the binary decodes again', () => {
    const state = fresh();
    openProject(state, { file: BINARY });
    const dir = mkdtempSync(join(tmpdir(), 'bone-studio-mcp-'));
    const json = skeletonExport(state, { out: join(dir, 'out_ske.json'), type: 'json' }) as { bytes: number };
    const binary = skeletonExport(state, { out: join(dir, 'out_ske.dbbin'), type: 'binary' }) as { bytes: number };
    expect(json.bytes).toBeGreaterThan(1000);
    expect(binary.bytes).toBeGreaterThan(1000);
    expect(JSON.parse(readFileSync(join(dir, 'out_ske.json'), 'utf8')).armature.length).toBeGreaterThan(0);
    // the dbbin magic is 'DBDT'
    expect(readFileSync(join(dir, 'out_ske.dbbin')).subarray(0, 4).toString('ascii')).toBe('DBDT');
  });
});
describe.skipIf(!hasFixture)('MCP 结构工具与历史', () => {
  it('reads the bone tree, the slot list and one animation keyframe table', () => {
    const state = fresh();
    openProject(state, { file: SKELETON, texture: TEXTURE });

    const tree = bonesTree(state) as { count: number; bones: Array<{ name: string; depth: number; parent: string | null }> };
    expect(tree.count).toBe(63);
    expect(tree.bones[0].depth).toBe(0);
    expect(tree.bones[0].parent).toBeNull();
    expect(tree.bones.some((bone) => bone.name === 'head_bone_01' && bone.parent === 'neck_bone_02')).toBe(true);

    const slots = slotsList(state) as { count: number; slots: Array<{ name: string; parent: string; displays: number }> };
    expect(slots.count).toBe(14);
    expect(slots.slots.every((slot) => typeof slot.parent === 'string')).toBe(true);

    const detail = animationDetail(state, { animation: 'rooster_idle_anim' }) as {
      name: string; duration: number; bones: Array<{ bone: string; keyCount: number; frames: Array<{ frame: number }> }>;
    };
    expect(detail.name).toBe('rooster_idle_anim');
    expect(detail.bones.length).toBeGreaterThan(0);
    // 帧号由前序 duration 累加得到，所以每条时间轴的第一帧必然落在 0
    for (const timeline of detail.bones) expect(timeline.frames[0]?.frame ?? 0).toBe(0);
  });

  it('creates, renames and deletes a bone, and undo / redo walks the session history', () => {
    const state = fresh();
    openProject(state, { file: SKELETON, texture: TEXTURE });
    const namesOf = () => (bonesList(state) as { bones: Array<{ name: string }> }).bones.map((bone) => bone.name);

    const created = boneCreate(state, { name: 'tmp_bone' }) as { created: string; bones: number; undoDepth: number; redoDepth: number };
    expect(created.created).toBe('tmp_bone');
    expect(created.bones).toBe(64);
    expect(created.undoDepth).toBe(1);
    expect(created.redoDepth).toBe(0);

    const renamed = boneUpdate(state, { bone: 'tmp_bone', rename: 'tmp_bone_2', length: 30 }) as { changed: { name?: string; length?: number } };
    expect(renamed.changed.name).toBe('tmp_bone_2');
    expect(renamed.changed.length).toBe(30);

    // 撤销只回退最近一步（重命名 + 改长度），新建那一步仍在
    expect((historyUndo(state) as { undone: boolean }).undone).toBe(true);
    expect(namesOf()).toContain('tmp_bone');
    expect(namesOf()).not.toContain('tmp_bone_2');

    expect((historyRedo(state) as { redone: boolean }).redone).toBe(true);
    expect(namesOf()).toContain('tmp_bone_2');

    const removed = boneDelete(state, { bone: 'tmp_bone_2' }) as { bones: number };
    expect(removed.bones).toBe(63);
    expect((historyUndo(state) as { undone: boolean }).undone).toBe(true);
    expect((bonesList(state) as { count: number }).count).toBe(64);


    // 一路撤到底：栈空后返回 undone=false 而不是抛错，且骨架回到 63 根
    let steps = 0;
    while ((historyUndo(state) as { undone: boolean }).undone) steps++;
    expect(steps).toBe(2);
    expect((bonesList(state) as { count: number }).count).toBe(63);
  });
});