import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { mcpInfoPlugin } from './tools/mcpInfoPlugin';
import { livePlugin } from './tools/livePlugin';
import { projectAdminPlugin } from './tools/projectAdminPlugin';
import { resolveProjectsDir, resolveSamplesDir } from './tools/mcpInfoCore';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

/**
 * Dev-only helper: serve the local DragonBones Pro example exports (extracted by
 * the reverse-engineering step) so the editor can be verified without copying
 * Egret's sample assets into this repository.
 */
// 两个互不相干的目录：
//  - 内置示例（/dbsamples）：BONESTUDIO_SAMPLES > 本机取证示例目录 > 无；欢迎页「示例」只列这里
//  - AI 工程（/aiprojects）：BONESTUDIO_PROJECTS > <repo>/projects；MCP server 写这里，欢迎页「AI 工程」/ AI 面板列这里
function projectsInfo() {
  return resolveProjectsDir(process.env, resolve('.'));
}
function aiProjectsRoot(): string {
  return projectsInfo().dir;
}
function samplesRoot(): string | null {
  return resolveSamplesDir(process.env, resolve('.'), existsSync);
}

const MIME: Record<string, string> = { '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.atlas': 'text/plain' };

/** 把一个目录按原样挂到 route 下（只读、禁止越界、点开头的文件 / 目录不出） */
function staticDirPlugin(name: string, route: string, root: () => string | null): Plugin {
  return {
    name,
    configureServer(server) {
      server.middlewares.use(route, (req, res, next) => {
        const dir = root();
        if (!dir) { next(); return; }
        const url = decodeURIComponent((req.url ?? '').split('?')[0]);
        if (/(^|[\\/])\./.test(url)) { next(); return; }
        const target = resolve(join(dir, normalize(url).replace(/^([/\\])+/, '')));
        if (!target.startsWith(resolve(dir)) || !existsSync(target) || !statSync(target).isFile()) { next(); return; }
        res.setHeader('Content-Type', MIME[extname(target).toLowerCase()] ?? 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-store');
        createReadStream(target).pipe(res);
      });
    },
  };
}

function localSamplesPlugin(): Plugin {
  const root = samplesRoot() ?? resolve('.no-samples');
  const mime: Record<string, string> = {
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.atlas': 'text/plain',
  };
  return {
    name: 'bone-studio-local-samples',
    configureServer(server) {
      server.middlewares.use('/dbsamples', (req, res, next) => {
        const url = decodeURIComponent((req.url ?? '').split('?')[0]);
        const target = resolve(join(root, normalize(url).replace(/^([/\\])+/, '')));
        if (!target.startsWith(resolve(root)) || !existsSync(target) || !statSync(target).isFile()) {
          next();
          return;
        }
        res.setHeader('Content-Type', mime[extname(target).toLowerCase()] ?? 'application/octet-stream');
        createReadStream(target).pipe(res);
      });
    },
  };
}

/**
 * Dev-only helper: serve `public/plugins/*.js` as-is.
 *
 * `public/` 下的文件不该被 Vite 当模块转换（`import('/plugins/x.js')` 会带 `?import`
 * 走进 transform → 500）。插件是运行时才知道的 ESM，所以这里直接把原文按
 * `text/javascript` 返回。生产构建时 `public/` 会原样拷进 dist，静态服务器直接返回。
 */
function localPluginsPlugin(): Plugin {
  const root = 'public/plugins';
  return {
    name: 'bone-studio-local-plugins',
    configureServer(server) {
      server.middlewares.use('/plugins', (req, res, next) => {
        const url = decodeURIComponent((req.url ?? '').split('?')[0]);
        const target = resolve(join(root, normalize(url).replace(/^([/\\])+/, '')));
        if (!target.startsWith(resolve(root)) || !existsSync(target) || !statSync(target).isFile()) {
          next();
          return;
        }
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        createReadStream(target).pipe(res);
      });
    },
  };
}

export default defineConfig({
  // 相对资源路径：Web 静态托管与桌面 `file://` 加载都能用（桌面外壳见 tools/desktop/main.cjs）。
  base: './',
  plugins: [react(), localSamplesPlugin(), localPluginsPlugin(), staticDirPlugin('bone-studio-ai-projects', '/aiprojects', aiProjectsRoot), mcpInfoPlugin(projectsInfo), livePlugin(aiProjectsRoot), projectAdminPlugin({ projectsRoot: aiProjectsRoot, samplesRoot })],
  server: {
    port: 5178,
    strictPort: false,
    watch: {
      // 忽略编辑工具/构建产生的临时目录：watch 到被锁的临时文件会 EBUSY，未捕获异常会带崩 dev server
      ignored: ['**/.*.tmpdir/**', '**/*.tmp', '**/.build-tmp/**', '**/.verify-projects/**'],
    },
  },
  // build:mcp 把 spine-core 打进 dist-mcp/server.js：只拉代码没 npm install 新依赖时 server 也能启动
  ssr: { noExternal: ['@esotericsoftware/spine-core'] },
  build: {
    target: 'es2022',
    // 首屏体积预算（M6）：把渲染器与框架从入口 chunk 里拆出去，入口只留应用本身。
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/pixi.js')) return 'pixi';
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react';
          // Spine 导入器按需加载官方运行时：单独成 chunk，入口 bundle 不增长
          if (id.includes('node_modules/@esotericsoftware/spine-core')) return 'spine-core';
          return undefined;
        },
      },
    },
  },
});
