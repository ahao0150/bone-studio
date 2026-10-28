// 演示：通过真实 stdio MCP 导入 asset-canvas 的 lubu_q34，渲染 5 个动作的预览、导出 Spine 4.2 并校验、编辑器截图。
// 用法：npm run build:mcp && node tools/mcp-demo-lubu.mjs [角色目录] [输出目录]
import { startMcp } from './mcp-client.mjs';
const charDir = process.argv[2] ?? '/workspace/asset-canvas/chars/lubu_q34';
const out = process.argv[3] ?? '/workspace/demo-out/lubu_q34';
const mcp = startMcp();
const log = (k, v) => console.log(k, JSON.stringify(v, null, 1));
try {
  await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'demo', version: '1' } });
  const tools = await mcp.request('tools/list', {});
  console.log('tools:', tools.tools.length);
  log('import', await mcp.call('project_import', { path: charDir, name: 'lubu_q34' }));
  for (const anim of ['idle', 'walk', 'attack', 'hit', 'death']) {
    log(anim, await mcp.call('render_animation', { animation: anim, out: `${out}/${anim}_sheet.png`, format: 'sheet', width: 220, columns: 6 }));
  }
  log('gif', await mcp.call('render_animation', { animation: 'attack', out: `${out}/attack.gif`, format: 'gif', width: 320 }));
  log('spine42', await mcp.call('spine_export', { outDir: `${out}/spine42`, version: '4.2' }));
  log('spine41', await mcp.call('spine_export', { outDir: `${out}/spine41`, version: '4.1', validate: false }));
  log('url', await mcp.call('editor_url', { animation: 'attack', frame: 18 }));
  try { log('shot', await mcp.call('editor_screenshot', { out: `${out}/editor_attack.png`, animation: 'attack', frame: 18 })); } catch (e) { console.log('screenshot skipped:', e.message); }
} finally { mcp.close(); }
