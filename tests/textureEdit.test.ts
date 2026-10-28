/**
 * 图集切片删除（资源面板标题栏「删除」，官方 `removeAssets` 的等价物）。
 *
 * 判据：原始数据 `SubTexture` 与解析后的 `regions` / `byName` **两处同步**消失
 * —— 只改一处会让导出与渲染对不上。
 */
import { describe, expect, it } from 'vitest';
import { parseTextureAtlas } from '../src/core/parse/texture';
import { removeRegion, removeSubTexture } from '../src/core/textureEdit';
import type { DbTextureAtlasData } from '../src/core/types';

const rawAtlas = (names: string[]): DbTextureAtlasData => ({
  name: 'atlas',
  imagePath: 'atlas.png',
  width: 128,
  height: 64,
  SubTexture: names.map((name, index) => ({
    name,
    x: index * 10,
    y: 0,
    width: 10,
    height: 10,
  })),
});

describe('图集切片删除', () => {
  it('removeSubTexture 从原始数据里删，导出路径跟着变', () => {
    const raw = rawAtlas(['a', 'b', 'c']);
    expect(removeSubTexture(raw, 'b')).toBe(true);
    expect(raw.SubTexture.map((entry) => entry.name)).toEqual(['a', 'c']);
    expect(removeSubTexture(raw, 'b')).toBe(false);       // 已经没了
    expect(raw.SubTexture.length).toBe(2);
  });

  it('removeRegion 同步删掉 regions 与 byName，渲染路径跟着变', () => {
    const atlas = parseTextureAtlas(rawAtlas(['a', 'b', 'c']));
    expect(atlas.byName.has('b')).toBe(true);
    expect(removeRegion(atlas, 'b')).toBe(true);
    expect(atlas.regions.map((region) => region.name)).toEqual(['a', 'c']);
    expect(atlas.byName.has('b')).toBe(false);
    expect(atlas.byName.size).toBe(2);
    expect(removeRegion(atlas, 'b')).toBe(false);
  });
});
