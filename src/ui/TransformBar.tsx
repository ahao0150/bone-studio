/**
 * 舞台底部的**变换控件条**（官方画布下缘那条细长控件，见 `DBPRO-SPEC.md` §72）。
 *
 * 四组，按官方截图排两行：
 *   ① `✥` 位置：X / Y        ② `◪` 缩放：scX / scY（带**锁定宽高比**）
 *   ③ `↻` 旋转：角度         ④ `I|◪` 尺寸：骨骼的**长度**（骨骼没有高度，第二格留空）
 * 每组右侧的**旗标**就是官方那个"在当前帧记录这组数值"的开关 —— 这里接既有的
 * “在当前帧打 / 删关键帧”（动画制作模式下才可用）。
 */
import { useEffect, useState } from 'react';
import { Icon } from './icons';
import type { ToolId } from './chrome';
import type { BoneTransformValues } from '../core/editing';

export function TransformBar({
  label, values, length, keyAtFrame, animationMode, tool, onTool, onChange, onLength, onKey, playbackLock, transformLocked, keyed,
}: {
  /** 当前选中的骨骼（null 时数字框禁用；四个工具图标仍然可点） */
  label: string | null;
  values: BoneTransformValues | null;
  length?: number;
  keyAtFrame: boolean;
  /** 旗标只在动画制作模式下可用（装配模式 K 帧没有意义） */
  animationMode: boolean;
  /** 与左侧工具条同一套工具，点图标互相点亮 */
  tool: ToolId;
  onTool: (id: ToolId) => void;
  /** 播放中锁死 Z/X/C/V：图标和数字框都不能改动画 */
  playbackLock?: boolean;
  /** IK 链内的骨骼：local 会被 IK 求解覆盖，数字框与工具按钮整体锁死 */
  transformLocked?: boolean;
  onChange: (patch: Partial<BoneTransformValues>) => void;
  onLength?: (value: number) => void;
  onKey: (channel?: 'translate' | 'rotate' | 'scale') => void;
  /** 三通道各自的「当前帧已有关键帧」状态 —— 旗杆红（已有）/ 白（可以 K），官方口径 */
  keyed?: { translate: boolean; rotate: boolean; scale: boolean } | null;
}) {
  const [lockAspect, setLockAspect] = useState(true);
  // 换骨骼时回到默认（锁定），避免上一根的状态误导
  useEffect(() => { setLockAspect(true); }, [label]);
  const disabled = !label || !values || !!playbackLock || !!transformLocked;
  const num = (value: number | undefined) => (typeof value === 'number' ? Number(value.toFixed(3)) : 0);
  const commitScale = (axis: 'scX' | 'scY', value: number) => {
    if (!values) return;
    if (!lockAspect) { onChange({ [axis]: value } as Partial<BoneTransformValues>); return; }
    const other = axis === 'scX' ? values.scY : values.scX;
    const base = axis === 'scX' ? values.scX : values.scY;
    const ratio = base === 0 ? 1 : value / base;
    const nextOther = other * ratio;
    onChange(axis === 'scX'
      ? { scX: value, scY: nextOther }
      : { scY: value, scX: nextOther });
  };
  const field = (
    key: string, value: number | undefined, onCommit: (value: number) => void, step = 1,
  ) => (
    <input
      key={key}
      data-transform-field={key}
      className="tb-input"
      type="number"
      step={step}
      disabled={disabled}
      title={transformLocked ? '该骨骼在 IK 约束链内：姿态由 IK 求解决定，改这里不会生效' : undefined}
      value={num(value)}
      onChange={(event) => onCommit(Number(event.target.value))}
    />
  );
  /** 旗杆：红 = 当前帧已经有这个属性的关键帧（再点即删），白 = 可以 K。`channel` 缺省表示不受通道控制的字段（长度）。 */
  const flag = (id: string, title: string, channel?: 'translate' | 'rotate' | 'scale') => (
    <button
      className={`tb-flag${channel && keyed?.[channel] ? ' on' : ''}`}
      data-transform-flag={id}
      disabled={!animationMode || disabled}
      title={animationMode
        ? (channel && keyed?.[channel] ? `${title}（当前帧已有，点一下删除）` : title)
        : '切换到「动画制作」再打关键帧'}
      onClick={() => onKey(channel)}
    >
      <Icon name="flag" size={13} />
    </button>
  );
  const toolButton = (id: ToolId, icon: 'move' | 'scale' | 'rotate' | 'free', title: string) => (
    <button
      type="button"
      className={`tb-ico${tool === id ? ' on' : ''}`}
      data-transform-tool={id}
      title={playbackLock ? `${title}（播放中已锁定）` : title}
      disabled={!!playbackLock}
      onClick={() => { if (!playbackLock) onTool(id); }}
    >
      <Icon name={icon} size={13} />
    </button>
  );
  return (
    <div className={`transform-bar${disabled ? ' off' : ''}`} data-transform-bar="">
      <div className="tb-grid">
        <div className="tb-group" data-transform-group="position">
          {toolButton('move', 'move', '平移（Z）')}
          {field('x', values?.x, (value) => onChange({ x: value }))}
          {field('y', values?.y, (value) => onChange({ y: value }))}
          {flag('position', '在当前帧记录位置', 'translate')}
        </div>
        <div className="tb-group" data-transform-group="scale">
          {toolButton('scale', 'scale', '缩放（C）')}
          {field('scX', values?.scX, (value) => commitScale('scX', value), 0.01)}
          {field('scY', values?.scY, (value) => commitScale('scY', value), 0.01)}
          <button
            className={`tb-flag${lockAspect ? ' on' : ''}`}
            data-transform-lock=""
            disabled={disabled}
            title={lockAspect ? '已锁定宽高比（改一个另一个跟着走）' : '未锁定：宽高各改各的'}
            onClick={() => setLockAspect((value) => !value)}
          >
            <Icon name={lockAspect ? 'lock' : 'unlock'} size={13} />
          </button>
          {flag('scale', '在当前帧记录缩放', 'scale')}
        </div>
        <div className="tb-group" data-transform-group="rotation">
          {toolButton('rotate', 'rotate', '旋转（X）')}
          {field('rotation', values?.skX, (value) => onChange({ skX: value, skY: value }))}
          <span className="tb-blank" />
          {flag('rotation', '在当前帧记录旋转', 'rotate')}
        </div>
        <div className="tb-group" data-transform-group="size">
          {toolButton('free', 'free', '自由变换（V）')}
          {field('length', length, (value) => onLength?.(value))}
          <span className="tb-blank" />
          {flag('length', '在当前帧记录长度')}
        </div>
      </div>
    </div>
  );
}
