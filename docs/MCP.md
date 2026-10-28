# BoneStudio MCP 接口（给 agent 用）

BoneStudio 把自己暴露成一个 **MCP server**：agent 用标准 MCP 工具调用驱动编辑内核 ——
打开工程、读结构、打关键帧、增删改骨骼、撤销回去、导出。走的都是**和 UI 完全相同**的命令路径
（同一个 `Player` + `core/editing` / `core/boneEdit` / `core/meshEdit`），所以结果可对拍、可撤销。

## 启动

```bash
cd outputs/bone-studio
npm run build:mcp      # vite build --ssr -> dist-mcp/server.js
npm run mcp            # node dist-mcp/server.js（stdio）
```

**为什么分两步**：`vite-node` 启动时 `npm` 会往 stdout 打 `npm notice`，那会污染 stdio 上的
JSON-RPC 帧；所以先 `vite build --ssr` 出一个干净的 JS 入口，再直接 `node` 跑。

把它接进 MCP 客户端（stdio）。Cursor：仓库里已带 `.cursor/mcp.json`（用 `${workspaceFolder}`），
其它客户端用绝对路径：

```json
{
  "mcpServers": {
    "bone-studio": {
      "command": "node",
      "args": ["<abs>/bone-studio/dist-mcp/server.js"],
      "env": {
        "BONESTUDIO_PROJECTS": "<abs>/bone-studio/projects",
        "BONESTUDIO_EDITOR_URL": "http://127.0.0.1:5178"
      }
    }
  }
}
```

| 环境变量 | 作用 | 默认 |
|---|---|---|
| `BONESTUDIO_PROJECTS` | MCP / AI 工作区（工程 + `manifest.json`），dev server 挂在 `/aiprojects/` | `<repo>/projects` |
| `BONESTUDIO_SAMPLES` | **仅**编辑器内置示例目录（`/dbsamples/`，欢迎页「示例」）；不再兼作 AI 工作区 | 本地样本示例目录（存在时） |
| `BONESTUDIO_EDITOR_URL` | 编辑器 dev server 地址（`editor_url` / `editor_screenshot`） | 依次探测 5178–5181 上「服务这个工作区」的那个 |
| `CHROME_PATH` | `editor_screenshot` 用的 Chrome | `/usr/bin/google-chrome` 等常见位置 |

### 让编辑器看到 MCP 的改动（live）

```bash
npm run dev     # AI 工作区挂在 /aiprojects/（BONESTUDIO_PROJECTS 覆盖目录），欢迎页「AI 工程」分区 + AI 面板「实时预览」
```

MCP 每次写工程都会把 `projects/<name>/<name>_ske.json|_tex.json|_tex.png` 写盘并更新 `manifest.json` 的 `rev`；
`editor_url` 返回的 `?aiproject=<name>&live=1&anim=<动画>&frame=<帧>` 页面通过 SSE 原地更新（SSE 不可用时每 1.5s 轮询 `/aiprojects/manifest.json`，`rev` 一变就整页重载）。旧链接 `?sample=<AI 工程名>` 仍可用（自动改写成 `?aiproject=`）——
agent 改一下，编辑器里就看得到。`&play=1` 自动播放。

## 协议

换行分隔的 JSON-RPC 2.0（MCP stdio framing：一行一个 JSON 对象，行内不含换行）。
实现的方法：`initialize`、`notifications/initialized`、`ping`、`tools/list`、`tools/call`。
协议版本默认 `2024-11-05`，客户端请求 `2025-03-26` / `2025-06-18` 时照回（版本协商）；零依赖（没有引入 MCP SDK）。

## 工具（43）

### 工作室工具（`src/mcp/studio.ts`，本轮新增 24 个）

所有写工具：先进撤销栈（`history_undo` 可退）→ 失败回滚 → 成功后若工程在工作区则自动写盘（编辑器 live 重载）。返回值带 `synced` / `undoDepth`。

| 工具 | 作用 |
|---|---|
| `project_new` | 新建空工程（root 骨骼 + idle），进工作区并开自动同步 |
| `project_import` | 导入流水线产物：`chars/<id>`（自动挑 `out/*_dragonbones` → `out/*_spine` → `layers.json`，`prefer` 可改）、DragonBones 目录、Spine 4.x 目录（`skeleton.json` + `images/`，用官方 spine-core 逐帧烘焙）、`layers.json`（分层 PNG，未绑定） |
| `project_open` / `project_save` / `project_list` | 打开工作区工程或任意 `*_ske.json`；保存（另存为）；列出 |
| `image_add` / `layers_add` | 加图（图集整页重排）并挂到插槽 / 批量加分层 PNG（原点 = 画布底边中点） |
| `slot_create` / `slot_update` | 新建插槽；改父骨骼（保持世界位置）、附件、颜色、混合、绘制顺序 |
| `mesh_create` | 图片 → cols×rows 网格（轮廓顶点在前，Spine hull 正确） |
| `weights_auto` / `weights_set` | 按到骨骼线段的距离自动蒙皮（每顶点 ≤ N 根）/ 精确改某顶点权重 |
| `animation_create` / `animation_update` | 新建（可复制）/ 改时长、循环、改名、删除 |
| `bone_key` / `bone_keys` | **通道关键帧**（相对绑定姿态的增量：rotate / x,y / scaleX,scaleY；easing = linear / stepped / 数字 / bezier[4]）；批量版只同步一次 |
| `slot_key` | 插槽颜色键（受击闪红、淡出）/ 附件切换键（眨眼换图，空串 = 隐藏） |
| `event_key` | 事件帧（导出到 Spine `events`） |
| `render_frame` | **无头软件光栅**渲染一帧 PNG（与编辑器同一套 `Player.renderItems()` 姿态） |
| `render_animation` | 整段：`sheet` 联系表 / `frames` PNG 序列 / `gif` / `mp4`（后两者用 ffmpeg） |
| `spine_export` | Spine **4.2**（默认）/ 4.1 / 3.6(legacy) JSON + `.atlas` + png；默认用官方 `@esotericsoftware/spine-core` 4.2 加载并逐帧对拍 |
| `dragonbones_export` | DragonBones 5.5 包 |
| `editor_url` / `editor_screenshot` | 编辑器深链（live）/ 无头 Chrome 打开编辑器截图（验证编辑器里的预览） |

### 核心工具（原有 19 个）


### 工程 / 读取

| 工具 | 作用 | 关键参数 |
|---|---|---|
| `open_project` | 打开 `*_ske.json` / `*_ske.dbbin`（可选纹理），返回骨架摘要 | `file`（必填）、`texture`、`armature`、`animation` |
| `skeleton_summary` | 骨骼 / 槽位 / 皮肤 / 显示对象 / IK 数量、动画列表、帧率 | — |
| `bones_list` | 每根骨骼：索引、名称、父级、长度、绑定姿态（**文档顺序**） | — |
| `bones_tree` | 骨骼**层级树**：按绘制顺序缩进，带 `depth`、父级、长度、当前动画是否有关键帧 | — |
| `slots_list` | 槽位：名称、父骨骼、当前显示索引、显示对象数、z 序、混合模式、颜色变换 | — |
| `animations_list` | 动画名列表、当前动画、时长、帧率 | — |
| `animation_detail` | 某条动画的**完整关键帧表**（逐骨骼：帧号 + 时长 + 变换 + 缓动），另附槽位/FFD/IK 时间轴计数 | `animation` |
| `mesh_detail` | 某槽位网格的顶点、三角形、轮廓边与绑定骨骼列表 | `slot`（必填） |
| `bone_transform_get` | 某骨骼在某帧的**绝对**变换 + 关键帧位置 + 世界矩阵 | `bone`（必填）、`frame` |

### 写入（都可撤销）

| 工具 | 作用 | 关键参数 |
|---|---|---|
| `bone_keyframe_set` | 在某帧打关键帧（`transform` 是绝对姿态，只写要改的字段）；`remove: true` 删该帧 | `bone`、`frame`（必填）、`transform`、`remove` |
| `bone_create` | 新建骨骼（名字冲突自动加后缀） | `name`、`parent`、`transform`、`length` |
| `bone_delete` | 删除骨骼；子骨骼与挂它下面的槽位**上提一级** | `bone`（必填） |
| `bone_update` | 重命名 / 改父级 / 改长度，可同时给出 | `bone`（必填）、`rename`、`parent`、`length` |
| `skeleton_export` | 导出 `*_ske.json` 或 `*_ske.dbbin` | `out`（必填）、`type`(`json`\|`binary`) |

### 会话历史

| 工具 | 作用 |
|---|---|
| `history_status` | 撤销 / 重做栈深度 |
| `history_undo` | 撤销上一步写操作（回到上一个 armature 快照） |
| `history_redo` | 重做刚才撤销的那一步 |

## rig-bot 反馈修复（fix/rig-feedback）新增用法

| 工具 | 新参数 / 行为 |
|---|---|
| `bone_update` | `transform:{x,y,rotation,skX,skY,scX,scY}` 改绑定变换（只改给出的分量；`rotation` 同时设 skX/skY 并保留原斜切）；`keepChildren:true` 时子骨骼、挂在该骨上的槽位显示对象、以及加权网格（改写 bonePose）都保持世界位置；`inherit:{rotation,scale,translation,reflection}` 继承开关 |
| `bone_delete` | 子骨骼与槽位上提到父级时做世界坐标补偿（不再跳位） |
| `slot_update` | `transform:{x,y,rotation,skX,skY,scaleX,scaleY,scale,pivotX,pivotY}` 改显示对象变换；`display` 选显示（索引/名字，默认当前）；`mode:"set"`(默认)/`"offset"`（增量、scale 为倍率）；未加权网格顶点同步变换，加权网格拒绝；换父骨时补偿覆盖所有 skin、含缩放/斜切 |
| `image_add` | `scale` / `scaleX` / `scaleY` 写入显示变换 scX/scY（以前被 schema 丢掉） |
| `weld_joints` | texture 模式把延伸后没填到的透明边裁掉并平移显示变换 → 四边形不再变大，setup 渲染取景不变 |
| `render_frame` / `render_animation` | `fit:"geometry"`(默认，旧行为)/`"content"`（按不透明像素取景，透明边/图集重排不影响）；`bounds:[minX,minY,maxX,maxY]` 固定取景（返回值里带本次 `bounds`，传回即同取景）；`bones:"off"|"on"|"only"` 骨骼叠加层；`render_frame.trim:N` 按内容裁剪并外扩 N 像素（返回 `crop`） |
| `bone_key` | `shear`（斜切度，导出 Spine shear） |
| `draw_order_key` | 新工具：`{frame, order:[插槽名 底→顶], animation?, remove?}`，可只给子集 |
| `spine_export` | `curves:"auto"`(默认)/`"bezier"`/`"bake"`：auto 时多段曲线、余弦缓动、与编辑器采样表偏差 >0.002 的曲线逐帧烘焙，导出与预览一致 |
| `history_*` | 撤销栈默认 1000 步（`BONESTUDIO_UNDO_LIMIT`）+ 内存预算（`BONESTUDIO_UNDO_MB`，默认 512）；`history_status` 报 `undoLimit/undoDropped`；快照含图集，image_add/weld/region_erase 也能正确撤销 |

## 语义要点

- **会话历史**：MCP 服务是独立进程，没有 UI 的撤销栈，所以自己维护一份 armature 快照栈
  （上限 100 步，走 `editing.ts` 的 `snapshotArmature` / `restoreArmature`，与 UI 同源）。
  每个写工具在动手前 `checkpoint`，失败则 `rollback` 并把那一步丢掉 —— agent 不会留下半个改动。
  写工具的返回值里都带 `undoDepth` / `redoDepth`，agent 据此决定要不要回滚。
- `bone_transform_get` 返回的是**绝对姿态**（绑定 ⊕ 增量），不是原始的增量帧数据。
- `bone_keyframe_set` 的 `transform` 同样是**绝对值**，且**只改给出的字段**。
- 在已有区间中间打关键帧会**切分区间**（关键帧数 +1）；`remove` 会把该帧的时长**并给相邻帧**，
  所以「关键帧数」回到原值，但后续帧的起点位置会前移 —— 这是官方编辑器的行为。
- `bones_list` 是**文档顺序**，`bones_tree` 是**层级顺序**（带 depth）—— 想要缩进结构用后者。

## 例子（一段完整会话）

```
tools/call open_project        { "file": ".../Rooster_An_ske.json", "texture": ".../Rooster_An_tex.json" }
tools/call bones_tree          {}
tools/call animation_detail    { "animation": "rooster_idle_anim" }
tools/call bone_transform_get  { "bone": "head_bone_01", "frame": 12 }
tools/call bone_keyframe_set   { "bone": "head_bone_01", "frame": 12, "transform": { "skX": 25 } }
tools/call bone_create         { "name": "tail_03", "parent": "tail_bone_02", "length": 12 }
tools/call bone_update         { "bone": "tail_03", "rename": "tail_tip", "length": 18 }
tools/call history_undo        {}          ← 回到 tail_03
tools/call history_redo        {}          ← 再变回 tail_tip
tools/call history_undo        {}          ← 撤销新建
tools/call skeleton_export     { "out": "/tmp/out_ske.dbbin", "type": "binary" }
```

## 已知问题

- 编辑器原有的 `setSlotDisplayKeyframe`（`core/slotEdit.ts`）在**空时间轴**上追加时，把新值写给了「该帧之前」的区间（`frames.push({ duration: at, displayIndex })`）；
  `setSlotColorKeyframe` 追加的末帧 `duration: 1` 会让时间轴总长短于动画。MCP 的 `slot_key` 绕开它们、直接写 5.x 组件时间轴；UI 侧未改。
- 运行时按**数组身份**缓存展开后的旋转值（`rotationCache`）：原地改 `rotateFrame` 会读到旧缓存 → NaN。MCP 写键一律换新数组；UI 侧若有原地改同样会中招。
- 从 Spine 导入（`prefer: spine`）与流水线的 DragonBones 包一样是**逐帧烘焙**的关键帧（IK 结果已烘进去），能改但不是原始关键帧。
- `.psd` 直接导入未实现：先用流水线拆成 `layers.json` + PNG 再 `project_import`。
- Spine 时间轴的时间不再四舍五入到 4 位（官方运行时用 Float32 存时间，整帧边界上的附件切换会差一帧）。

## 验证

- 单元测试 `tests/mcpTools.test.ts`（6 项）：开工程 / 列骨骼动画 / 读变换+增删关键帧 / 导出 json+dbbin（魔数 `DBDT`）/
  骨骼树+槽位+动画帧表 / 增删改骨骼并走撤销重做。
- 端到端 smoke（`work/mcp-smoke.mjs`，真实 stdio JSON-RPC：握手 → tools/list → 17 个 tools/call）：
  在 `outputs/bone-studio` 下 `npm run build:mcp && node ../../work/mcp-smoke.mjs`，输出 `ok: true`。
- `npm run verify` 已把 `build:mcp` 纳入门禁，MCP 入口构建失败会直接红。
- `tests/mcpStudio.test.ts`（9 项，自带合成样例 + 可选 lubu_q34）：建工程/加图/网格/自动权重/通道键/插槽键/事件/撤销/渲染/
  Spine 4.2（spine-core 4.2.x 加载对拍）/ Spine 4.1（`spine-core-41` = spine-core 4.1.x 加载对拍，`transform` 键）/ 3.6 legacy / 流水线导入。
- `tests/mcpStdio.test.ts`：真实 stdio（版本协商 → tools/list → 新建 → 打键 → 渲染 → 撤销）。
- 演示：`npm run build:mcp && node tools/mcp-demo-lubu.mjs [chars/<id>] [输出目录]` —— 导入 lubu_q34、渲染 idle/walk/attack/hit/death 联系表 + gif、导出并校验 Spine 4.2、编辑器截图。
## 构建与排错（Windows 同样适用）

- `dist-mcp/server.js` 不再入库。`npm run dev` 的 `predev` 会自动执行 `node tools/build-mcp.mjs --if-stale`；`npm run build:mcp` 强制重建。
- 构建会写 `dist-mcp/build-info.json`（MCP 相关源码的内容哈希，CRLF 归一）；面板据此判断「需要重新构建」，可点「立即构建」（`POST /api/mcp/rebuild`）。
- spine-core 已打包进 server.js，只拉代码、没 `npm install` 新依赖时 server 也能启动；面板读取工具清单失败时会显示真实 stderr。
- 工作区：`BONESTUDIO_PROJECTS` > `<repo>/projects`，面板会标出来源；只设了 `BONESTUDIO_SAMPLES` 指向旧工作区时面板会提示改用 `BONESTUDIO_PROJECTS`。

## 会话登记、写锁与实时预览

- **会话**：每个 MCP server 进程写 `<工作区>/.sessions/<id>.json`（displayName、clientName/clientVersion（来自 initialize 的 clientInfo）、pid、当前工程、最近工具+参数摘要、最后渲染的动画/帧、startedAt、updatedAt）。
  每次工具调用 + 每 5 s 心跳刷新；exit / SIGINT / SIGTERM / stdin 关闭时删除。30 s 无刷新 = stale，10 min 以上的残留文件由 dev server 清理。全部 tmp + rename 原子写。
- **名字优先级**：`session_set {name, task?}` > clientInfo.name > `BONESTUDIO_AGENT_NAME` > `Agent-<pid>`。
- **写锁**：`<工作区>/<工程>/.lock`（sessionId + 心跳）。写工具（project_save、bone_key、image_add、bone_create、history_undo…）在被别的活会话锁住的工程上直接报错，内存不改；
  锁心跳超 30 s 或持有者会话已失联 → 接管。读与渲染工具不受锁限制。新目标（project_new / project_import / project_save{name}）在落盘时检查。
- **dev server**：`GET /api/agents`（会话按 active / idle / stale 分类 + 工程锁 + 缩略图）、`GET /api/live`（SSE：`agents`、`project` 事件；fs.watch 递归 + 150 ms 去抖，Windows/macOS 原生递归，不支持时逐目录监听）、`GET /api/thumb/<工程>.png`（`cover.png` 或软件光栅绑定姿态）。
- **编辑器**：「AI → MCP 服务 → 实时预览」按工程分组列出会话（状态点、客户端、最近操作、相对时间、过滤）。点条目在**新标签页**打开 `?aiproject=<工程>&live=1&readonly=1&agent=<id>`（横幅「退出观看」/ Esc 关掉该页回到原标签；直接打开的链接则原地退出到欢迎页，URL 参数 replaceState 清掉、不重载）；「打开编辑」在当前标签打开，持锁时先提示（可改为只读观看）：
  顶部「正在观看 <名字> 编辑 · 只读」；SSE 到来时原地替换骨架（相机、选择、播放头保留），可勾「跟随 agent」；图集变化或 SSE 不可用时退回整页重载。
- **只读守卫**（`src/core/readonlyGuard.ts`）：命令层所有写入口 `assertWritable`；工具只剩选择/平移；快捷键白名单（播放、逐帧、缩放、适应窗口）；属性面板捕获拦截并禁用控件；
  文件/编辑/动画菜单置灰；另有完整性兜底——只读时任何非 live 同步带来的骨架变化都会被还原。
- 验证：`node tools/verify-live.mjs [url]`（两个 MCP 进程 + 无头浏览器）。
