/**
 * 帮助弹窗（官方 `Menu.Help.*`）。
 *
 * 三块内容对应官方入口：
 *   - `Menu.Help.LearnDB`   学习 DragonBones → 离线环境下给本地规格/文档索引
 *   - `Menu.Help.About`     关于 → 版本与清洁室说明
 *   - 快捷键速查（官方 `docs/DBPRO-SPEC.md` §7 的权威快捷键表）
 */
import { Icon } from './icons';

export type HelpTopic = 'shortcuts' | 'about' | 'learn';

const SHORTCUTS: Array<[string, string]> = [
  ['Q / W / E / R', '选择 · 姿态 · 创建骨骼 · 权重'],
  ['Z / X / C / V', '平移 · 旋转 · 缩放 · 自由变换'],
  ['B / N / M', '网格编辑 · 加点 · 删点（进入网格模式后）'],
  ['L', '手动绘制边线（自定义线）'],
  ['H', '抓手（时间轴聚焦时 = 下一个关键帧）'],
  ['T / G', '前一帧 / 后一帧'],
  ['Y / H', '上一个 / 下一个关键帧'],
  ['J / K', '添加补间 / 添加关键帧'],
  ['空格', '播放 / 暂停'],
  ['方向键', '微调选中对象（Shift 加速 · Ctrl 精细）'],
  ['= / -', '前置 / 后置层级（Ctrl 变体为置顶 / 置底）'],
  ['1..0', '应用组（Ctrl+1..0 存组）'],
  ['F2', '重命名'],
  ['Ctrl+O / Ctrl+N / Ctrl+S', '打开文件 · 新建项目 · 保存项目(.dbproj)'],
  ['Ctrl+E', '导出骨架 JSON'],
  ['Ctrl+Z / Ctrl+Y', '撤销 / 重做'],
  ['Ctrl+Shift+C / Ctrl+Shift+V', '复制 / 粘贴变换'],
  ['Ctrl+B / Ctrl+I', '显示骨骼 / 显示图片'],
  ['Ctrl+; / Ctrl+Alt+;', '隐藏参考线 / 启用参考线'],
  ['Ctrl+,', '偏好设置'],
];

const DOCS: Array<[string, string]> = [
  ['docs/OSS-REFERENCES.md', '开源语料清单与许可（运行时、工具链、文档站）'],
  ['docs/MCP.md', '给 agent 用的 MCP 接口'],
  ['docs/UX-DESIGN.md', '界面设计规范'],
  ['docs/PACKAGING.md', '打包形态与性能预算'],
];

export function HelpDialog({
  topic, onTopic, onClose,
}: {
  topic: HelpTopic;
  onTopic: (topic: HelpTopic) => void;
  onClose: () => void;
}) {
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  const tabs: Array<{ id: HelpTopic; label: string }> = [
    { id: 'shortcuts', label: '快捷键速查' },
    { id: 'learn', label: '学习 DragonBones' },
    { id: 'about', label: '关于' },
  ];
  return (
    <div
      data-help-dialog=""
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 95, display: 'grid', placeItems: 'center', background: 'rgba(0, 0, 0, 0.45)' }}
    >
      <div onClick={stop} className="panel" style={{ minWidth: 520, maxWidth: 680, border: '1px solid var(--line-strong)' }}>
        <div className="panel-head">
          <Icon name="info" size={13} />
          <span className="panel-title">帮助</span>
          <span className="spacer" />
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`chip${tab.id === topic ? ' on' : ''}`}
              onClick={() => onTopic(tab.id)}
            >
              {tab.label}
            </button>
          ))}
          <button className="head-btn" title="关闭" onClick={onClose}><Icon name="x" size={13} /></button>
        </div>
        <div className="panel-body" style={{ padding: 10, display: 'grid', gap: 8, maxHeight: '60vh', overflow: 'auto' }}>
          {topic === 'shortcuts' && (
            <>
              <div className="muted" style={{ fontSize: 11 }}>
                与官方 `hotkeys.txt` 对齐（同一张表也写在 docs/DBPRO-SPEC.md §7）。
              </div>
              {SHORTCUTS.map(([keys, what]) => (
                <div className="prop-row" key={keys} style={{ gridTemplateColumns: '190px 1fr' }}>
                  <span className="label" style={{ fontFamily: 'var(--mono)' }}>{keys}</span>
                  <span className="muted">{what}</span>
                </div>
              ))}
            </>
          )}
          {topic === 'learn' && (
            <>
              <div className="muted" style={{ fontSize: 11, lineHeight: 1.7 }}>
                官方「学习 DragonBones」指向在线教程 —— 离线版本没有对应服务端，因此这里给出**本地规格与文档索引**：
                它们记录了本项目的格式验证过程、数据格式与行为对照，等价于这个复刻版的"说明书"。
              </div>
              {DOCS.map(([path, what]) => (
                <div className="prop-row" key={path} style={{ gridTemplateColumns: '230px 1fr' }}>
                  <span className="label" style={{ fontFamily: 'var(--mono)' }}>{path}</span>
                  <span className="muted">{what}</span>
                </div>
              ))}
            </>
          )}
          {topic === 'about' && (
            <>
              <div className="prop-row" style={{ gridTemplateColumns: '150px 1fr' }}>
                <span className="label">版本</span>
                <span className="muted">BoneStudio v0.2</span>
              </div>
              <div className="prop-row" style={{ gridTemplateColumns: '150px 1fr' }}>
                <span className="label">方式</span>
                <span className="muted">独立实现：不搬运任何第三方实现代码</span>
              </div>
              <div className="prop-row" style={{ gridTemplateColumns: '150px 1fr' }}>
                <span className="label">兼容</span>
                <span className="muted">DragonBones 5.x 骨架 / dbbin / 图集 / .dbproj</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
