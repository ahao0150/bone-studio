/**
 * 示例插件（新编辑器架构）—— 演示最小契约：导出 `activate(api)`，
 * 用 `api.registerCapability()` 注册一个能力；能力只产出命令，不直接改数据。
 *
 * 装法：插件管理 → 粘贴 `/plugins/example-clone-animation.js` → 从 URL 安装。
 */
export function activate(api) {
  api.log(`示例插件已激活（API v${api.apiVersion}）`);
  api.registerCapability({
    id: 'example.clone-animation',
    title: '复制当前动画',
    description: '把当前动画复制成一份 <名字>-plugin（示例插件）',
    async plan(player) {
      const armature = player.skeleton.armature;
      const current = player.animation;
      if (!current) return [];
      const wanted = `${current.name}-plugin`;
      if ((armature.animation ?? []).some((entry) => entry.name === wanted)) return [];
      const duration = current.duration ?? 0;
      return [{
        id: `example-clone:${wanted}`,
        label: `新建动画 ${wanted}（时长 ${duration} 帧）`,
        apply(target) {
          const arm = target.skeleton.armature;
          if (!arm.animation) arm.animation = [];
          arm.animation.push({ name: wanted, duration, bone: [], slot: [], ffd: [] });
          target.rebuildSkeleton();
        },
      }];
    },
  });
}