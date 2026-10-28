/**
 * Project wrapper shape: a bare `*_ske.json` is not a project - the shipped
 * reader looks for `dragonBones` (see 格式规范).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  defaultStage, parseDbproj, serializeDbproj, unwrapProjectSkeleton, wrapSkeletonAsProject,
} from '../src/core/project/dbproj';

const SKELETON = 'samples/out-new/Rooster_An_ske.json';
const hasFixture = existsSync(SKELETON);

describe('project wrapper', () => {
  it('uses the shipped template stage/timeline blocks', () => {
    const stage = defaultStage();
    expect(Object.keys(stage)).toEqual(['cX', 'cY', 'zoom', 'filter']);
    const filter = stage.filter as Record<string, Record<string, unknown>>;
    expect(Object.keys(filter)).toEqual(['visibleFilter', 'selectableFilter']);
    expect(Object.keys(filter.visibleFilter)).toEqual(['bone', 'image', 'bones', 'slots']);
  });

  it('wraps a skeleton into the project key order', () => {
    const doc = { version: '5.5', frameRate: 24, name: 'demo', armature: [{ name: 'a' }] };
    const project = wrapSkeletonAsProject(doc);
    expect(Object.keys(project)).toEqual([
      'library', 'currentArmature', 'projectType', 'isNew', 'stage', 'timeline', 'dragonBones',
    ]);
    expect(project.currentArmature).toBe('a');
    expect(project.dragonBones).toEqual(doc);
    expect(project.timeline).toEqual({ autoRecordKeyFrame: 0, autoTween: 1 });
  });

  it.skipIf(!hasFixture)('round-trips a real skeleton losslessly through the JSON flavour', () => {
    const source = JSON.parse(readFileSync(SKELETON, 'utf8'));
    const bytes = serializeDbproj(wrapSkeletonAsProject(source), true);
    // plain JSON: the shipped reader takes the else branch, so the first byte is not 0x6F
    expect(bytes[0]).not.toBe(0x6f);
    const parsed = parseDbproj(bytes);
    expect(parsed.format).toBe('json');
    const back = unwrapProjectSkeleton(parsed.data as Record<string, unknown>);
    expect(back).not.toBeNull();
    expect(JSON.stringify(back)).toBe(JSON.stringify(source));
  });

  it('rejects payloads that carry no dragonBones block', () => {
    expect(unwrapProjectSkeleton({ library: [] })).toBeNull();
    expect(unwrapProjectSkeleton({ dragonBones: { armature: 'nope' } })).toBeNull();
  });
});
