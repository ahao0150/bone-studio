/**
 * 图集层面的编辑：删除一个切片。
 *
 * 官方入口是资源面板标题栏的「删除」（`LibraryPanelController.onDeleteArmature` →
 * `removeAssets`，`_555/LibraryPanelController.as:1271-1300`）：把选中节点对应的资源文件
 * 从工程里移除。本仓库没有磁盘资源目录，等价物是删掉图集里那条 `SubTexture`。
 *
 * 维护两处状态，缺一不可：
 *   - 原始数据 `DbTextureAtlasData.SubTexture` —— 导出 `*_tex.json` 时读的是它；
 *   - 解析后的 `TextureAtlas`（`regions` + `byName`）—— 运行时渲染读的是它。
 */
import type { DbTextureAtlasData } from './types';
import type { TextureAtlas } from './parse/texture';

/** 从原始图集数据里删掉一个切片（导出路径读这份）。返回是否真的删了。 */
export function removeSubTexture(raw: DbTextureAtlasData, name: string): boolean {
  const list = raw.SubTexture ?? [];
  const index = list.findIndex((entry) => entry.name === name);
  if (index < 0) return false;
  list.splice(index, 1);
  return true;
}

/** 从解析后的图集里删掉一个切片（渲染路径读这份）。返回是否真的删了。 */
export function removeRegion(atlas: TextureAtlas, name: string): boolean {
  const index = atlas.regions.findIndex((region) => region.name === name);
  if (index < 0) return false;
  atlas.regions.splice(index, 1);
  atlas.byName.delete(name);
  return true;
}
