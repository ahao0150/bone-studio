// 红狐换皮：skin_clone + region_swap 应用 AI 纹理 + 渲染检查
// 用法: node apply_reskin.mjs <parts_dir> [skinName] [projectName] [workdir]
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const { startMcp } = await import('file://' + join(REPO, 'tools', 'mcp-client.mjs').replace(/\\/g, '/'));

const partsDir = resolve(HERE, process.argv[2] || 'parts');
const skinName = process.argv[3] || 'painterly';
const projectName = process.argv[4] || 'red-fox-2d';
const workdir = resolve(process.env.RESKIN_WORKDIR || process.argv[5] || join(HERE, '..', 'fox-workspace'));
const manifest = JSON.parse(readFileSync(join(workdir, 'layers_manifest.json'), 'utf8'));
const OUT = join(HERE, 'render');
mkdirSync(OUT, { recursive: true });

const mcp = await startMcp({ BONESTUDIO_PROJECTS: join(REPO, 'projects') });
try {
  await mcp.call('session_set', { name: 'Claude Desktop (Cowork)·骨骼动画师', task: '红狐 AI 换皮' });
  await mcp.call('project_open', { name: projectName });

  const skins = await mcp.call('skin_list', {});
  const list = skins.skins ?? [];
  const has = list.some((s) => (s.name ?? s) === skinName);
  if (has) {
    await mcp.call('skin_set', { name: skinName });
    console.log('skin_set ->', skinName);
  } else {
    const r = await mcp.call('skin_clone', { name: skinName });
    console.log('skin_clone ->', JSON.stringify(r).slice(0, 200));
  }

  for (const e of manifest.sort((a, b) => a.zIndex - b.zIndex)) {
    // 影子不参与换皮：恢复原始深色半透明纹理
    const file = e.name === 'shadow'
      ? join(HERE, '..', 'fox-workspace', 'png', 'shadow.png')
      : join(partsDir, e.name + '.png');
    await mcp.call('region_swap', { slot: e.name, file, keepSize: true });
  }
  console.log('region_swap x', manifest.length, 'slots');

  await mcp.call('project_save', {});
  const setup = await mcp.call('render_frame', { setup: true, width: 800, height: 600, background: '#EDE6DA', out: join(OUT, 'reskin_setup.png') });
  const setupB = await mcp.call('render_frame', { setup: true, bones: true, width: 800, height: 600, background: '#EDE6DA', out: join(OUT, 'reskin_setup_bones.png') });
  const runSheet = await mcp.call('render_animation', { animation: 'run', format: 'sheet', cols: 9, step: 2, width: 320, height: 240, out: join(OUT, 'reskin_run_sheet.png') });
  const idleSheet = await mcp.call('render_animation', { animation: 'idle', format: 'sheet', cols: 6, step: 4, width: 400, height: 300, out: join(OUT, 'reskin_idle_sheet.png') });
  const jumpSheet = await mcp.call('render_animation', { animation: 'jump', format: 'sheet', cols: 6, step: 2, width: 320, height: 240, out: join(OUT, 'reskin_jump_sheet.png') });
  console.log(JSON.stringify({ setup: setup.out, runSheet: runSheet.out }));
} catch (e) {
  console.error('APPLY FAILED:', e.message);
  process.exitCode = 1;
} finally {
  mcp.close();
  setTimeout(() => process.exit(process.exitCode || 0), 100);
}
