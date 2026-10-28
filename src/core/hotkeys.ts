/**
 * 可自定义快捷键（官方 `Setting.hotkey` / `Setting.hotkey.set` / `Setting.hotkey.default`，见 `格式规范` §65）。
 *
 * 模型：每个动作有稳定 id + 默认键；用户改动只存 `{ [id]: keys }` 覆盖表（localStorage）。
 * 键串统一走 `normalizeKey`（小写、修饰键按 ctrl+alt+shift 顺序、空格写 `space`），
 * 所以比较是纯字符串相等，冲突检测也是。
 *
 * **不纳入自定义**：上下文键（网格模式下 B/N/M 是加点删点、非网格模式是选择父/子/兄弟；
 * H 在时间轴聚焦时是"下一个关键帧"）—— 这些留给编辑器按上下文决定，避免一个键两种含义被改乱。
 */

export interface HotkeyAction {
  id: string;
  label: string;
  group: string;
  /** 默认键串，见 `normalizeKey` */
  keys: string;
}

export const DEFAULT_HOTKEYS: HotkeyAction[] = [
  { id: 'tool.select', label: '选择工具', group: '工具', keys: 'q' },
  { id: 'tool.pose', label: '姿态工具', group: '工具', keys: 'w' },
  { id: 'tool.bone', label: '创建骨骼', group: '工具', keys: 'e' },
  { id: 'tool.weight', label: '权重工具', group: '工具', keys: 'r' },
  { id: 'tool.move', label: '平移', group: '工具', keys: 'z' },
  { id: 'tool.rotate', label: '旋转', group: '工具', keys: 'x' },
  { id: 'tool.scale', label: '缩放', group: '工具', keys: 'c' },
  { id: 'tool.free', label: '自由变换', group: '工具', keys: 'v' },
  { id: 'view.fit', label: '适应窗口', group: '视图', keys: 'f' },
  { id: 'play.toggle', label: '播放 / 暂停', group: '播放', keys: 'space' },
  { id: 'frame.prev', label: '前一帧', group: '播放', keys: 't' },
  { id: 'frame.next', label: '后一帧', group: '播放', keys: 'g' },
  { id: 'key.prev', label: '上一个关键帧', group: '关键帧', keys: 'y' },
  { id: 'key.toggle', label: '打关键帧', group: '关键帧', keys: 'k' },
  { id: 'key.tween', label: '添加补间', group: '关键帧', keys: 'j' },
  { id: 'layer.forward', label: '移到上一层', group: '层级', keys: '=' },
  { id: 'layer.backward', label: '移到下一层', group: '层级', keys: '-' },
];

export const HOTKEY_STORAGE_KEY = 'bonestudio.hotkeys';

const SPECIAL: Record<string, string> = {
  ' ': 'space', spacebar: 'space', enter: 'enter', escape: 'escape', tab: 'tab',
  delete: 'delete', del: 'delete', backspace: 'backspace', arrowleft: 'arrowleft', arrowright: 'arrowright',
  arrowup: 'arrowup', arrowdown: 'arrowdown', '+': '=', '_': '-',
};

/** 把键盘事件归一成键串：`q` / `ctrl+shift+c` / `space` / `delete` */
export function normalizeKey(event: { key: string; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; metaKey?: boolean }): string {
  const raw = String(event.key ?? '').toLowerCase();
  const base = SPECIAL[raw] ?? SPECIAL[event.key ?? ''] ?? raw;
  if (base === 'control' || base === 'shift' || base === 'alt' || base === 'meta') return '';
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('ctrl');
  if (event.altKey) parts.push('alt');
  if (event.shiftKey) parts.push('shift');
  parts.push(base);
  return parts.join('+');
}

/** 读 localStorage 里的覆盖表（坏数据一律忽略） */
export function readHotkeys(storage: Pick<Storage, 'getItem'>): Record<string, string> {
  try {
    const raw = storage.getItem(HOTKEY_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [id, keys] of Object.entries(parsed ?? {})) {
      if (typeof keys === 'string' && keys) out[id] = keys;
    }
    return out;
  } catch {
    return {};
  }
}

export function writeHotkeys(storage: Pick<Storage, 'setItem'>, overrides: Record<string, string>): void {
  storage.setItem(HOTKEY_STORAGE_KEY, JSON.stringify(overrides));
}

/** 某个动作**当前生效**的键（覆盖优先，其次默认） */
export function bindingOf(actionId: string, overrides: Record<string, string>): string {
  return overrides[actionId] ?? DEFAULT_HOTKEYS.find((entry) => entry.id === actionId)?.keys ?? '';
}

/** 与别的动作撞键时返回那个动作的 id（`actionId` 自己被忽略） */
export function findConflict(actionId: string, keys: string, overrides: Record<string, string>): string | null {
  for (const action of DEFAULT_HOTKEYS) {
    if (action.id === actionId) continue;
    if (bindingOf(action.id, overrides) === keys) return action.id;
  }
  return null;
}

/** 事件命中了哪个动作（无命中返回 null） */
export function matchHotkey(event: Parameters<typeof normalizeKey>[0], overrides: Record<string, string>): string | null {
  const keys = normalizeKey(event);
  if (!keys) return null;
  for (const action of DEFAULT_HOTKEYS) {
    if (bindingOf(action.id, overrides) === keys) return action.id;
  }
  return null;
}

export function labelOf(actionId: string): string {
  return DEFAULT_HOTKEYS.find((entry) => entry.id === actionId)?.label ?? actionId;
}
