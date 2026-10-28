/** 打开文件时的格式识别（同步、无依赖，进 UI 入口 chunk 也只是一小段）。 */
export function classifyJsonFile(json: unknown): 'dragonbones' | 'texture' | 'spine' | 'unknown' {
  if (!json || typeof json !== 'object') return 'unknown';
  const o = json as Record<string, unknown>;
  if (Array.isArray(o.armature)) return 'dragonbones';
  if (Array.isArray(o.SubTexture)) return 'texture';
  if (o.skeleton && Array.isArray(o.bones) && (o.skins || o.animations)) return 'spine';
  return 'unknown';
}
