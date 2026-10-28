/**
 * 内置 AI capability（M6「AI 扩展接口」）。
 *
 * 契约见 `src/ai/pluginApi.ts`：capability 只产出 `EditorCommand[]`（**不改数据**），
 * 由调用方（UI / MCP / 脚本）审阅后再 `applyAiCommands` 落到 `Player` 上 ——
 * 和手动编辑走同一条路径，所以可撤销、可对拍。
 */
import { registerAiCapability, type AiCapability, type EditorCommand } from './pluginApi';
import { setSlotDisplayKeyframe } from '../core/slotEdit';
import type { Player } from '../core/player';
import type { DbAnimationData, DbBoneTimeline } from '../core/types';

/** 从 prompt 里抠出要"说"的文本：支持 `lip: xxx` / `口型：xxx`，否则用整句。 */
function lipText(prompt: string): string {
  // 允许「口型 slot=xxx: 你好」这种带参数的写法：冒号前可以夹参数
  const match = /(?:lip|口型|台词|对话)[^:：]*[:：]\s*(.+)$/i.exec(prompt);
  let raw = (match ? match[1] : prompt).trim();
  raw = raw.replace(/slot\s*=\s*[A-Za-z0-9_\-\u4e00-\u9fa5]+/gi, '');   // 剥掉 slot=xxx 这类参数
  return raw.replace(/[\s，。,.!！?？、；;：:]/g, '');
}

/** `slot=mouth` 这样的显式指名；没给就挑第一个"显示对象 ≥ 2"的槽位。 */
function pickSlot(player: Player, prompt: string): string | null {
  const named = /slot\s*=\s*([A-Za-z0-9_\-]+)/i.exec(prompt);
  if (named) return named[1];
  for (const slot of player.skeleton.armature.slot) {
    const displays = player.skeleton.skinSlots.get(slot.name)?.display?.length ?? 0;
    if (displays >= 2) return slot.name;
  }
  return null;
}

/**
 * 口型：按文本逐字切换槽位的显示对象，生成**切换关键帧**。
 *
 * 离线等价物说明：真实口型要靠音频分析（本项目没有音频管线也没有音素表），
 * 所以这里用"文本 → 每字 2 帧 → 字符码取模选显示对象"的确定性映射 ——
 * 效果上等价于逐字张嘴，且完全可复算、可撤销。
 */
export const LIP_SYNC: AiCapability = {
  id: 'lip-sync',
  title: '口型',
  description: '按文本逐字切换槽位显示对象，生成口型关键帧（离线等价物，无音频分析）',
  async plan(player, prompt) {
    const text = lipText(prompt);
    if (text.length === 0 || !player.animation) return [];
    const slotName = pickSlot(player, prompt);
    if (!slotName) return [];
    const displays = player.skeleton.skinSlots.get(slotName)?.display?.length ?? 0;
    if (displays < 2) return [];
    const FRAMES_PER_CHAR = 2;
    return [...text].map((char, index): EditorCommand => {
      const frame = index * FRAMES_PER_CHAR;
      const displayIndex = (char.codePointAt(0) ?? 0) % displays;
      return {
        id: `lip:${slotName}:${frame}`,
        label: `第 ${frame} 帧：${slotName} 切到显示对象 ${displayIndex}（字符「${char}」）`,
        apply: (target) => { setSlotDisplayKeyframe(target, slotName, frame, displayIndex); },
      };
    });
  },
};

/** `from=A` / `to=B` / `bone=arm` 的解析（都允许省略）。 */
function param(prompt: string, name: string): string | null {
  const match = new RegExp(`${name}\\s*=\\s*([A-Za-z0-9_\\-\\u4e00-\\u9fa5]+)`, 'i').exec(prompt);
  return match ? match[1] : null;
}

/**
 * 动作迁移：把源动画的**骨骼时间轴**整体复制到目标动画。
 *
 * 离线等价物说明：官方是跨角色迁移（要骨骼名映射 + 姿态归一化）；
 * 这里做**同一骨架内**的动画间迁移 —— 骨骼一一对应，结果是确定的、可逐帧对拍的。
 */
export const MOTION_TRANSFER: AiCapability = {
  id: 'motion-transfer',
  title: '动作迁移',
  description: '把源动画的骨骼时间轴复制到目标动画（同骨架；官方是跨角色迁移）',
  async plan(player, prompt) {
    const armature = player.skeleton.armature;
    const animations = armature.animation ?? [];
    if (animations.length === 0) return [];
    const from = param(prompt, 'from') ?? player.animation?.name ?? animations[0].name;
    const source = animations.find((entry) => entry.name === from);
    if (!source) return [];
    const wanted = param(prompt, 'to') ?? `${from}-transfer`;
    const boneFilter = param(prompt, 'bone');

    const commands: EditorCommand[] = [];
    let target = animations.find((entry) => entry.name === wanted);
    if (!target) {
      commands.push({
        id: `transfer:create:${wanted}`,
        label: `新建动画 ${wanted}（时长 ${source.duration} 帧）`,
        apply: (p) => {
          const arm = p.skeleton.armature;
          if (!arm.animation) arm.animation = [];
          arm.animation.push({ name: wanted, duration: source.duration, bone: [], slot: [], ffd: [] });
          p.rebuildSkeleton();
        },
      });
    }
    const bones = (source.bone ?? [])
      .filter((timeline) => !boneFilter || timeline.name === boneFilter)
      .map((timeline) => timeline.name);
    if (bones.length === 0) return [];
    commands.push({
      id: `transfer:${from}->${wanted}:${bones.length}`,
      label: `把 ${from} 的 ${bones.length} 条骨骼时间轴复制到 ${wanted}（${bones.slice(0, 3).join('、')}${bones.length > 3 ? '…' : ''}）`,
      apply: (p) => {
        const arm = p.skeleton.armature;
        const src = (arm.animation ?? []).find((entry) => entry.name === from);
        const dst = (arm.animation ?? []).find((entry) => entry.name === wanted);
        if (!src || !dst) return;
        const copied: DbBoneTimeline[] = JSON.parse(JSON.stringify(
          (src.bone ?? []).filter((timeline) => !boneFilter || timeline.name === boneFilter),
        )) as DbBoneTimeline[];
        dst.bone = [...(dst.bone ?? []).filter((timeline) => !copied.some((c) => c.name === timeline.name)), ...copied];
        dst.duration = Math.max(dst.duration ?? 0, src.duration ?? 0);
        p.rebuildSkeleton();
      },
    });
    return commands;
  },
};

let registered = false;

/** 幂等注册内置 capability（App 启动与 MCP 服务都会调）。 */
export function registerBuiltinCapabilities(): void {
  if (registered) return;
  registered = true;
  registerAiCapability(LIP_SYNC);
  registerAiCapability(MOTION_TRANSFER);
}

/** 给测试用：重置注册标记（registry 本身在 pluginApi 里是模块级的）。 */
export function __resetBuiltinFlag(): void {
  registered = false;
}