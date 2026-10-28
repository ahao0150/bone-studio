/**
 * 舞台过滤器条（官方 `_953/StageFilterBar.as`，文案 `StageFilterBar.*`）。
 *
 * 结构照官方：一列表头（可见控制 / 选择控制 / 继承控制）+ 两行数据（骨骼 / 图片），共 6 个开关。
 * 表头画列图标（`/assets/stageIcon/*`），数据格只画状态记号 —— **开 = 实心圆点，关 = 叉**
 * （官方 `StageFilterBar` 的开/关贴图），开关列本身不再重复列图标。
 * 状态在 `src/core/stageFilter.ts`（含取值与默认值的格式验证说明）；本组件只负责画与回调。
 */
import { Icon } from './icons';
import type { StageFilter } from '../core/stageFilter';

export interface StageFilterBarProps {
  filter: StageFilter;
  onToggle: (key: keyof StageFilter) => void;
}

/** 状态记号：开 = 实心圆点，关 = 叉（就地画 SVG，16×14 的格子里点约 6px、叉约 8px）。 */
function Mark({ on }: { on: boolean }) {
  return (
    <svg className="sft-mark" data-sft-mark={on ? 'on' : 'off'} width={12} height={12} viewBox="0 0 12 12" aria-hidden="true">
      {on ? (
        <circle cx={6} cy={6} r={3} fill="currentColor" />
      ) : (
        <path
          d="M2.4 2.4 9.6 9.6M9.6 2.4 2.4 9.6"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

export function StageFilterBar({ filter, onToggle }: StageFilterBarProps) {
  const cell = (key: keyof StageFilter, title: string) => (
    <button
      type="button"
      className={`sft${filter[key] ? ' on' : ''}`}
      data-stage-filter={key}
      aria-pressed={filter[key]}
      title={title}
      onClick={() => onToggle(key)}
    >
      <Mark on={filter[key]} />
    </button>
  );
  return (
    <div className="stage-filter-bar" data-stage-filter-bar="">
      <span className="sft-head" />
      <span className="sft-head" title="可见控制"><Icon name="eye" size={10} /></span>
      <span className="sft-head" title="选择控制"><Icon name="cursor" size={10} /></span>
      <span className="sft-head" title="继承控制"><Icon name="control" size={10} /></span>

      <span className="sft-row" title="骨骼"><Icon name="bone" size={10} /></span>
      {cell('boneVisible', '骨骼可见')}
      {cell('boneSelectable', '骨骼可选')}
      {cell('boneInherit', '子骨骼可控')}

      <span className="sft-row" title="图片"><Icon name="image" size={10} /></span>
      {cell('imageVisible', '图片可见')}
      {cell('imageSelectable', '图片可选')}
      {cell('imageInherit', '子图片可控')}
    </div>
  );
}
