/**
 * Slot properties panel — official 属性面板 with a slot selected
 * (`pose-slot.md`: 名称 / 颜色 / 混合模式 / 不透明度 / 显示资源 / 坐标变换, plus
 * the 删除 button in the panel head).
 *
 * The blend-mode list is the shipped runtime's `BlendMode` enum, and the display
 * list comes from the active skin so switching attachments stays valid.
 */
import { useEffect, useRef, useState } from 'react';
import type { DbColorTransform } from '../core/types';
import type { Player } from '../core/player';
import { BLEND_MODES, blendModeIndex, byteToChannel, channelToByte, colorKeyAt, readSlotColor, slotColorAt, slotData } from '../core/slotEdit';
import { meshWeightBones } from '../core/editing';
import { WEIGHT_HEX } from '../core/weightPie';
import { ColorPickerDialog } from './ColorPickerDialog';
import { Icon } from './icons';
import { displayKindOf } from './panels';

export interface SlotPanelProps {
  player: Player | null;
  slotName: string | null;
  onRename: (next: string) => void;
  onBlendMode: (mode: number) => void;
  onDisplayIndex: (index: number) => void;
  /** 替换图片（官方 Property.display.changeAsset / SwapImageWindow） */
  onSwapImage?: (displayIndex: number) => void;
  /** 自动权重（官方 Property.weight.autoWeight）：按到骨骼线段的距离重新分配 */
  onAutoWeight?: () => void;
  /** 官方 Mesh.property.edit：进入 / 退出网格编辑（底部悬浮工具栏由宿主渲染） */
  onMeshEdit?: () => void;
  /** 官方 Mesh.property.reset / ResetMesh：把网格重置成覆盖整张图片的 4 角点矩形 */
  onMeshReset?: () => void;
  /** 正在网格编辑模式（组头按钮高亮） */
  meshEditing?: boolean;
  /** 官方 BoundingBoxPanel.btn.new「重新画」 */
  onBBoxRedraw?: () => void;
  /** 官方 BoundingBoxPanel.btn.create / btn.delete：进入舞台拾取模式 */
  onBBoxMode?: (mode: 'add' | 'delete' | null) => void;
  onColor: (color: DbColorTransform) => void;
  /** 拖滑条之前记一笔撤销。颜色选择器自己在确定时再记。 */
  onBeginColor?: () => void;
  /** 选择器打开时记下编辑前的颜色，拖动中只预览。 */
  onBeginColorPreview?: () => void;
  onCommitColorPreview?: (changed: boolean) => void;
  onCancelColorPreview?: () => void;
  /** 动画制作模式下旗杆可点，在当前帧打上或删掉颜色关键帧。 */
  animationMode?: boolean;
  frame?: number;
  onToggleColorKey?: () => void;
  /** 「显示资源」的旗杆：当前帧打 / 删显示对象关键帧（官方 Property.display.changeAsset 右侧那个） */
  onToggleDisplayKey?: () => void;
  displayKeyed?: boolean;
  onDelete: () => void;
  onAddWeightBone: (bone: string) => void;
  onRemoveWeightBone: (bone: string) => void;
  /** 点「添加绑定骨骼」后，下一次在舞台上点骨骼就绑进来。只在骨骼装配模式可用。 */
  weightBonePick?: boolean;
  armatureMode?: boolean;
  /** 序列帧元件没有骨架装配，锁定项不再提示 Ctrl+Tab */
  sheetMode?: boolean;
  onWeightBonePick?: (active: boolean) => void;
  /** 舞台上点中的饼图顶点；null 时进度条不可拖 */
  weightVertex?: number | null;
  /** 当前帧已有 FFD 键时旗杆点亮 */
  ffdKeyed?: boolean;
  onToggleFfdKey?: () => void;
  /** 该顶点在每根绑定骨骼上的权重，0..1 */
  weightShares?: Record<string, number> | null;
  onBeginWeight?: () => void;
  onWeightShare?: (bone: string, percent: number) => void;
  /** 舞台 / 场景树当前选中的骨骼 */
  activeBone?: string | null;
  /** R 权重工具下，列表跟随这根骨骼，方便解绑 */
  weightMode?: boolean;
}

// official 权重骨骼列表 shows one colour per bound bone (green / orange / red / blue …)
const WEIGHT_COLORS = WEIGHT_HEX;

export function SlotPanel({
  player, slotName, onRename, onBlendMode, onDisplayIndex, onColor, onDelete, onSwapImage, onAutoWeight, onBBoxRedraw, onBBoxMode,
  onMeshEdit, onMeshReset, meshEditing,
  onAddWeightBone, onRemoveWeightBone, weightBonePick, armatureMode, sheetMode, onWeightBonePick, weightVertex, weightShares, onBeginWeight, onWeightShare,
  ffdKeyed, onToggleFfdKey,
  activeBone, weightMode, animationMode, frame, onToggleColorKey, onToggleDisplayKey, displayKeyed, onBeginColor,
  onBeginColorPreview, onCommitColorPreview, onCancelColorPreview,
}: SlotPanelProps) {
  const armatureLock = sheetMode ? '序列帧不使用骨架装配' : '';
  const entry = player && slotName ? slotData(player.skeleton.armature, slotName) : undefined;
  const [draft, setDraft] = useState(slotName ?? '');
  /** 权重骨骼列表里当前选中的那一行；解绑按钮只挂在这一行上 */
  const [selectedWeightBone, setSelectedWeightBone] = useState<string | null>(null);
  const [colorPicker, setColorPicker] = useState(false);
  /** 打开选择器那一刻的色块。预览会改舞台，不能拿正在变的颜色当「当前」。 */
  const [pickerOrigin, setPickerOrigin] = useState<{ r: number; g: number; b: number } | null>(null);
  const cancelPreviewRef = useRef(onCancelColorPreview);
  cancelPreviewRef.current = onCancelColorPreview;
  const weightRowRef = useRef<HTMLDivElement | null>(null);
  const weightBoneKey = player && slotName ? meshWeightBones(player.skeleton.armature, slotName).join('\0') : '';
  useEffect(() => {
    setDraft(slotName ?? '');
    setSelectedWeightBone(null);
    setColorPicker(false);
    return () => { cancelPreviewRef.current?.(); };
  }, [slotName]);
  useEffect(() => {
    if (!weightMode || !activeBone) return;
    const names = weightBoneKey ? weightBoneKey.split('\0') : [];
    setSelectedWeightBone(names.includes(activeBone) ? activeBone : null);
  }, [weightMode, activeBone, weightBoneKey, slotName]);
  useEffect(() => {
    if (!weightMode || !selectedWeightBone) return;
    weightRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [weightMode, selectedWeightBone]);
  /**
   * 解绑成功后（或换槽位后）当前列表已经没有这一行，选中态必须跟着失效 ——
   * 否则 `selectedWeightBone` 会悬在一个不存在的名字上，解绑按钮的挂载点也随之消失。
   */
  useEffect(() => {
    if (!selectedWeightBone) return;
    const names = weightBoneKey ? weightBoneKey.split('\0') : [];
    if (!names.includes(selectedWeightBone)) setSelectedWeightBone(null);
  }, [selectedWeightBone, weightBoneKey]);

  if (!player || !slotName || !entry) {
    return <div className="prop-empty">在舞台或场景树中选择一个槽位</div>;
  }
  const bindColor = readSlotColor(player, slotName) as DbColorTransform;
  const color = (animationMode ? slotColorAt(player, slotName, frame ?? player.position) : bindColor) ?? bindColor;
  const keyed = Boolean(animationMode) && colorKeyAt(player, slotName, frame ?? player.position);
  const swatch = {
    r: channelToByte(color.rM),
    g: channelToByte(color.gM),
    b: channelToByte(color.bM),
  };
  const swatchHex = [swatch.r, swatch.g, swatch.b].map((channel) => channel.toString(16).padStart(2, '0')).join('').toUpperCase();
  const flagTitle = animationMode
    ? (keyed ? '删除当前帧颜色关键帧' : '在当前帧打颜色关键帧')
    : '切换到「动画制作」再打关键帧';
  const displays = player.skeleton.skinSlots.get(slotName)?.display ?? [];
  const displayIndex = entry.displayIndex ?? 0;
  // Official 属性面板 shows 类型: 插槽 for the slot, and 类型: 网格/图片 for its display object.
  const kind = displayKindOf(player, slotName, displayIndex);
  const current = displays[displayIndex];
  // 权重指纹：headless 测试用它判断「自动权重」有没有真的改到数据
  //（归一化后每个顶点的权重和恒为 1，所以只看长度 + 一个带权位置和就能区分前后）
  /** 官方 BoundingBoxPanel.vertices「顶点数：{0}」 */
  const bboxCount = current && (current.type === 'boundingBox' || current.type === 3)
    ? Math.floor((current.vertices?.length ?? 0) / 2)
    : 0;
  const weightSig = current?.weights
    ? `${current.weights.length}:${current.weights.reduce((acc, value, index) => acc + value * ((index % 7) + 1), 0).toFixed(4)}`
    : '';
  const weightBones = kind.label === '网格' ? meshWeightBones(player.skeleton.armature, slotName) : [];

  const commitColor = (patch: Partial<DbColorTransform>) => onColor({ ...color, ...patch });

  return (
    <div className="slot-props">
      <div className="prop-group">
        <div className="group-head">
          <Icon name="image" size={12} />
          <span>槽位</span>
          <span className="spacer" />
          <button className="chip" title="删除槽位（Delete）" onClick={onDelete}>删除</button>
        </div>
        <div className="prop-row">
          <span className="ico"><Icon name="layers" size={12} /></span>
          <span className="label">名称</span>
          <input
            type="text"
            data-slot-name={entry.name}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => { if (draft !== entry.name) onRename(draft); }}
            onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }}
          />
          <span />
        </div>
        <div className="prop-row">
          <span className="ico"><Icon name="bone" size={12} /></span>
          <span className="label">挂点骨骼</span>
          <span className="muted" data-slot-parent={entry.parent}>{entry.parent}</span>
          <span />
        </div>
        <div className="prop-row">
          <span className="ico"><Icon name="layers" size={12} /></span>
          <span className="label">类型</span>
          <span className="muted" data-slot-kind="slot">插槽</span>
          <span />
        </div>
        <div className="prop-row">
          <span className="ico"><Icon name="layers" size={12} /></span>
          <span className="label">混合模式</span>
          <select
            data-slot-blend={entry.blendMode ?? 'normal'}
            value={String(blendModeIndex(entry.blendMode))}
            onChange={(event) => onBlendMode(Number(event.target.value))}
          >
            {BLEND_MODES.map((mode) => (
              <option key={mode.id} value={mode.id}>{mode.label}（{mode.name}）</option>
            ))}
          </select>
          <span />
        </div>
        <div className="prop-row">
          <span className="ico"><Icon name="image" size={12} /></span>
          <span className="label">显示资源</span>
          <select
            data-slot-display={displayIndex}
            value={String(displayIndex)}
            onChange={(event) => onDisplayIndex(Number(event.target.value))}
          >
            <option value="-1">（无）</option>
            {displays.map((display, index) => (
              <option key={index} value={index}>{display.name ?? display.path ?? `资源 ${index}`}</option>
            ))}
          </select>
          <button
            type="button"
            className={`prop-flag${displayKeyed ? ' on' : ''}`}
            data-slot-display-flag=""
            disabled={!animationMode}
            title={flagTitle}
            onClick={onToggleDisplayKey}
          >
            <Icon name="flag" size={13} />
          </button>
        </div>
      </div>
      <div className="prop-group" data-slot-weights={weightSig}>
        <div className="group-head">
          <Icon name={kind.icon} size={12} />
          <span>资源属性</span>
          <span className="spacer" />
          <button
            className="link"
            data-swap-image-open=""
            title={armatureMode
              ? '替换图片（官方 Property.display.changeAsset / SwapImageWindow）'
              : (armatureLock || '替换图片只在骨架装配模式下可用（Ctrl+Tab 切换）')}
            disabled={!armatureMode || !player.atlas}
            onClick={() => onSwapImage?.(displayIndex)}
          >
            替换图片
          </button>
        </div>
        <div className="prop-row">
          <span className="ico"><Icon name="layers" size={12} /></span>
          <span className="label">名字</span>
          <span className="muted" data-slot-display-name={current?.name ?? ''}>{current?.name ?? '（无）'}</span>
          <span />
        </div>
        <div className="prop-row">
          <span className="ico"><Icon name="image" size={12} /></span>
          <span className="label">资源</span>
          <span className="muted" data-slot-display-path={current?.path ?? current?.name ?? ''}>{current?.path ?? current?.name ?? '（无）'}</span>
          <span />
        </div>
        <div className="prop-row">
          <span className="ico"><Icon name={kind.icon} size={12} /></span>
          <span className="label">类型</span>
          <span className="muted" data-slot-display-kind={kind.label}>{kind.label}</span>
          <span />
        </div>
      </div>
      {(kind.label === '网格' || kind.label === '图片') && (
        <div
          className="prop-group"
          data-mesh-outline=""
          data-mesh-stats={`${(current?.vertices?.length ?? 0) / 2}:${(current?.triangles?.length ?? 0) / 3}`}
        >
          <div className="group-head">
            <Icon name="grid" size={12} />
            <span>网格</span>
            <span className="spacer" />
          </div>
          <div className="prop-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <button
              type="button"
              className={`chip${meshEditing ? ' on' : ''}`}
              data-mesh-edit={meshEditing ? '1' : '0'}
              title={kind.label === '网格'
                ? (meshEditing ? '退出网格编辑' : '编辑网格：进入后底部出现网格编辑工具栏')
                : '先把图片转换成网格（右键「转换为网格」）才能编辑'}
              disabled={!armatureMode || kind.label !== '网格'}
              onClick={() => onMeshEdit?.()}
            >
              编辑网格
            </button>
            <button
              type="button"
              className="chip"
              data-mesh-reset=""
              title={kind.label === '网格'
                ? '重置网格：还原为覆盖整张图片的 4 个角点'
                : '先把图片转换成网格（右键「转换为网格」）才能重置'}
              disabled={!armatureMode || kind.label !== '网格'}
              onClick={() => onMeshReset?.()}
            >
              重置网格
            </button>
          </div>
          {animationMode && kind.label === '网格' && (
            <div className="prop-row">
              <span className="ico" />
              <span className="label">FFD</span>
              <span />
              <button
                type="button"
                className={`prop-flag${ffdKeyed ? ' on' : ''}`}
                data-ffd-flag={ffdKeyed ? '1' : '0'}
                title={ffdKeyed ? '删除当前帧 FFD 关键帧' : '在当前帧打 FFD 关键帧'}
                onClick={onToggleFfdKey}
              >
                <Icon name="flag" size={13} />
              </button>
            </div>
          )}
        </div>
      )}
      {(kind.label === '包围盒') && (
        <div className="prop-group" data-bbox-panel="">
          <div className="group-head">
            <Icon name="mesh" size={12} />
            <span>编辑边界框</span>
            <span className="spacer" />
            <span className="muted" data-bbox-vertices={bboxCount}>顶点数：{bboxCount}</span>
          </div>
          <div className="prop-row" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
            <button
              className="chip"
              data-bbox-redraw=""
              title={armatureMode
                ? '官方 BoundingBoxPanel.btn.new：在舞台上重新画一圈顶点'
                : (armatureLock || '重新画只在骨架装配模式下可用（Ctrl+Tab 切换）')}
              disabled={!armatureMode}
              onClick={() => onBBoxRedraw?.()}
            >重新画</button>
            <button className="chip" data-bbox-add="" title="官方 BoundingBoxPanel.btn.create：点一条边，在中点插入顶点" onClick={() => onBBoxMode?.('add')}>添加点</button>
            <button className="chip" data-bbox-delete="" title="官方 BoundingBoxPanel.btn.delete：点一个顶点删除它" onClick={() => onBBoxMode?.('delete')}>删除点</button>
          </div>
        </div>
      )}
      {kind.label === '网格' && (
        <div className="prop-group">
          <div className="group-head">
            <Icon name="layers" size={12} />
            <span>权重骨骼列表</span>
            <span className="spacer" />
            <button
              className="link"
              data-auto-weight=""
              title={!armatureMode
                ? (armatureLock || '自动权重只在骨架装配模式下可用（Ctrl+Tab 切换）')
                : `自动权重（官方 Property.weight.autoWeight）：按顶点到骨骼线段的距离重新分配，需绑定至少 2 根骨骼（当前 ${weightBones.length} 根）`}
              disabled={!armatureMode || weightBones.length < 2}
              onClick={() => onAutoWeight?.()}
            >
              自动权重
            </button>
          </div>
          <div className="weight-add">
            <button
              className={`chip${weightBonePick ? ' on' : ''}`}
              data-weight-pick={weightBonePick ? '1' : '0'}
              disabled={!armatureMode}
              title={armatureMode
                ? '点此进入选骨，再在舞台上点一根骨骼把它加进列表。已经绑定的骨骼不会重复添加。'
                : (armatureLock || '添加绑定骨骼只在骨骼装配模式下可用（Ctrl+Tab 切换）')}
              onClick={() => onWeightBonePick?.(!weightBonePick)}
            >
              {weightBonePick ? '点选骨骼中…（再点退出）' : '添加绑定骨骼'}
            </button>
          </div>
          {weightBones.length > 0 ? weightBones.map((name, index) => {
            const percent = Math.round((weightShares?.[name] ?? 0) * 100);
            const selected = selectedWeightBone === name;
            // 滑块只在权重工具里、且舞台上选中了顶点时出现 —— 离开权重工具（切 B/V 等）即还原。
            const editing = !!weightMode && weightVertex != null;
            return (
              <div
                className={`weight-bone${selected ? ' selected' : ''}${editing ? ' editing' : ''}`}
                key={name}
                data-weight-bone={name}
                data-weight-percent={percent}
                data-weight-selected={selected ? '1' : '0'}
                ref={selected ? weightRowRef : undefined}
                onClick={() => setSelectedWeightBone(name)}
              >
                <i style={{ background: WEIGHT_COLORS[index % WEIGHT_COLORS.length] }} />
                <span className="weight-name" title={name}>{name}</span>
                {editing && (
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    data-weight-slider={name}
                    value={percent}
                    title={`${name} ${percent}%`}
                    onPointerDown={() => onBeginWeight?.()}
                    onChange={(event) => onWeightShare?.(name, Number(event.target.value))}
                  />
                )}
                {editing && <span className="weight-pct">{percent} %</span>}
                {selected && !editing && (
                  <button
                    data-weight-unbind={name}
                    disabled={!armatureMode}
                    title={armatureMode
                      ? `解绑 ${name}`
                      : (armatureLock || '解绑骨骼只在骨架装配模式下可用（Ctrl+Tab 切换）')}
                    onClick={(event) => { event.stopPropagation(); onRemoveWeightBone(name); }}
                  ><Icon name="x" size={10} /></button>
                )}
              </div>
            );
          }) : <div className="hint">这个网格还没有绑定骨骼</div>}
          {weightBones.length > 0 && weightVertex == null && (
            <div className="hint">点舞台上的饼图，再用进度条调这个顶点</div>
          )}
        </div>
      )}
      <div className="prop-group">
        <div className="group-head">
          <Icon name="eye" size={12} />
          <span>颜色 / 不透明度</span>
        </div>
        <div className="prop-row slot-color">
          <span className="ico"><Icon name="drop" size={12} /></span>
          <span className="label">颜色</span>
          <button
            type="button"
            className="slot-swatch"
            data-slot-color={swatchHex}
            title="选择颜色"
            style={{ background: `#${swatchHex}` }}
            onClick={() => {
              onBeginColorPreview?.();
              setPickerOrigin(swatch);
              setColorPicker(true);
            }}
          />
          <button
            type="button"
            className={`prop-flag${keyed ? ' on' : ''}`}
            data-slot-color-flag=""
            disabled={!animationMode}
            title={flagTitle}
            onClick={onToggleColorKey}
          >
            <Icon name="flag" size={13} />
          </button>
        </div>
        <div className="prop-row slot-color">
          <span className="ico"><Icon name="eye" size={12} /></span>
          <span className="label">不透明</span>
          <span className="slot-alpha">
            <input
              type="range"
              min={0}
              max={100}
              data-slot-alpha={color.aM ?? 100}
              value={color.aM ?? 100}
              onPointerDown={() => onBeginColor?.()}
              onChange={(event) => commitColor({ aM: Number(event.target.value) })}
            />
            <span className="pct">{Math.round(color.aM ?? 100)} %</span>
          </span>
          <button
            type="button"
            className={`prop-flag${keyed ? ' on' : ''}`}
            data-slot-alpha-flag=""
            disabled={!animationMode}
            title={flagTitle}
            onClick={onToggleColorKey}
          >
            <Icon name="flag" size={13} />
          </button>
        </div>
      </div>
      {colorPicker && pickerOrigin && (
        <ColorPickerDialog
          initial={pickerOrigin}
          onChange={(next) => commitColor({ rM: byteToChannel(next.r), gM: byteToChannel(next.g), bM: byteToChannel(next.b) })}
          onCancel={() => {
            setColorPicker(false);
            onCancelColorPreview?.();
          }}
          onConfirm={(next) => {
            const changed = next.r !== pickerOrigin.r || next.g !== pickerOrigin.g || next.b !== pickerOrigin.b;
            setColorPicker(false);
            onCommitColorPreview?.(changed);
          }}
        />
      )}
    </div>
  );
}
