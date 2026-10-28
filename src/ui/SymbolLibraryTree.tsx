/**
 * 资源树：元件 → library → 图集 → 切片。
 * 序列帧元件上，展开（或双击）切片会把这张图追加成一帧。
 *
 * 本轮（§109）补三件事，口径照官方 Pro 格式验证（见 `docs/DBPRO-SPEC.md §109.1`）：
 *   - 每个节点名前一枚类型小图标（官方 `/assets/panelIcon/*.png` 的语义）；
 *   - 切片行悬停 1 秒后弹跟随鼠标的浮动大图（官方 `Timer(1000,1)` + `SHOW_TIP_IMAGE`，只对资源叶子生效）；
 *   - 切片行可拖到舞台：骨骼工程加入插槽、序列帧工程追加一帧。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './icons';

/** 切片在图集里的像素矩形（只取渲染需要的四个字段） */
export interface RegionRect { x: number; y: number; width: number; height: number }

/** 官方 hover 预览延迟：`Timer(1000,1)`（`_472/_622.as:94`） */
export const PREVIEW_DELAY_MS = 1000;
/** 预览浮层的最大边长（像素）与其缩放上下限 */
const PREVIEW_MAX_SIDE = 160;
const PREVIEW_MIN_ZOOM = 1;
const PREVIEW_MAX_ZOOM = 4;
/** 预览浮层与光标 / 视口边的留白（像素） */
const PREVIEW_GAP = 14;
const PREVIEW_EDGE_MARGIN = 8;
/** 拖拽负载的 MIME，供舞台侧的 `onDrop` 识别 */
export const REGION_DRAG_MIME = 'application/x-bone-studio-region';

/**
 * 切换元件后只展开「元件」那一行（`arm:<名字>`）——`library` / 图集 / 切片要手点。
 * 图集的切片动辄几十个（FramesAnimation 一个元件 58 个），自动全展开会把树冲垮。
 */
const expandOnly = (name: string) => new Set([`arm:${name}`]);

export interface SymbolNode {
  name: string;
  sheet: boolean;
}

/**
 * 切片浮动大图预览：跟着光标弹一张放大的图集切片（官方 1 秒延迟 + `SHOW_TIP_IMAGE`）。
 * 资源树与「层级」面板共用同一份（口径见 docs/DBPRO-SPEC.md §109.1）；两者都在右栏，
 * 所以优先放在光标**左侧**，左边空间不够才翻到右侧。
 */
export function SlicePreview({ name, x, y, atlasUrl, regionRects }: {
  name: string;
  x: number;
  y: number;
  atlasUrl: string | null;
  regionRects: Record<string, RegionRect>;
}) {
  const r = regionRects[name];
  if (!atlasUrl || !r) return null;
  const zoom = Math.min(PREVIEW_MAX_ZOOM, Math.max(PREVIEW_MIN_ZOOM, PREVIEW_MAX_SIDE / Math.max(r.width, r.height)));
  const w = r.width * zoom;
  const h = r.height * zoom;
  const leftSide = x - w - PREVIEW_GAP >= PREVIEW_EDGE_MARGIN;
  const left = leftSide ? x - w - PREVIEW_GAP : x + PREVIEW_GAP;
  const top = Math.max(PREVIEW_EDGE_MARGIN, Math.min(y - h / 2, window.innerHeight - h - PREVIEW_EDGE_MARGIN));
  return (
    <div
      className="lib-preview"
      data-lib-preview={name}
      data-lib-preview-side={leftSide ? 'left' : 'right'}
      style={{ left, top, width: w, height: h }}
    >
      <img
        src={atlasUrl}
        alt={name}
        style={{ transform: `scale(${zoom}) translate(${-r.x}px, ${-r.y}px)` }}
      />
    </div>
  );
}

export function SymbolLibraryTree({
  armatures, current, atlasName, regions, highlight,
  onSelect, onAddFrame, onHighlight, atlasUrl, regionRects, usedRegions,
  selectedNode, onSelectNode,
}: {
  armatures: SymbolNode[];
  current: string;
  atlasName: string | null;
  regions: string[];
  highlight: string | null;
  onSelect: (name: string) => void;
  onAddFrame: (armature: string, image: string) => void;
  onHighlight: (name: string | null) => void;
  /** 图集整图 URL：为空（只有数据没贴图）时不做悬停预览 */
  atlasUrl: string | null;
  /** 切片名 → 在图集里的像素矩形 */
  regionRects: Record<string, RegionRect>;
  /** 已被显示对象引用的切片名（官方 `imageUsed.png` 的那一档） */
  usedRegions: Set<string>;
  /** 资源面板标题栏的「删除」按选中节点决定目标（`arm:` / `img:`） */
  selectedNode?: string | null;
  onSelectNode?: (key: string) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(
    current ? expandOnly(current) : [],
  ));

  // 顶层同时只展开一个元件，且只展开它这一层。当前元件变了（树或顶栏下拉）就收起其余元件。
  useEffect(() => {
    if (!current) return;
    setOpen(expandOnly(current));
  }, [current]);

  const openOnly = (name: string) => {
    setOpen(expandOnly(name));
    onSelect(name);
  };

  const toggle = (key: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // 悬停预览：只在切片行、延迟 1 秒弹（官方口径），跟随鼠标，离开/开始拖拽即收。
  const [preview, setPreview] = useState<{ name: string; x: number; y: number } | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPreview = useCallback(() => {
    if (previewTimer.current) { clearTimeout(previewTimer.current); previewTimer.current = null; }
    setPreview(null);
  }, []);
  useEffect(() => cancelPreview, [cancelPreview]);

  // 图集整图：预载一份 `HTMLImageElement`，拖拽开始时同步裁出切片当幽灵图（dragstart 里不能异步）。
  const atlasImg = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!atlasUrl) { atlasImg.current = null; return; }
    const img = new Image();
    img.src = atlasUrl;
    atlasImg.current = img;
    return () => { if (atlasImg.current === img) atlasImg.current = null; };
  }, [atlasUrl]);

  /** 官方拖拽幽灵图：切片的半透明缩略图（`_15/_16.as:34` alpha=0.5，`_232` 的 Bitmap 缩略图） */
  const makeDragGhost = (name: string): HTMLCanvasElement | null => {
    const rect = regionRects[name];
    const img = atlasImg.current;
    if (!rect || !img || !img.complete || !img.naturalWidth) return null;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, rect.width);
    canvas.height = Math.max(1, rect.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.globalAlpha = 0.5;
    ctx.drawImage(img, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
    return canvas;
  };

  const hoverRegion = (name: string, event: { clientX: number; clientY: number }) => {
    if (!atlasUrl) return;
    const { clientX, clientY } = event;
    if (preview) { setPreview({ name, x: clientX, y: clientY }); return; }
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => {
      previewTimer.current = null;
      setPreview({ name, x: clientX, y: clientY });
    }, PREVIEW_DELAY_MS);
  };

  // 点选、当前元件、高亮切片原先各画一道蓝，同屏会亮两行。有点选只亮点选，否则亮高亮切片，都没有才亮当前元件。
  const markedKey = selectedNode
    ?? (highlight ? `img:${current}:${highlight}` : (current ? `arm:${current}` : null));

  const row = (
    key: string, depth: number, label: string, opts: {
      selected?: boolean;
      branch?: boolean;
      onOpen?: () => void;
      onBranch?: () => void;
      onActivate?: () => void;
      add?: boolean;
      /** 节点类型图标名（见 `src/ui/icons.tsx`） */
      icon: string;
      /** 「已被引用」态（官方 `imageUsed.png`） */
      used?: boolean;
      /** 切片行：可拖到舞台，且悬停出预览 */
      region?: string;
    },
  ) => (
    <div
      key={key}
      className={`tree-row${key === markedKey ? (selectedNode === key ? ' node-selected' : ' selected') : ''}`}
      data-library-node={key}
      data-library-selected={selectedNode === key ? '1' : undefined}
      style={{ paddingLeft: 8 + depth * 14 }}
      draggable={!!opts.region}
      onClick={() => {
        onSelectNode?.(key);
        if (opts.region) onHighlight(opts.region);
        else if (highlight) onHighlight(null);
      }}
      onDragStart={(event) => {
        // 拖拽源是整行（图标 / 行空白）时，名字上的 setData 不会跑，舞台只能收到空负载。
        if (!opts.region || event.target !== event.currentTarget) return;
        cancelPreview();
        event.dataTransfer.setData(REGION_DRAG_MIME, opts.region);
        event.dataTransfer.effectAllowed = 'copy';
        const ghost = makeDragGhost(opts.region);
        if (ghost) event.dataTransfer.setDragImage(ghost, ghost.width / 2, ghost.height / 2);
      }}
      onMouseMove={opts.region ? (event) => hoverRegion(opts.region as string, event) : undefined}
      onMouseLeave={opts.region ? cancelPreview : undefined}
    >
      <button
        type="button"
        className="glyph"
        data-library-toggle={key}
        title={opts.add ? '加入序列帧' : undefined}
        onClick={(event) => {
          event.stopPropagation();
          if (opts.branch) (opts.onBranch ?? (() => toggle(key)))();
          else opts.onOpen?.();
        }}
      >{opts.branch ? (open.has(key) ? '▾' : '▸') : (opts.add ? '+' : '')}</button>
      <span className={`ico${opts.used ? ' used' : ''}`} data-library-icon={key}><Icon name={opts.icon} size={12} /></span>
      <span
        className="name"
        onClick={() => opts.onActivate?.()}
        onDoubleClick={() => { if (opts.add) opts.onOpen?.(); }}
        draggable={!!opts.region}
        onDragStart={opts.region ? (event) => {
          cancelPreview();
          const region = opts.region as string;
          event.dataTransfer.setData(REGION_DRAG_MIME, region);
          event.dataTransfer.effectAllowed = 'copy';
          const ghost = makeDragGhost(region);
          if (ghost) event.dataTransfer.setDragImage(ghost, ghost.width / 2, ghost.height / 2);
        } : undefined}
      >{label}</span>
    </div>
  );

  return (
    <div className="tree" data-symbol-library="">
      {armatures.map((arm) => {
        const armKey = `arm:${arm.name}`;
        const libKey = `lib:${arm.name}`;
        const atlasKey = `atlas:${arm.name}`;
        const expanded = open.has(armKey);
        return (
          <div key={arm.name}>
            {row(armKey, 0, arm.name, {
              selected: arm.name === current,
              branch: true,
              icon: arm.sheet ? 'clock' : 'bone',
              onBranch: () => {
                if (open.has(armKey)) {
                  setOpen((prev) => {
                    const next = new Set(prev);
                    next.delete(armKey);
                    return next;
                  });
                  return;
                }
                openOnly(arm.name);
              },
              onActivate: () => openOnly(arm.name),
            })}
            {expanded && row(libKey, 1, 'library', { branch: true, icon: 'folder', onActivate: () => toggle(libKey) })}
            {expanded && open.has(libKey) && (
              atlasName
                ? row(atlasKey, 2, atlasName, { branch: true, icon: 'layers', onActivate: () => toggle(atlasKey) })
                : <div className="hint" style={{ paddingLeft: 36 }}>没有图集</div>
            )}
            {expanded && open.has(libKey) && open.has(atlasKey) && regions.map((name) => row(
              `img:${arm.name}:${name}`,
              3,
              name,
              {
                selected: name === highlight,
                add: arm.sheet,
                icon: 'image',
                used: usedRegions.has(name),
                region: name,
                onOpen: () => (arm.sheet ? onAddFrame(arm.name, name) : onHighlight(name)),
                onActivate: () => onHighlight(name),
              },
            ))}
          </div>
        );
      })}
      {armatures.length === 0 && <div className="hint">打开工程后在这里浏览元件和切片</div>}
      {preview && <SlicePreview {...preview} atlasUrl={atlasUrl} regionRects={regionRects} />}
    </div>
  );
}
