# AI 换皮参考脚本（BoneStudio）

配合 `docs/SKILL-bone-studio-mcp.md` 的「AI 换皮」章节使用。两条路线的可复用脚本，
来源于 red-fox-2d 的实战（厚涂换皮，25 部件）。

## 文件

| 文件 | 路线 | 作用 |
|---|---|---|
| `project_texture.py` | A 整图投影 | AI 重绘整图 → 轮廓 IoU 仿射配准回画布 → 逐部件 bbox 采样颜色（alpha 沿用原部件） |
| `make_sheet.py` | B 部件图版 | 拼 1536×1024 图版：左完整角色 + 右 5×5 部件格，输出 `sheet_layout.json` |
| `extract_sheet.py` | B 部件图版 | 图版逐格抠图 → 矩配准到原部件 → 边缘白圈修复 → 输出换皮 PNG |
| `apply_reskin.mjs` | 通用 | `skin_clone` + `region_swap(keepSize)` 装皮肤，渲染自检图（影子槽保留原贴图） |

## 运行环境

- Python：`opencv-python-headless`、`pillow`、`numpy`（`pip install opencv-python-headless`）
- 生图：任意图生图（codex-image / ComfyUI），要求纯色背景、保持参考姿态
- 装皮肤：Node + 仓库自带的 `tools/mcp-client.mjs`（自动拉起 `dist-mcp/server.js`）

## 环境变量 / 参数

- `RESKIN_WORKDIR`：部件工作区（含 `layers_manifest.json` 与 `png/`；图版路线用
  `layers_manifest_clean.json` + `png_clean/`）。默认 `../fox-workspace`。
- `RESKIN_OUT`（make_sheet）：图版输出目录，默认脚本目录。
- `RESKIN_LAYOUT`（extract_sheet）：`sheet_layout.json` 路径，默认脚本目录。

## 典型用法

```bash
# 路线 A：整图投影（gen.png 为 AI 重绘的 setup 姿态整图）
RESKIN_WORKDIR=/path/to/workspace python3 project_texture.py gen.png out_parts --ref ref_setup.png

# 路线 B：部件图版
RESKIN_WORKDIR=/path/to/workspace RESKIN_OUT=/path/to/out python3 make_sheet.py
#   → 提交 sheet_ref.png + ref_clean.png 两张参考图给模型，拿回 painted_sheet.png
RESKIN_WORKDIR=/path/to/workspace RESKIN_LAYOUT=/path/to/out/sheet_layout.json \
  python3 extract_sheet.py painted_sheet.png out_parts

# 装皮肤（在仓库根目录运行）
node examples/mcp-reskin/apply_reskin.mjs out_parts painterly red-fox-2d
```

## 关键实现备注

- **配准不要用 ECC**：二值 mask 无梯度，`findTransformECC` 易 NaN；本脚本用
  「二阶矩协方差初始化 + 6 参数坐标下降最大化 IoU」。
- **白圈修复**：AI 常给肢体末端画浅色毛边，见 `extract_sheet.py` 中三层处理
  （边缘亮色钳制 / 四肢环带中和 / 角落中值混合）。
- **影子槽**：`apply_reskin.mjs` 自动跳过 `shadow`，用原贴图回填，否则脚下会变浅色残影。
- 工程写锁 30s 心跳：连续跑脚本之间等一会儿，或换工程/另存。
