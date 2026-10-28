/**
 * 「新建工程」模板与官方空工程的逐字段对拍。
 *
 * 判据很强：直接用官方 `.dbproj`（DragonBones 新建后保存）解出来的 `dragonBones` 段
 * 与 `emptySkeleton()` 做 deep equal —— 少一个字段、错一个默认值都会红。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseDbproj, unwrapProjectSkeleton } from '../src/core/project/dbproj';
import { emptySheetSkeleton, emptySkeleton, newProjectDocument } from '../src/core/project/newProject';
import { isSheetArmature, readSheetFrames } from '../src/core/sheetEdit';

const REAL = process.env.BONESTUDIO_DBPROJ ?? 'samples/NewProject/NewProject.dbproj';
const hasReal = existsSync(REAL);

describe('新建工程模板', () => {
  it('产出的骨架可被工程外壳包裹并解回', () => {
    const project = newProjectDocument();
    expect(Array.isArray(project.dragonBones.armature)).toBe(true);
    const back = unwrapProjectSkeleton(project as unknown as Record<string, unknown>)!;
    expect(back).toEqual(emptySkeleton());
  });

  it.skipIf(!hasReal)('与官方空工程逐字段一致', () => {
    const parsed = parseDbproj(readFileSync(REAL));
    expect(parsed.complete).toBe(true);
    const official = unwrapProjectSkeleton(parsed.data as Record<string, unknown>)!;
    // 先比 keys（差异时报错更好读），再比整体
    expect(Object.keys(emptySkeleton()).sort()).toEqual(Object.keys(official).sort());
    const mineArray = emptySkeleton().armature as Array<Record<string, unknown>>;
    const officialArray = official.armature as Array<Record<string, unknown>>;
    expect(mineArray.length).toBe(officialArray.length);
    expect(Object.keys(mineArray[0]).sort()).toEqual(Object.keys(officialArray[0]).sort());
    const mineBones = mineArray[0].bone as Array<Record<string, unknown>>;
    const officialBones = officialArray[0].bone as Array<Record<string, unknown>>;
    expect(Object.keys(mineBones[0]).sort()).toEqual(Object.keys(officialBones[0]).sort());
    expect(emptySkeleton()).toEqual(official);
  });
});

describe('序列帧工程模板', () => {
  it('产出的骨架被识别为 sheet 工程，并带一个空的帧槽位', () => {
    const skeleton = emptySheetSkeleton();
    const armature = (skeleton.armature as Array<Record<string, unknown>>)[0];
    expect(armature.type).toBe('sheet');
    const sheet = readSheetFrames(armature as never);
    expect(sheet).not.toBeNull();
    expect(sheet!.slot).toBe('sheetSlot');
    expect(sheet!.frames.length).toBe(0);              // 空态：官方显示「拖拽图片到这里」
    expect(sheet!.animation?.name).toBe('Animation1');
    expect(isSheetArmature(armature as never)).toBe(true);
  });

  it('骨骼模板不会被当成 sheet 工程', () => {
    const armature = (emptySkeleton().armature as Array<Record<string, unknown>>)[0];
    expect(isSheetArmature(armature as never)).toBe(false);
    expect(readSheetFrames(armature as never)).toBeNull();
  });
});