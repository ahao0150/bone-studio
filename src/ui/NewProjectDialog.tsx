/**
 * 新建工程弹窗 —— 让用户先选**工程类型**再创建。
 *
 * 两条路径对应官方两种 armature 类型（`core/project/newProject.ts`）：
 *   - `armature`「骨骼动画」：1 根 root 骨骼，空的 skin / animation，可直接建骨骼、插槽、动画；
 *   - `sheet`「序列帧」：`type = "sheet"`，带一个空的帧槽位 `sheetSlot`，
 *     底部 dock 会换成「序列帧」面板（官方 `Menu.Window.SheetPanel`）。
 */
import { Icon } from './icons';

export type NewProjectKind = 'armature' | 'sheet';

export interface NewProjectDialogProps {
  onPick: (kind: NewProjectKind) => void;
  onClose: () => void;
}

export function NewProjectDialog({ onPick, onClose }: NewProjectDialogProps) {
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  return (
    <div
      data-new-project-dialog=""
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 96, display: 'grid', placeItems: 'center', background: 'rgba(0, 0, 0, 0.45)' }}
    >
      <div onClick={stop} className="panel" style={{ width: 470, border: '1px solid var(--line-strong)' }}>
        <div className="panel-head">
          <Icon name="plus" size={13} />
          <span className="panel-title">新建工程</span>
          <span className="spacer" />
          <button className="head-btn" title="关闭" onClick={onClose}><Icon name="x" size={13} /></button>
        </div>
        <div className="panel-body" style={{ padding: 12, display: 'grid', gap: 10 }}>
          <div className="row" style={{ gap: 10 }}>
            <button className="new-project-card" data-new-project="armature" onClick={() => onPick('armature')}>
              <Icon name="bone" size={20} />
              <b>骨骼动画</b>
              <span className="muted">1 根 root 骨骼，可直接创建骨骼 / 插槽 / 动画</span>
            </button>
            <button className="new-project-card" data-new-project="sheet" onClick={() => onPick('sheet')}>
              <Icon name="grid" size={20} />
              <b>序列帧</b>
              <span className="muted">带一个空的帧槽位 sheetSlot，在底部「序列帧」面板里排帧</span>
            </button>
          </div>
          <span className="muted" style={{ fontSize: 11 }}>
            工程类型写在 <code>armature.type</code> 上：骨骼动画是 <code>Armature</code>，序列帧是 <code>sheet</code>。
          </span>
        </div>
      </div>
    </div>
  );
}