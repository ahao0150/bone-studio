/**
 * bikeik 离线对拍：把本编辑器的逐帧世界矩阵与**官方运行时**的逐帧输出对比。
 *
 * 官方数据由 closure oracle 的 `&probe=` 通道一次采集后缓存，因此这个工具不再起 Chrome，
 * 适合快速迭代 IK / 变换状态机（§101/§161）。
 *
 *   node work/dump-official-probe.mjs      # 重新采集（需 Chrome，见 docs/DBPRO-SPEC.md §101）
 *   npx vite-node tools/ik-parity.mts      # 离线对比
 *
 * Env: BONESTUDIO_PROBE 覆盖 probe json 路径；BONESTUDIO_PROJECT 覆盖工程 fixture。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Player } from '../src/core/player';
import { setBoneTransform } from '../src/core/editing';

const ROOT = process.cwd();
const HOME = resolve(ROOT, '..', '..');
const PROBE = process.env.BONESTUDIO_PROBE ?? join(ROOT, 'docs/evidence/official-bikeik-probe.json');
const PROJECT = process.env.BONESTUDIO_PROJECT ?? join(process.env.BONESTUDIO_SAMPLES ?? HOME, 'projects/Bicycle/Bicycle_ske.json');
const WATCH = (process.env.BONESTUDIO_WATCH ?? 'arm_lower,arm_hand,arm_upper').split(',');

if (!existsSync(PROBE)) {
  console.error(`missing official probe data: ${PROBE}`);
  console.error('regenerate it with a headless-Chrome dump (see docs/DBPRO-SPEC.md §101).');
  process.exit(2);
}

interface Probe { frames: Array<Record<string, number[]>> }
const off = JSON.parse(readFileSync(PROBE, 'utf8')) as Probe;
const src = JSON.parse(readFileSync(PROJECT, 'utf8')) as unknown;
const player = new Player(src as never);
player.setArmature('Bicycle');
player.setAnimation('bicycle');
setBoneTransform(player, 'arm_lower', 19, { skX: -10 });

let worst = 0;
let worstAt = '';
const rows: string[] = [];
for (let f = 0; f < off.frames.length; f++) {
  player.position = f;
  player.skeleton.update(player.animation, f);
  const cells: string[] = [];
  for (const name of WATCH) {
    const bone = player.skeleton.bones.find((b) => b.name === name);
    const expected = off.frames[f]?.[name];
    if (!bone || !expected) { cells.push('?'); continue; }
    let max = 0;
    let component = -1;
    for (let i = 0; i < 6; i++) {
      const d = Math.abs(bone.world[i] - expected[i]);
      if (d > max) { max = d; component = i; }
    }
    if (max > worst) { worst = max; worstAt = `f${f} ${name}[${component}]`; }
    cells.push(max < 1e-6 ? '.' : `${max.toExponential(2)}#${component}`);
  }
  rows.push(`${String(f).padStart(3)} | ${cells.join(' | ')}`);
}

console.log(`probe: ${PROBE}`);
console.log(`frame | ${WATCH.join(' | ')}`);
for (const row of rows) console.log(row);
console.log(`worst ${worst.toExponential(4)} @ ${worstAt}`);
process.exit(worst < 1e-5 ? 0 : 1);
