/**
 * 浏览器端 PNG 编解码（canvas）——不把 Node 的 zlib 拖进 UI bundle。
 * Spine 导入器用它解码图集页、编码重新打包后的图集。
 */
import type { RasterImage } from '../core/raster';

export async function decodePngInBrowser(bytes: Uint8Array): Promise<RasterImage> {
  const bitmap = await createImageBitmap(new Blob([bytes as unknown as BlobPart], { type: 'image/png' }));
  // 尺寸必须在 close() 前取出：Chrome 里关闭后 width/height 会归零
  const width = bitmap.width;
  const height = bitmap.height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 2D 画布');
  ctx.drawImage(bitmap, 0, 0);
  const data = ctx.getImageData(0, 0, width, height);
  bitmap.close?.();
  return { width, height, rgba: new Uint8Array(data.data) };
}

export async function encodePngInBrowser(image: RasterImage): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 2D 画布');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height), 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG 编码失败'))), 'image/png');
  });
}

/** PNG 魔数：用来识别 14 字节的 `404: Not Found` 占位文件。 */
export function isPngBytes(bytes: Uint8Array): boolean {
  return bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}
