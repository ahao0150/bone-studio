/**
 * CLI `spine` 子命令（P1 P-06）：真跑一次命令，产出 Spine JSON，并与官方 `toSpine` 的 oracle 对拍。
 */
import { describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { main } from '../src/cli';

const BASE = '.';
const SRC = `${BASE}/work/cli-test/Bicycle_ske.json`;
const ORACLE = `${BASE}/samples/spine-bicycle.json`;
const OUT = `${BASE}/work/cli-spine-test`;
const has = existsSync(SRC) && existsSync(ORACLE);

type Any = Record<string, any>;

describe('CLI spine 子命令', () => {
  it.skipIf(!has)('导出 JSON，结构与官方 toSpine 一致', () => {
    rmSync(OUT, { recursive: true, force: true });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = main(['spine', '-i', SRC, '-o', OUT, '--spine-version', '3.6']);
    log.mockRestore();
    expect(code).toBe(0);

    const mine = JSON.parse(readFileSync(`${OUT}/Bicycle.json`, 'utf8')) as Any;
    const oracle = (JSON.parse(readFileSync(ORACLE, 'utf8')) as { spines: Any[] }).spines[0];
    // 顶层键顺序也照官方（skeleton, bones, slots, ik, transform, path, skins, animations, events）
    expect(Object.keys(mine)).toEqual(Object.keys(oracle));
    expect(mine.skeleton).toEqual(oracle.skeleton);
    expect(mine.bones.map((b: Any) => b.name)).toEqual(oracle.bones.map((b: Any) => b.name));
    expect(mine.bones.map((b: Any) => b.parent ?? null)).toEqual(oracle.bones.map((b: Any) => b.parent ?? null));
    expect(mine.slots.map((s: Any) => s.name)).toEqual(oracle.slots.map((s: Any) => s.name));
    expect(mine.slots.map((s: Any) => s.bone)).toEqual(oracle.slots.map((s: Any) => s.bone));
    expect(Object.keys(mine.animations)).toEqual(Object.keys(oracle.animations));
  });

  it.skipIf(!has)('第二个 armature 也各写一份（Bicycle_ske.json 里有 2 个）', () => {
    rmSync(OUT, { recursive: true, force: true });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    main(['spine', '-i', SRC, '-o', OUT, '--spine-version', '3.6']);
    log.mockRestore();
    expect(existsSync(`${OUT}/Bicycle.json`)).toBe(true);
    expect(existsSync(`${OUT}/robot.json`)).toBe(true);
  });

  it('没有 -i 时报错而不是写半个文件', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => main(['spine'])).toThrow();
    error.mockRestore();
  });
});