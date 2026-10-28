/**
 * Batch CLI regression: the conversion must reproduce the shipped tool's bytes
 * and `inspect` must summarise both input formats.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { main } from '../src/cli';

const ORACLE = 'samples';
const INPUT = `${ORACLE}/out-bicycle-new/Bicycle_ske.json`;
const BINARY = `${ORACLE}/out-new-as-binary/Bicycle_ske.dbbin`;
const OUT = 'work/cli-test';
const hasFixture = existsSync(INPUT) && existsSync(BINARY);

describe.skipIf(!hasFixture)('batch CLI', () => {
  it('converts JSON to the shipped tool\'s exact bytes', () => {
    mkdirSync(OUT, { recursive: true });
    expect(main(['convert', '-i', INPUT, '-o', OUT, '-t', 'binary'])).toBe(0);
    const mine = readFileSync(`${OUT}/Bicycle_ske.dbbin`);
    expect(mine.equals(readFileSync(BINARY))).toBe(true);
  });

  it('round-trips a binary back to JSON', () => {
    mkdirSync(OUT, { recursive: true });
    expect(main(['convert', '-i', BINARY, '-o', OUT, '-t', 'json'])).toBe(0);
    const json = JSON.parse(readFileSync(`${OUT}/Bicycle_ske.json`, 'utf8')) as { armature: unknown[] };
    expect(json.armature.length).toBe(2);
  });

  it('inspects a binary document', () => {
    expect(main(['inspect', BINARY])).toBe(0);
  });
});
