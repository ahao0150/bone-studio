/**
 * 只读（观看 agent 编辑）模式的唯一守卫。
 *
 * 编辑器所有会改数据的入口都过这里：
 *  - `guard(action, fn)`：命令层包装（舞台拖拽、属性提交、关键帧编辑、撤销/重做、保存/导出/导入、写历史）；
 *  - `allowTool` / `allowKey`：工具栏与快捷键白名单（选择、平移、缩放、播放/暂停、逐帧、拖动播放头）；
 *  - `installDomGuard`：捕获阶段拦截标记区域（属性面板等）的输入事件并把控件置为 disabled；
 *  - App 另有一张数据「完整性网」：只读时任何不是 live 同步带来的骨架改动都会被还原（见 App.tsx）。
 * 纯模块，无 React 依赖，便于单测。
 */
let readonly = false;
let onBlocked: ((action: string) => void) | null = null;

export function setReadonly(value: boolean, blocked?: (action: string) => void): void {
  readonly = value;
  onBlocked = blocked ?? onBlocked;
}
export function isReadonly(): boolean { return readonly; }

/** 只读时拒绝并通知；返回 true 表示可以写 */
export function assertWritable(action: string): boolean {
  if (!readonly) return true;
  onBlocked?.(action);
  return false;
}

/** 命令包装：只读时变成提示 no-op（返回 undefined） */
export function guard<A extends unknown[], R>(action: string, fn: (...args: A) => R): (...args: A) => R | undefined {
  return (...args: A) => (assertWritable(action) ? fn(...args) : undefined);
}

export const READONLY_TOOLS = ['select', 'pan'] as const;
export function allowTool(tool: string): boolean {
  return !readonly || (READONLY_TOOLS as readonly string[]).includes(tool);
}

/**
 * 只读时允许的按键：空格（播放/暂停）、t/g 与 ←/→（逐帧）、y/u 关键帧跳转、Home/End、
 * f（适应窗口）、q（选择）、h（平移）、Ctrl+= / Ctrl+- / Ctrl+0（缩放）、Esc、F1、Ctrl+Tab 不允许（切换模式会触发编辑态）。
 */
export function allowKey(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }): boolean {
  if (!readonly) return true;
  const key = e.key.toLowerCase();
  const meta = !!(e.ctrlKey || e.metaKey);
  if (meta) return ['=', '+', '-', '0'].includes(key);
  if (e.altKey) return false;
  return [' ', 't', 'g', 'y', 'u', 'f', 'q', 'h', 'arrowleft', 'arrowright', 'home', 'end', 'escape', 'f1', 'shift', 'control', 'meta', 'alt'].includes(key);
}

const EDIT_EVENTS = ['beforeinput', 'input', 'change', 'paste', 'cut', 'drop', 'dblclick', 'contextmenu'] as const;

/** 在 root 上装捕获阶段拦截：`[data-ro-block]` 区域内的编辑事件全部吞掉，控件置 disabled。返回卸载函数。 */
export function installDomGuard(root: HTMLElement, notify: (action: string) => void): () => void {
  const inBlock = (t: EventTarget | null) => (t instanceof Element ? t.closest('[data-ro-block]') : null);
  const stop = (event: Event) => {
    if (!readonly) return;
    const blockAll = event.type === 'contextmenu' || event.type === 'drop';
    if (!blockAll && !inBlock(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.type !== 'beforeinput') notify(event.type);
  };
  for (const t of EDIT_EVENTS) root.addEventListener(t, stop, true);
  const pointer = (event: Event) => {
    if (!readonly) return;
    const el = event.target instanceof Element ? event.target.closest('button, input, select, textarea, [contenteditable], [role="slider"]') : null;
    if (el && inBlock(el)) { event.preventDefault(); event.stopPropagation(); }
  };
  root.addEventListener('pointerdown', pointer, true);
  root.addEventListener('click', pointer, true);
  const disableAll = () => {
    if (!readonly) return;
    root.querySelectorAll('[data-ro-block] input, [data-ro-block] select, [data-ro-block] textarea, [data-ro-block] button').forEach((el) => {
      if (!(el as HTMLInputElement).disabled) { (el as HTMLInputElement).disabled = true; el.setAttribute('data-ro-disabled', ''); }
    });
  };
  disableAll();
  const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(disableAll) : null;
  mo?.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled'] });
  return () => {
    for (const t of EDIT_EVENTS) root.removeEventListener(t, stop, true);
    root.removeEventListener('pointerdown', pointer, true);
    root.removeEventListener('click', pointer, true);
    mo?.disconnect();
  };
}
