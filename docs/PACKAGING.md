# BoneStudio 打包与性能预算（M6）

本文记录「可发布产物」的形态、性能预算与一键复跑方式。目标程序的格式验证与格式规格见
[`格式规范`](格式规范)，界面规范见 [`UX-DESIGN.md`](UX-DESIGN.md)。

## 1. Web 产物

```bash
npm run build      # tsc -b（严格模式）+ vite build → dist/
npm run preview    # 本地预览 dist/
```

产物是**纯静态**站点（`dist/index.html` + `dist/assets/*.js|css`），不需要后端：
应用本身没有运行时网络依赖，导入工程走文件选择 / 拖放，图集以 data URL 或同目录资源读入。

已知产物体积（2026-10-12 拆包后，`vite 6.4.4`）：

| 文件 | 大小 | gzip |
|---|---|---|
| `dist/index.html` | 0.42 kB | 0.31 kB |
| `dist/assets/index-*.css` | 33.8 kB | 6.5 kB |
| `dist/assets/index-*.js`（入口） | **332 kB** | **109.5 kB** |
| `dist/assets/react-*.js` | 142.9 kB | 45.8 kB |
| `dist/assets/pixi-*.js` | 526.7 kB | 150.0 kB |
| 其余按需分包（PixiJS 渲染器分支） | 2.7–74 kB | 1.2–20 kB |

> 入口 chunk 已经从 541 kB（gzip 175 kB）降到 **332 kB（gzip 109.5 kB）** —— `vite.config.ts` 的
> `build.rollupOptions.output.manualChunks` 把 `pixi.js` 与 `react` 拆成独立 chunk。

> 首屏预算由 `npm run verify:budget`（`tools/verify-bundle-budget.mjs`）把关：入口 ≤ 400 kB / gzip ≤ 130 kB、
> 全部 JS ≤ 1.2 MB；证据落在 `docs/evidence/bundle-budget.json`，并已接入 `npm run verify`。

## 2. 产物验证（`npm run verify:dist`）

**为什么单独做**：前 25 轮的所有端到端证据都打在 `vite` 开发服务器上，而开发模式与产物
至少在两点不同——`import.meta.env.DEV` 为真时会挂调试探针 `window.__boneStudio`，
且开发服务器额外挂了示例数据中间件。产物能不能跑必须单独证明。

`tools/verify-dist.mjs` 做四件事，全程**零额外依赖**（Node 内置 http + 全局 WebSocket）：

1. 用内置 `http` 起一个静态服务器托管 `dist/`（MIME 表内联，路径逃逸防护，未知路径回落 `index.html`）；
2. 起一个 `--headless=new` 的 Chrome（临时 profile，端口可配）；
3. 通过 CDP `DOM.setFileInputFiles` 把**真实工程**塞进应用的 `<input type="file">`（模拟用户打开工程）；
4. 从状态栏 / 视口页脚读回对象数、渲染耗时、fps、时间轴行数与动画列表，写证据到
   `docs/evidence/dist-verify.json`，并在控制台出现任何 error 时判失败。

断言：产物里**没有** `window.__boneStudio`（确认是生产构建）、有文件输入、画布存在、
两个工程都能渲染出对象、时间轴有轨道、最后一个工程的稳态 fps ≥ 55、控制台 0 error。

实测（2026-10-11）：

| 工程 | 对象 | 渲染 | fps | 时间轴轨道 |
|---|---|---|---|---|
| `Rooster_Ani`（63 骨骼） | 14 | 2.0 ms | 61 | 64 |
| `you_xin/body`（70 骨骼 / 96 槽位 / 10 动画） | 96 | 1.6 ms | 60 | 71 |

截图：`docs/screenshot-editor-dist.png`。

## 3. CPU 性能预算（`tests/perf.test.ts`）

60fps 的预算是 16.7 ms/帧。这里测的是**编辑器每帧真正要做的 CPU 工作**：
`Skeleton.update()` 采样 + `getRenderItems()` 组网格（不含 GPU 提交），
因为它跟设备无关、可重复，也最容易因为代码改动而数量级退化。

两份负载：

| 负载 | 骨骼 | 槽位 | 动画 | 帧数 | 生成图元 | 平均 | p95 | 最差 |
|---|---|---|---|---|---|---|---|---|
| `you_xin/body`（真实素材） | 70 | 96 | 10 | 540 | 51,840 | **0.41 ms** | 0.79 ms | 7.8 ms |
| 合成压力骨架（200 骨骼链） | 200 | 200 | 1 | 240 | 48,000 | **0.90 ms** | 1.91 ms | 11.9 ms |

判据：

- 先跑一遍**热身**再计时（让 V8 优化热路径），避免 JIT 计入预算；
- 断言 **avg < 8 ms**（60fps 预算的 2 倍余量）与 **p95 < 16 ms**；
- `worst` 只报告不设卡：首帧与 GC 抖动会到 8–12 ms，用它当门禁必然抖动。

结论：真实素材每帧约 0.4 ms、200 骨骼压力骨架约 0.9 ms，都远在 60fps 预算内
（折算约 1000+ fps 的 CPU 余量）。

## 4. 一键复跑

```bash
npm run verify        # npm test && npm run build && npm run verify:dist
```

环境变量（都有默认值，默认指向本地样本目录）：

| 变量 | 作用 |
|---|---|
| `CHROME_PATH` | headless Chrome 可执行文件 |
| `BONESTUDIO_SAMPLES` | 小示例（`Rooster_Ani`）所在目录 |
| `BONESTUDIO_BIG_SAMPLES` | 大骨架示例所在目录（`you_xin/body`） |
| `BONESTUDIO_PERF_SAMPLES` | 性能测试的素材目录 |
| `DIST_PORT` / `DIST_CDP` | 静态服务器 / CDP 端口 |

## 6. Windows 桌面产物（免安装）

```bash
npm run build            # 先出生产产物
npm run package:desktop  # → release/BoneStudio-win32-x64/
```

目录结构（Electron 默认会加载 `resources/app/`）：

```
release/BoneStudio-win32-x64/
├─ BoneStudio.exe          ← electron.exe 复制改名
├─ *.dll / locales/ …      ← Electron 运行时
└─ resources/app/
   ├─ package.json         ← main 指向 tools/desktop/main.cjs
   ├─ tools/desktop/main.cjs
   └─ dist/…               ← 生产构建产物
```

双击 `BoneStudio.exe` 即可运行，**不需要安装**，也没有引入 `electron-builder`
（后者还得再下几百 MB 的 nsis / winCodeSign）。为了让 `file://` 能加载，`vite.config.ts`
设了 `base: "./"` —— 相对资源路径在 HTTP 静态托管下同样有效，所以 Web 产物不受影响。

判据 `work/verify-desktop.mjs`：启动 `BoneStudio.exe`（带 `--remote-debugging-port`），
CDP 读回标题 / `file://` URL / `window.__boneStudio === undefined`，再用 `DOM.setFileInputFiles`
塞入 Rooster 工程，确认画布出现、插槽 14、状态栏 60fps。

## 5. 尚未完成

| 项 | 状态 |
|---|---|
| Web 静态产物 + 产物级端到端 + 性能预算 | ✅ 本轮完成 |
| 首屏体积预算（`manualChunks` 拆分 + 体积断言） | ✅ 已完成：入口 541→332 kB，`npm run verify:budget` 把关 |
| Windows 桌面产物（Electron 自带运行时，免安装） | ✅ 已完成：`npm run package:desktop` → `release/BoneStudio-win32-x64/BoneStudio.exe`（见第 6 节） |
| **MCP 接口（给 agent 驱动编辑器）** | ✅ 已落地：`src/mcp/server.ts` + `tools.ts`，7 个工具（open_project / skeleton_summary / bones_list / animations_list / bone_transform_get / bone_keyframe_set / skeleton_export），零依赖 stdio JSON-RPC；见 `docs/MCP.md` |
| AI 扩展接口（自然语言打关键帧 / 动作生成 / 口型表情） | ✅ `src/ai/pluginApi.ts` + `capabilities.ts`：`lip-sync` 与 `motion-transfer` 两个 capability 已注册，经 MCP 的 `ai_plan` / `ai_apply` 驱动 |
