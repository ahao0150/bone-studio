# 开源参考语料（OSS-REFERENCES）

> 本文回答一个问题：**做清洁室复刻时，官方/第三方开源仓库里有哪些"可以直接引用的权威依据"？**
> 规则不变：只使用**已发布的开源仓库 + 已发布的格式文档 + 受控行为观察**，不搬运反编译产物。

所有仓库都在 `work/oss/`（浅克隆）+ `work/dragonbones-src/`（既有克隆）下，可直接复核。

## 1. 语料清单

| 仓库 | 提交 | 日期 | 许可 | 对本项目的价值 |
|---|---|---|---|---|
| [DragonBones/DragonBonesJS](https://github.com/DragonBones/DragonBonesJS) | `64b6c69ae357` | 2025-05-24 | MIT | **官方运行时**：JSON/二进制解析器、IK、网格/权重、Surface、时间轴求值 |
| [DragonBones/Tools](https://github.com/DragonBones/Tools) | `4bdafe9a3636`（`master`） | 2020-05-24 | MIT | **官方工具链源码**：二进制格式文档、JSON→二进制写出器、`toNew`/`format` 归一化 |
| [DragonBones/Loongbones-doc](https://github.com/DragonBones/Loongbones-doc) | `f866e596cc7b` | 2026-10-09 | 文档 | **官方编辑器文档站**（DragonBones 后继产品）：功能清单 / UI 面板 / 快捷键 / 导出选项 |
| [DragonBones/DragonBonesAS](https://github.com/DragonBones/DragonBonesAS) | `450d4d301359` | 2017-07-31 | MIT | 原始 ActionScript 运行时（4.x/5.x 语义对照） |
| [DragonBones/DesignPanel](https://github.com/DragonBones/DesignPanel) | `dev` | — | MIT | 上一代 Flash 编辑器源码（数据模型 / 导入导出命令，未克隆，按需） |

`DragonBones/Tools` 的 `master` 是**最新分支**（`dev` 停在 2019-03-11，且少一行 ffd 修正）。

### 1.1 官方格式文档（`work/oss/Tools/doc/`）

| 文档 | 内容 |
|---|---|
| `dragonbones_bin_format_1.0-zh_CN.md` | **二进制格式标准**：Data Tag / Header / Color / Weights / **Surface** / Mesh / Path / Timeline / Frame / Tween / Action / ZOrder |
| `dragonbones_json_format_5.5.md`(+`-zh_CN`) | 5.5 JSON 权威字段表（默认值、可选性） |
| `QA-zh_CN.md` | 工具链常见问题 |

这两份文档把此前靠 REA 逐字节推出来的若干布局（段偏移表、Timeline 5 槽头、Tween 类型表）**变成了官方明文**，
因此 §4/§9/§15/§16 的结论现在有"官方文档 + 实测"双重依据。

## 2. 已经吸收进本仓库的算法

| 能力 | 官方出处 | 本仓库落点 |
|---|---|---|
| 二进制段布局 / 稀疏 JSON | `doc/dragonbones_bin_format_1.0-zh_CN.md`、`src/action/toBinary.ts` | `src/core/export/dbbin.ts`、`src/core/parse/dbbin.ts` |
| JSON→二进制写出（含曲线采样、权重烘焙、FFD 轴裁剪） | `src/action/toBinary.ts` | `src/core/export/dbbin.ts` |
| `toNew` 归一化（legacy → 5.5） | `src/action/toNew.ts` | 工具链 oracle 侧（`-t new`） |
| 二进制读取（timeline 数组、slot/bone/constraint 映射） | `src/dragonBones/parser/BinaryDataParser.ts` | `src/core/parse/dbbinDecode.ts` |
| Surface 骨骼 + `Surface(50)` 时间轴 | `src/format/dragonBonesFormat.ts`、`src/action/toBinary.ts` | `src/core/export/dbbin.ts`、`src/core/parse/dbbinDecode.ts`（§19） |
| IK 求解语义（`bendPositive`、chain） | `src/dragonBones/armature/Bone.ts` | `src/core/runtime/ik.ts`（§13 已对拍） |
| 编辑器功能/UI 面板清单 | `Loongbones-doc/zh/loongbones/editor/*` | `docs/UX-DESIGN.md`、M1 功能清单 |

## 3. 本轮由开源语料直接定位到的两个工具链缺陷（重要）

1. **随 DragonBones 5.6 发布的工具链（`dragonbones-tools` v50）无法导出 Surface**：
   - `toBinary.js` 的骨骼循环里只有 `MeshDisplay / PathDisplay / PolygonBoundingBoxDisplay` 分支，
     **没有 Surface 骨骼分支** ⇒ 顶点网格永远不会进入 `intArray/floatArray`；
   - `createSurfaceTimeline()` 第一行是 `if (!surface || surface.type !== dbft.BoneType.Surface) return timelines;`，
     而 `Surface.type` 是字符串 `"surface"`、`dbft.BoneType.Surface` 是数字 `1` ⇒ **恒为真，时间轴被静默丢弃**。
2. **上游 `Tools@master`（2020）修好了 Surface，却回归了 FFD**：
   `src/action/toBinary.ts` 的 ffd 分支删掉了 `timelines.push(dbft.TimelineType.SlotDeform)`（`dev` 分支里还在），
   于是 slot 映射只剩裸偏移（`"slot":{"upperbody":[43]}`），而 5.5 运行时按 `[type, offset]` 步长 2 读取 ⇒ 读不出来。

结论：**Surface 族只能以上游 `master` 的写出结果作 oracle，其余族仍以 Pro 附带工具链为 oracle**。
两个 oracle 的产物都在 `work/dbrecon/oracle/`，逐字节证据见 `格式规范`。

## 4. 复算方法

```powershell
# 1) 上游工具链（master）编译：仓库不自带 tsc，借用本仓库的 typescript
cd work/oss/Tools
npm install
node C:\...\outputs\bone-studio\node_modules\typescript\bin\tsc -p tsconfig.json

# 2) 产出 Surface 家族 oracle（fixture: work/dbrecon/oracle/in-surface-min）
node out/convertTo.js -t binary -i ..\..\dbrecon\oracle\in-surface-min -o ..\..\dbrecon\oracle\out-surface-min

# 3) 随 Pro 发布的工具链（v50）仍用于其余族
cd work/dbrecon/oracle/tools
node convertTo.js -t binary -i <skeleton-dir> -o <out-dir>
```

## 5. 红线

- **不复制任何反编译代码**：上表"落点"列的实现都是按格式规范 + 行为观察重写的；官方源码只用于**确认语义**与**构造 oracle**。
- 引用官方源码时保留其 MIT 归属（本仓库不直接链接/打包其代码）。
- 运行时可执行文件（`dragonBones.min.js`）只用于**受控重放对拍**（§13）。

## 6. Surface 运行时对拍装置（本轮新增）

`work/dbrecon/surface-oracle/`：

| 文件 | 说明 |
|---|---|
| `SurfaceChild_ske.dbbin` | 上游 `DragonBones/Tools` 产出的二进制夹具（本仓库导出逐字节一致） |
| `dragonBones57.js` | **官方运行时**（`DragonBonesJS` 仓库 `Egret/4.x/out/dragonBones.js`，v5.7.000，MIT） |
| `egret.min.js` / `egret.web.min.js` | 运行时依赖（与运行时同源仓库） |
| `index.html` | 把 `.dbbin` 喂给 `factory.parseDragonBonesData(ArrayBuffer)`，逐帧记录子骨骼矩阵 |

复算：`node ik-serve.mjs <surface-oracle 目录> 8792` 起静态站，再用
`work/surface-oracle.mjs`（CDP）驱动无头 Chrome，结果写入
`outputs/bone-studio/docs/evidence/surface-child-oracle.json`。

**注意**：随旧示例发布的 5.5 运行时**不支持** Surface（`SurfaceData` 没有 `geometry`，会产出 NaN），
对拍必须用 5.6+ 构建。
