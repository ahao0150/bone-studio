/**
 * 「文件 → 导出...」对话框（官方 `Menu.File.Export` / `Export.*`）。
 * 三个页签对应官方 `Export.superType.data / image / webpage`；图片与 HTML 页后续支持，先灰显占位。
 * 纹理不内嵌预览，点「查看…」开独立的图片预览框。
 */
import { useState } from 'react';
import { Icon } from './icons';
import { TextureViewer } from './TextureViewer';
import { EXPORT_DATA_TYPES, exportFileNames, type ExportDataType, type ExportRequest } from './exportFormats';

const ROW: React.CSSProperties = { display: 'grid', gridTemplateColumns: '68px 1fr', alignItems: 'center', gap: 6, minHeight: 24 };
const SECTION: React.CSSProperties = { display: 'grid', gap: 4, padding: '6px 0', borderTop: '1px solid var(--line)' };
const HEAD: React.CSSProperties = { fontSize: 11, color: 'var(--text-dim)' };

export function ExportDialog({ armatureName, projectName, atlasUrl, canPickDirectory, onExport, onClose }: {
  armatureName: string;
  projectName: string;
  atlasUrl: string | null;
  canPickDirectory: boolean;
  onExport: (request: ExportRequest) => Promise<boolean>;
  onClose: () => void;
}) {
  const [type, setType] = useState<ExportDataType>('dbjson');
  const [name, setName] = useState(projectName);
  const [data, setData] = useState(true);
  const [texture, setTexture] = useState(true);
  const [zip, setZip] = useState(false);
  const [toDirectory, setToDirectory] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [versionByType, setVersionByType] = useState<Record<string, string>>({});
  const def = EXPORT_DATA_TYPES.find((entry) => entry.id === type) ?? EXPORT_DATA_TYPES[0];
  const hasTexture = !!atlasUrl;
  const version = versionByType[type] ?? def.versions?.[0]?.id;
  const request: ExportRequest = { type, name: name.trim(), data, texture, zip: def.zip && zip, toDirectory, version };
  const files = exportFileNames(request, hasTexture);
  const canExport = !busy && request.name.length > 0 && files.length > 0;
  const submit = async () => {
    if (!canExport) return;
    setBusy(true);
    const ok = await onExport(request).catch(() => false);
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <div data-export-dialog="" onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 95, display: 'grid', placeItems: 'center', background: 'rgba(0, 0, 0, 0.45)' }}>
      <div className="panel" onClick={(event) => event.stopPropagation()}
        style={{ width: 460, maxWidth: '96vw', border: '1px solid var(--line-strong)', fontSize: 12 }}>
        <div className="panel-head">
          <Icon name="menu" size={13} />
          <span className="panel-title">导出</span>
          <span className="spacer" />
          <button className="head-btn" title="取消" onClick={onClose}><Icon name="x" size={13} /></button>
        </div>
        <div className="panel-body" style={{ padding: '8px 12px', display: 'grid', gap: 2 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2, marginBottom: 4 }}>
            <button className="chip on" data-export-tab="data">动画数据+纹理</button>
            <button className="chip" data-export-tab="image" disabled title="后续支持（官方 Export.superType.image：序列帧 / GIF / 纹理图）">图片</button>
            <button className="chip" data-export-tab="html" disabled title="后续支持（官方 Export.superType.webpage）">HTML</button>
          </div>
          <div style={ROW}><span>目标：</span><span data-export-target="">{armatureName}</span></div>
          <div style={SECTION}>
            <span style={HEAD}>数据设置</span>
            <label style={ROW}><span>数据类型：</span>
              <select data-export-type="" value={type} onChange={(event) => setType(event.target.value as ExportDataType)}>
                {EXPORT_DATA_TYPES.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
              </select>
            </label>
            {def.versions && (
              <label style={ROW}><span>数据版本：</span>
                <select data-export-version="" value={version} key={def.id} onChange={(event) => setVersionByType((prev) => ({ ...prev, [type]: event.target.value }))}>
                  {def.versions.map((v) => <option key={v.id} value={v.id} disabled={v.disabled}>{v.label}</option>)}
                </select>
              </label>
            )}
          </div>
          <div style={SECTION}>
            <span style={HEAD}>纹理设置</span>
            <div style={ROW}><span>纹理类型：</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                纹理集 · 100 %
                {hasTexture
                  ? <button className="chip" data-export-view-texture="" onClick={() => setViewing(true)}>查看…</button>
                  : <span style={HEAD}>（当前工程没有纹理）</span>}
              </span>
            </div>
          </div>
          <div style={SECTION}>
            <label style={ROW}><span>导出到：</span>
              <select data-export-dest="" value={toDirectory ? 'dir' : 'download'} onChange={(event) => setToDirectory(event.target.value === 'dir')}>
                <option value="download">浏览器下载</option>
                <option value="dir" disabled={!canPickDirectory}>选择文件夹…{canPickDirectory ? '' : '（当前浏览器不支持）'}</option>
              </select>
            </label>
            <label style={ROW}><span>项目名：</span>
              <input data-export-name="" value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <div style={{ ...ROW, alignItems: 'start' }}><span style={{ lineHeight: '20px' }}>生成：</span>
              <div style={{ display: 'grid', gap: 2 }}>
                <div style={{ display: 'flex', gap: 12, minHeight: 20, alignItems: 'center' }}>
                  <label className="checkbox"><input type="checkbox" data-export-data="" checked={data} onChange={(e) => setData(e.target.checked)} />数据</label>
                  <label className="checkbox"><input type="checkbox" data-export-texture="" checked={texture} disabled={!hasTexture} onChange={(e) => setTexture(e.target.checked)} />纹理</label>
                  {def.zip && <label className="checkbox"><input type="checkbox" data-export-zip="" checked={zip} onChange={(e) => setZip(e.target.checked)} />打包zip</label>}
                </div>
                <div data-export-files="" style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-dim)', wordBreak: 'break-all' }}>
                  {files.length > 0 ? files.map((file) => <div key={file}>{file}</div>) : <div>（没有要生成的文件）</div>}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '6px 12px 10px', borderTop: '1px solid var(--line)' }}>
          <button className="chip on" data-export-ok="" disabled={!canExport} onClick={() => { void submit(); }}>{busy ? '导出中…' : '完成'}</button>
          <button className="chip" data-export-cancel="" onClick={onClose}>取消</button>
        </div>
      </div>
      {viewing && atlasUrl && <TextureViewer url={atlasUrl} title={`纹理预览 · ${name.trim() || projectName}`} onClose={() => setViewing(false)} />}
    </div>
  );
}
