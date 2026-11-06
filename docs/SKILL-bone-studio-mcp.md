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
| `bone_create` | `{ name: string, parent?: string, x?: number, y?: number, rotation?: number, length?: number }` | 新建骨骼（父骨骼必须已存在） |
| `bone_update` | `{ name: string, parent?: string, x?: number, y?: number, rotation?: number, scaleX?: number, scaleY?: number, length?: number, inheritRotation?: boolean, inheritScale?: boolean }` | 修改骨骼绑定属性 |
| `bone_delete` | `{ name: string }` | 删除骨骼（子骨骼与插槽自动归回父骨骼） |
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
| `animation_update` | `{ name: string, newName?: string, duration?: number, playTimes?: number, scaleFrames?: boolean }` | 改动画时长/重命名 |
| `bone_key` | `{ animation?: string, bone: string, frame: number, x?: number, y?: number, rotate?: number, scaleX?: number, scaleY?: number, easing?: number \| "linear" \| "stepped" \| "easeIn" \| "easeOut" \| "easeInOut" \| [number,number,number,number] }` | 单帧写入骨骼**相对绑定姿态的增量** |
| `bone_keys` | `{ animation?: string, keys: Array<{ bone: string, frame: number, x?: number, y?: number, rotate?: number, scaleX?: number, scaleY?: number, easing?: ... }> }` | **批量写入骨骼关键帧**（强烈推荐） |
| `slot_key` | `{ animation?: string, slot: string, frame: number, attachment?: string \| null, rM?: number, gM?: number, bM?: number, aM?: number, easing?: ... }` | 插槽换图（`null` 隐藏）或颜色/透明度关键帧（0–100） |
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
