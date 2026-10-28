/**
 * 导出对话框「动画数据+纹理」页的数据类型表（官方 `Export.superType.data`）。
 *
 * 数据类型：`Export.json` / `Export.type.Binary` / `ExportSp.version3_3`；
 * 版本 `Export.version4_0/4_5` + 5.5。其他厂商格式不做。
 * 只列本工程真能写出的版本，其余灰显。
 */

export type ExportDataType = 'dbjson' | 'dbbin' | 'spine';

export interface ExportDataTypeDef {
  id: ExportDataType;
  label: string;
  /** 数据版本下拉；只有一个可用版本时仍显示，方便看清写出的是哪个版本 */
  versions?: Array<{ id: string; label: string; disabled?: boolean }>;
  /** 是否提供「打包zip」（官方只在 DragonBones 格式上出现） */
  zip: boolean;
}

export const EXPORT_DATA_TYPES: ExportDataTypeDef[] = [
  {
    id: 'dbjson',
    label: 'DragonBones JSON',
    versions: [
      { id: '5.5', label: '5.5' },
      { id: '5.0', label: '5.0（后续支持）', disabled: true },
      { id: '4.5', label: '4.5（后续支持）', disabled: true },
      { id: '4.0', label: '4.0（后续支持）', disabled: true },
    ],
    zip: true,
  },
  { id: 'dbbin', label: 'DragonBones 二进制', zip: true },
  {
    id: 'spine',
    label: 'Spine',
    versions: [{ id: '4.2', label: '4.2（默认）' }, { id: '4.1', label: '4.1' }, { id: '3.6.52', label: '3.6.52（旧版）' }],
    zip: false,
  },
];

export interface ExportRequest {
  type: ExportDataType;
  /** 项目名：所有产物文件名的前缀 */
  name: string;
  data: boolean;
  texture: boolean;
  zip: boolean;
  /** true = 选择文件夹写入（File System Access API）；false = 浏览器逐个下载 */
  toDirectory: boolean;
  /** 数据版本（Spine：4.2 / 4.1 / 3.6.52；DragonBones：5.5） */
  version?: string;
}

/** 按官方命名约定列出将要生成的文件（对话框「生成」下方的清单与实际写出共用这一份）。 */
export function exportFileNames(request: Pick<ExportRequest, 'type' | 'name' | 'data' | 'texture' | 'zip'>, hasTexture: boolean): string[] {
  const { type, name } = request;
  const texture = request.texture && hasTexture;
  const files: string[] = [];
  if (type === 'spine') {
    if (request.data) files.push(`${name}.json`);
    if (texture) files.push(`${name}.atlas`, `${name}.png`);
    return files;
  }
  if (request.data) files.push(type === 'dbbin' ? `${name}_ske.dbbin` : `${name}_ske.json`);
  if (texture) files.push(`${name}_tex.json`, `${name}_tex.png`);
  if (request.zip && files.length > 0) return [`${name}.zip`];
  return files;
}
