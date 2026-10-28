/**
 * 序列帧（Sheet）面板 —— 官方 `Menu.Window.SheetPanel` / `Sheet.*`。
 *
 * 布局与文案对齐官方 `_13212/SheetPanel.as`：
 *   工具条（**与「序列帧」页签同一行、靠右**，见 `SheetToolbar`）：按名称升 / 降序排序
 *           （`/assets/frames/sortUp|sortDown.png`）+ 前一帧 / 后一帧洋葱皮（`Sheet.onion.prev` / `Sheet.onion.next`）
 *           + 删除（复用 `ScenePanel.removeBtn.tooltip`）
 *           + 第一帧 / 上一帧 / 播放 / 下一帧 / 最后一帧（复用 `Timeline.*` 的 tooltip）
 *           + 信息组：帧 `{0}/{1}`（`Sheet.frame.current` / `Sheet.frame.show`）、帧率（`Sheet.frame.rate`）、
 *           循环次数（`Sheet.anim.time`）、循环（`Sheet.anim.loop`）、显示边框（`Sheet.showframe`）
 *   帧列表：每个显示对象一格；列表为空时居中显示「拖拽图片到这里」（`Sheet.first.tip`）
 *
 * 帧格子按官方 `_13215`（列表项）+ `_13216`（皮肤）+ `_13211`（缩略图）+ `_13213`（列表）复刻，
 * 细节见 `DBPRO-SPEC.md` §104：边长随面板高度、缩略图居中且不放大、序号 1 基且在左上、
 * 名称在底部居中、**每格右上角一个删除按钮**。
 *
 * 勾上「循环」后「循环次数」输入框变灰 —— 官方 `_13432` 就是这个联动。
 * 工具条本身由 `TimelineDock` 渲染进 `Tabs` 的 `.tab-tools`，面板只负责帧列表。
 *
 * 帧编辑条（位置 / 轴心 / 翻转 / 应用所有帧）已迁到**舞台底部浮层** `SheetFrameBar`
 * （官方 `_953/_13221.as`），见 `DBPRO-SPEC.md` §51.1。
 */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Icon } from './icons';
import type { Player } from '../core/player';
import {
  SHEET_CELL_DEFAULT, SHEET_SCROLLBAR, sheetCellSize, sheetThumbBox, sheetThumbScale, type SheetFrames,
} from '../core/sheetEdit';

export interface SheetPanelProps {
  player: Player | null;
  sheet: SheetFrames | null;
  /** 当前帧（时间轴帧号） */
  frame: number;
  atlasUrl: string | null;
  onSeek: (frame: number) => void;
  /** 每格右上角的删除按钮（官方 `_13216._4197`） */
  onRemove: (index: number) => void;
}

/** 工具条（官方 `_13212/SheetPanel.as` 第 74-191 行 `_2438()` 的 `addElement` 顺序）。 */
export interface SheetToolbarProps {
  total: number;
  current: number;
  playing: boolean;
  frameRate: number;
  playTimes: number;
  loop: boolean;
  showBorder: boolean;
  onionPrev: boolean;
  onionNext: boolean;
  onSeek: (frame: number) => void;
  onStep: (delta: number) => void;
  onTogglePlay: () => void;
  /** 官方 `RESET_SHEET_ORDER`：按名字重排整个帧列表（true = 升序） */
  onSort: (asc: boolean) => void;
  onRemove: (index: number) => void;
  onOnionPrev: (value: boolean) => void;
  onOnionNext: (value: boolean) => void;
  onFrameRate: (value: number) => void;
  onPlayTimes: (value: number) => void;
  onLoop: (value: boolean) => void;
  onShowBorder: (value: boolean) => void;
}

export function SheetPanel(props: SheetPanelProps) {
  const { player, sheet, frame, atlasUrl, onSeek, onRemove } = props;
  const listRef = useRef<HTMLDivElement>(null);
  /** 官方 `_13215._13415`：全列表共享一个格子边长，初值 `DEFUALT_HEIGHT` */
  const [cell, setCell] = useState(SHEET_CELL_DEFAULT);

  // 官方 `_13213._5823()`：列表尺寸变化时把格子边长改成 `列表高 - 16`（夹在 80..200）。
  //
  // 这里量的是**整个盒子的高**（`getBoundingClientRect`）再扣边框 + padding，
  // 而不是 `clientHeight` —— 后者**不含横向滚动条**。若用 `clientHeight`，一旦横向溢出：
  // 滚动条出现 → 内容盒高变小 → 格子变小 → 可能不再溢出 → 滚动条消失 → 格子又变大，
  // 来回抖动并且会把最后一行的名称裁掉。改成扣掉一个恒定的滚动条高度后，
  // 滚动条出现与否都不影响格子边长，滚动条也永远有自己的位置（不会压住格子）。
  useEffect(() => {
    const host = listRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const styles = window.getComputedStyle(host);
      const rect = host.getBoundingClientRect();
      const inner = rect.height
        - parseFloat(styles.borderTopWidth || '0') - parseFloat(styles.borderBottomWidth || '0')
        - parseFloat(styles.paddingTop || '0') - parseFloat(styles.paddingBottom || '0');
      setCell(sheetCellSize(Math.max(0, inner - SHEET_SCROLLBAR)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [sheet]);

  if (!sheet) {
    return <div className="hint" style={{ padding: 12 }}>当前工程不是序列帧（官方工程类型：<code>armature.type = "sheet"</code>）</div>;
  }

  const total = sheet.frames.length;
  const current = Math.max(0, Math.min(total - 1, frame));
  const thumbBox = sheetThumbBox(cell);
  const regionOf = (index: number) => {
    const display = sheet.frames[index];
    if (!display || !player?.atlas) return null;
    const key = display.path ?? display.name ?? '';
    return player.atlas.regions.find((entry) => entry.name === key) ?? null;
  };
  /**
   * 缩略图：按图集切片裁出该显示对象的矩形，再按官方 `_13211.draw()` 用 `min(盒/图)`（不放大）
   * 以**中心**为原点缩放 —— 外层 `.sf-thumb` 负责居中与裁剪，所以缩放原点必须是 `center`。
   * 「显示边框」不在这里画：官方 `Sheet.showframe` 的边框画在**舞台**上（`_948/_951.as`），
   * 与缩略图格无关。
   */
  const thumbStyle = (index: number, width: number, height: number): CSSProperties => ({
    width,
    height,
    transform: `scale(${sheetThumbScale(thumbBox, width, height)})`,
    transformOrigin: 'center center',
  });
  const thumbImageStyle = (index: number): CSSProperties => {
    const region = regionOf(index);
    if (!region || !atlasUrl) return {};
    return { backgroundImage: `url(${atlasUrl})`, backgroundPosition: `${-region.x}px ${-region.y}px` };
  };

  return (
    <div className="sheet-panel" data-sheet-panel="">
      <div
        className="sheet-frames"
        data-sheet-frames={total}
        data-sheet-cell={cell}
        ref={listRef}
        style={{ '--sheet-cell': `${cell}px`, '--sheet-thumb': `${thumbBox}px` } as CSSProperties}
      >
        {sheet.frames.map((display, index) => {
          const region = regionOf(index);
          const label = display.name ?? display.path ?? '';
          return (
            <div
              key={`${label}-${index}`}
              className={`sheet-frame${index === current ? ' on' : ''}`}
              data-sheet-frame={index}
              title={`第 ${index} 帧${index === current ? '（当前）' : ''} · ${label}`}
              role="button"
              tabIndex={0}
              onClick={() => onSeek(index)}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onSeek(index); }}
            >
              {/* 官方 `_13216`：`_13426` = 序号（`_2540 + 1`，top 2 / left 4）；`_6194` = 名字（bottom 2、居中） */}
              <span className="sf-index">{index + 1}</span>
              <span className="sf-thumb">
                <span
                  className="sf-img"
                  style={{ ...thumbStyle(index, region?.width ?? thumbBox, region?.height ?? thumbBox), ...thumbImageStyle(index) }}
                />
              </span>
              <span className="sf-name">{label}</span>
              {/* 官方 `_13216._4197`：`delAnimation.png`，top 2 / right 2，`SheetEvent.DELETE_FRAME` */}
              <button
                className="sf-del"
                data-sheet-frame-remove={index}
                title={`删除该帧（官方 ScenePanel.removeBtn.tooltip）`}
                disabled={total <= 1}
                onClick={(event) => { event.stopPropagation(); onRemove(index); }}
              ><Icon name="x" size={10} /></button>
            </div>
          );
        })}
        {total === 0 && <span className="sheet-empty">拖拽图片到这里</span>}
      </div>
    </div>
  );
}

/** 序列帧工具条（官方 `_13212/SheetPanel.as` 第 74-191 行的控件顺序）。 */
export function SheetToolbar(props: SheetToolbarProps) {
  const {
    total, current, playing, frameRate, playTimes, loop, showBorder, onionPrev, onionNext,
    onSeek, onStep, onTogglePlay, onSort, onRemove, onOnionPrev, onOnionNext,
    onFrameRate, onPlayTimes, onLoop, onShowBorder,
  } = props;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const numberField = (key: string, value: number, commit: (next: number) => void) => (
    <input
      className="tl-frame"
      data-sheet-fps={key === 'fps' ? '' : undefined}
      data-sheet-fps-value={key === 'fps' ? value : undefined}
      data-sheet-play-times={key === 'times' ? '' : undefined}
      type="number"
      min={1}
      max={99}
      disabled={key === 'times' && loop}
      title={key === 'fps' ? '帧率（1..99）' : '循环次数（1..99）'}
      value={drafts[key] ?? String(value)}
      onChange={(event) => setDrafts((prev) => ({ ...prev, [key]: event.target.value }))}
      onBlur={() => {
        const raw = drafts[key];
        setDrafts((prev) => { const next = { ...prev }; delete next[key]; return next; });
        if (raw === undefined) return;
        const num = Number(raw);
        if (Number.isFinite(num)) commit(num);
      }}
      onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }}
    />
  );
  return (
    <div className="sheet-headcluster" data-sheet-toolbar="">
      <button className="chip" data-sheet-sort-asc="" title="按名称升序排列帧" onClick={() => onSort(true)}><Icon name="sortUp" size={12} /></button>
      <button className="chip" data-sheet-sort-desc="" title="按名称降序排列帧" onClick={() => onSort(false)}><Icon name="sortDown" size={12} /></button>
      <span className="tl-headgap" />
      <button className={'chip' + (onionPrev ? ' on' : '')} data-sheet-onion-prev="" title="前一帧洋葱皮" onClick={() => onOnionPrev(!onionPrev)}><Icon name="onionPrev" size={12} /></button>
      <button className={'chip' + (onionNext ? ' on' : '')} data-sheet-onion-next="" title="后一帧洋葱皮" onClick={() => onOnionNext(!onionNext)}><Icon name="onionNext" size={12} /></button>
      <button className="chip" data-sheet-remove="" title="删除该帧" disabled={total <= 1} onClick={() => onRemove(current)}><Icon name="x" size={12} /></button>
      <span className="tl-headgap" />
      <button className="chip" data-sheet-first="" title="回到第一帧" onClick={() => onSeek(0)}><Icon name="toStart" size={12} /></button>
      <button className="chip" data-sheet-prev="" title="上一帧" onClick={() => onStep(-1)}><Icon name="prevKey" size={12} /></button>
      <button className={'chip' + (playing ? ' on' : '')} data-sheet-play="" title={playing ? '暂停' : '播放'} onClick={onTogglePlay}><Icon name={playing ? 'pause' : 'play'} size={12} /></button>
      <button className="chip" data-sheet-next="" title="下一帧" onClick={() => onStep(1)}><Icon name="nextKey" size={12} /></button>
      <button className="chip" data-sheet-last="" title="回到最后一帧" onClick={() => onSeek(Math.max(0, total - 1))}><Icon name="toEnd" size={12} /></button>
      <span className="tl-headgap" />
      <span className="lab">帧:</span>
      <span className="tl-readout" data-sheet-frame-count="">{total === 0 ? '0/0' : `${current + 1}/${total}`}</span>
      <span className="lab">帧率:</span>
      {numberField('fps', frameRate, onFrameRate)}
      <span className="lab">循环次数:</span>
      {numberField('times', playTimes, onPlayTimes)}
      <label className="checkbox" title="循环"><input type="checkbox" data-sheet-loop="" checked={loop} onChange={(event) => onLoop(event.target.checked)} />循环</label>
      <label className="checkbox" title="显示边框"><input type="checkbox" data-sheet-border="" checked={showBorder} onChange={(event) => onShowBorder(event.target.checked)} />显示边框</label>
    </div>
  );
}

/** 序列帧左栏：名称、类型、帧率、默认动画。 */
export function SheetProperties({
  name, frameRate, animations, current, onFrameRate, onAnimation,
}: {
  name: string;
  frameRate: number;
  animations: string[];
  current: string;
  onFrameRate: (value: number) => void;
  onAnimation: (name: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const row = { gridTemplateColumns: '14px 64px 1fr' } as const;
  return (
    <div className="prop-group" data-sheet-properties="">
      <div className="prop-row" style={row}>
        <span />
        <span className="label">名称</span>
        <span className="muted" data-sheet-name="">{name}</span>
      </div>
      <div className="prop-row" style={row}>
        <span />
        <span className="label">类型</span>
        <span className="muted">序列帧</span>
      </div>
      <div className="prop-row" style={row}>
        <span />
        <span className="label">帧率</span>
        <input
          data-sheet-fps=""
          data-sheet-fps-value={frameRate}
          type="number"
          min={1}
          max={99}
          value={draft ?? frameRate}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (draft !== null) onFrameRate(Number(draft));
            setDraft(null);
          }}
          onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }}
        />
      </div>
      <div className="prop-row" style={row}>
        <span />
        <span className="label">默认动画</span>
        <select data-sheet-animation="" value={current} onChange={(event) => onAnimation(event.target.value)}>
          {animations.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
        </select>
      </div>
      {/* 「循环」勾选只在工具条保留一处，左栏不再重复（否则 `data-sheet-loop` 钩子同屏出现两个） */}
    </div>
  );
}
