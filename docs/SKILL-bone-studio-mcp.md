---
name: bonestudio-mcp
description: >-
  用 BoneStudio 的 MCP 工具在编辑器里制作、修改、预览并导出 2D 骨骼动画（DragonBones 5.5 / Spine
  4.2）时使用；也用于从零通过 SVG/PNG 程序化生成分层部件、计算精确骨骼绑定与分析式 IK 动画，或把「角色骨骼动画生成」流水线产出的角色导入编辑器微调、补动作、重新导出。包含完整工具参数与坐标/旋转数学公式，无需翻阅 BoneStudio 源码。
---
# BoneStudio MCP 骨骼动画技能指南

BoneStudio 是 DragonBones 兼容的骨骼动画编辑器（Vite + TS）。它的 MCP server（stdio）直接驱动编辑内核：建工程、导入素材、建骨骼/插槽/网格/权重、打关键帧、无头渲染预览、导出 Spine 4.2 / DragonBones，并把工程写进工作区，让正在运行的编辑器页面自动重载显示同一份数据。
**动作好不好由你自己 Read 渲染出来的联系表（contact sheet）判断**，不要只看数字。

---

## 前提与环境路径
- **MCP Server 入口**：`<repo>/dist-mcp/server.js`（先 `npm install && npm run build:mcp`；改了 `src/mcp/**` 才需重建）。
- **AI 工作区工程目录**：`<repo>/projects/<project-name>`（环境变量 `BONESTUDIO_PROJECTS` 可指定）。
- **编辑器实时预览**：仓库里 `npm run dev`（AI 工作区挂在 `/aiprojects/`，端口被占会顺延，`editor_url` 会自动找到）。你写的工程出现在欢迎页「AI 工程」分区，不会混进编辑器的内置「示例」。
- **单工具交互 vs 批量脚本**：
  - **少量/交互式操作**：直接用 MCP 客户端工具（如 `call_mcp_tool` 调用 `bone-studio`）。
  - **从零建骨架 + 批量写入上百关键帧**：直接写一个 Node `.mjs` 脚本，通过 `file://` URL 导入 `<repo>/tools/mcp-client.mjs` 中的 `startMcp`，在同一个 stdio 会话里一次性跑完建骨、导入图层、绑插槽、打关键帧、渲染预览和导出（耗时约 2 秒，且自动保持同一会话写锁）。
  - **注意（Windows Node ESM）**：动态或静态 `import` 本地绝对路径时必须加 `file:///` 前缀（例如 `import { startMcp } from 'file:///C:/path/to/bone-studio/tools/mcp-client.mjs'`），否则 Node 会报 `ERR_UNSUPPORTED_ESM_URL_SCHEME: Received protocol 'c:'`。

---

## 第 0 步：登记会话（每次连上先做）
- **先调用 `session_set { name: "<你的 agent 名>", task: "<一句话任务>" }`**，例如 `{ name: "Antigravity·骨骼动画师", task: "制作鹈鹕骑自行车动画" }`。
  用户在编辑器「AI → MCP 服务 → 实时预览」里按这个名字看到你、点开只读观看你的编辑。
- 任务换了就再调一次 `session_set { task }` 更新。

## 写锁（多 agent 同时工作）
- 你第一次写某个工作区工程时自动取得它的写锁（`projects/<工程>/.lock`），会话活着就一直续。
- 写工具碰到别的活会话锁住的工程会报错「工程「X」正被 <名字> 编辑，写操作被拒绝」——**不要重试硬写**：换一个工程、`project_save { name: "<新名字>" }` 另存一份再改、或只做读取/渲染（读与 `render_*` 不受锁限制）。
- 对方 30 s 没心跳锁自动失效，再写会直接接管；进程退出时锁和会话文件会删除。

---

## 核心坐标、矩阵与旋转铁律（必读，避免翻源码与错位）

### 1. 画布坐标 vs 世界坐标原点（`layers_add` 原点约定）
- DragonBones 内部世界坐标：**`x` 向右为正，`y` 向下为正，角度顺时针（CW）为正**（单位：度）。导出 Spine 时导出器会自动翻转 Y 轴和角度，**绝对不要自己取反**。
- **`layers_add` 的世界原点 `(0, 0)` 固定在画布底边中心 `(canvasWidth / 2, canvasHeight)`**：
  当传入画布尺寸 `(W, H)` 与图层左上角 `(left, top)`、图片宽高 `(imgW, imgH)` 时，`layers_add` 挂到 `root` 上的世界坐标为：
  ```js
  const OX = canvasWidth / 2;
  const OY = canvasHeight; // 注意：必须是 canvasHeight，不能自定义成地面高度！
  const worldX = left + imgW / 2 - OX;
  const worldY = top + imgH / 2 - OY;
  ```
- **建骨骼（`bone_create`）必须使用同一个原点 `(OX, OY) = (canvasWidth / 2, canvasHeight)`**：
  如果画布上某个关节像素坐标是 `(cx, cy)`，它的世界坐标就是 `(wx, wy) = (cx - canvasWidth / 2, cy - canvasHeight)`。如果 `OY` 用了别的值（比如地面 y=620 而不是画布底边 700），整副骨架会相对图片整体偏移！

### 2. 零偏移插槽绑定模式（`layers_add` → `bone_create` → `slot_update`）
从分层图片建角色的黄金三步（100% 零偏移）：
1. **先用 `layers_add` 将所有图层挂在 `bone: "root"` 上导入**（传入画布 `canvasWidth, canvasHeight` 和每张图的 `left, top`），此时每张图都精确落在画布世界坐标位置。
2. **按父在前、子在后的顺序调 `bone_create` 建好全部骨骼**。
3. **调 `slot_update { slot, bone, zIndex }` 把每个插槽改挂到目标骨骼**：
   `slot_update` 内部会自动执行 `rebaseSlotDisplays`，把插槽内贴图的局部 `x, y, skX, skY` 从旧父骨骼（`root`）反算到新父骨骼的局部坐标系中，**贴图在画面上的世界位置与朝向保持纹丝不动**！

### 3. 父子骨骼局部绑定矩阵公式（`bone_create`）
- 骨骼锥体在编辑器中从局部 `(0, 0)` 沿局部 `+x` 轴画到 `(length, 0)`。
- 已知骨骼起点画布坐标 `(cx, cy)` 和终点（子关节）画布坐标 `(tx, ty)`，父骨骼的世界矩阵为 `P`（`root` 的世界矩阵为单位阵 `[1, 0, 0, 1, 0, 0]`，位于世界原点 `(0, 0)`）：
  ```js
  const RAD = Math.PI / 180;
  const DEG = 180 / Math.PI;
  // 2D 仿射矩阵 [a, b, c, d, tx, ty]
  function matFrom(x, y, deg) {
    const r = deg * RAD;
    return [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), x, y];
  }
  function mulMat(A, B) {
    return [
      A[0]*B[0] + A[2]*B[1], A[1]*B[0] + A[3]*B[1],
      A[0]*B[2] + A[2]*B[3], A[1]*B[2] + A[3]*B[3],
      A[0]*B[4] + A[2]*B[5] + A[4], A[1]*B[4] + A[3]*B[5] + A[5],
    ];
  }
  function invMat(M) {
    const det = M[0]*M[3] - M[1]*M[2];
    const a = M[3]/det, b = -M[1]/det, c = -M[2]/det, d = M[0]/det;
    return [a, b, c, d, -(a*M[4] + c*M[5]), -(b*M[4] + d*M[5])];
  }
  // 计算子骨骼相对父骨骼 P 的局部变换 (x, y, rotation, length)
  function calcBoneLocal(cx, cy, tx, ty, parentWorldMat, canvasW, canvasH) {
    const wx = cx - canvasW / 2, wy = cy - canvasH;
    const txW = tx - canvasW / 2, tyW = ty - canvasH;
    const worldDeg = Math.atan2(tyW - wy, txW - wx) * DEG;
    const length = Math.round(Math.hypot(txW - wx, tyW - wy));
    const W = matFrom(wx, wy, worldDeg);
    const localM = mulMat(invMat(parentWorldMat), W);
    const localDeg = Math.atan2(localM[1], localM[0]) * DEG;
    return {
      x: Number(localM[4].toFixed(2)),
      y: Number(localM[5].toFixed(2)),
      rotation: Number(localDeg.toFixed(2)),
      length,
      worldMat: W,
      bindWorldDeg: worldDeg,
    };
  }
  ```

### 4. 关键帧相对旋转通用公式（`bone_key` / `bone_keys`）
- `bone_key` / `bone_keys` 中的 `x, y, rotate` 都是**相对该骨骼自身绑定姿态（setup pose）的增量**：
  - 绑定姿态下（第 0 帧基准），任何骨骼的增量都是 `rotate: 0, x: 0, y: 0`。
- 当你在动画第 `f` 帧通过 IK 或正弦波算出了某根骨骼 `B` 的目标世界角度 `worldDeg[B](f)`，且它的父骨骼 `P` 在第 `f` 帧的世界角度为 `worldDeg[P](f)` 时，直接用以下**通用增量旋转公式**（永不错位）：
  ```js
  // rotateKey = 当前骨骼世界角度变化量 - 父骨骼世界角度变化量
  const dWorldB = worldDegB_f - bindWorldDegB;
  const dWorldP = worldDegP_f - bindWorldDegP;
  const rotateKey = dWorldB - dWorldP;
  ```
- **注意父骨骼局部坐标系下的位移 `(x, y)`**：
  `bone_key` 的 `x, y` 是在**父骨骼局部坐标系**下叠加到 `bone.transform.x / y` 上的。如果某根骨骼（如 `bike_frame`、`hip`）直接挂在 `root`（`rotation = 0`）下，它的 `x, y` 关键帧增量就等于世界坐标像素增量 `(dx, dy)`！因此需要直接做世界位移的根部件（车架、骨盆、身体重心）应优先挂在 `root`（或朝向为 `0°` 的骨骼）下。

### 5. 连续 360° 旋转防反转铁律（车轮/齿轮/螺旋桨必看）
- DragonBones 5.x 的组件旋转时间轴（`expandRotations`）在未指定 `clockwise` 时，会对相邻两帧做**最短路径展开（`normalizeRadian(rot - prev)`，步长严格 `< 180°`）**。
- **后果**：
  - 如果只在 `f=0` 打 `rotate: 0`、`f=24` 打 `rotate: 360`，差值归一化后为 `0°`，轮子完全不转！
  - 如果每隔 `180°` 打一帧（`0, 180, 360`），会在 `±π` 边界发生方向翻转或往复摆动！
- **正确做法**：
  - 凡是需要连续旋转 `360°`（或 `N × 360°`）的骨骼，**相邻关键帧的旋转步长必须严格 `< 180°`**（推荐每 2 帧打一个关键帧，步长 `30°` 或 `45°`，例如 24 帧转一圈：在 `f = 0, 2, 4, ..., 24` 依次写入 `rotate = (f / 24) * 360`）。
  - **公转但保持水平的子部件**（例如挂在旋转牙盘 `crank_gear` 下的脚踏板 `pedal_r` / `pedal_l`）：父骨骼 `crank_gear` 打 `rotate: +spinDeg`，子骨骼 `pedal` 同步打相反的 `rotate: -spinDeg`，即可让踏板随曲柄公转一圈的同时始终保持水平！

### 6. 分析式双骨骼 IK（2-Bone IK）烘焙公式
当角色手握车把/武器、脚踩踏板/地面时，在脚本中用余弦定理逐帧（如每 2 帧）算出大腿/小腿或上臂/前臂的世界角度并写入 `bone_keys`，可以保证末端 0 像素漂移，且导出 Spine 4.2 时官方 `spine-core` 对拍误差 `< 0.02px`：
```js
/**
 * 求解双骨骼 IK 在世界坐标系下的角度（y 向下，顺时针角度为正）
 * @param {number} rootX 上肢起点（髋/肩）坐标 X
 * @param {number} rootY 上肢起点（髋/肩）坐标 Y
 * @param {number} targetX 末端目标（脚踝/手腕）坐标 X
 * @param {number} targetY 末端目标（脚踝/手腕）坐标 Y
 * @param {number} L1 第一段骨骼长度（必须与建骨时的实际距离严格一致）
 * @param {number} L2 第二段骨骼长度（必须与建骨时的实际距离严格一致）
 * @param {number} bendSign 弯曲方向 (+1 或 -1，与第 0 帧绑定姿态一致)
 */
function solve2BoneIK(rootX, rootY, targetX, targetY, L1, L2, bendSign = 1) {
  const dx = targetX - rootX;
  const dy = targetY - rootY;
  const dist = Math.hypot(dx, dy);
  const maxReach = L1 + L2 - 0.01;
  const minReach = Math.abs(L1 - L2) + 0.01;
  const d = Math.max(minReach, Math.min(maxReach, dist));

  const baseAngle = Math.atan2(dy, dx);
  const cosAlpha = Math.max(-1, Math.min(1, (L1*L1 + d*d - L2*L2) / (2 * L1 * d)));
  const alpha = Math.acos(cosAlpha);

  const angle1 = baseAngle + bendSign * alpha;
  const midX = rootX + L1 * Math.cos(angle1);
  const midY = rootY + L1 * Math.sin(angle1);
  const angle2 = Math.atan2(targetY - midY, targetX - midX);

  return {
    upperWorldDeg: angle1 * (180 / Math.PI),
    lowerWorldDeg: angle2 * (180 / Math.PI),
    midX,
    midY,
  };
}
```
> **关键提示**：`L1`、`L2` 必须使用第 0 帧关节之间的精确欧氏距离（`Math.hypot`），且第 0 帧的目标点 `(targetX, targetY)` 必须与绑定姿态关节坐标完全一致，这样第 0 帧算出的 `rotateKey` 才会精确为 `0`！

---

## 从零程序化生成 SVG → PNG 分层部件规范

当用户要求用 SVG 生成部件并制作骨骼动画时，遵循以下流程可彻底杜绝部件错位与边缘裁切：
1. **统一画布坐标系设计第 0 帧（Setup Pose）**：
   - 先定好统一画布尺寸（如 `800 × 700`），所有 SVG 部件和所有关节坐标都在同一个 `800 × 700` 画布坐标系中设计。
   - **第 0 帧（绑定姿态）必须是完整好看的标准姿势**（手在车把上、脚在踏板上），因为编辑器 Setup 视图与欢迎页卡片缩略图直接渲染绑定姿态。
2. **先整张渲染再自动检测非透明包围盒（防描边裁切）**：
   - 不要手猜每个部件的裁剪框！用 Python（`pymupdf` / `fitz` + `PIL.Image`）把每个部件的 SVG 片段放在完整 `800 × 700` 透明画布上渲染一次，用 `im.getbbox()` 拿到精确非透明像素边界，四周外扩 `pad = 8` 像素得到 `(left, top, width, height)`。
   - 再用 `viewBox="{left} {top} {width} {height}"` 写出独立 `.svg` 文件并渲染出等尺寸 `.png`，同时输出 `layers_manifest.json`（含 `name, file, left, top, width, height, zIndex, bone`）。
   - 验证每张 PNG 四周最外圈 1px 的 alpha 最大值均为 `0`（零裁切）。

---

## MCP 工具参数速查表（无需查源码）

### 会话与工程管理
| 工具 | 参数签名 | 说明 |
|---|---|---|
| `session_set` | `{ name?: string, task?: string }` | 登记当前 Agent 名称与任务 |
| `project_new` | `{ name: string, saveTo?: string }` | 新建空白工程（默认保存在 `projects/<name>`） |
| `project_open` | `{ name: string }` | 打开已有工程（名称或路径） |
| `project_import` | `{ path: string, name?: string, prefer?: "dragonbones" \| "spine" \| "layers" }` | 导入角色目录或 JSON |
| `project_save` | `{ name?: string }` | 保存当前工程（传 `name` 可另存为新工程） |
| `project_list` | `{}` | 列出工作区所有工程 |
| `history_undo` / `history_redo` | `{}` | 撤销 / 重做上一步写操作 |

### 素材、骨骼、插槽与网格
| 工具 | 参数签名 | 说明 |
|---|---|---|
| `layers_add` | `{ layers: Array<{ file: string, name?: string, bone?: string, left: number, top: number }>, canvasWidth?: number, canvasHeight?: number }` | 批量导入分层 PNG（推荐先挂 `bone: "root"`，再用 `slot_update` 挂目标骨骼） |
| `image_add` | `{ file: string, name?: string, bone?: string, slot?: string, x?: number, y?: number, rotation?: number }` | 单张导图 |
| `bone_create` | `{ name: string, parent?: string, length?: number, transform?: { x?: number, y?: number, skX?: number, skY?: number, rotation?: number, scX?: number, scY?: number }, x?: number, y?: number, rotation?: number }` | 新建骨骼（**父骨骼必须已存在**；推荐传 `transform: { x, y, skX: localDeg, skY: localDeg }` 或顶层 `x, y, rotation`） |
| `bone_update` | `{ bone: string, rename?: string, parent?: string, length?: number, transform?: { x?, y?, rotation?, skX?, skY?, scX?, scY? }, keepChildren?: boolean }` | 修改骨骼绑定属性（`bone` 兼容 `name`） |
| `bone_delete` | `{ bone: string }` | 删除骨骼（子骨骼与插槽自动归回父骨骼，`bone` 兼容 `name`） |
| `slot_create` | `{ name: string, bone: string, attachment?: string, width?: number, height?: number, zIndex?: number }` | 新建插槽 |
| `slot_update` | `{ slot: string, bone?: string, zIndex?: number, displayIndex?: number, blendMode?: "normal" \| "add" \| "multiply" \| "screen", color?: { rM?, gM?, bM?, aM? } }` | 改绑父骨骼（**自动反算贴图局部坐标保持世界位置不变**）、调层级 `zIndex` |
| `mesh_create` | `{ slot: string, display?: string, cols?: number, rows?: number }` | 将普通贴图转为 `cols × rows` 网格（默认 4×4） |
| `weights_auto` | `{ slot: string, bones: string[], display?: string, falloff?: number }` | 按距离自动计算多骨骼蒙皮权重 |
| `weights_set` | `{ slot: string, weights: Array<{ vertex: number, pairs: Array<{ bone: string, weight: number }> }> }` | 手动精修顶点权重 |
| `ik_set` | `{ name?: string, bone: string, target: string, chain?: boolean, bendPositive?: boolean, weight?: number }` | 设 IK 约束（`chain: true` 为两节骨骼链） |

### 动画与关键帧
| 工具 | 参数签名 | 说明 |
|---|---|---|
| `animation_create` | `{ name: string, duration?: number, playTimes?: number, from?: string }` | 新建或复制动画（`duration` 为帧数，24fps；`playTimes: 0` 循环，`1` 单次） |
| `animation_update` | `{ animation: string, rename?: string, duration?: number, playTimes?: number, remove?: boolean }` | 改动画时长/循环次数/重命名（`animation` 兼容 `name`） |
| `bone_key` | `{ animation?: string, bone: string, frame: number, x?: number, y?: number, rotate?: number, rotation?: number, scaleX?: number, scaleY?: number, easing?: number \| "linear" \| "stepped" \| "easeIn" \| "easeOut" \| "easeInOut" \| [number,number,number,number] }` | 单帧写入骨骼**相对绑定姿态的增量**（`rotate` 与 `rotation`、`easing` 与 `curve` 均兼容） |
| `bone_keys` | `{ animation?: string, keys: Array<{ bone: string, frame: number, x?: number, y?: number, rotate?: number, scaleX?: number, scaleY?: number, easing?: ... }> }` | **批量写入骨骼关键帧**（强烈推荐；也兼容 `{ animation, bone, keyframes: [...] }`） |
| `slot_key` | `{ animation?: string, slot: string, frame: number, attachment?: string, color?: { rM?: number, gM?: number, bM?: number, aM?: number }, displayIndex?: number, easing?: ... }` | 插槽换图（`attachment: ""` 空串隐藏）或颜色/透明度关键帧（`color: { rM, gM, bM, aM }` 范围 0–100） |
| `event_key` | `{ animation?: string, frame: number, name: string, clear?: boolean }` | 写入/删除帧事件（导出到 Spine `events`） |

### 预览渲染与导出
| 工具 | 参数签名 | 说明 |
|---|---|---|
| `render_frame` | `{ animation?: string, frame?: number, setup?: boolean, width?: number, height?: number, padding?: number, bones?: boolean, mesh?: boolean, background?: string, out?: string }` | 渲染单帧 PNG（`setup: true` 看绑定姿态，`bones: true` 叠加骨骼锥体检查对齐） |
| `render_animation` | `{ animation?: string, format?: "sheet" \| "gif" \| "mp4" \| "frames", cols?: number, step?: number, width?: number, height?: number, fps?: number, bones?: boolean, background?: string, out?: string }` | 渲染联系表（`sheet`）或动图（`gif`/`mp4`） |
| `spine_export` | `{ outDir: string, version?: "4.2" \| "4.1" \| "3.6", scale?: number }` | 导出 Spine JSON + Atlas + PNG，**自动返回官方 `spine-core 4.2` 对拍结果 `validation`**（要求 `ok: true` 且 `maxVertexErrorPx < 1`） |
| `dragonbones_export` | `{ outDir: string }` | 导出 DragonBones 5.5 `*_ske.json` + `*_tex.json` + `*_tex.png` |
| `editor_url` | `{ animation?: string, frame?: number, play?: boolean }` | 获取实时预览 URL |

---

## 批量构建 Node 脚本模板（`tools/mcp-client.mjs`）

当需要一次性创建完整骨架与多套动画时，可在工作目录编写 `.mjs` 脚本并运行 `node build_mcp.mjs`：

```js
import { startMcp } from 'file:///C:/path/to/bone-studio/tools/mcp-client.mjs';

const mcp = await startMcp({
  BONESTUDIO_PROJECTS: 'C:/path/to/bone-studio/projects',
});

try {
  await mcp.call('session_set', { name: 'Antigravity·骨骼动画师', task: '构建角色骨骼与动画' });
  await mcp.call('project_new', { name: 'my-character' });
  // 1. bone_create (parent-first)
  // 2. layers_add (bone: 'root', canvasWidth, canvasHeight)
  // 3. slot_update (rebind to target bone + zIndex)
  // 4. mesh_create & weights_auto
  // 5. animation_create & bone_keys
  // 6. render_frame & render_animation (Read 联系表自检！)
  // 7. spine_export & dragonbones_export
  await mcp.call('project_save', {});
} finally {
  mcp.close();
}
```

---

## 预览自检清单（每改一轮必做）
1. **必看绑定图**：`render_frame { setup: true, bones: true, out: ".../setup_bones.png" }` → 用 `read_file` 查看图片，确认骨骼关节锥体精确落在美术部件的旋转轴心上，没有整体偏移。
2. **必看动作联系表**：`render_animation { animation, format: "sheet", cols: 6, step: 2, out: ".../sheet.png" }` → 用 `read_file` 查看联系表，检查：
   - 车轮/旋转件是否朝正确方向匀速转动（无静止或半途反转）；
   - 手部是否稳握车把/武器、脚底是否紧贴踏板/地面（无脱手或穿模）；
   - 遮挡层级（`zIndex`）是否正确（远端肢体在车架后、近端肢体在车架前）；
   - 循环动画首尾帧姿态是否无缝衔接。
3. **必验 Spine 4.2 对拍**：`spine_export` 返回的 `validation.ok` 必须为 `true` 且 `maxVertexErrorPx < 1`。


---

## 精美 2D 角色 SVG 程序化绘制与关节遮挡规范（决定原画品质与 AI 换皮上限）

如果目标是制作精美的 2D 角色（如近战武士、精灵游侠）或后续需要结合 `skin_clone` + `region_swap` 进行换皮，**底座 SVG 的绘制质量与拆件结构直接决定了最终画面上限**：
- **切勿用粗糙的几何方块/火柴人作为底座**：简陋的几何 SVG 会产生错误的包围盒长宽比（如扁平头框、方形胸框、缺失脖颈）。后续换皮时若按原框裁切或强行拉伸，会导致头部变形、身体变方、脖子消失；只有底座本身的解剖比例、关节圆弧与衣摆遮挡足够精美准确，矢量初版与换皮效果才能同时达到商业级水准。

### 2D 人形角色拆件与防穿帮 5 大黄金法则

1. **必须设立独立的脖颈骨骼与插槽（`neck`）**：
   - 严禁省略脖子或将脖子画死在躯干顶部，否则低头冲刺、仰头蓄力或换皮裁切时下巴会直接挤压领口，造成「没脖子、缩头」现象。
   - **标准做法**：建立 `torso -> neck -> head` 骨骼链，并将独立的 `neck` 插槽置于胸甲与头部之间（例如 `neck` 的 `zIndex: 12` 介于 `torso_armor: 13` 与 `head: 16` 之间），脖子圆柱体上下两端各预留 `8–12px` 嵌入头底与交领内部。
2. **躯干采用 3/4 侧面闭口剪影 + 近端大臂采用关节同心圆肩甲（`Sode` / Pauldron）**：
   - 严禁在孤立的 `torso` 贴图左上侧挖出内凹的「无袖背心袖窿（U-shaped Armhole）」，否则大臂旋转时腋下会露出缺口或方形台阶。
   - **标准做法**：`torso` 采用完整闭合的 3/4 侧面胸腔轮廓；近端大臂（`arm_upper_r`）顶部设计以肩关节 `(jointX, jointY)` 为圆心的**同心圆弧顶或圆形大袖肩甲（半径 `r ≈ 14–16px`）**，即使双手举刀过头旋转 `150°` 以上，肩部轮廓也始终平滑贴合无断层。
3. **躯干下摆自带护胯甲裙/战裙（`Kusazuri` / Tunic Skirt）遮挡大腿根部**：
   - 近端左大腿（`thigh_l`）大幅度向前抬腿（如疾跑、弓步挥砍 `-46°`）时，若髋部直接裸露极易漏出大腿顶部的半圆切口。
   - **标准做法**：在 `torso` 下摆向下延伸绘制 `35–45px` 的甲裙/衣摆，并将 `torso` 的 `zIndex` 设为高于近端大腿 `thigh_l`（如 `torso: 13 > thigh_l: 9`），天然遮挡跨步与弓步时的髋关节切口。
4. **多层次赛璐璐矢量着色 + PyMuPDF 渐变回退 + 纯 Alpha 通道辉光（防黑边）**：
   - 使用 `pymupdf`（内置 `nanosvg`）光栅化 SVG 时，`fill="url(#gradId)"` 会被渲染为纯黑 `(0, 0, 0)`。应在脚本中将渐变解析为显式色值，并采用**多层赛璐璐矢量路径（暗部底色 + 主体中调 + 亮部受光面 + 金边/高光描边）**叠加 2D 方向光。
   - 绘制发光特效（如近战武士的双阶段月牙剑气 `slash_arc_fx` / `slash_wave_fx`）时，**严禁直接对未预乘 RGBA 图像做 `GaussianBlur`**（透明像素 `(0,0,0,0)` 的黑色 RGB 会混入半透明边缘形成脏灰黑边）。必须**只提取 Alpha 通道做多尺度高斯模糊**（`a_chan.filter(GaussianBlur(r))`），再填充纯亮青 `(56, 189, 248)` / 冰蓝 `(186, 230, 253)` RGB 进行 `alpha_composite`。
5. **披风多骨骼权重网格（Weighted Mesh）防翻卷 & 武器世界角防穿脸**：
   - 披风（如 `haori_cape`）绑定至 `['torso', 'cape_root', 'cape_mid', 'cape_tip']` 并转为 `5×4` 自动权重网格；注意父子骨骼旋转角会**逐级累加**，三节披风骨骼的单帧旋转增量之和应控制在 `25°–35°` 以内（如 `14° + 10° + 8° = 32°`），使披风向后水平飘起而不会向上翻卷过头顶。
   - 编写奔跑与挥砍关键帧时，随时校验武器世界角 `worldDeg = refDeg + torso + armUpper + armLower + weapon`，确保刀剑始终朝向角色前方或斜下方，绝不反向穿过面部。

---

## 多皮肤换装与 AI 生图换皮（不动骨骼、网格、权重与任何动画）
- **`skin_list`** `{}`：列出当前骨架的全部皮肤（`Armature.skin[]`）与当前激活皮肤。
- **`skin_set`** `{ name }`：切换当前激活皮肤（默认皮肤传 `""`）；之后调用 `render_frame` / `render_animation` 即使用该皮肤渲染。编辑器顶部工具栏会在皮肤数 `> 1` 时自动显示「皮肤」下拉菜单（或通过 URL `?skin=<皮肤名>` 直接打开指定皮肤）。
- **`skin_clone`** `{ name, from? }`：深拷贝一套现有皮肤（完整保留所有插槽的 `mesh` 顶点、`uvs`、`weights`、`bonePose` 与 `transform`）并压入 `Armature.skin[]`，自动切到新皮肤。
- **`region_swap`** `{ slot, file, display?, skin?, keepSize? }`：
  - 将指定插槽的贴图替换为新的 PNG。
  - 当目标皮肤为非默认皮肤（`skinIdx > 0`）时，会自动分配独立的图集子纹理区域 `${skinName}__${slotName}` 并写入 `display.path`，同时保持 `display.name` 不变 —— **既不会覆盖默认皮肤的贴图，又能 100% 兼容 `slot_key` 附件切换时间轴**！
  - `keepSize: true`（默认）会将新 PNG 双线性缩放到原区域像素宽高 `(sub.width, sub.height)`，保证 `0..1` 归一化网格 UV 与骨骼局部变换严丝合缝。
  - **AI 生图换皮最佳实践（精美底座 + 同源 16:9 模板图 + 红十字关节锚点）**：
    1. **先画精美的同源 SVG 底座**：底座部件必须具备真实的解剖长宽比、独立 `neck` 插槽、闭口躯干与下摆遮挡，切勿用简陋几何图形做底座。
    2. **拼装 16:9 同源拆件模板图（Template Sheet）**：左侧放置完整拼装好的待机角色作为全身风格、光影与比例锚点，右侧在固定像素框 `(x, y, width, height)` 内排列各独立部件，并在关节连接点画上醒目的**红十字靶心（Red Crosshair Joint Fiducials）**。
    3. **等比缩放 + 关节锚点对齐裁切**：将生图结果按部件框提取后，采用等比缩放（Uniform Scale）对齐关节圆心，并用原始 SVG 膨胀剪影掩码（Dilated Silhouette Mask）与距离场色彩外推（Distance-Transform RGB Extrapolation）消除白边，最后通过 `skin_clone` + `region_swap` 挂载到骨架上。

---

## 非人形软体与半透明角色（如史莱姆 `slime-2d`）SVG 绘制与软体蒙皮 4 大法则

1. **PyMuPDF `get_pixmap(alpha=True)` 反预乘 Alpha（Unpremultiplied RGBA）修正**：
   - `pymupdf` 在光栅化含 `fill-opacity < 1.0` 的半透明 SVG 部件时，输出的 `pix.samples` 是**预乘 Alpha（Premultiplied RGB = RGB × A / 255）**。若直接转成 PIL `RGBA` 保存，半透明果冻腔体、白色高光与粉红腮红会被二次乘算导致严重发灰发暗。
   - **标准做法**：光栅化后立即执行反预乘还原直通色值：
     ```python
     raw = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 4).astype(np.float32)
     alpha = raw[..., 3:4]
     raw[..., :3] = np.where(alpha > 0, np.clip(raw[..., :3] * 255.0 / np.maximum(alpha, 1.0), 0.0, 255.0), 0.0)
     ```
2. **Fresnel 半透明折射 + 内部悬浮部件多层视差拆件**：
   - 半透明生物切忌画成单张死板贴图，应按纵深拆分为：**后壁折射层（`slime_back_rim`）** → **后景气泡（`bubbles_back`）** → **悬浮魔力晶核（`crystal_core` + `crystal_core_glow`）** → **主果冻腔体（`slime_body`，中心 Fresnel 透明度 `0.28`、边缘 `0.98`）** → **底部焦散反光（`slime_belly_caustic`）** → **前景气泡与曲面玻璃高光（`bubbles_front` + `slime_specular`）**。
   - 跳跃与受击时，让内部 `core` 与 `bubbles_*` 相对外部腔体产生 `2–3` 帧的惯性滞后与旋转，即可呈现真实的半透明果冻流体质感。
3. **全骨骼 `0°` 水平绑定方向 + 接地锚点（Bottom-Contact Pivot）体积守恒挤压拉伸**：
   - 将非人形软体角色的全部骨骼统一设为 **`0°` 水平绑定方向**（`to = [from[0] + len, from[1]]`），此时 `bone_keys` 中的 `x, y, scaleX, scaleY` 与画布水平位移（`+X` 右）、垂直位移（`+Y` 下）、水平宽窄缩放、垂直高矮缩放完全 `1:1` 对齐。
   - 将主体根骨骼 `body_base` 精确放置在角色**底面与地面的接触点**（如 `(400, 406)`）。起跳蓄力（`scaleX: 1.30, scaleY: 0.70`）、落地砸地（`scaleX: 1.34, scaleY: 0.68`）或死亡化为一滩液体（`scaleX: 1.64, scaleY: 0.28`）时，底面始终严丝合缝贴合地面，绝不悬空或穿地。
4. **`6×6` 多骨骼软体权重网格 + 死亡融化时刚性子部件的反向缩放补偿**：
   - 将 `slime_body` 与 `slime_back_rim` 转为 `6×6` 网格（`mesh_create`），并绑定至 `['body_base', 'body_mid', 'body_top', 'cheek_l', 'cheek_r']` 五根软体控制骨骼（`weights_auto`），受击或落地时通过推拉左右脸颊骨骼 `cheek_l` / `cheek_r` 实现非对称果冻波纹。
   - 当死亡动画（`die`）将父骨骼 `body_base` 垂直压扁为液滩（`scaleY: 0.28, scaleX: 1.64`）时，挂在其子层级下的刚性物体（如 `core` 晶核、`crest_drop` 皇冠、`face` 眩晕 `X X` 眼）若不补偿也会被压扁成细线；只需在关键帧中对这些刚性子骨骼施加**反向缩放补偿**（如 `scaleX: 0.62, scaleY: 3.15`）并配合向下位移 `y` 与弹跳曲线，即可表现果冻融化塌陷的同时皇冠与晶核保持立体比例掉落弹跳的戏剧效果。

---

## 深度技术方案一：骨骼绑定、关节圆心与零偏移重挂（Bone Rigging & Joint Pivot）

许多 AI 模型（如失败的 `mage-2d` 案例）做出的角色之所以「四肢断裂、旋转脱节、骨骼全堆在脚底原点」，根本原因是**没有把美术部件的旋转圆心与骨骼关节起点对齐**，或者**未传局部绑定变换 `transform`**。请严格执行以下技术方案：

### 1. 关节同心圆重叠设计（Joint Overlap Circle）
在绘制 SVG 分层部件时，凡是存在旋转关系的父子部件（如 `arm_upper` 与 `arm_lower`、`thigh` 与 `shin`、`neck` 与 `head`），必须在它们的公共关节像素坐标 `(jx, jy)` 处**各自画出半径为 `R` 的圆弧端头**：
- **肩关节 / 髋关节**：`R = 13..16px`（两个部件在 `(jx, jy)` 处重叠直径 `26..32px` 的圆形区域）；
- **肘关节 / 膝关节**：`R = 10..13px`；
- **手腕 / 脚踝 / 脖颈两端**：`R = 8..11px`。
> **为什么必须有重叠圆？** 如果上臂底部画成平直横线、前臂顶部也画成平直横线，前臂只要旋转 `30°` 就会立刻露出三角形透明缺口和生硬的直角折痕！只有两端都以 `(jx, jy)` 为圆心画圆弧端头，绕 `(jx, jy)` 旋转任意角度轮廓才永远连续平滑。

### 2. 标准骨骼树拓扑与局部矩阵自动换算模板（直接复制使用）
不要手算局部坐标！在脚本中只定义画布像素空间下的关节坐标字典 `J` 和父子线段表 `BONE_SPECS`，然后用下面的矩阵模板一键算出每根骨骼相对父骨骼的 `transform: { x, y, skX, skY }` 与 `length`：

```js
// 1. 定义画布尺寸与关节像素坐标（必须与 generate_*_svg.py 中的关节完全一致！）
const CANVAS_W = 880, CANVAS_H = 560;
const OX = CANVAS_W / 2; // 440
const OY = CANVAS_H;     // 560 (layers_add 世界原点固定在画布底边中点)

const J = {
  root:        [240, 495],
  hip:         [235, 312],
  torso:       [235, 298],
  neck:        [238, 206],
  head:        [240, 190],
  cape_root:   [212, 218],
  cape_mid:    [150, 290],
  cape_tip:    [90,  375],
  arm_upper_l: [252, 224],
  arm_lower_l: [284, 272],
  arm_upper_r: [222, 228],
  arm_lower_r: [256, 282],
  weapon:      [292, 298],
  thigh_r:     [246, 316],
  shin_r:      [258, 398],
  foot_r:      [266, 476],
  thigh_l:     [224, 316],
  shin_l:      [212, 398],
  foot_l:      [204, 476],
};

// 2. 父骨骼在前、子骨骼在后！注意 hip/shadow 等需要直接做水平/垂直位移的骨骼保持 0° 水平绑定（to = [from[0]+len, from[1]]）
const BONE_SPECS = [
  { name: 'shadow',      parent: 'root',        from: J.root,        to: [J.root[0] + 45, J.root[1]] },
  { name: 'hip',         parent: 'root',        from: J.hip,         to: [J.hip[0] + 28, J.hip[1]] },
  { name: 'thigh_r',     parent: 'hip',         from: J.thigh_r,     to: J.shin_r },
  { name: 'shin_r',      parent: 'thigh_r',     from: J.shin_r,      to: J.foot_r },
  { name: 'foot_r',      parent: 'shin_r',      from: J.foot_r,      to: [J.foot_r[0] + 28, J.foot_r[1] + 6] },
  { name: 'thigh_l',     parent: 'hip',         from: J.thigh_l,     to: J.shin_l },
  { name: 'shin_l',      parent: 'thigh_l',     from: J.shin_l,      to: J.foot_l },
  { name: 'foot_l',      parent: 'shin_l',      from: J.foot_l,      to: [J.foot_l[0] + 28, J.foot_l[1] + 6] },
  { name: 'torso',       parent: 'hip',         from: J.torso,       to: J.neck },
  { name: 'neck',        parent: 'torso',       from: J.neck,        to: J.head },
  { name: 'head',        parent: 'neck',        from: J.head,        to: [J.head[0], J.head[1] - 42] },
  { name: 'cape_root',   parent: 'torso',       from: J.cape_root,   to: J.cape_mid },
  { name: 'cape_mid',    parent: 'cape_root',   from: J.cape_mid,    to: J.cape_tip },
  { name: 'cape_tip',    parent: 'cape_mid',    from: J.cape_tip,    to: [J.cape_tip[0] - 32, J.cape_tip[1] + 24] },
  { name: 'arm_upper_l', parent: 'torso',       from: J.arm_upper_l, to: J.arm_lower_l },
  { name: 'arm_lower_l', parent: 'arm_upper_l', from: J.arm_lower_l, to: [J.arm_lower_l[0] + 24, J.arm_lower_l[1] + 40] },
  { name: 'arm_upper_r', parent: 'torso',       from: J.arm_upper_r, to: J.arm_lower_r },
  { name: 'arm_lower_r', parent: 'arm_upper_r', from: J.arm_lower_r, to: J.weapon },
  { name: 'weapon',      parent: 'arm_lower_r', from: J.weapon,      to: [J.weapon[0] + 120, J.weapon[1] - 80] },
];

// 3. 自动换算每根骨骼相对父级的局部 transform (x, y, skX, skY) 与 length
const worldMats = { root: matFrom(0, 0, 0) };
for (const b of BONE_SPECS) {
  const wx = b.from[0] - OX, wy = b.from[1] - OY;
  const tx = b.to[0] - OX,   ty = b.to[1] - OY;
  const wDeg = Math.atan2(ty - wy, tx - wx) * DEG;
  const len = Math.round(Math.hypot(tx - wx, ty - wy));
  const W = matFrom(wx, wy, wDeg);
  const localM = mulMat(invMat(worldMats[b.parent]), W);
  const localDeg = Math.atan2(localM[1], localM[0]) * DEG;
  worldMats[b.name] = W;
  await mcp.call('bone_create', {
    name: b.name,
    parent: b.parent,
    length: len,
    transform: {
      x: Number(localM[4].toFixed(2)),
      y: Number(localM[5].toFixed(2)),
      skX: Number(localDeg.toFixed(2)),
      skY: Number(localDeg.toFixed(2)),
    },
  });
}
```

---

## 深度技术方案二：插槽层级覆盖选择规范（Z-Index Draw Order & 夹心遮挡矩阵）

在 2D 骨骼动画中，90% 的「关节穿帮、脖子割裂衣领、武器穿帽子、大腿漏切口」都是因为 `zIndex`（绘制顺序，`0` 在最底层，越大越靠前）排错导致的。

### 1. 四大核心遮挡夹心不变量（必须死守）
1. **脖颈三明治夹心（`back_hair < neck < torso < head`）**：
   - **错误做法（如失败的 `mage-2d`）**：把 `neck` 的 `zIndex` 设得比 `torso` 和 `hair` 还高，导致脖子像一块创可贴贴在胸口和头发表面！
   - **正确做法**：`neck` 必须低于 `torso`（让衣领/胸甲上缘盖住脖子下端切口），且 `head` 必须高于 `torso` 和 `neck`（让下巴盖住脖子上端切口），而脑后长发/马尾 `hair_back` 则放在 `neck` 后面。
2. **近端肩甲盖躯干（`torso < arm_upper_r`）**：
   - 远端左臂全套放在躯干后面（`arm_upper_l < arm_lower_l < torso`）；近端右大臂 `arm_upper_r` 必须高于 `torso`，并用顶部圆形肩甲/袖口盖住胸腔右上侧肩窝。
3. **护胯甲裙/衣摆盖大腿根（`thigh_r < shin_r < foot_r < thigh_l < torso`）**：
   - 把护胯甲裙/长袍前摆直接画在 `torso`（或高于 `thigh_l` 的 `pelvis_skirt`）下部，使其 `zIndex` 高于近端大腿 `thigh_l`，抬腿冲刺时髋部圆头被衣摆完美遮挡。
4. **手掌与武器/法杖握持夹心（`weapon < hand_r` 或一体式握柄）**：
   - 若手与武器拆开：`arm_upper_r < arm_lower_r < weapon < hand_r`（手掌贴图在最外层包住剑柄/杖杆，绝不能让手掌藏在袖子底下而法杖悬浮在空中）；
   - 且法杖/长柄武器的绑定点必须在手心 `J.hand_r`，旋转轴沿手腕展开，绝不能垂直竖在角色正前方穿过帽檐。

### 2. 标准 3/4 侧面人形角色 Z-Index 全层级速查表（直接照抄）

| `zIndex` 序号 | 插槽名 (`slot`) | 绑定骨骼 (`bone`) | 遮挡逻辑说明 |
| :---: | :--- | :--- | :--- |
| `0` | `ground_shadow` | `shadow` | 最底层地面投影 |
| `1` | `cape_back` / `haori_cape` | `torso` (加权网格) | 角色背后的披风/斗篷，位于全身最背部 |
| `2` | `quiver_back` / `saya_sheath` | `torso` / `hip` | 背部箭袋或腰后刀鞘 |
| `3` | `thigh_r` | `thigh_r` | 远端（右）大腿 |
| `4` | `shin_r` | `shin_r` | 远端（右）小腿（盖住远端膝盖） |
| `5` | `foot_r` | `foot_r` | 远端（右）战靴 |
| `6` | `arm_upper_l` | `arm_upper_l` | 远端（左）大臂（在躯干后方） |
| `7` | `arm_lower_l` | `arm_lower_l` | 远端（左）前臂与远端手 |
| `8` | `thigh_l` | `thigh_l` | 近端（左）大腿（高于远端腿，但**低于躯干护胯下摆**！） |
| `9` | `shin_l` | `shin_l` | 近端（左）小腿 |
| `10` | `foot_l` | `foot_l` | 近端（左）战靴 |
| `11` | `neck` | `neck` | **独立脖颈（必须低于 `torso_armor` 与 `head`！）** |
| `12` | `torso_armor` | `torso` | **躯干胸甲 + 交领（盖住 `neck` 下端）+ 护胯下摆（盖住 `thigh_l` 上端）** |
| `13` | `hair_back` / `hair_ponytail` | `head` / `hair_ponytail` | 脑后马尾/长发（在头部后方，随头部滞后摆动） |
| `14` | `head` | `head` | 头部与五官（下巴盖住 `neck` 上端） |
| `15` | `beard` / `hat_headwear` | `head` / `hat` | 胡须、兜帽、头盔或法师帽（高于头部） |
| `16` | `arm_upper_r` | `arm_upper_r` | **近端（右）大臂（顶部同心圆肩甲盖住 `torso_armor` 肩口！）** |
| `17` | `weapon` (`katana` / `staff`) | `weapon` | 武器/法杖（夹在近端小臂/手心之间） |
| `18` | `arm_lower_r` (含握持手掌) | `arm_lower_r` | **近端（右）前臂与手掌（盖住 `arm_upper_r` 肘部与 `weapon` 握柄！）** |
| `19..21` | `slash_arc_fx` / `magic_fx` | `slash_arc` / `fx` | 最顶层剑气、箭矢、法球发光特效（默认 `attachment: ""` 隐藏） |

---

## 深度技术方案三：网格划分与蒙皮权重工程规范（Mesh & Skinning Weights）

### 1. 刚体插槽（Rigid Slot）vs 加权网格（Weighted Mesh）决策表
切忌不加区分地对所有部件做网格蒙皮，也切忌对柔性部件不做网格：

| 部件类别 | 绑定方式 | 网格密度 (`cols × rows`) | 参与权重骨骼 (`weights_auto.bones`) | 衰减指数 (`falloff`) | 核心禁忌 |
| :--- | :--- | :---: | :--- | :---: | :--- |
| **头部、五官、头盔、帽子** | **刚体插槽（Rigid）** | 不转网格 | 仅挂 `head` / `hat` | — | **严禁**与脖子/躯干混绑权重，否则转头时脸部会被拉长扭曲 |
| **刀剑、法杖、弓把、箭矢** | **刚体插槽（Rigid）** | 不转网格 | 仅挂 `weapon` / `bow_riser` | — | **严禁**多骨软蒙皮，否则挥砍时刀剑会像橡胶一样弯曲 |
| **大臂、小臂、大腿、小腿** | **刚体分段（Rigid）** | 不转网格 | 各自挂对应单骨 | — | 依靠关节同心圆重叠旋转，保持铠甲/护腕硬朗结构 |
| **披风 / 斗篷 (`cape_back`)** | **加权网格（Mesh）** | `5 × 4` 或 `4 × 3` | `['torso', 'cape_root', 'cape_mid', 'cape_tip']` | `2.0` | **严禁把 `root`、`hip` 或手臂骨骼放进 `bones`！**（放 `root` 会把披风底角钉死在地面原点） |
| **长袍下摆 (`robe_skirt`)** | **加权网格（Mesh）** | `4 × 4` | `['hip', 'thigh_l', 'thigh_r']` | `1.8` | 仅绑骨盆与左右大腿，迈步时袍摆自然随双腿前后分开 |
| **非人形软体腔体 (`slime_body`)** | **加权网格（Mesh）** | `6 × 6` | `['body_base', 'body_mid', 'body_top', 'cheek_l', 'cheek_r']` | `1.65` | 配合接地锚点 `body_base` 与左右脸颊骨骼实现果冻Q弹形变 |

### 2. 调用 `weights_auto` 的两条铁律
1. **必须在所有骨骼都已通过 `bone_create` 放置在正确世界位置之后再调 `weights_auto`**：
   - `weights_auto` 是根据网格顶点在绑定姿态（Setup Pose）下的世界坐标到每根骨骼线段 `(from -> to)` 的最短距离计算权重的。如果像失败的 `mage-2d` 那样骨骼都在 `(0, 0)` 原点，算出的权重会完全失效！
2. **多节骨骼链（如披风 `cape_root -> cape_mid -> cape_tip`）的旋转角累加控制**：
   - 子骨骼会继承父骨骼的旋转。给披风打关键帧时，三节骨骼在单帧的 `rotate` 增量应同向递减且总和控制在 `25°–35°` 以内（例如冲刺时 `cape_root: +14°, cape_mid: +10°, cape_tip: +8°`，累计 `+32°`），这样网格会呈现优美的 S 型流线飘动，绝不会折成锐角或翻卷到头顶前方。

---

## 深度技术方案四：AI 常见翻车反模式对照表（Anti-Patterns vs Best Practices）

在编写 SVG 生成与 MCP 绑定脚本时，请逐条对照以下反模式自检：

| 常见翻车现象（以失败的 `mage-2d` 为戒） | 根本原因（Anti-Pattern ❌） | 正确工程方案（Best Practice ✅） |
| :--- | :--- | :--- |
| **1. 所有骨骼堆在脚底 `(0,0)`，一播放动画全身乱飞** | 调 `bone_create` 时漏写了 `transform` 或算错了原点（未用 `OX = canvasW/2, OY = canvasH`） | 使用上方「标准骨骼树矩阵模板」，严格以 `(canvasW/2, canvasH)` 为世界原点，传入 `transform: { x, y, skX, skY }`（现已同时兼容顶层 `x, y, rotation`） |
| **2. 角色像积木拼的火柴人，长方形袖子、没有脖子、胡子像白布条** | SVG 只用了简单的 `<rect>` / `<polygon>` 和单色填充，没有解剖曲线与多层光影 | 使用三次贝塞尔曲线 `<path d="M ... C ...">` 绘制解剖轮廓；每个部件至少包含 **3 层赛璐璐路径（暗部底色 + 主体中调 + 受光亮面 + 描边高光）**，并在脚本中做 `apply_cel_shading` 定向光着色 |
| **3. 脖子压在衣服和头发上面，或者转头时下巴脱节** | `neck` 的 `zIndex` 设得太高（如 `z=16 > torso z=9`），且脖子长度太短没有预留插入余量 | 遵守三明治法则：`hair_back < neck < torso < head`，且 `neck` 上下两端各向头底和衣领内延伸 `10px` |
| **4. 挥砍/施法结束后退出循环播放，或多出 `idle_1` 空动画** | `project_new` 已默认自带 `idle` 动画，又调了 `animation_create({ name: "idle" })` 导致重名生成 `idle_1`；且攻击动画设了 `playTimes: 1` | 对默认 `idle` 调 `animation_update({ animation: "idle", duration: 32, playTimes: 0 })`；其它动作调 `animation_create` 且统一设 `playTimes: 0` 以便在编辑器内无缝循环预览 |
| **5. 发光法球/剑气周围有一圈黑灰色脏边** | 直接对透明底 RGBA 图片做 `ImageFilter.GaussianBlur`，把透明像素 `(0,0,0,0)` 的黑色 RGB 混入了边缘 | **只对 Alpha 通道做高斯模糊**：提取 `a = im.split()[3]` 模糊后再贴回纯色发光层（如 `(56, 189, 248, 0)`）做 `Image.alpha_composite` |
| **6. 披风下半截被钉在原地拉成三角形长丝** | 调 `weights_auto` 时把静止的 `root` 或腿部骨骼也传进了披风的 `bones` 数组 | 披风的 `weights_auto` **只传** `['torso', 'cape_root', 'cape_mid', 'cape_tip']` 四根骨骼 |

---

## 内置完整参考工程与 SVG/MCP 工作区脚本（供 AI 直接学习与复用）

仓库与本 Skill 内置了 **4 套不同类型（机械联动 IK、远程弓箭手、近战刀剑武士、非人形半透明软体生物）** 的完整演示工程及全套 SVG 生成 + MCP 骨骼动画脚本，可直接读取学习或作为模板改写：

| 工程名 (`projects/<name>`) | 角色类型与核心技术点 | SVG 部件生成脚本 (`generate_*.py`) | MCP 骨骼与动画构建脚本 (`build_*_mcp.mjs`) | 包含动作 (`24fps`, `playTimes: 0`) |
| :--- | :--- | :--- | :--- | :--- |
| **`pelican-bicycle`** | 复杂机械联动 + 双腿圆周踏板分析式余弦定理 IK | `examples/mcp-demos/pelican-bicycle/generate_svg_parts.py`（25 个分层部件） | `examples/mcp-demos/pelican-bicycle/build_pelican_mcp.mjs`（26 根骨骼 + 软披风网格） | `ride`（匀速骑行）、`sprint`（站立冲刺）、`idle_coast`（滑行待机） |
| **`archer-2d`** | 2D 远程精灵游侠 + 弓臂弯曲与弓弦回弹 + 抛物线箭矢插靶 | `examples/mcp-demos/archer-2d/generate_archer_svg.py`（28 个分层部件） | `examples/mcp-demos/archer-2d/build_archer_mcp.mjs`（32 根骨骼 + `4×3` 披风网格） | `idle`、`walk`、`run`、`aim_shoot`（蓄力平射）、`jump_multishot`（跃起散射）、`hit` |
| **`samurai-2d`** | 2D 近战武士 + 5 大防穿帮解剖法则 + 双阶段纯 Alpha 辉光剑气斩竹靶 | `examples/mcp-demos/samurai-2d/generate_samurai_svg.py`（22 个多层赛璐璐部件） | `examples/mcp-demos/samurai-2d/build_samurai_mcp.mjs`（26 根骨骼 + `5×4` 阵羽织网格） | `idle`、`walk`、`run`、`slash`（上段蓄力 → 弓步挥斩 → 月牙剑气破空斩断青竹靶） |
| **`slime-2d`** | 2D 非人形半透明果冻史莱姆 + Fresnel/SSS 着色 + `6×6` 软体网格 + 死亡融化 | `examples/mcp-demos/slime-2d/generate_slime_svg.py`（18 个半透明折射与多表情部件） | `examples/mcp-demos/slime-2d/build_slime_mcp.mjs`（15 根 `0°` 水平软体骨骼） | `idle`、`hop_walk`（跳跃行走）、`hop_run`（跳跃奔跑）、`hit`（受击震荡）、`die`（膨胀融化液滩） |

> **文件位置说明**：
> - **BoneStudio 仓库内**：编译好的可直接打开工程位于 `projects/<name>/`（已登记在 `projects/manifest.json`）；对应的 SVG 生成脚本、坐标清单 `layers_manifest.json`、`svg/*.svg`、`png/*.png` 与 MCP 构建脚本位于 `examples/mcp-demos/<name>/`。
> - **Skill 目录内**：同一套脚本与 SVG/PNG 工作区也已同步在 Skill 目录下的 `examples/<name>/` 中，AI Agent 无需离开 Skill 目录即可直接读取参考。

---

## AI 换皮：不动骨骼，把画风/材质换掉（实战沉淀）

**目标**：骨架、网格、权重、动画零改动，只替换 25 个插槽的贴图。可用 MCP 的 `skin_clone` + `region_swap` 承载。
**参考脚本**：`examples/mcp-reskin/`（make_sheet / extract_sheet / project_texture / apply_reskin）。

### 两条路线怎么选

| 路线 | 做法 | 优点 | 代价 |
|---|---|---|---|
| **A 整图重绘 + 投影采样** | AI 按 setup 姿态重绘整只角色 → 轮廓 IoU 仿射配准回原画布 → 逐部件按 bbox 采样 AI 图颜色，alpha 沿用原部件 | 部件间颜色光影天然连续，流程短 | 所有部件共享同一张图：遮挡区域内容靠"借"，肢体大幅转动时被借的身体毛会跟着转（重影感） |
| **B 部件图版（两参考图）** | 把全部部件平铺成 5×5 图版 + 完整 setup 两图一起提交 → 模型逐格重绘 → 逐格抠图、矩配准、沿用原 alpha | 每个部件是**独立内容**，转动时不再重复身体纹理 | 拼装感略强（每部件带独立光影/描边）；逐格提取和边缘修补要求高 |

> 经验：机械/道具类（自行车、武器）用 A 就够；角色立绘追求"动起来也对"时用 B；再往上就是逐部件单独 img2img（一致性靠统一 prompt 与调色）。

### 参考图准备（通用）
1. **setup 渲染**：`render_frame {setup: true, background: 纯色}`，不带骨骼；纯色背景是后续抠图的前提。
2. **去傀儡关节**：如果底座画了显式的"关节圆盘/铆钉"，先出**无描边变体**（`gen_parts.py --clean` 式做法：把关节圆描边改成填充色，几何不变）。否则 AI 会原样把圆盘画回来，成品像木偶。
3. **图版**（路线 B）：1536×1024，左侧完整角色做风格锚点，右侧 5×5 网格逐部件摆放，每格留 ~30px 余量；导出 `sheet_layout.json`（格子坐标 + 部件名 + 缩放）。

### 提示词要点
- 保持参考图的姿态/朝向/构图，只换画风与材质（如「手绘厚涂 impasto」）。
- **关节**：「四肢关节由毛发自然覆盖、圆润过渡，不要绘制圆形铆钉、木偶球关节、圆盘或描边圆圈」。
- 纯色浅灰背景，无文字、边框、地面投影；全身完整入画不裁切。
- 两张参考图同时给时，明确「输出与参考图1完全相同的排版；每个格子重绘对应部件，位置/数量/类型一致」。

### 落地流程
1. **抠底**：取四角底色中值；颜色距离 <15 且与画布边缘连通的区域（四角泛洪）判为背景；取主体最大连通域。背景非纯色时先让模型重出。
2. **配准**：矩协方差初始化（含各向异性缩放）+ 6 参数坐标下降最大化 IoU。*不要用 `cv2.findTransformECC`——二值 mask 无梯度，常 NaN 不收敛。* 4× 降采样粗调 → 全分辨率细调；实测 IoU 0.87~0.93 可用。
3. **颜色外扩**：主体颜色向背景级联膨胀（约 18px），防止部件边缘采样到底色；alpha 关节圆超出画出内容的角落，用泛洪填充**向部件中值色混合 65%**，避免白角。
4. **逐部件采样**：bbox 裁 AI 图 RGB + 原部件 alpha 输出 RGBA；`region_swap {slot, file, keepSize: true}` 写入新皮肤；**影子槽不要换皮**（否则脚下变浅色残影），用原影子贴图回填。
5. **自检**：`render_frame {setup, bones}` 看对齐；`render_animation` 联系表看动作；跑步/跳跃的**极限帧 2 倍近景**检查关节密封；`spine_export` 的 `validation.ok` 必须为 true（几何未改，一般必过）。

### 白圈/「毛袜」问题（路线 B 必踩）
AI 常把每个肢体末端画成浅色毛边，叠到 alpha 的关节圆上就是白圈。三层修复（`extract_sheet.py` 已内置）：
1. **边缘亮色钳制**：距 alpha 边缘 5px 环带内、比内部核心亮 >22 的像素，用内部最近色替换；
2. **四肢环带中和**：3px 边缘环带向部件中值色混合 55%（仅腿/臂部件）；
3. **角落中值混合**：见流程第 3 步。
仍不理想 → 回到参考图阶段：底座无描边或弱描边，从源头减少描边惯性。

### 风格与质量提示
- **厚涂/水彩类画风与粗描边互斥**：底座 outline 建议 ≤2px 且贴近本体色；5px 深色描边 + AI 再画一遍描边 = 明显的「贴纸拼装感」。
- **换皮的天花板是底座质量**：AI 只能改画风，不可能修正残缺的比例与解剖；底座越接近概念图，成品越高级。
- 想再进一步：① 逐部件 img2img（部件朝向覆盖完整）；② 图版格子内把部件「画大一圈」（环绕延展），交叠区域完全被邻居覆盖；③ 头部单独二级配准（五官 landmark）解决局部错位。
