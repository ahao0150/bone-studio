import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './icons';
import { t } from '../i18n';

export type ToolId =
  | 'select' | 'pose' | 'bone' | 'weight'
  | 'move' | 'rotate' | 'scale' | 'free'
  | 'mesh' | 'meshAdd' | 'meshDelete' | 'meshEdge' | 'meshOutline'
  | 'pan';

export interface ToolDef {
  id: ToolId;
  name: string;
  key: string;
  icon: string;
  hint: string;
}

/** Tool list follows the original DragonBones single-key bindings. */
export const TOOLS: ToolDef[] = [
  { id: 'select', name: '选择', key: 'Q', icon: 'cursor', hint: '选择骨骼 / 槽位 / 显示对象' },
  { id: 'pose', name: '姿态', key: 'W', icon: 'star', hint: '调整姿态，改动自动写关键帧' },
  { id: 'bone', name: '创建骨骼', key: 'E', icon: 'bone', hint: '绘制新骨骼（M2 里程碑）' },
  { id: 'weight', name: '权重', key: 'R', icon: 'drop', hint: '网格权重绘制（M4 里程碑）' },
  { id: 'move', name: '平移', key: 'Z', icon: 'move', hint: '平移骨骼（拖动写关键帧）' },
  { id: 'rotate', name: '旋转', key: 'X', icon: 'rotate', hint: '拖骨片旋转（红拨杆同效）' },
  { id: 'scale', name: '缩放', key: 'C', icon: 'scale', hint: '拖绿块 / 骨片自由缩放（宽高各改各的）' },
  { id: 'free', name: '自由变换', key: 'V', icon: 'free', hint: '黄点缩放，红绿箭头分轴平移，按住骨片自由平移' },
  // 网格三工具是上下文快捷键：进入网格模式后 B/N/M 才切换它们，非网格模式下 B/N/M 是选父/子/兄弟
  { id: 'mesh', name: '网格编辑', key: 'B', icon: 'mesh', hint: '拖动网格顶点（网格模式下 B）' },
  { id: 'meshAdd', name: '添加网格点', key: 'N', icon: 'meshPlus', hint: '在网格边线上插入顶点（网格模式下 N）' },
  { id: 'meshDelete', name: '删除网格点', key: 'M', icon: 'meshMinus', hint: '删除网格顶点与相关三角形（网格模式下 M）' },
  // 官方 TOOL_ADD_EDGE(9)：两点画一条手绘边（点已有边则删除）
  { id: 'meshEdge', name: '添加边线', key: 'K', icon: 'grid', hint: '依次点两个顶点画一条边线；点已有的边线则删除它' },
  // 官方 TOOL_OUTLINE(3) / Mesh.tool.outline：连续点轮廓，点回起点闭合后重建网格
  { id: 'meshOutline', name: '重绘网格边线', key: 'L', icon: 'grid', hint: '依次点击轮廓点，点回起点闭合即重建网格（会清空已有点 / 权重 / FFD 关键帧）' },
  { id: 'pan', name: '抓手', key: 'H', icon: 'hand', hint: '拖动舞台（或鼠标中键；时间轴聚焦时 H = 下一关键帧）' },
];

/** 播放中锁死的工具。适应窗口不在这张表里，播放时仍可用。 */
export const PLAYBACK_LOCKED_TOOLS: readonly ToolId[] = TOOLS.map((entry) => entry.id);

/**
 * 会改网格拓扑或边线的工具。动画制作里锁住。
 * `mesh`（拖顶点）不在这里：动画模式下它写的是 FFD 偏移，不改基础网格。
 */
export const STRUCTURE_MESH_TOOLS: readonly ToolId[] = ['meshAdd', 'meshDelete', 'meshEdge', 'meshOutline'];

export interface ToolLock {
  ids: readonly ToolId[];
  reason: string;
}

export function ToolRail({
  tool, onTool, onFit, locks,
}: {
  tool: ToolId;
  onTool: (id: ToolId) => void;
  onFit: () => void;
  /** 按顺序匹配，先命中的原因生效（播放锁放前面）。 */
  locks?: readonly ToolLock[];
}) {
  const reasonFor = (id: ToolId): string | undefined => {
    for (const lock of locks ?? []) {
      if (lock.ids.includes(id)) return lock.reason;
    }
    return undefined;
  };
  return (
    <div className="toolrail">
      {TOOLS.map((entry) => {
        const reason = reasonFor(entry.id);
        return (
        <button
          key={entry.id}
          data-tool={entry.id}
          className={entry.id === tool ? 'active' : ''}
          disabled={reason !== undefined}
          title={reason
            ? `${t(entry.name)} (${entry.key}) — ${reason}`
            : `${t(entry.name)} (${entry.key}) — ${t(entry.hint)}`}
          onClick={() => { if (!reason) onTool(entry.id); }}
        >
          <Icon name={entry.icon} size={15} />
        </button>
        );
      })}
      <div className="rail-sep" />
      <button title="适应窗口 (F)" onClick={onFit}><Icon name="fit" size={15} /></button>
    </div>
  );
}

export interface MenuEntry {
  label?: string;
  accel?: string;
  onSelect?: () => void;
  disabled?: boolean;
  checked?: boolean;
  kind?: 'item' | 'sep';
}

export interface MenuDef {
  label: string;
  items: MenuEntry[];
}

export function MenuBar({
  title, menus, editMode, onEditMode, showEditMode = true, allowArmatureMode = true, right,
}: {
  title: string;
  menus: MenuDef[];
  /** 官方 StagePanel.ArmatureMode / StagePanel.AnimationMode 的编辑模式机（Ctrl+Tab 切换） */
  editMode: 'armature' | 'animation';
  onEditMode: (mode: 'armature' | 'animation') => void;
  /** 欢迎页不显示「骨架装配 / 动画制作」 */
  showEditMode?: boolean;
  /** 序列帧元件没有骨架可装配，顶栏不提供「骨架装配」 */
  allowArmatureMode?: boolean;
  right?: ReactNode;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!hostRef.current?.contains(event.target as Node)) setOpen(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="menubar" ref={hostRef}>
      <span className="brand"><Icon name="logo" size={15} />{title}</span>
      {menus.map((menu) => (
        <div key={menu.label} className={`menu-item${open === menu.label ? ' open' : ''}`}>
          <button
            onClick={() => setOpen(open === menu.label ? null : menu.label)}
            onMouseEnter={() => { if (open) setOpen(menu.label); }}
          >
            {t(menu.label)}
          </button>
          {open === menu.label && (
            <div className="menu-pop">
              {menu.items.map((entry, index) => entry.kind === 'sep' ? (
                <hr key={`sep-${index}`} />
              ) : (
                <button
                  key={entry.label}
                  disabled={entry.disabled}
                  onClick={() => { setOpen(null); entry.onSelect?.(); }}
                >
                  <span>{entry.checked ? '✓ ' : ''}{t(entry.label ?? '')}</span>
                  {entry.accel && <kbd>{entry.accel}</kbd>}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      <div className="spacer" style={{ flex: 1 }} />
      {showEditMode && (
        <div className="workbar" style={{ marginRight: 10 }}>
          {([['armature', '骨架装配'], ['animation', '动画制作']] as const)
            .filter(([id]) => allowArmatureMode || id !== 'armature')
            .map(([id, name]) => (
            <button
              key={id}
              className={`worklink${editMode === id ? ' active' : ''}`}
              onClick={() => onEditMode(id)}
              title={allowArmatureMode ? `${name}（Ctrl+Tab 切换）` : name}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      {right}
    </div>
  );
}

export function Tabs({
  tabs, active, onChange, tools,
}: {
  tabs: Array<{ id: string; name: string }>;
  active: string;
  onChange: (id: string) => void;
  tools?: ReactNode;
}) {
  return (
    <div className="tabs">
      {tabs.map((tab) => (
        <button key={tab.id} data-tab={tab.id} className={tab.id === active ? 'active' : ''} onClick={() => onChange(tab.id)}>
          {t(tab.name)}
        </button>
      ))}
      {tools && <div className="tab-tools">{tools}</div>}
    </div>
  );
}

export function Panel({
  title, icon, actions, children, className, bodyClassName,
}: {
  title: string;
  icon?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div className={`panel${className ? ` ${className}` : ''}`}>
      <div className="panel-head">
        {icon && <Icon name={icon} size={13} />}
        <span className="panel-title">{t(title)}</span>
        <span className="spacer" />
        {actions}
      </div>
      <div className={`panel-body${bodyClassName ? ` ${bodyClassName}` : ''}`}>{children}</div>
    </div>
  );
}

export function HeadButton({
  icon, title, onClick, active, dataHook, disabled, pressed,
}: {
  icon: string; title: string; onClick?: () => void; active?: boolean; dataHook?: string;
  disabled?: boolean;
  /** 两态按钮（如「智能过滤」）：渲染 `aria-pressed` 与 `data-pressed`，供端到端断言 */
  pressed?: boolean;
}) {
  return (
    <button
      className="head-btn"
      data-head-btn={dataHook}
      data-pressed={pressed === undefined ? undefined : (pressed ? 'on' : 'off')}
      aria-pressed={pressed}
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={active ? { color: '#cfe3ff', background: '#1a3c66' } : undefined}
    >
      <Icon name={icon} size={13} />
    </button>
  );
}

export function StatusBar({ children }: { children: ReactNode }) {
  return <div className="statusbar">{children}</div>;
}

export function Check({
  checked, onChange, label,
}: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}


