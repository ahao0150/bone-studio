/**
 * 真实 stdio 端到端：起 dist-mcp/server.js（先 `npm run build:mcp`），握手 → tools/list → 新建工程 → 渲染。
 */
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM helper without types
import { startMcp } from '../tools/mcp-client.mjs';

const SERVER = join(__dirname, '..', 'dist-mcp', 'server.js');

describe.skipIf(!existsSync(SERVER))('MCP over stdio', () => {
  it('negotiates, lists tools and drives a project', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bs-stdio-'));
    const mcp = startMcp({ BONESTUDIO_PROJECTS: dir });
    try {
      const init = await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
      expect(init.protocolVersion).toBe('2025-06-18');
      const list = await mcp.request('tools/list', {});
      const names = list.tools.map((t: { name: string }) => t.name);
      for (const n of ['project_import', 'image_add', 'mesh_create', 'weights_auto', 'bone_key', 'slot_key', 'render_frame', 'render_animation', 'spine_export', 'editor_url', 'editor_screenshot']) expect(names).toContain(n);
      await mcp.call('project_new', { name: 'stdio' });
      await mcp.call('bone_create', { name: 'b1', parent: 'root', length: 50 });
      await mcp.call('bone_key', { bone: 'b1', frame: 12, rotate: 30 });
      const out = join(dir, 'f.png');
      await mcp.call('render_frame', { out, frame: 6 });
      expect(readFileSync(out).subarray(1, 4).toString()).toBe('PNG');
      const undo = await mcp.call('history_undo', {});
      expect(undo.undone).toBe(true);
    } finally { mcp.close(); }
  }, 30000);
});
