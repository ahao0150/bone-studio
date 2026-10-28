import { useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { CurvePresetName, CurveState } from '../core/curveEdit';
import { CURVE_PRESETS, curveSamples } from '../core/curveEdit';
import { Icon, type IconName } from './icons';

const PRESET_ICONS: Record<CurvePresetName, IconName> = {
  step: 'curveStep',
  linear: 'curveLinear',
  easeIn: 'curveEaseIn',
  easeOut: 'curveEaseOut',
  easeInOut: 'curveEaseInOut',
};

export interface CurvePanelProps {
  /** the keyframe the panel is editing (official: the curve *after* the selected key) */
  target: { bone: string; frame: number } | null;
  state: CurveState | null;
  onPreset: (preset: CurvePresetName) => void;
  onEdit: (points: number[]) => void;
  onCopy: () => void;
  onPaste: () => void;
  hasClipboard: boolean;
}

const W = 240;
const H = 150;
const PAD = 22;

/** value (0..1+) -> canvas y */
const toY = (value: number) => H - PAD - value * (H - PAD * 2);
const toX = (t: number) => PAD + t * (W - PAD * 2);

/**
 * Animation curve editor (official 曲线编辑器): shows the curve after the selected
 * keyframe, its draggable bezier handles and the vendor's preset buttons.
 * See docs/UX-DESIGN.md 「曲线编辑器」 and docs/DBPRO-SPEC.md §21.
 */
export function CurvePanel(props: CurvePanelProps) {
  const { target, state, onPreset, onEdit, onCopy, onPaste, hasClipboard } = props;
  const svgRef = useRef<SVGSVGElement>(null);

  const points = state?.kind === 'curve' ? state.points : [];
  const samples = useMemo(
    () => curveSamples(points, 33, state?.kind === 'step' ? 'step' : state?.kind === 'curve' ? 'curve' : 'linear'),
    [points, state?.kind],
  );
  // 台阶：进度一直停在 0，到区间右端才跳到 1。均匀采样连成折线会把这一跳画成贴底横线。
  const polyline = state?.kind === 'step'
    ? `${toX(0).toFixed(1)},${toY(0).toFixed(1)} ${toX(1).toFixed(1)},${toY(0).toFixed(1)} ${toX(1).toFixed(1)},${toY(1).toFixed(1)}`
    : samples.map((value, index) => {
      const t = samples.length > 1 ? index / (samples.length - 1) : 0;
      return `${toX(t).toFixed(1)},${toY(value).toFixed(1)}`;
    }).join(' ');

  const dragHandle = (event: ReactPointerEvent<SVGCircleElement>, index: 0 | 1) => {
    if (state?.kind !== 'curve') return;
    if (svgRef.current) svgRef.current.dataset.dragging = '1';
    event.stopPropagation();
    event.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const move = (moveEvent: PointerEvent) => {
      const t = (moveEvent.clientX - rect.left - PAD) / (rect.width - PAD * 2);
      const value = 1 - (moveEvent.clientY - rect.top - PAD) / (rect.height - PAD * 2);
      const next = [...points];
      const at = index * 2;
      next[at] = Math.round(Math.max(0, Math.min(1, t)) * 1000) / 1000;
      next[at + 1] = Math.round(value * 1000) / 1000;
      onEdit(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (svgRef.current) delete svgRef.current.dataset.dragging;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const handles = state?.kind === 'curve' && points.length >= 4
    ? [
      { x: toX(points[0]), y: toY(points[1]) },
      { x: toX(points[2]), y: toY(points[3]) },
    ]
    : [];

  const presetButtons: Array<{ id: CurvePresetName; label: string }> = [
    { id: 'step', label: CURVE_PRESETS.step.label },
    { id: 'linear', label: CURVE_PRESETS.linear.label },
    { id: 'easeIn', label: CURVE_PRESETS.easeIn.label },
    { id: 'easeOut', label: CURVE_PRESETS.easeOut.label },
    { id: 'easeInOut', label: CURVE_PRESETS.easeInOut.label },
  ];

  return (
    <div className="curve-panel">
      <div className="curve-head">
        <span className="muted">
          {target ? `${target.bone} @ ${target.frame} 帧` : '选中一个关键帧'}
        </span>
        <span className="spacer" />
        <span className="muted">{state ? `${state.kind}${state.duration ? ` · ${state.duration} 帧` : ''}` : ''}</span>
      </div>
      <svg
        ref={svgRef}
        className="curve-canvas"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        data-testid="curve-canvas"
        data-curve={points.join(",")}
        data-kind={state?.kind ?? "none"}
      >
        <rect x={PAD} y={PAD} width={W - PAD * 2} height={H - PAD * 2} className="curve-box" />
        {[0.25, 0.5, 0.75].map((t) => (
          <line key={`h${t}`} x1={PAD} x2={W - PAD} y1={toY(t)} y2={toY(t)} className="curve-grid" />
        ))}
        {[0.25, 0.5, 0.75].map((t) => (
          <line key={`v${t}`} y1={PAD} y2={H - PAD} x1={toX(t)} x2={toX(t)} className="curve-grid" />
        ))}
        <line x1={PAD} y1={toY(0)} x2={W - PAD} y2={toY(1)} className="curve-linear" />
        <polyline points={polyline} className={`curve-line${state?.kind === 'step' ? ' stepped' : ''}`} />
        {handles.map((handle, index) => (
          <g key={`h-${index}`}>
            <line x1={toX(index === 0 ? 0 : 1)} y1={toY(index === 0 ? 0 : 1)} x2={handle.x} y2={handle.y} className="curve-arm" />
            <circle
              cx={handle.x}
              cy={handle.y}
              r={4}
              className="curve-handle"
              onPointerDown={(event) => dragHandle(event, index === 0 ? 0 : 1)}
            />
          </g>
        ))}
        <text x={2} y={12} className="curve-label">100</text>
        <text x={2} y={H - 4} className="curve-label">0</text>
      </svg>
      <div className="curve-presets">
        {presetButtons.map((entry) => (
          <button
            key={entry.id}
            className="chip"
            data-curve-preset={entry.id}
            disabled={!target}
            onClick={() => onPreset(entry.id)}
            title={entry.label}
            aria-label={entry.label}
          >
            <Icon name={PRESET_ICONS[entry.id]} size={14} />
          </button>
        ))}
        <span className="spacer" />
        <button className="chip" data-curve-preset="copy" disabled={!target} onClick={onCopy} title="复制当前曲线" aria-label="复制当前曲线"><Icon name="copy" size={13} /></button>
        <button className="chip" data-curve-preset="paste" disabled={!hasClipboard || !target} onClick={onPaste} title="粘贴曲线" aria-label="粘贴曲线"><Icon name="paste" size={13} /></button>
      </div>
    </div>
  );
}
