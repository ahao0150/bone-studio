/**
 * 通用二次确认弹框（删除类操作）。
 *
 * 动画删除、权重骨骼解绑在执行前统一走这里：遮罩 + `.panel` 壳体 + `.chip` 按钮，
 * 按钮文案与「重新命名」窗口一致（取消 / 确定）。
 * 是否弹框由官方 `Setting.DeleteConfirmation` 决定 —— 开关关闭时调用方（`App.tsx`）
 * 直接执行，根本不会渲染这个组件。
 *
 * 这里刻意保持轻量（不入 icon、不挂键盘监听）：`verify:budget` 对入口 chunk 有
 * gzip 预算，首屏组件每多一行都会挤到别的功能。关闭方式是点「取消」或点遮罩。
 */
export interface ConfirmDialogProps {
  /** 面板标题，例如「删除动画」 */
  title: string;
  /** 正文提示，写清删的是什么、会连带什么 */
  message: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({ title, message, onConfirm, onClose }: ConfirmDialogProps) {
  return (
    <div className="confirm-dialog" data-confirm-dialog="" onClick={onClose}>
      <div className="panel confirm-panel" onClick={(event) => event.stopPropagation()}>
        <div className="confirm-body">
          <span className="confirm-title" data-confirm-title="">{title}</span>
          <span className="confirm-message" data-confirm-message="">{message}</span>
          <div className="row">
            <button className="chip" data-confirm-cancel="" onClick={onClose}>取消</button>
            <button className="chip" data-confirm-ok="" autoFocus onClick={onConfirm}>确定</button>
          </div>
        </div>
      </div>
    </div>
  );
}
