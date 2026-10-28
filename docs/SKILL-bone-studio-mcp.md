---
name: BoneStudio MCP 骨骼动画
description: >-
  用 BoneStudio 的 MCP 工具在编辑器里制作、修改、预览并导出 2D 骨骼动画（DragonBones 5.5 / Spine
  4.2）时使用；也用于把「角色骨骼动画生成」流水线产出的角色导入编辑器微调、补动作、重新导出。
---
# BoneStudio MCP 骨骼动画

BoneStudio 是 DragonBones 兼容的骨骼动画编辑器（Vite + TS）。它的 MCP server（stdio）直接驱动编辑内核：建工程、导入素材、建骨骼/插槽/网格/权重、打关键帧、无头渲染预览、导出 Spine 4.2 / DragonBones，并把工程写进工作区，让正在运行的编辑器页面自动重载显示同一份数据。
**动作好不好由你自己 Read 渲染出来的联系表判断**，不要只看数字。

## 前提
- 仓库已 `npm install`；先 `npm run build:mcp`（产出 `dist-mcp/server.js`；改了 `src/mcp/**` 要重建）。
- MCP 客户端配置：`command: node`，`args: [<repo>/dist-mcp/server.js]`，`env.BONESTUDIO_PROJECTS=<repo>/projects`（Cursor 用仓库里的 `.cursor/mcp.json`）。
- 需要在编辑器里看：仓库里 `npm run dev`（AI 工作区挂在 `/aiprojects/`，`BONESTUDIO_PROJECTS` 可改目录；端口被占会顺延，`editor_url` 会自动找到）。你写的工程出现在欢迎页「AI 工程」分区，不会混进编辑器的内置「示例」。
- `render_animation` 的 gif/mp4 需要 ffmpeg；`editor_screenshot` 需要本机 Chrome（`CHROME_PATH` 可指定）。

## 第 0 步：登记会话（每次连上先做）
- **先调用 `session_set { name: "<你的 agent 名>", task: "<一句话任务>" }`**，例如 `{name:"Cursor·吕布动画师", task:"调整吕布攻击动作"}`。
  用户在编辑器「AI → MCP 服务 → 实时预览」里按这个名字看到你、点开只读观看你的编辑（不调用时退回客户端名 / `BONESTUDIO_AGENT_NAME` / `Agent-<pid>`）。
- 任务换了就再调一次 `session_set { task }` 更新。

## 写锁（多 agent 同时工作）
- 你第一次写某个工作区工程时自动取得它的写锁（`projects/<工程>/.lock`），会话活着就一直续。
- 写工具碰到别的活会话锁住的工程会报错「工程「X」正被 <名字> 编辑，写操作被拒绝」——**不要重试硬写**：换一个工程、`project_save { name:"<新名字>" }` 另存一份再改、或只做读取/渲染（读与 `render_*` 不受锁限制）。
- 对方 30 s 没心跳锁自动失效，再写会直接接管；进程退出时锁和会话文件会删除。
- 你的 `render_frame` / `render_animation` 会记下「最后渲染的动画/帧」，观看者勾「跟随 agent」会跳到那里——渲染你正在调的那一帧方便用户跟。

## 坐标与数值约定（最容易错）
- DragonBones 坐标：**y 向下，角度顺时针为正**。导出 Spine 时自动翻转，不要自己取反。
- `bone_key` 的值是**相对绑定姿态的增量**（rotate 度、x/y 像素、scaleX/scaleY 倍率）；`bone_keyframe_set` 才是绝对值（旧接口）。
- 帧号是整数帧；`duration` 也是帧数（默认 24fps）。循环动画首尾帧值要相同。
- 颜色是 0–100 的乘数：`{rM, gM, bM, aM}`。受击闪红 = `{gM:30, bM:30}`，淡出 = `{aM:0}`。

## 流程

### A. 打开 / 导入
1. 流水线角色：`project_import { path: "<asset-canvas>/chars/<id>" }` → 自动用 `out/<id>_dragonbones`；`prefer:"spine"` 用 Spine 包（官方运行时逐帧烘焙），`prefer:"layers"` 用 `layers.json` 只要分层不要绑定。
2. 已有工程：`project_list` → `project_open { name }`。
3. 从零开始：`project_new { name }` → `layers_add`（或逐张 `image_add`）。
4. 用 `bones_tree`、`slots_list`、`animation_detail` 看结构。

### B. 绑定（从分层素材开始时）
1. `bone_create` 建骨架（父在前；长度 = 到子关节的距离），常用层级 root → hip → torso → head / upperArm → foreArm → hand / thigh → shin。
2. `slot_update { slot, bone }` 把每层挂到对应骨骼；`zIndex` 调绘制顺序（握武器的拳头要在武器之上）。
3. 需要弯曲的部件（披风、袖子、腿）：`mesh_create { slot, cols, rows }` → `weights_auto { slot, bones:[关节两侧的骨骼] }`，个别顶点用 `weights_set` 修。关节处让网格跨过关节、两侧骨骼都分权重，弯曲时才不会断。
4. `render_frame { setup:true }` 看绑定姿态，确认没有错位。

### C. 做动画
1. `animation_create { name, duration, playTimes }`（0=循环；攻击/受击/死亡用 1）。也可 `from` 复制一个再改。
2. 用 `bone_keys` 一次写一组键：
   - 待机：躯干 scaleY 1→0.98→1、头 rotate ±2，周期 30–48 帧；眨眼用 `slot_key { attachment }` 在 2–3 帧内换闭眼图再换回。
   - 走路：腿 rotate 正反相 ±20–30，hip y 在双脚着地时下沉 3–6px，手臂与腿反相。
   - 攻击：蓄力 → 出手（快，bezier `[0.2,0,0.1,1]`）→ 定格 2–3 帧 → 收招，首尾回待机。
   - 受击：后仰 + `slot_key` 闪红 2–4 帧再恢复；死亡：后倒、root 下沉，最后可 `aM` 渐隐。
3. 补间：`easing:"stepped"` 做定格/硬切，数字 = DB tweenEasing，四元组 = bezier。
4. 事件（命中帧、音效）：`event_key { frame, name }`，导出到 Spine `events`。

### D. 预览与自检（每改一轮都做）
1. `render_animation { animation, format:"sheet", out }` → **Read 联系表**，检查穿帮、关节断裂、武器脱手、脚底漂移、首尾不衔接。
2. 给人看：`format:"gif"` 或 `"mp4"`；单帧细查：`render_frame { frame, width:1024 }`。
3. 编辑器里看：`editor_url { animation, frame, play }`（live=1：SSE 原地刷新，相机/选择/播放头不变；图集变了才整页重载），或 `editor_screenshot` 截图 Read。
   用户也可以在「AI → MCP 服务 → 实时预览」点你的条目只读观看（`?aiproject=<工程>&live=1&readonly=1&agent=<会话 id>`）。
4. 改坏了：`history_undo`（所有写工具都进撤销栈）。

### E. 导出
1. `spine_export { outDir, version:"4.2" }` → `.json` + `.atlas` + `.png`。返回的 `validation` 是官方 spine-core 4.2 运行时与编辑器逐帧对拍结果：`ok:true` 且 `maxVertexErrorPx` < 1 才算过。老项目用 `version:"4.1"`；3.6 仅作 legacy。
2. `dragonbones_export { outDir }` → DragonBones 5.5 `*_ske.json` + `*_tex.json` + `*_tex.png`（可再走流水线的 editorSafe）。
3. 命令行：`npm run cli -- spine -i x_ske.json -o out/ --spine-version 4.2`。

## 已知限制
- 导入的流水线动画是逐帧烘焙键，微调优先改少量骨骼或复制后重做关键姿势。
- `.psd` 不能直接导入，先用流水线拆成 `layers.json`。
- 父骨骼非等比缩放 + 子骨骼不继承缩放时，Spine 与 DragonBones 结果不同；尽量等比缩放。
- 编辑器 UI 原有的插槽显示/颜色关键帧在空时间轴上有偏移问题；MCP 的 `slot_key` 不受影响。
