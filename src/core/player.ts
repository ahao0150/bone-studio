import type { DbAnimationData, DbTextureAtlasData, DbTransform } from './types';
import { parseSkeletonData, type SkeletonDoc } from './parse/ske';
import { parseTextureAtlas, type TextureAtlas } from './parse/texture';
import { Skeleton, type RenderItem } from './runtime/skeleton';

export interface PlayerEvents {
  onFrame?: (player: Player) => void;
  onAnimationChange?: (player: Player) => void;
  /** fired for every authored action frame the playhead enters */
  onAction?: (action: unknown, player: Player) => void;
}

export class Player {
  doc: SkeletonDoc;
  atlases: TextureAtlas[];
  skeleton: Skeleton;
  animation: DbAnimationData | null = null;
  /** current position in frames */
  position = 0;
  playing = false;
  /**
   * 骨架装配：为 true 时不套当前动画。
   * 骨骼停在绑定姿态，插槽回到默认显示，动画数据本身保留。
   */
  setupPose = false;
  speed = 1;
  /** 时间轴「开始 / 结束」设定的循环区间（帧）；null = 整条动画 */
  playRange: { start: number; end: number } | null = null;
  /** 倒放（官方 Timeline.playback） */
  reverse = false;
  events: PlayerEvents = {};

  constructor(skeletonJson: unknown, textureJson?: DbTextureAtlasData | null, events?: PlayerEvents) {
    this.doc = parseSkeletonData(skeletonJson);
    this.atlases = textureJson ? [parseTextureAtlas(textureJson)] : [];
    this.skeleton = new Skeleton(this.doc.armatures[0]);
    this.animation = this.skeleton.getAnimation(undefined);
    this.events = events ?? {};
    this.applyPose();
  }

  /** 当前应套到骨架上的动画。装配模式下是 null。 */
  private poseAnimation(): DbAnimationData | null {
    return this.setupPose ? null : this.animation;
  }

  /** 按当前模式把姿态写进运行时骨架（含编辑期临时姿态，见 `poseOverrides`）。 */
  applyPose(): void {
    // 临时姿态挂在 Player 上（`rebuildSkeleton` / `setArmature` 会换 Skeleton 实例），每次重新挂上。
    this.skeleton.localOverrides = this.poseOverrides;
    this.skeleton.update(this.poseAnimation(), this.position);
  }

  /**
   * 编辑期临时骨骼姿态（**不落盘**）：骨骼名 → 绝对 local 变换。
   *
   * 等价官方 `_416/_418.as:66-83` 在 `autoKey` 关时的 `_3402`（写 `bone._2002`）：
   * 拖动改的是当前显示，关键帧数据不动，等手动 K / 旗杆才落帧。切帧、播放、换动画、重建骨架都会清掉。
   */
  readonly poseOverrides = new Map<string, DbTransform>();

  poseOverrideOf(name: string): DbTransform | undefined {
    return this.poseOverrides.get(name);
  }

  setPoseOverride(name: string, values: DbTransform | null): void {
    if (values) this.poseOverrides.set(name, values);
    else this.poseOverrides.delete(name);
  }

  clearPoseOverrides(): void {
    this.poseOverrides.clear();
  }

  get atlas(): TextureAtlas | null {
    return this.atlases[0] ?? null;
  }

  get frameRate(): number {
    return this.skeleton.frameRate;
  }

  get duration(): number {
    return this.animation?.duration ?? 0;
  }

  /** For `sheet` projects each armature is one animation, so expose armatures. */
  get multiArmature(): boolean {
    return this.doc.armatures.length > 1;
  }

  animationNames(): string[] {
    if (this.multiArmature) return this.doc.armatures.map((a) => a.name);
    return this.skeleton.animationNames();
  }

  currentAnimationName(): string {
    return this.multiArmature ? this.skeleton.armature.name : (this.animation?.name ?? '');
  }

  armatureNames(): string[] {
    return this.doc.armatures.map((a) => a.name);
  }

  setArmature(name: string): void {
    const armature = this.doc.armatures.find((a) => a.name === name) ?? this.doc.armatures[0];
    this.skeleton = new Skeleton(armature, this.skeleton.skinName);
    this.animation = this.skeleton.getAnimation(undefined);
    this.position = 0;
    this.clearPoseOverrides();
    this.applyPose();
    this.events.onAnimationChange?.(this);
  }

  setAnimation(name: string): void {
    if (this.multiArmature) {
      const armature = this.doc.armatures.find((a) => a.name === name);
      if (armature) {
        this.skeleton = new Skeleton(armature, this.skeleton.skinName);
        this.animation = this.skeleton.getAnimation(undefined);
        this.position = 0;
        this.clearPoseOverrides();
        this.applyPose();
        this.events.onAnimationChange?.(this);
        return;
      }
    }
    const next = this.skeleton.getAnimation(name);
    this.animation = next;
    this.position = 0;
    this.clearPoseOverrides();
    this.applyPose();
    this.events.onAnimationChange?.(this);
  }

  /**
   * Rebuild the runtime skeleton from the (possibly edited) armature.
   *
   * `bones`, `slots`, `skinSlots`, `boneIndexByName` and every runtime parent index
   * are derived once in the `Skeleton` constructor, so a structural edit (create /
   * delete / rename / re-parent a bone or slot) silently keeps rendering the *old*
   * document until this runs — the outline and dope sheet would still show the
   * removed entries and would not show the new ones.
   */
  rebuildSkeleton(): void {
    const armature = this.skeleton.armature;
    const skinName = this.skeleton.skinName;
    const animationName = this.animation?.name;
    const position = this.position;
    const playing = this.playing;
    this.skeleton = new Skeleton(armature, skinName);
    this.animation = this.skeleton.getAnimation(animationName);
    this.position = Math.max(0, Math.min(position, this.animation?.duration ?? position));
    this.playing = playing;
    this.clearPoseOverrides();
    this.applyPose();
    this.events.onAnimationChange?.(this);
  }

  /** 切皮肤（官方 `Armature.skin[]`）：只换显示对象映射，骨架与动画不动。 */
  setSkin(name: string): boolean {
    if (!this.skeleton.setSkin(name)) return false;
    this.applyPose();
    this.events.onAnimationChange?.(this);
    return true;
  }
  play(): void {
    if (this.setupPose) { this.playing = false; return; }
    this.playing = true;
  }
  /**
   * 暂停总是停在**整帧**上：官方播放头以帧为单位（标尺刻度就是帧号），
   * 停在 12.37 帧会让属性面板 / 变换栏旗杆的命中判断失效（用户 185 轮）。
   */
  pause(): void {
    this.playing = false;
    this.position = Math.round(this.position);
    this.applyPose();
  }
  toggle(): void {
    if (this.setupPose) { this.playing = false; return; }
    this.playing = !this.playing;
    if (!this.playing) {
      this.position = Math.round(this.position);
      this.applyPose();
    }
  }

  seek(frame: number): void {
    const duration = Math.max(1, this.duration);
    const previous = this.position;
    const next = ((frame % duration) + duration) % duration;
    this.fireActions(previous, next);
    this.position = next;
    // 临时姿态是「这一帧的姿态」，换帧即作废（官方 `_2002` 同样不跨帧存活）。
    this.clearPoseOverrides();
    this.applyPose();
  }

  seekNormalized(t: number): void {
    this.seek(t * this.duration);
  }

  /** Advance by wall-clock seconds. */
  step(dtSeconds: number): void {
    if (this.setupPose || !this.playing || this.duration <= 0) return;
    const previous = this.position;
    const duration = this.duration;
    const playTimes = this.animation?.playTimes ?? 0;
    if (this.playRange || this.reverse) {
      // 官方 `Timeline.tick`：区间 [开始, 结束]（缺省整条动画）内循环；倒放越过起点回到终点
      const a = this.playRange ? this.playRange.start : 0;
      const b = this.playRange ? this.playRange.end : duration;
      const lo = Math.max(0, Math.min(a, b));
      const hi = Math.min(duration, Math.max(a, b));
      this.position += (this.reverse ? -1 : 1) * dtSeconds * this.frameRate * this.speed;
      if (this.position > hi) {
        if (playTimes > 0) { this.playing = false; this.position = hi; } else this.position = lo;
      } else if (this.position < lo) {
        if (playTimes > 0) { this.playing = false; this.position = lo; } else this.position = hi;
      }
      this.fireActions(previous, this.position);
      this.clearPoseOverrides();
      this.applyPose();
      this.events.onFrame?.(this);
      return;
    }
    this.position += dtSeconds * this.frameRate * this.speed;
    if (this.position >= duration) {
      if (playTimes > 0) {
        this.playing = false;
        this.position = duration;
      } else {
        this.position = this.position % duration;
      }
    }
    this.fireActions(previous, this.position);
    this.clearPoseOverrides();
    this.applyPose();
    this.events.onFrame?.(this);
  }

  /**
   * Action timelines are stepped markers: a frame fires once when the playhead
   * enters its span. Play actions (type 0) switch animation, mirroring the
   * official runtime's ActionType handling.
   */
  private fireActions(from: number, to: number): void {
    const frames = this.animation?.frame ?? [];
    if (frames.length === 0) return;
    const wrapped = to < from;
    let at = 0;
    for (const frame of frames) {
      const start = at;
      at += typeof frame.duration === 'number' ? frame.duration : 1;
      const actions = frame.actions ?? [];
      if (actions.length === 0) continue;
      const entered = wrapped ? (start >= from || start < to) : (start >= from && start < to);
      if (!entered) continue;
      for (const action of actions) {
        this.events.onAction?.(action, this);
        const item = action as { type?: number; name?: string; gotoAndPlay?: string };
        const target = item.gotoAndPlay ?? (item.type === 0 ? item.name : undefined);
        if (target) this.setAnimation(target);
      }
    }
  }

  /**
   * 编辑期临时绘制顺序（**不落盘**）：`order[i]` = 画在第 `i` 个位置的原始槽位下标。
   * 官方「层级」面板在动画模式下改序不写骨架，等「添加层级关键帧」旗杆才落帧
   * （`_573/_574.as:376-392`）—— 这就是那份临时缓存的等价物。
   * 放在 Player 上而不是 Skeleton 上：`rebuildSkeleton` / `setArmature` 会换掉骨架实例。
   */
  zOrderOverride: number[] | null = null;

  renderItems(): RenderItem[] {
    this.applyPose();
    this.skeleton.zOrderOverride = this.zOrderOverride;
    return this.skeleton.getRenderItems(this.atlas, this.poseAnimation(), this.position);
  }

  boneTree(): Array<{ name: string; depth: number; index: number; hasTimeline: boolean }> {
    const out: Array<{ name: string; depth: number; index: number; hasTimeline: boolean }> = [];
    const byName = new Map(this.skeleton.bones.map((b, i) => [b.name, i]));
    const children = new Map<number, number[]>();
    this.skeleton.bones.forEach((bone, i) => {
      const list = children.get(bone.parent) ?? [];
      list.push(i);
      children.set(bone.parent, list);
    });
    const walk = (index: number, depth: number) => {
      const bone = this.skeleton.bones[index];
      out.push({
        name: bone.name,
        depth,
        index,
        hasTimeline: Boolean(this.animation?.bone?.some((t) => t.name === bone.name)),
      });
      for (const child of children.get(index) ?? []) walk(child, depth + 1);
    };
    for (const root of children.get(-1) ?? []) walk(root, 0);
    void byName;
    return out;
  }
}


