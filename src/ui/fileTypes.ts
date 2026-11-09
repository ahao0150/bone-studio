/**
 * 文件类型配置：统一管理 BoneStudio 支持的文件格式和 MIME 类型。
 *
 * 解决的问题：
 * 1. 某些操作系统生成大写扩展名（.JSON, .DBBIN），`accept` 需要同时包含大小写变体
 * 2. 某些浏览器需要 MIME 类型才能正确过滤文件
 * 3. File System Access API 的 `types` 格式与 `<input accept>` 格式不同
 */

/** 支持的文件扩展名（小写，不含点） */
export const FILE_EXTENSIONS = {
  skeleton: ['json', 'dbbin', 'dbproj'],
  texture: ['json'],
  image: ['png', 'jpg', 'jpeg', 'webp'],
  atlas: ['atlas'],
  plugin: ['json', 'js', 'mjs'],
  reference: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'],
} as const;

/** 文件 MIME 类型映射 */
export const MIME_TYPES: Record<string, string> = {
  json: 'application/json',
  dbbin: 'application/octet-stream',
  dbproj: 'application/octet-stream',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  atlas: 'text/plain',
  js: 'text/javascript',
  mjs: 'text/javascript',
};

/**
 * 生成 `<input accept>` 属性值。
 * 同时包含小写和大写扩展名变体，以及相关的 MIME 类型。
 *
 * @param extensions 要包含的扩展名（不含点）
 * @returns accept 属性值，如 ".json,.JSON,application/json,.png,.PNG,image/png"
 */
export function buildAccept(extensions: readonly string[]): string {
  const parts: string[] = [];
  const seenMimes = new Set<string>();

  for (const ext of extensions) {
    parts.push(`.${ext.toLowerCase()}`);
    parts.push(`.${ext.toUpperCase()}`);

    const mime = MIME_TYPES[ext.toLowerCase()];
    if (mime && !seenMimes.has(mime)) {
      seenMimes.add(mime);
      parts.push(mime);
    }
  }

  return parts.join(',');
}

/** 打开项目的 accept 属性（骨架 + 图集 + 图片 + atlas） */
export const ACCEPT_OPEN_PROJECT = buildAccept([
  ...FILE_EXTENSIONS.skeleton,
  ...FILE_EXTENSIONS.image,
  ...FILE_EXTENSIONS.atlas,
]);

/** 导入数据到项目的 accept 属性（骨架文件） */
export const ACCEPT_IMPORT_DATA = buildAccept(FILE_EXTENSIONS.skeleton);

/** 导入资源（PNG 图片）的 accept 属性 */
export const ACCEPT_IMPORT_ASSET = buildAccept(['png']);

/** 插件文件的 accept 属性 */
export const ACCEPT_PLUGIN = buildAccept(FILE_EXTENSIONS.plugin);

/** 参考垫图的 accept 属性 */
export const ACCEPT_REFERENCE_IMAGE = buildAccept(FILE_EXTENSIONS.reference);

/**
 * 检查文件扩展名是否匹配指定类型（大小写不敏感）。
 */
export function hasExtension(filename: string, extensions: readonly string[]): boolean {
  const lower = filename.toLowerCase();
  return extensions.some((ext) => lower.endsWith(`.${ext}`));
}

/**
 * 判断文件是否是骨架文件（json/dbbin/dbproj）。
 */
export function isSkeletonFile(filename: string): boolean {
  return hasExtension(filename, FILE_EXTENSIONS.skeleton);
}

/**
 * 判断文件是否是图片文件。
 */
export function isImageFile(filename: string): boolean {
  return hasExtension(filename, FILE_EXTENSIONS.image);
}

/**
 * 判断文件是否是二进制骨架文件（dbbin）。
 */
export function isBinarySkeletonFile(filename: string): boolean {
  return filename.toLowerCase().endsWith('.dbbin');
}

/**
 * 判断文件是否是项目文件（dbproj）。
 */
export function isProjectFile(filename: string): boolean {
  return filename.toLowerCase().endsWith('.dbproj');
}

/**
 * 判断文件是否是 Atlas 文件。
 */
export function isAtlasFile(filename: string): boolean {
  return filename.toLowerCase().endsWith('.atlas');
}

/**
 * 获取不含扩展名的文件基础名称。
 */
export function baseName(filename: string): string {
  return filename.replace(/\.[^.]+$/, '');
}

/**
 * 标准化导出文件名：确保扩展名正确且不重复。
 *
 * @param name 用户输入的文件名
 * @param expectedExt 期望的扩展名（不含点）
 * @returns 标准化后的文件名
 */
export function normalizeExportFilename(name: string, expectedExt: string): string {
  const ext = `.${expectedExt.toLowerCase()}`;
  const lower = name.toLowerCase();

  if (lower.endsWith(ext)) {
    const actualExt = name.slice(-ext.length);
    if (actualExt !== ext) {
      return name.slice(0, -ext.length) + ext;
    }
    return name;
  }

  const existingExtMatch = name.match(/\.[^.]+$/);
  if (existingExtMatch) {
    const existingExt = existingExtMatch[0].toLowerCase();
    const validExts = Object.keys(MIME_TYPES).map((e) => `.${e}`);
    if (validExts.includes(existingExt)) {
      return name.slice(0, -existingExtMatch[0].length) + ext;
    }
  }

  return name + ext;
}
