import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './icons';
import type { Player } from '../core/player';
import type { BoneChannel, BoneTransformValues, KeyFrameRef } from '../core/editing';
import type { BoneChannelKeys } from '../core/boneChannels';
import { displayChildrenVisible } from '../core/sceneTreeFilter';
import { filterRegions, slotDisplayUsage } from '../core/library';

export interface BoneRow {
  name: string;
  depth: number;
  index: number;
  keys: KeyFrameRef[];
  parent: string;
  /** 时间轴子行（平移 / 旋转 / 缩放）各自的关键帧与补间类型 */
  channels?: BoneChannelKeys;
}

/**
 * Official 场景树 draws a distinct glyph per display-object kind, and its 属性面板 reports
 * the kind as the "类型" row (插槽 for the slot itself, 网格/图片 for its display object).
 */
/** 场景树图标色：骨骼浅色、图片橙、网格青、骨架/包围盒另色。 */
export function sceneKindClass(icon: string): string {
  if (icon === 'bone') return 'bone';
  if (icon === 'image') return 'image';
  if (icon === 'grid') return 'mesh';
  return 'box';
}

export function displayKindOf(player: Player | null, slotName: string, displayIndex: number): { label: string; icon: 'grid' | 'image' | 'mesh' } {
  const display = player?.skeleton.skinSlots.get(slotName)?.display?.[displayIndex];
  if (!display) return { label: '空', icon: 'image' };
  const type = display.type;
  if (type === 'mesh' || type === 2) return { label: '网格', icon: 'grid' };
  if (type === 'armature' || type === 1) return { label: '骨架', icon: 'mesh' };
  if (type === 'boundingBox' || type === 3) return { label: '包围盒', icon: 'mesh' };
  return { label: '图片', icon: 'image' };
}

/** 行首固定列宽：两个 14px 按钮，缩进加在它右边，圆点才能排成竖线。 */
const SCENE_FLAG_GUTTER = 30;

/** 眼睛管显隐，指针管能否选中。开着时 CSS 画成圆点。 */
function SceneFlags({
  id, visible, selectable, onToggleVisible, onToggleSelectable,
}: {
  id: string;
  visible: boolean;
  selectable: boolean;
  onToggleVisible: () => void;
  onToggleSelectable: () => void;
}) {
  return (
    <span className="scene-flags">
      <button
        type="button"
        className={`scene-flag eye${visible ? ' on' : ''}`}
        data-scene-eye={id}
        aria-pressed={visible}
        title={visible ? '隐藏' : '显示'}
        onClick={(event) => { event.stopPropagation(); onToggleVisible(); }}
      >
        <Icon name="eye" size={11} />
      </button>
      <button
        type="button"
        className={`scene-flag pick${selectable ? ' on' : ''}`}
        data-scene-pick={id}
        aria-pressed={selectable}
        title={selectable ? '设为不可选' : '设为可选'}
        onClick={(event) => { event.stopPropagation(); onToggleSelectable(); }}
      >
        <Icon name="cursor" size={11} />
      </button>
    </span>
  );
}

/**
 * 第一层骨架行：图标一直露着（参考图），管下面每一行。
 * 单击 = 全选（全部显示 / 全部可选），Shift+单击 = 反选。
 */
function ArmatureFlags({
  allVisible, allSelectable, onVisible, onSelectable,
}: {
  allVisible: boolean;
  allSelectable: boolean;
  onVisible: (mode: 'all' | 'invert') => void;
  onSelectable: (mode: 'all' | 'invert') => void;
}) {
  const run = (event: { stopPropagation: () => void; shiftKey: boolean }, fn: (mode: 'all' | 'invert') => void) => {
    event.stopPropagation();
    fn(event.shiftKey ? 'invert' : 'all');
  };
  return (
    <span className="scene-flags">
      <button
        type="button"
        className={`scene-flag master eye${allVisible ? ' on' : ''}`}
        data-armature-eye=""
        aria-pressed={allVisible}
        title="全部显示（Shift：显隐反选）"
        onClick={(event) => run(event, onVisible)}
      >
        <Icon name="eye" size={11} />
      </button>
      <button
        type="button"
        className={`scene-flag master pick${allSelectable ? ' on' : ''}`}
        data-armature-pick=""
        aria-pressed={allSelectable}
        title="全部可选（Shift：可选反选）"
        onClick={(event) => run(event, onSelectable)}
      >
        <Icon name="cursor" size={11} />
      </button>
    </span>
  );
}

export function ProjectBrowser({
  player, query, onQuery, selectedBone, onSelectBone, onToggleBoneSelection, selectedBones, rows, selectedSlot, onSelectSlot, selectedSlots, onToggleSlotSelection,
  hiddenSlots, onToggleSlot, hiddenBones, onToggleBoneVisible, lockedBones, lockedSlots, onToggleLockBone, onToggleLockSlot,
  onRenameBone, onRenameSlot,
  onHoverBone, onHoverSlot,
  onArmatureVisible, onArmatureSelectable,
  smartFilter, onToggleSmartFilter,
  revealBone, revealToken,
}: {
  player: Player | null;
  query: string;
  onQuery: (value: string) => void;
  selectedBone: string | null;
  onSelectBone: (name: string) => void;
  /** Ctrl / Shift 点骨骼行时的多选切换 */
  onToggleBoneSelection?: (name: string) => void;
  /** 骨骼多选集合：高亮，以及眼睛 / 指针的批量翻转由调用方按这个集合决定 */
  selectedBones?: Set<string>;
  rows: BoneRow[];
  selectedSlot: string | null;
  onSelectSlot: (name: string) => void;
  /** 插槽多选集合（Ctrl / Shift 点选插槽行时用） */
  selectedSlots?: Set<string>;
  onToggleSlotSelection?: (name: string) => void;
  hiddenSlots: Set<string>;
  onToggleSlot: (name: string) => void;
  /** 骨骼显隐（舞台不画、点不中；树上留着以便再显示） */
  hiddenBones: Set<string>;
  onToggleBoneVisible: (name: string) => void;
  /** 官方右键菜单的「锁定」：锁定的对象在树上点不中，骨骼在舞台上也不可选 */
  lockedBones: Set<string>;
  lockedSlots: Set<string>;
  onToggleLockBone: (name: string) => void;
  onToggleLockSlot: (name: string) => void;
  /** 双击骨骼行 / 插槽行：弹出「重新命名」输入窗（内核 renameBone / renameSlot） */
  onRenameBone?: (name: string) => void;
  onRenameSlot?: (name: string) => void;
  /**
   * 行 hover → 舞台高亮（官方 `StageNotification.ROLLOVER_BONE` / `ROLLOVER_SLOT`，
   * `_586/_588.as:275-307` 骨骼行 / `_555/_558.as:4124-4125` 插槽行）：移入传名字、移出传 null。
   * 骨骼行优先；插槽行与显示对象行都归到各自的插槽。
   */
  onHoverBone?: (name: string | null) => void;
  onHoverSlot?: (name: string | null) => void;
  /** 骨架行：全选（全部打开）或反选（逐个取反）显隐 / 可选 */
  onArmatureVisible: (mode: 'all' | 'invert') => void;
  onArmatureSelectable: (mode: 'all' | 'invert') => void;
  /**
   * 官方「智能过滤」（`ScenePanel.intelligentFilterButton`）：状态在 App（按钮在标题栏），
   * 这里只读它决定要不要列出槽位的显示对象子行。
   */
  smartFilter: boolean;
  onToggleSmartFilter: () => void;
  /**
   * 「定位到某根骨骼」：展开它的祖先链、滚进可视区（官方「点击 IK 目标 = 切换选择集」的落地）。
   * `revealToken` 让**重复点同一个目标**也能再滚一次（值相同不会触发 effect）。
   */
  revealBone?: string | null;
  revealToken?: number;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  /** 官方 `MenuItem-expandAll` / `MenuItem-collapseAll`：树区域右键菜单（`_710/_713.as:94-96`） */
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  // 「定位到骨骼」：先把祖先链从折叠集合里摘掉，再滚进可视区。
  // 行可能因为折叠要等一帧才挂上 DOM，所以用 rAF 小步重试（固定 sleep 会假红）。
  useEffect(() => {
    if (!revealBone) return;
    const bones = rowsRef.current;
    const byName = new Map(bones.map((row) => [row.name, row]));
    if (!byName.has(revealBone)) return;   // 被搜索过滤掉了：不折腾
    const ancestors: string[] = [];
    const guard = new Set<string>();
    let cursor = byName.get(revealBone)?.parent ?? '';
    while (cursor && !guard.has(cursor)) {
      guard.add(cursor);
      ancestors.push(cursor);
      cursor = byName.get(cursor)?.parent ?? '';
    }
    setCollapsed((prev) => {
      if (!ancestors.some((name) => prev.has(name))) return prev;
      const next = new Set(prev);
      for (const name of ancestors) next.delete(name);
      return next;
    });
    let tries = 0;
    let raf = requestAnimationFrame(function step() {
      const el = document.querySelector(`[data-bone-row="${CSS.escape(revealBone)}"]`);
      if (el) { el.scrollIntoView({ block: 'nearest' }); return; }
      if (tries++ < 8) raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
  }, [revealBone, revealToken]);
  const needle = query.trim().toLowerCase();
  const filtered = needle ? rows.filter((row) => row.name.toLowerCase().includes(needle)) : rows;
  const slots = (player?.skeleton.slots ?? []).filter((slot) => !needle || slot.name.toLowerCase().includes(needle));

  const seed = <T,>(map: Map<string, T[]>, key: string, value: T) => {
    const list = map.get(key);
    if (list) list.push(value); else map.set(key, [value]);
  };
  // The official 场景树 nests each slot under the bone it hangs from, so build two trees:
  // child bones by `parent`, and slots by their挂点骨骼 (skip-list style, as before).
  const known = new Set(filtered.map((row) => row.name));
  const childBones = new Map<string, BoneRow[]>();
  const roots: BoneRow[] = [];
  for (const row of filtered) {
    if (row.parent && known.has(row.parent)) seed(childBones, row.parent, row);
    else roots.push(row);
  }
  const childSlots = new Map<string, typeof slots>();
  for (const slot of slots) seed(childSlots, player?.skeleton.bones[slot.parentBone]?.name ?? '', slot);

  /**
   * 行 hover → 舞台高亮（官方 `ROLLOVER_BONE` / `ROLLOVER_SLOT`）。
   * 用容器上的 mouseover 冒泡、而不是逐行绑 `onMouseEnter`：折叠 / 搜索过滤会把行从 DOM 摘掉，
   * 那一刻不会触发 `mouseleave`，逐行绑定会留下残影；容器级监听 + 容器 `mouseleave` 收口更稳。
   */
  const hoverFromPoint = (target: EventTarget | null) => {
    const el = (target as HTMLElement | null)?.closest?.('[data-bone-row],[data-slot-row],[data-display-row]') as HTMLElement | null;
    if (!el) { onHoverBone?.(null); onHoverSlot?.(null); return; }
    const bone = el.getAttribute('data-bone-row');
    if (bone) { onHoverBone?.(bone); onHoverSlot?.(null); return; }
    // 显示对象行写成 `slot#index`：归到同名插槽（官方插槽行派发的就是插槽 vo）
    const slot = el.getAttribute('data-slot-row') ?? el.getAttribute('data-display-row');
    if (slot) { onHoverSlot?.(slot.split('#')[0]); onHoverBone?.(null); }
  };

  const toggle = (name: string) => {
    // 折叠 / 展开会把行子树从 DOM 摘掉，mouseleave 不会触发 —— 顺手清掉外部悬停，免得舞台残留高亮
    onHoverBone?.(null);
    onHoverSlot?.(null);
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const out: ReactNode[] = [];
  const emitBone = (row: BoneRow, depth: number) => {
    const kids = childBones.get(row.name) ?? [];
    const owned = childSlots.get(row.name) ?? [];
    const hasChildren = kids.length > 0 || owned.length > 0;
    const isCollapsed = collapsed.has(row.name);
    const boneHidden = hiddenBones.has(row.name);
    const boneSelected = selectedBones?.has(row.name) || selectedBone === row.name;
    out.push(
      <div
        key={`b-${row.index}`}
        className={`scene-row${boneSelected ? ' selected' : ''}${boneHidden ? ' concealed' : ''}`}
        data-bone-row={row.name}
        style={{ paddingLeft: SCENE_FLAG_GUTTER + 4 + (depth + 1) * 14 }}
        onClick={(event) => {
          if (lockedBones.has(row.name)) return;
          if (event.shiftKey || event.ctrlKey) onToggleBoneSelection?.(row.name);
          else onSelectBone(row.name);
        }}
        onDoubleClick={(event) => {
          // 眼睛 / 指针 / 折叠箭头是 button，双击它们不该弹重命名窗
          if (lockedBones.has(row.name) || (event.target as HTMLElement).closest('button')) return;
          event.stopPropagation();
          onRenameBone?.(row.name);
        }}
        title={row.parent ? `骨骼 · 父级：${row.parent}` : '骨骼 · 根骨骼'}
      >
        <SceneFlags
          id={`bone:${row.name}`}
          visible={!boneHidden}
          selectable={!lockedBones.has(row.name)}
          onToggleVisible={() => onToggleBoneVisible(row.name)}
          onToggleSelectable={() => onToggleLockBone(row.name)}
        />
        {hasChildren ? (
          <button
            className="tree-toggle"
            title={isCollapsed ? `展开 ${row.name}` : `折叠 ${row.name}`}
            onClick={(event) => { event.stopPropagation(); toggle(row.name); }}
          >
            <Icon name={isCollapsed ? 'chevronRight' : 'chevronDown'} size={11} />
          </button>
        ) : <span className="tree-toggle" />}
        <span className="scene-kind bone" title="骨骼"><Icon name="bone" size={12} /></span>
        <span className="tree-name"><span>{row.name}</span></span>
      </div>,
    );
    if (isCollapsed) return;
    for (const kid of kids) emitBone(kid, depth + 1);
    for (const slot of owned) {
      const displays = player?.skeleton.skinSlots.get(slot.name)?.display ?? [];
      const kind = displayKindOf(player, slot.name, slot.displayIndex ?? 0);
      const showDisplays = displayChildrenVisible(displays.length, smartFilter);
      const slotKey = `slot:${slot.name}`;
      const slotCollapsed = collapsed.has(slotKey);
      const slotHidden = hiddenSlots.has(slot.name);
      const slotLocked = lockedSlots.has(slot.name);
      out.push(
        <div
          key={`s-${slot.name}`}
          className={`scene-row${(selectedSlots?.has(slot.name) || selectedSlot === slot.name) ? ' selected' : ''}${slotHidden ? ' concealed' : ''}`}
          data-slot-row={slot.name}
          data-slot-displays={displays.length}
          style={{ paddingLeft: SCENE_FLAG_GUTTER + 4 + (depth + 2) * 14 }}
          onClick={(event) => {
            if (slotLocked) return;
            if (event.shiftKey || event.ctrlKey) onToggleSlotSelection?.(slot.name);
            else onSelectSlot(slot.name);
          }}
          onDoubleClick={(event) => {
            if (slotLocked || (event.target as HTMLElement).closest('button')) return;
            event.stopPropagation();
            onRenameSlot?.(slot.name);
          }}
          title={`${kind.label} · 挂点骨骼：${player?.skeleton.bones[slot.parentBone]?.name ?? '-'}`}
        >
          <SceneFlags
            id={`slot:${slot.name}`}
            visible={!slotHidden}
            selectable={!slotLocked}
            onToggleVisible={() => onToggleSlot(slot.name)}
            onToggleSelectable={() => onToggleLockSlot(slot.name)}
          />
          {showDisplays ? (
            <button
              className="tree-toggle"
              data-slot-expand={slot.name}
              title={slotCollapsed ? `展开 ${slot.name} 的显示对象` : `折叠 ${slot.name} 的显示对象`}
              onClick={(event) => { event.stopPropagation(); toggle(slotKey); }}
            >
              <Icon name={slotCollapsed ? 'chevronRight' : 'chevronDown'} size={11} />
            </button>
          ) : <span className="tree-toggle" />}
          <span className={`scene-kind ${sceneKindClass(kind.icon)}`} title={kind.label}><Icon name={kind.icon} size={12} /></span>
          <span className="tree-name"><span>{slot.name}</span></span>
        </div>,
      );
      if (!showDisplays || slotCollapsed) continue;
      displays.forEach((display, index) => {
        const displayKind = displayKindOf(player, slot.name, index);
        const active = index === (slot.displayIndex ?? 0);
        out.push(
          <div
            key={`d-${slot.name}-${index}`}
            className={`scene-row${selectedSlot === slot.name && active ? ' selected' : ''}${slotHidden ? ' concealed' : ''}`}
            data-display-row={`${slot.name}#${index}`}
            style={{ paddingLeft: SCENE_FLAG_GUTTER + 4 + (depth + 3) * 14 }}
            onClick={() => { if (!slotLocked) onSelectSlot(slot.name); }}
            title={`${displayKind.label}${active ? ' · 使用中' : ''}`}
          >
            <SceneFlags
              id={`slot:${slot.name}`}
              visible={!slotHidden}
              selectable={!slotLocked}
              onToggleVisible={() => onToggleSlot(slot.name)}
              onToggleSelectable={() => onToggleLockSlot(slot.name)}
            />
            <span className="tree-toggle" />
            <span className={`scene-kind ${sceneKindClass(displayKind.icon)}`} title={displayKind.label}><Icon name={displayKind.icon} size={12} /></span>
            <span className="tree-name"><span>{display.name ?? display.path ?? `显示对象 ${index}`}</span></span>
          </div>,
        );
      });
    }
  };
  for (const row of roots) emitBone(row, 0);

  return (
    <>
      <div className="searchbox">
        <Icon name="search" size={12} />
        <input
          value={query}
          placeholder="搜索工程…"
          onChange={(event) => onQuery(event.target.value)}
        />
        {query && <button className="head-btn" onClick={() => onQuery('')} title="清空"><Icon name="x" size={11} /></button>}
      </div>
      <div
        className="scene-tree"
        data-scene-tree=""
        onMouseOver={(event) => hoverFromPoint(event.target)}
        onMouseLeave={() => { onHoverBone?.(null); onHoverSlot?.(null); }}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenuAt({ x: event.clientX, y: event.clientY });
        }}
      >
        {menuAt && (
          <>
            <div className="stage-menu-backdrop" onClick={() => setMenuAt(null)} onContextMenu={(event) => { event.preventDefault(); setMenuAt(null); }} />
            <div className="stage-menu" data-scene-menu="" style={{ left: menuAt.x, top: menuAt.y }}>
              {/* 官方菜单项 `MenuItem-expandAll` / `MenuItem-collapseAll` */}
              <button data-scene-menu-item="expandAll" onClick={() => { setMenuAt(null); setCollapsed(new Set()); }}>展开全部</button>
              <button
                data-scene-menu-item="collapseAll"
                onClick={() => {
                  setMenuAt(null);
                  setCollapsed(new Set([
                    '__armature',
                    ...rows.map((row) => row.name),
                    ...(slots ?? []).map((slot) => `slot:${slot.name}`),
                  ]));
                }}
              >折叠全部</button>
            </div>
          </>
        )}
        {player && (
          <div
            className="scene-row"
            data-armature-row={player.skeleton.armature.name}
            style={{ paddingLeft: SCENE_FLAG_GUTTER + 4 }}
            title="骨架"
          >
            <ArmatureFlags
              allVisible={hiddenBones.size === 0 && hiddenSlots.size === 0}
              allSelectable={lockedBones.size === 0 && lockedSlots.size === 0}
              onVisible={onArmatureVisible}
              onSelectable={onArmatureSelectable}
            />
            <button
              className="tree-toggle"
              title={collapsed.has('__armature') ? '展开骨架' : '折叠骨架'}
              onClick={() => toggle('__armature')}
            >
              <Icon name={collapsed.has('__armature') ? 'chevronRight' : 'chevronDown'} size={11} />
            </button>
            <span className="scene-kind armature" title="骨架"><Icon name="layers" size={12} /></span>
            <span className="tree-name"><span>{player.skeleton.armature.name || 'armature'}</span></span>
          </div>
        )}
        {collapsed.has('__armature') ? null : out}
        {filtered.length === 0 && slots.length === 0 && (
          <div className="hint">{player ? '没有匹配的条目' : '打开工程或载入示例后显示工程结构'}</div>
        )}
      </div>
    </>
  );
}
export function LibraryTable({ player, onImport, highlight }: { player: Player | null; onImport?: () => void; highlight?: string | null }) {
  const [query, setQuery] = useState('');
  /** 素材库的「刷新」：重新统计切片与引用次数（revision 参与 useMemo 依赖） */
  const [revision, setRevision] = useState(0);
  const atlas = player?.atlas;
  const usage = useMemo(
    () => slotDisplayUsage(player?.skeleton.currentSkin()?.slot ?? []),
    [player, revision],
  );
  if (!atlas) return <div className="hint">载入 <code>*_tex.json</code> 后显示图集切片。</div>;
  const regions = filterRegions(atlas.regions, query);
  const citedCount = atlas.regions.filter((region) => usage.has(region.name)).length;
  // 「在资源库中显示」：滚到被点名的那个切片
  useEffect(() => {
    if (!highlight) return;
    const el = document.querySelector(`[data-library-row="${CSS.escape(highlight)}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight, revision]);

  return (
    <div className="table" data-library-revision={revision}>
      <div className="library-bar">
        <input
          data-library-search=""
          value={query}
          placeholder="搜索切片…"
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="muted" data-library-count={`${regions.length}/${atlas.regions.length}`}>{regions.length} / {atlas.regions.length}</span>
        <span style={{ flex: 1 }} />
        <button className="chip" data-library-import="" disabled={!onImport} title="把 PNG 并进当前图集" onClick={() => onImport?.()}>导入到库</button>
        <button className="chip" data-library-refresh="" title="重新统计切片与引用次数" onClick={() => setRevision((value) => value + 1)}>刷新</button>
      </div>
      <div className="table-head" style={{ gridTemplateColumns: '1fr 70px 44px 44px 44px' }}>
        <span>切片</span>
        <span>尺寸</span>
        <span>X</span>
        <span>Y</span>
        <span>引用</span>
      </div>
      {regions.map((region) => (
        <div key={region.name} className={`table-row${region.name === highlight ? ' library-highlight' : ''}`} data-library-row={region.name} data-library-highlight={region.name === highlight ? '1' : undefined} style={{ gridTemplateColumns: '1fr 70px 44px 44px 44px' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{region.name}</span>
          <span className="muted">{region.width}×{region.height}</span>
          <span className="num">{region.x}</span>
          <span className="num">{region.y}</span>
          <span className="num" data-library-usage={usage.get(region.name) ?? 0}>{usage.get(region.name) ?? 0}</span>
        </div>
      ))}
      {regions.length === 0 && <div className="hint">没有匹配「{query}」的切片。</div>}
      <div className="note">
        图集：<code>{atlas.imagePath}</code> · {atlas.regions.length} 个切片 · 被引用 {citedCount} 个
      </div>
    </div>
  );
}

export function InfoPanel({
  player, currentAnimation, stats, atlasRegions, decode,
}: {
  player: Player | null;
  currentAnimation: string;
  stats: { items: number; fps: number; ms: number };
  atlasRegions: number;
  /** `*_ske.dbbin` reader report: recovered surface grids + families still pending */
  decode?: { surfaces: number; pending: string[] } | null;
}) {
  const armature = player?.skeleton.armature;
  const surfaces = player?.skeleton.surfaceInfo() ?? [];
  const rows: Array<[string, string]> = [
    ['骨架', armature?.name ?? '-'],
    ['骨骼 / 槽位', player ? `${player.skeleton.bones.length} / ${player.skeleton.slots.length}` : '-'],
    ['动画', currentAnimation || '-'],
    ['时长（帧）', player ? String(player.duration) : '-'],
    ['帧率', player ? String(player.frameRate) : '-'],
    ['IK 约束', player ? String(player.skeleton.ik?.length ?? 0) : '-'],
    ['图集切片', atlasRegions ? String(atlasRegions) : '-'],
    ['绘制对象', String(stats.items)],
    ['渲染耗时', `${stats.ms.toFixed(1)} ms`],
    ['视口 FPS', stats.fps.toFixed(0)],
  ];
  if (surfaces.length > 0) {
    const worst = surfaces.reduce((max, entry) => Math.max(max, entry.deformMax), 0);
    rows.push(['曲面形变', `${surfaces.length} 个 · 最大位移 ${worst.toFixed(1)}`]);
  }
  if (decode) {
    rows.push(['二进制解析', decode.surfaces > 0 ? `Surface 网格 ×${decode.surfaces}` : '全部支持']);
    if (decode.pending.length > 0) rows.push(['待解码族', decode.pending.join('、')]);
  }
  return (
    <>
      <div className="stat-list">
        {rows.map(([label, value]) => (
          <div className="stat-row" key={label}><span>{label}</span><span>{value}</span></div>
        ))}
      </div>
      <div className="note">
        独立实现，不使用第三方运行时代码。兼容 <code>*_ske.json</code> + <code>*_tex.json</code> +
        Spine <code>.atlas</code>；带权重网格在 CPU 侧做线性混合蒙皮（LBS）。
      </div>
    </>
  );
}

export function PreviewPanel({
  player, loop, onLoop, onTogglePlay, onToStart, onStep, onPrevKey, onNextKey, speed, onSpeed,
}: {
  player: Player | null;
  loop: boolean;
  onLoop: (value: boolean) => void;
  onTogglePlay: () => void;
  onToStart: () => void;
  onStep: (delta: number) => void;
  onPrevKey: () => void;
  onNextKey: () => void;
  speed: number;
  onSpeed: (value: number) => void;
}) {
  const duration = player?.duration ?? 0;
  const cached = Math.round(((player?.position ?? 0) / Math.max(1, duration)) * 100);
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px 4px' }}>
        <div className="transport">
          <button title="回到起点" disabled={!player} onClick={onToStart}><Icon name="toStart" size={12} /></button>
          <button title="上一帧" disabled={!player} onClick={() => onStep(-1)}><Icon name="prevKey" size={12} /></button>
          <button title="播放 / 暂停（空格）" disabled={!player} onClick={onTogglePlay}>
            <Icon name={player?.playing ? 'pause' : 'play'} size={12} />
          </button>
          <button title="下一帧" disabled={!player} onClick={() => onStep(1)}><Icon name="nextKey" size={12} /></button>
          <button title="上一个关键帧" disabled={!player} onClick={onPrevKey}><Icon name="key" size={12} /></button>
          <button title="下一个关键帧" disabled={!player} onClick={onNextKey}><Icon name="key" size={12} /></button>
        </div>
      </div>
      <div className="prop-row" style={{ gridTemplateColumns: '14px 1fr 96px 16px' }}>
        <span className="ico"><Icon name="clock" size={12} /></span>
        <span className="label">循环</span>
        <label className="checkbox" style={{ justifyContent: 'flex-end' }}>
          <input type="checkbox" checked={loop} onChange={(event) => onLoop(event.target.checked)} />
          {loop ? '开启' : '关闭'}
        </label>
        <span />
      </div>
      <div className="prop-row" style={{ gridTemplateColumns: '14px 1fr 96px 16px' }}>
        <span className="ico"><Icon name="dot" size={12} /></span>
        <span className="label">播放速度</span>
        <input
          type="number"
          step={0.1}
          min={0.1}
          max={4}
          value={speed}
          onChange={(event) => onSpeed(Number(event.target.value) || 1)}
        />
        <span />
      </div>
      <div className="cachebar"><i style={{ width: `${cached}%` }} /></div>
      <div className="hint" style={{ paddingTop: 4 }}>
        {player ? `${Math.round(player.position)} / ${duration} 帧已缓存` : '未载入工程'}
      </div>
    </>
  );
}

const FIELDS: Array<{ key: keyof BoneTransformValues; label: string; icon: string; step: number; channel: BoneChannel }> = [
  { key: 'x', label: 'X', icon: 'move', step: 1, channel: 'translate' },
  { key: 'y', label: 'Y', icon: 'move', step: 1, channel: 'translate' },
  { key: 'skX', label: '旋转', icon: 'rotate', step: 1, channel: 'rotate' },
  { key: 'scX', label: '缩放 X', icon: 'scale', step: 0.01, channel: 'scale' },
  { key: 'scY', label: '缩放 Y', icon: 'scale', step: 0.01, channel: 'scale' },
  { key: 'skY', label: '倾斜', icon: 'anchor', step: 1, channel: 'rotate' },
];

export function PropertiesPanel({
  player, boneName, values, keyAtFrame, keyed, onChange, onToggleKey, onReset,
  ik, onAddIk, onRemoveIk, onIkPatch, onBeginIk, animationMode, ikKeyed, onToggleIkKey,
  ikTargetPick, onIkTargetPick, armatureMode, onLocateBone,
  boneLength, onBoneLength, locked, transformLocked, transformSpace, onTransformSpace,
}: {
  player: Player | null;
  boneName: string | null;
  values: BoneTransformValues | null;
  keyAtFrame: boolean;
  /** 三通道各自的「当前帧已有关键帧」状态（旗杆红/白，官方口径）；缺省时退回 `keyAtFrame` */
  keyed?: { translate: boolean; rotate: boolean; scale: boolean } | null;
  onChange: (key: keyof BoneTransformValues, value: number) => void;
  onToggleKey: (channel?: BoneChannel) => void;
  onReset: () => void;
  /**
   * 当前骨骼参与的 IK 约束。`role` 区分它是**链内骨骼**（含链末端与双骨的父级）还是**目标骨骼** ——
   * 官方对两者给两组不同的面板（`_906/_909.as:419-423`：`_1966` 查「作为目标」的约束、
   * `_1981` 查「在链内」的约束，标题分别是 `Property.ik.foldtarget`「IK约束目标」与 `Property.ik.fold`「IK约束」）。
   */
  ik?: {
    name: string; target: string; chain?: number; weight?: number;
    bendPositive?: boolean | number | string; role?: 'chain' | 'target';
  } | null;
  /** 「在骨骼末端生成约束目标」—— 官方 Property.ik.endPick */
  onAddIk?: (chain: number) => void;
  onRemoveIk?: (name: string) => void;
  /**
   * 改 IK 属性（官方 Property.ik.weight / bendDirection）。
   * `withHistory = false` 表示这是一次拖动中的连续改动（撤销点由 `onBeginIk` 在 pointerdown 时记）。
   */
  onIkPatch?: (patch: { weight?: number; bendPositive?: boolean }, withHistory?: boolean) => void;
  /** 拖 IK 权重进度条之前先记一笔撤销 */
  onBeginIk?: () => void;
  /** 动画制作模式下旗杆可点：在当前帧打 / 删 IK 关键帧 */
  animationMode?: boolean;
  /** 当前帧已有 IK 键（旗杆点亮） */
  ikKeyed?: boolean;
  onToggleIkKey?: () => void;
  /** 「设置约束目标」：进入后鼠标变十字，在舞台上点一根骨骼作为目标（官方 Property.ik.pick） */
  ikTargetPick?: boolean;
  onIkTargetPick?: (active: boolean) => void;
  /**
   * 骨架装配模式。官方的两个 IK 创建入口只在这时为真 ——
   * `_555/_570.as:276` 的 `_4418(_2873 == _715.ARMATURE)`，动画模式下整行 `enabled = false`。
   */
  armatureMode?: boolean;
  /** 官方的「点击目标 = 定位」：把选择集切到目标骨骼（`_908/_907.as:441-456`） */
  onLocateBone?: (name: string) => void;
  /** 骨骼显示长度（官方属性面板的「长度」；进入双骨 IK 求解与骨骼 overlay） */
  boneLength?: number;
  onBoneLength?: (value: number) => void;
  /** 播放中锁死位置 / 缩放 / 旋转 / 长度，避免改动正在播的动画 */
  locked?: boolean;
  /**
   * IK 链内的骨骼：local 会被 IK 求解覆盖（实测改完骨骼与目标都不动），
   * 所以六个变换字段整体锁死。要动就改 IK 的「目标」骨骼，或先删掉这条约束。
   */
  transformLocked?: boolean;
  /** 变换坐标系（官方 TransformPanel 的 World / Parent / Local 三个按钮） */
  transformSpace?: 'world' | 'parent' | 'local';
  onTransformSpace?: (space: 'world' | 'parent' | 'local') => void;
}) {
  if (!player || !boneName || !values) {
    return <div className="prop-empty">在舞台或工程面板中选择一根骨骼</div>;
  }
  const parent = player.skeleton.bones[player.skeleton.boneIndexByName.get(boneName) ?? 0]?.parent ?? -1;
  return (
    <>
      <div className="prop-group">
        <div className="group-head">
          <Icon name="move" size={12} />
          <span>变换坐标系</span>
        </div>
        <div className="prop-row" style={{ gridTemplateColumns: '1fr' }}>
          <div className="row" style={{ gap: 4 }}>
            {([['world', '世界'], ['parent', '父'], ['local', '本地']] as const).map(([id, label]) => (
              <button
                key={id}
                className={'chip' + ((transformSpace ?? 'world') === id ? ' on' : '')}
                title={`官方 TransformPanel 的${label}坐标系（影响拖动时按哪个轴移动）`}
                onClick={() => onTransformSpace?.(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="prop-group">
        <div className="group-head">
          <Icon name="bone" size={12} />
          <span>骨骼</span>
        </div>
        <div className="prop-row">
          <span className="ico" />
          <span className="label">长度</span>
          <input
            type="number" step="1" min="0"
            title="骨骼长度（官方 Property.bone.length）：直接输入即可改，参与双骨 IK 求解与骨骼 overlay 绘制"
            value={boneLength ?? 0}
            disabled={!!locked}
            onChange={(event) => onBoneLength?.(Number(event.target.value))}
          />
          <span />
        </div>
      </div>
      <div className="prop-group ik-group">
        <div className="group-head">
          <Icon name="anchor" size={12} />
          {/* 官方标题按角色切换：被约束骨骼 → Property.ik.fold「IK约束」；目标骨骼 → Property.ik.foldtarget「IK约束目标」 */}
          <span>{ik?.role === 'target' ? 'IK 约束目标' : 'IK 约束'}</span>
          <span className="spacer" />
          {ik && (
            <button className="head-btn" data-ik-remove="" title="删除这条 IK 约束" onClick={() => onRemoveIk?.(ik.name)}>
              <Icon name="x" size={12} />
            </button>
          )}
        </div>
        {ik ? (
          <>
            <div className="prop-row" style={{ gridTemplateColumns: '1fr' }}>
              <span className="label">
                {ik.role === 'target'
                  ? `${ik.name} → 目标骨骼`
                  : `${ik.name} → 链 ${(ik.chain ?? 0) > 0 ? 2 : 1} 根骨骼`}
              </span>
            </div>
            {/* 「目标」行：官方把目标名做成可点的 Label —— 点击 = 把选择集切到目标骨骼（定位），
                选中目标骨骼自己时官方省略这一行（`_908/_907.as:234-246` removeElement）。 */}
            {ik.role !== 'target' && (
              <div className="prop-row" data-ik-row="target">
                <span className="ico"><Icon name="anchor" size={12} /></span>
                <span className="label">目标</span>
                <button
                  type="button"
                  className="ik-target-link"
                  data-ik-target-locate={ik.target}
                  title={`定位到目标骨骼 ${ik.target}（官方行为：点击「目标」把选择集切到它）`}
                  onClick={() => onLocateBone?.(ik.target)}
                >
                  {ik.target}
                </button>
                <span />
              </div>
            )}
            {/* 权重行：进度条拖动（官方 Property.ik.weight 的滑条），尾部棋杆在动画制作模式下打键。
                `.ik-group` 把值列让给滑条 + 百分数（见 styles.css）。 */}
            <div className="prop-row" data-ik-row="weight">
              <span className="ico"><Icon name="anchor" size={12} /></span>
              <span className="label">IK 权重</span>
              <span className="ik-weight">
                <input
                  type="range" min={0} max={1} step={0.01}
                  data-ik-weight={ik.weight ?? 1}
                  value={ik.weight ?? 1}
                  disabled={!!locked}
                  title="IK 权重（官方 Property.ik.weight）：拖动调节，0 表示不参与求解"
                  onPointerDown={() => onBeginIk?.()}
                  onChange={(event) => onIkPatch?.({ weight: Number(event.target.value) }, false)}
                />
                <span className="pct" data-ik-weight-pct={Math.round((ik.weight ?? 1) * 100)}>
                  {Math.round((ik.weight ?? 1) * 100)} %
                </span>
              </span>
              <button
                type="button"
                className={`prop-flag${ikKeyed ? ' on' : ''}`}
                data-ik-key="weight"
                disabled={!animationMode}
                title={animationMode
                  ? (ikKeyed ? '删除当前帧 IK 关键帧（权重与弯曲方向同一帧）' : '在当前帧打 IK 关键帧（权重与弯曲方向同一帧）')
                  : '切换到「动画制作」再打关键帧'}
                onClick={() => onToggleIkKey?.()}
              >
                <Icon name="flag" size={13} />
              </button>
            </div>
            <div className="prop-row" data-ik-row="bend">
              <span className="ico"><Icon name="anchor" size={12} /></span>
              <span className="label">弯曲方向</span>
              <button
                className={'chip' + (ik.bendPositive === false ? '' : ' on')}
                data-ik-bend={ik.bendPositive === false ? 'reverse' : 'forward'}
                title="官方 Property.ik.bendDirection：正向 / 反向"
                onClick={() => onIkPatch?.({ bendPositive: ik.bendPositive === false })}
              >
                {ik.bendPositive === false ? '反向' : '正向'}
              </button>
              {/* 官方 IK 帧同时存 weight + bend（`_35_13487.as:1960-1961`）：只有一面旗杆，放在权重行 */}
              <span aria-hidden="true" />
            </div>
          </>
        ) : (
          /* 官方的两个创建入口（`_906/_909.as:132-141`）：`Property.ik.endPick`「在骨骼末端生成约束目标」
             与 `Property.ik.pick`「设置约束目标 / Create IK by Pick」。仅骨架装配模式可用。 */
          <div className="prop-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <button
              className="chip"
              data-ik-end-pick=""
              disabled={!armatureMode}
              title={armatureMode
                ? '在骨骼末端生成约束目标'
                : '骨架装配模式下才能操作（Ctrl+Tab 切换）'}
              onClick={() => onAddIk?.(0)}
            >
              <Icon name="crosshair" size={12} /> 末端生成
            </button>
            <button
              className={'chip' + (ikTargetPick ? ' on' : '')}
              data-ik-pick=""
              disabled={!armatureMode}
              title={armatureMode
                ? (ikTargetPick
                  ? '退出设置约束目标'
                  : '设置约束目标：鼠标变十字后，在舞台上点一根骨骼作为这条约束的目标')
                : '骨架装配模式下才能操作（Ctrl+Tab 切换）'}
              onClick={() => onIkTargetPick?.(!ikTargetPick)}
            >
              <Icon name="anchor" size={12} /> 设置目标
            </button>
          </div>
        )}
      </div>
      <div className="prop-group">
        <div className="group-head">
          <Icon name="bone" size={12} />
          <span>{boneName}</span>
        </div>
        {FIELDS.map((field) => (
          <div className="prop-row" key={field.key}>
            <span className="ico"><Icon name={field.icon} size={12} /></span>
            <span className="label">{field.label}</span>
            <input
              type="number"
              step={field.step}
              value={Number(values[field.key].toFixed(3))}
              disabled={!!locked || !!transformLocked}
              title={transformLocked ? '该骨骼在 IK 约束链内：姿态由 IK 求解决定，改这里不会生效' : undefined}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (Number.isFinite(next)) onChange(field.key, next);
              }}
            />
            <button
              type="button"
              className={`prop-flag${(keyed ? keyed[field.channel] : keyAtFrame) ? ' on' : ''}`}
              data-prop-key={field.key}
              title={(keyed ? keyed[field.channel] : keyAtFrame) ? '删除当前帧这个属性的关键帧' : '在当前帧只打这个属性的关键帧'}
              onClick={() => onToggleKey(field.channel)}
            >
              <Icon name="flag" size={13} />
            </button>
          </div>
        ))}
        {transformLocked && (
          <div className="hint" data-ik-chain-lock="" style={{ paddingTop: 2, color: '#ff9a9a' }}>
            该骨骼在 IK 约束链内（{ik?.name ?? 'IK'} → 目标 {ik?.target ?? '—'}），姿态由约束求解决定，不能直接改；
            请改「目标」骨骼，或先删除这条约束。
          </div>
        )}
        <div className="group-head">
          <span className="link" onClick={onReset}>重置为绑定姿态</span>
          <span className="spacer" />
          <span className="muted">{parent >= 0 ? `父级 ${player.skeleton.bones[parent].name}` : '根骨骼'}</span>
        </div>
      </div>
      <div className="note">
        改数值只更新当前帧已经打过的关键帧。没有关键帧时，点右侧旗标或按 K 再打。
        导出时按 DragonBones 5.x 的 <code>duration</code> 帧时长累积计算，
        <code>tweenEasing: 0</code> 为线性补间。
      </div>
    </>
  );
}

