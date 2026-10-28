/**
 * 网格编辑悬浮工具栏（官方 `_877/_11511.as`，用户截图图2/图3）。
 *
 * 结构对齐官方：
 *   - 头部：标题「编辑网格」(`Mesh.property.edit`) + 「变形」复选框(`Mesh.tool.deform`) + 关闭×（`CLOSE_EDIT`）
 *   - 工具行：编辑工具(B) / 添加工具(N) / 删除工具(M) / 分隔 / 手动绘制边线工具 / 重置(`Mesh.tool.reset`)
 *   - 密度行：密度(`Mesh.tool.density`) 1~5 + 自动生成边线(`Mesh.tool.autoOutline`) + 顶点数(`Mesh.tool.info`)
 *
 * 只负责渲染与回传事件；状态（工具 / 变形 / 密度 / 编辑槽位）全由宿主 `App` 持有。
 */
import type { ToolId } from './chrome';
import { Icon } from './icons';

export interface MeshEditorBarProps {
  /** 正在编辑的网格槽位（仅用于提示与 e2e 钩子） */
  slot: string;
  /** 官方 `Mesh.tool.info`：顶点数 */
  vertexCount: number;
  tool: ToolId;
  onTool: (id: ToolId) => void;
  /** 官方 `Mesh.tool.deform`：勾选=编辑变形层(FFD)；不勾=编辑基础网格并隐藏其它显示对象 */
  deform: boolean;
  onDeform: (value: boolean) => void;
  density: number;
  onDensity: (value: number) => void;
  onAutoOutline: () => void;
  onReset: () => void;
  onClose: () => void;
}

/** 三个工具按钮（图标 + 快捷键 + 文案）。 */
const TOOL_BUTTONS: Array<{ id: ToolId; icon: string; label: string; hint: string }> = [
  { id: 'mesh', icon: 'cursor', label: '编辑工具 (B)', hint: '拖动网格顶点' },
  { id: 'meshAdd', icon: 'meshPlus', label: '添加工具 (N)', hint: '在边线上插入顶点' },
  { id: 'meshDelete', icon: 'meshMinus', label: '删除工具 (M)', hint: '删除顶点及相关三角形' },
];

export function MeshEditorBar({
  slot, vertexCount, tool, onTool, deform, onDeform, density, onDensity, onAutoOutline, onReset, onClose,
}: MeshEditorBarProps) {
  return (
    <div className="mesh-editor-bar" data-mesh-editor-bar={slot}>
      <div className="meb-head">
        <Icon name="mesh" size={12} />
        <span className="meb-title">编辑网格</span>
        <label
          className="meb-deform"
          title="勾选后拖动顶点写变形关键帧；不勾选则编辑基础网格，并只显示当前网格"
        >
          <input
            type="checkbox"
            data-mesh-deform={deform ? '1' : '0'}
            checked={deform}
            onChange={(event) => onDeform(event.target.checked)}
          />
          变形
        </label>
        <button className="meb-close" data-mesh-close="" title="退出网格编辑" onClick={onClose}>
          <Icon name="x" size={11} />
        </button>
      </div>
      <div className="meb-row">
        {TOOL_BUTTONS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`meb-tool${tool === entry.id ? ' active' : ''}`}
            data-mesh-tool={entry.id}
            title={`${entry.label}：${entry.hint}`}
            onClick={() => onTool(entry.id)}
          >
            <Icon name={entry.icon} size={14} />
          </button>
        ))}
        <span className="meb-sep" />
        <button
          type="button"
          className={`meb-tool${tool === 'meshOutline' ? ' active' : ''}`}
          data-mesh-tool="meshOutline"
          title="手动绘制边线：依次点轮廓点，点回起点闭合即重建网格；进入后只显示当前网格"
          onClick={() => onTool('meshOutline')}
        >
          <Icon name="grid" size={14} />
        </button>
        <button
          type="button"
          className="meb-tool"
          data-mesh-reset-bar=""
          title="重置：还原为覆盖整张图片的 4 个角点"
          onClick={onReset}
        >
          <Icon name="reset" size={14} />
        </button>
      </div>
      <div className="meb-row">
        <span className="meb-label">密度</span>
        <input
          type="number"
          min={1}
          max={5}
          step={1}
          className="meb-density"
          data-mesh-density-bar=""
          title="密度 1~5：数值越大边线点越多"
          value={density}
          onChange={(event) => onDensity(Math.max(1, Math.min(5, Math.round(Number(event.target.value) || 1))))}
        />
        <button
          type="button"
          className="meb-tool"
          data-mesh-auto-bar=""
          title="自动生成边线：按密度重新生成网格轮廓"
          onClick={onAutoOutline}
        >
          <Icon name="mesh" size={14} />
        </button>
        <span className="meb-info" data-mesh-info={vertexCount}>顶点数：{vertexCount}</span>
      </div>
    </div>
  );
}
