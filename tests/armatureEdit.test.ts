/**
 * 元件级编辑（P1 P-10 新建元件 / P-17 导入数据到项目）。
 *
 * 判据：新元件真的进了 `doc.armatures`（与 `raw.armature` 同一数组，导出可见）、
 * 名字冲突自动加后缀、骨架/序列帧两种模板类型正确。
 */
import { describe, expect, it } from 'vitest';
import { parseSkeletonData } from '../src/core/parse/ske';
import { addArmature, mergeArmatures, mergeSkeletonDoc, removeArmature, uniqueArmatureName } from '../src/core/armatureEdit';
import { emptySkeleton } from '../src/core/project/newProject';
import { isSheetArmature, readSheetFrames } from '../src/core/sheetEdit';

const makeDoc = () => parseSkeletonData(emptySkeleton());

describe('元件级编辑（新建元件 / 并入外部数据）', () => {
  it('新建骨架元件：进 armatures、与 raw.armature 同一数组、type 正确', () => {
    const doc = makeDoc();
    expect(doc.armatures.length).toBe(1);
    const name = addArmature(doc, 'armature', 'hero');
    expect(name).toBe('hero');
    expect(doc.armatures.length).toBe(2);
    expect(doc.raw.armature.length).toBe(2);              // 导出时能看到
    const added = doc.armatures[1];
    expect(added.name).toBe('hero');
    expect(added.type).toBe('Armature');
  });

  it('新建序列帧元件：type = sheet，且能被 sheetEdit 认出来', () => {
    const doc = makeDoc();
    const name = addArmature(doc, 'sheet', 'walk_sheet');
    const added = doc.armatures.find((a) => a.name === name)!;
    expect(isSheetArmature(added)).toBe(true);
    expect(readSheetFrames(added)?.slot).toBe('sheetSlot');
  });

  it('重名自动加后缀', () => {
    const doc = makeDoc();
    expect(uniqueArmatureName(doc, doc.armatures[0].name)).toBe(`${doc.armatures[0].name}_1`);
    expect(uniqueArmatureName(doc, 'Armature')).toBe('Armature_1');
    expect(addArmature(doc, 'armature', 'Armature')).toBe('Armature_1');
  });

  it('并入外部骨架：全部加入且重名加后缀', () => {
    const doc = makeDoc();
    const added = mergeArmatures(doc, [
      { name: 'Armature' } as never,        // 与现有同名 → Armature_1
      { name: 'robot' } as never,
    ]);
    expect(added).toEqual(['Armature_1', 'robot']);
    expect(doc.armatures.map((a) => a.name)).toEqual(['Armature', 'Armature_1', 'robot']);
    expect(doc.raw.armature.length).toBe(3);
  });

  it('从另一份骨架文档并入，空输入不报错', () => {
    const doc = makeDoc();
    const incoming = emptySkeleton({ name: 'other' });
    expect(mergeSkeletonDoc(doc, incoming as never)).toEqual(['other']);
    expect(mergeSkeletonDoc(doc, null)).toEqual([]);
    expect(mergeSkeletonDoc(doc, { armature: [] } as never)).toEqual([]);
  });

  it('删除元件：进 armatures 与 raw.armature 同步消失，最后一个元件删不掉', () => {
    const doc = makeDoc();
    addArmature(doc, 'armature', 'hero');
    expect(doc.armatures.map((a) => a.name)).toEqual(['Armature', 'hero']);

    expect(removeArmature(doc, 'hero')).toBe(true);
    expect(doc.armatures.map((a) => a.name)).toEqual(['Armature']);
    expect(doc.raw.armature.length).toBe(1);              // 导出时也不见
    expect(removeArmature(doc, 'hero')).toBe(false);      // 已经没了

    // 工程至少要留一个元件（官方 deleteArmatureVO 检查 length > 1）
    expect(removeArmature(doc, 'Armature')).toBe(false);
    expect(doc.armatures.length).toBe(1);
  });
});