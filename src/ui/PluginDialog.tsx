/**
 * 插件管理对话框（官方 `Menu.Help.Plugin`「插件管理...」/ `Plugin.Title`「插件管理」）。
 *
 * 界面沿用官方那份**语义**（已安装数量 / 选择插件 / 开启·禁用 / 卸载），但清单与加载方式
 * 按新编辑器架构走：插件是 ESM 模块（`entry` URL 或导入时保存的单文件 `source`），
 * 导出 `activate(api)`。本组件**无状态** —— 安装 / 启停 / 卸载都交给 App 动 `localStorage`，
 * 便于端到端断言。
 */
import { useRef, useState } from 'react';
import { Icon } from './icons';
import type { PluginManifest } from '../plugins/registry';

export interface PluginDialogProps {
  plugins: PluginManifest[];
  onInstallFile: (file: File) => void;
  onInstallUrl: (url: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onRemove: (id: string) => void;
  onRun: (plugin: PluginManifest) => void;
  onClose: () => void;
}

const COLUMNS = '1fr 62px 84px 66px 168px';

export function PluginDialog({
  plugins, onInstallFile, onInstallUrl, onToggle, onRemove, onRun, onClose,
}: PluginDialogProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  const installUrl = () => {
    const value = url.trim();
    if (value === '') return;
    onInstallUrl(value);
    setUrl('');
  };
  return (
    <div
      data-plugin-dialog=""
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 95, display: 'grid', placeItems: 'center', background: 'rgba(0, 0, 0, 0.45)' }}
    >
      <div onClick={stop} className="panel" style={{ minWidth: 620, maxWidth: 780, border: '1px solid var(--line-strong)' }}>
        <div className="panel-head">
          <Icon name="layers" size={13} />
          <span className="panel-title">插件管理</span>
          <span className="spacer" />
          <span className="muted" style={{ fontSize: 11 }} data-plugin-count={plugins.length}>已安装插件 {plugins.length} 款</span>
          <button className="head-btn" title="关闭" onClick={onClose}><Icon name="x" size={13} /></button>
        </div>
        <div className="panel-body" style={{ padding: 10, display: 'grid', gap: 8, maxHeight: '62vh', overflow: 'auto' }}>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <button className="chip" data-plugin-pick="" onClick={() => fileRef.current?.click()}>选择插件...</button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,.js,.mjs,application/json,text/javascript"
              data-plugin-file=""
              style={{ display: 'none' }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onInstallFile(file);
                event.target.value = '';
              }}
            />
            <input
              type="text"
              className="url-input"
              data-plugin-url=""
              placeholder="或粘贴插件模块 URL（ESM）"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') installUrl(); }}
              style={{ flex: 1, minWidth: 180 }}
            />
            <button className="chip" data-plugin-install-url="" disabled={url.trim() === ''} onClick={installUrl}>从 URL 安装</button>
          </div>
          <span className="muted" style={{ fontSize: 11 }}>
            插件是 ESM 模块，导出 <code>activate(api)</code>；用 <code>api.registerCapability()</code> 注册能力
            （只产出命令，编辑器审阅后应用 → 可撤销）。插件与编辑器同源运行，**不是沙箱**，只装可信插件。
          </span>
          <div style={{ display: 'grid', gap: 4 }}>
            <div className="table-row" style={{ gridTemplateColumns: COLUMNS, color: 'var(--text-mute)', fontSize: 11 }}>
              <span>名称</span><span>版本</span><span>作者</span><span>状态</span><span>操作</span>
            </div>
            {plugins.map((plugin) => (
              <div
                key={plugin.id}
                className="table-row"
                data-plugin-row={plugin.id}
                style={{ gridTemplateColumns: COLUMNS, alignItems: 'center' }}
                title={plugin.description ?? plugin.entry ?? ''}
              >
                <span>{plugin.name}</span>
                <span className="muted">{plugin.version ?? '-'}</span>
                <span className="muted">{plugin.author ?? '-'}</span>
                <span className="muted" data-plugin-status={plugin.id}>{plugin.enabled === false ? '已禁用' : '已启用'}</span>
                <span className="row" style={{ gap: 4 }}>
                  <button className="chip" data-plugin-run={plugin.id} disabled={plugin.enabled === false} onClick={() => onRun(plugin)}>运行</button>
                  <button className="chip" data-plugin-toggle={plugin.id} onClick={() => onToggle(plugin.id, plugin.enabled === false)}>
                    {plugin.enabled === false ? '开启' : '禁用'}
                  </button>
                  <button className="chip" data-plugin-remove={plugin.id} onClick={() => onRemove(plugin.id)}>卸载</button>
                </span>
              </div>
            ))}
            {plugins.length === 0 && (
              <span className="muted" style={{ fontSize: 11, padding: '6px 2px' }}>
                还没有安装插件 —— 用「选择插件...」导入清单 JSON / 单文件 .js，或粘贴模块 URL
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}