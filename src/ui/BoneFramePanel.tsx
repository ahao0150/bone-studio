/**
 * 骨骼关键帧面板（官方 `BoneFramePropertyGroup` / `TweenFolderItem`）：选中骨骼在播放头正好有键时出现。
 * - 补间：不补间 / 线性（曲线由下方「曲线编辑器」编辑，这里只显示状态）
 * - 旋转：自动 / 顺时针 / 逆时针 + 圈数 0–99。编码：0 = 自动；顺时针 n 圈 = n + 1；逆时针 n 圈 = -(n + 1)。
 */
import { Icon } from './icons';

export interface BoneFramePanelProps {
  bone: string;
  tween: 'none' | 'line' | 'curve';
  rotate: number;
  onTween: (mode: 'none' | 'line') => void;
  onRotate: (value: number) => void;
}

type Dir = 'auto' | 'cw' | 'ccw';

export function BoneFramePanel({ bone, tween, rotate, onTween, onRotate }: BoneFramePanelProps) {
  const dir: Dir = rotate === 0 ? 'auto' : rotate > 0 ? 'cw' : 'ccw';
  const loops = rotate === 0 ? 0 : Math.abs(rotate) - 1;
  const encode = (next: Dir, count: number) => (next === 'auto' ? 0 : next === 'cw' ? count + 1 : -(count + 1));
  return (
    <div className="prop-group" data-bone-frame-panel={bone}>
      <div className="group-head">
        <Icon name="key" size={12} />
        <span>骨骼关键帧</span>
        <span className="spacer" />
        <span className="muted">{bone}</span>
      </div>
      <div className="prop-row" style={{ gridTemplateColumns: '64px 1fr' }}>
        <span className="label">补间</span>
        <select data-bone-tween="" value={tween} onChange={(event) => onTween(event.target.value as 'none' | 'line')}>
          <option value="none">不补间</option>
          <option value="line">线性</option>
          {tween === 'curve' && <option value="curve">自定义（曲线）</option>}
        </select>
      </div>
      <div className="prop-row" style={{ gridTemplateColumns: '64px 1fr 56px' }}>
        <span className="label">旋转</span>
        <select
          data-bone-rotate-dir=""
          value={dir}
          disabled={tween === 'none'}
          onChange={(event) => onRotate(encode(event.target.value as Dir, loops))}
        >
          <option value="auto">自动</option>
          <option value="cw">顺时针</option>
          <option value="ccw">逆时针</option>
        </select>
        <input
          data-bone-rotate-loops=""
          type="number"
          min={0}
          max={99}
          value={loops}
          disabled={tween === 'none' || dir === 'auto'}
          onChange={(event) => onRotate(encode(dir, Math.max(0, Math.min(99, Math.round(Number(event.target.value) || 0)))))}
        />
      </div>
    </div>
  );
}
