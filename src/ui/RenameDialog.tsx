/**
 * 场景树双击重命名（骨骼 / 插槽）。
 *
 * 文案与布局对齐 DragonBones 的「重新命名」输入窗（标题「重新命名」、提示
 * 「请输入新的名字」、「取消 / 确定」）。重命名内核不在这个组件里：确定后交给
 * 调用方派发到 `core/editing.ts#renameBone` 或 `core/slotEdit.ts#renameSlot`，
 * 两个内核都会连带改名所有引用（子骨骼、slot.parent、时间轴、IK 约束）。
 *
 * 这里只做本地即时校验（空名 / 与同类对象重名），让「确定」在明显不合法时就禁用，
 * 不至于提交后才弹错；真正的唯一性仍由内核兜底。
 */
import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';

export interface RenameDialogProps {
  /** 双击的是骨骼行还是插槽行（只影响标题图标） */
  kind: 'bone' | 'slot';
  /** 当前名字：预填并全选，方便直接覆盖输入 */
  current: string;
  /** 同类其它对象的现有名字，用于即时查重 */
  taken?: string[];
  onSubmit: (next: string) => void;
  onClose: () => void;
}

export function RenameDialog({ kind, current, taken = [], onSubmit, onClose }: RenameDialogProps) {
  const [name, setName] = useState(current);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 打开就聚焦并全选原名：官方窗口也是预填当前名字，直接敲字即覆盖。
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  const trimmed = name.trim();
  const empty = trimmed.length === 0;
  const unchanged = trimmed === current;
  const conflict = !empty && !unchanged && taken.includes(trimmed);
  const canSubmit = !empty && !unchanged && !conflict;

  // Enter：名字合法就提交；没改名字等于确认原名，直接关掉；空名 / 撞名则原地不动。
  const submit = () => {
    if (canSubmit) { onSubmit(trimmed); return; }
    if (unchanged) onClose();
  };
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();

  return (
    <div
      className="rename-dialog"
      data-rename-dialog=""
      data-rename-kind={kind}
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 97, display: 'grid', placeItems: 'center', background: 'rgba(0, 0, 0, 0.45)' }}
    >
      <div onClick={stop} className="panel rename-panel" style={{ width: 360, border: '1px solid var(--line-strong)' }}>
        <div className="panel-head">
          <Icon name={kind === 'slot' ? 'layers' : 'bone'} size={13} />
          <span className="panel-title">重新命名</span>
          <span className="spacer" />
          <span className="muted" style={{ fontSize: 11 }}>{kind === 'slot' ? '插槽' : '骨骼'}</span>
          <button className="head-btn" data-rename-close="" title="关闭" onClick={onClose}><Icon name="x" size={13} /></button>
        </div>
        <div className="panel-body rename-body" style={{ padding: 12, display: 'grid', gap: 10 }}>
          <span className="muted" data-rename-hint="" style={{ fontSize: 11 }}>请输入新的名字</span>
          <input
            ref={inputRef}
            data-rename-input=""
            type="text"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
              if (event.key === 'Escape') onClose();
            }}
          />
          {conflict && <span className="rename-error" data-rename-error="">已经有同名的{kind === 'slot' ? '插槽' : '骨骼'}了！</span>}
          <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <button className="chip" data-rename-cancel="" onClick={onClose}>取消</button>
            <button className="chip" data-rename-ok="" disabled={!canSubmit} onClick={() => onSubmit(trimmed)}>确定</button>
          </div>
        </div>
      </div>
    </div>
  );
}
