/**
 * 偏好设置弹窗（官方 `Menu.File.Setting` / `Setting.*`）。
 *
 * 条目与文案对齐官方：常规（删除确认、图片平滑）/ 界面（骨骼颜色、背景网格尺寸），
 * 以及"重置所有偏好设置"。账户与语言在官方属于在线/多语言能力，这里如实说明离线不提供。
 */
import { useEffect, useState } from 'react';
import type { StudioSettings } from '../core/project/settings';
import { DEFAULT_HOTKEYS, bindingOf, findConflict, labelOf, normalizeKey } from '../core/hotkeys';
import { LOCALES, t, type Locale } from '../i18n';
import { Icon } from './icons';

export function SettingsDialog({
  settings, onChange, onReset, onClose,
  hotkeys, onHotkeyChange, onHotkeyReset, onHotkeyResetAll, locale, onLocaleChange,
}: {
  settings: StudioSettings;
  onChange: (patch: Partial<StudioSettings>) => void;
  onReset: () => void;
  onClose: () => void;
  /** P-09 快捷键覆盖表（官方 `Setting.hotkey`） */
  hotkeys: Record<string, string>;
  onHotkeyChange: (id: string, keys: string) => void;
  onHotkeyReset: (id: string) => void;
  onHotkeyResetAll: () => void;
  /** 界面语言（官方 Setting 里的「语言」） */
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
}) {
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  /** 正在等用户按下新键的动作 id */
  const [capturing, setCapturing] = useState<string | null>(null);

  useEffect(() => {
    if (!capturing) return;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') { setCapturing(null); return; }
      const keys = normalizeKey(event);
      if (!keys) return;
      onHotkeyChange(capturing, keys);
      setCapturing(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, onHotkeyChange]);
  return (
    <div
      data-settings-dialog=""
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 90, display: 'grid', placeItems: 'center',
        background: 'rgba(0, 0, 0, 0.45)',
      }}
    >
      <div
        onClick={stop}
        className="panel"
        style={{ minWidth: 420, maxWidth: 560, border: '1px solid var(--line-strong)' }}
      >
        <div className="panel-head">
          <Icon name="menu" size={13} />
          <span className="panel-title">{t('偏好设置')}</span>
          <span className="spacer" />
          <button className="head-btn" title={t('完成')} onClick={onClose}><Icon name="x" size={13} /></button>
        </div>
        <div className="panel-body" style={{ padding: 10, display: 'grid', gap: 10 }}>
          <div className="prop-group">
            <div className="group-head"><span>{t('常规')}</span></div>
            <label className="checkbox" style={{ padding: '2px 8px' }}
              title="删除前弹出确认对话框（官方 Setting.DeleteConfirmation）">
              <input
                type="checkbox"
                checked={settings.deleteConfirmation}
                onChange={(event) => onChange({ deleteConfirmation: event.target.checked })}
              />
              {t('删除确认提示')}
            </label>
            <label className="checkbox" style={{ padding: '2px 8px' }}
              title="官方 Setting.ImageSmooth：开启用线性过滤（平滑但可能发糊），关闭用最近邻（像素锐利）">
              <input
                type="checkbox"
                checked={settings.imageSmooth}
                onChange={(event) => onChange({ imageSmooth: event.target.checked })}
              />
              {t('图片平滑显示')}
            </label>
          </div>
          <div className="prop-group">
            <div className="group-head"><span>{t('界面')}</span></div>
            <div className="prop-row" style={{ gridTemplateColumns: '1fr 90px' }}>
              <span className="label">{t('骨骼颜色')}</span>
              <input
                type="color"
                value={settings.boneColor}
                onChange={(event) => onChange({ boneColor: event.target.value })}
              />
            </div>
            <div className="prop-row" style={{ gridTemplateColumns: '1fr 90px' }}>
              <span className="label">{t('背景网格尺寸')}</span>
              <input
                type="number" min={8} max={400} step={4}
                value={settings.backgroundGridSize}
                onChange={(event) => onChange({ backgroundGridSize: Number(event.target.value) })}
              />
            </div>
          </div>
          <div className="prop-group">
            <div className="group-head"><span>{t('快捷键')}</span></div>
            <div className="muted" style={{ padding: '0 8px 4px', fontSize: 11 }}>
              点按键格再按任意键改绑（官方 `Setting.hotkey.set`）；「默认」清掉该动作的覆盖，
              底部的「恢复默认快捷键设置」清掉全部（官方 `Setting.hotkey.default`）。
            </div>
            {DEFAULT_HOTKEYS.map((action) => {
              const keys = bindingOf(action.id, hotkeys);
              const custom = hotkeys[action.id] !== undefined;
              const conflict = findConflict(action.id, keys, hotkeys);
              return (
                <div className="prop-row" key={action.id} style={{ gridTemplateColumns: '1fr 120px 60px' }}>
                  <span className="label">{t(action.label)}</span>
                  <button
                    className={`chip${capturing === action.id ? ' on' : ''}`}
                    data-hotkey-bind={action.id}
                    title={conflict ? `与「${labelOf(conflict)}」冲突` : '点击后按新键'}
                    onClick={() => setCapturing(action.id)}
                  >
                    {capturing === action.id ? t('按键...') : (keys || '（无）')}
                  </button>
                  <button
                    className="chip"
                    data-hotkey-reset={action.id}
                    disabled={!custom}
                    onClick={() => onHotkeyReset(action.id)}
                  >{t('默认')}</button>
                </div>
              );
            })}
            <div className="row" style={{ padding: '4px 8px' }}>
              <button className="chip" data-hotkey-reset-all="" onClick={onHotkeyResetAll}>{t('恢复默认快捷键设置')}</button>
            </div>
          </div>
          <div className="prop-group">
            <div className="group-head"><span>{t('账户 / 语言')}</span></div>
            <div className="prop-row" style={{ gridTemplateColumns: '1fr 150px' }}>
              <span className="label">{t('语言')}</span>
              <select data-locale-select="" value={locale} onChange={(event) => onLocaleChange(event.target.value as Locale)}>
                {LOCALES.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
              </select>
            </div>
            <div className="muted" style={{ padding: '0 8px', fontSize: 11, lineHeight: 1.6 }}>
              账户与云服务依赖官方在线接口 —— 离线版本没有对应服务端，因此在范围之外（见 docs/ACCEPTANCE.md 的 P2 段）。
            </div>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button className="chip" onClick={onReset}>{t('重置所有偏好设置')}</button>
            <button className="chip on" onClick={onClose}>{t('完成')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
