/**
 * 场景树「智能过滤」（官方 `ScenePanel.intelligentFilterButton`，tooltip「智能过滤」/ "Intelligent filter"）。
 *
 * 格式验证（`格式规范`）：
 *   - 第 219 行：`this.intelligentFilterButton.addEventListener(MouseEvent.CLICK, this._4450)`
 *   - 第 1150-1154 行：点击把 `_12462.getInstance().sceneTreeFilter` **取反**，再 `_12626()` 刷新视图
 *   - 第 1166-1180 行（`_4478`）：开启时把树的 `dataProvider._4505` 设为过滤谓词 `_4469`，关闭时设为 `null`
 *   - 第 1183-1198 行（`_4469`）：
 *       if (!node.parent) return true;                         // 根保留
 *       if (!filter || !(node.parent.vo is Slot)) return true; // 关着 / 父不是槽位 → 保留
 *       if (node.parent.children.length === 1) return false;   // 父槽位只有 1 个子节点 → 隐藏
 *   - 图标两态：`/assets/skins/tree/filterClose.png`（关）与 `filterOpen.png`（开）
 *   - 状态是**持久设置**：`_12469/_12468.as` 第 75 行把 `custom.sceneTreeFilter` 写进配置
 *
 * 也就是：**开启时，只有 1 个显示对象的槽位不再单独列出它的显示对象行** ——
 * 父行图标已经换成该显示对象的类型图标（`_4538` 第 1206-1251 行）。
 */

export const SCENE_TREE_FILTER_KEY = 'bonestudio.sceneTreeFilter';

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'> | null | undefined;

/** 默认关闭（官方配置里 `sceneTreeFilter` 缺省是 0）。 */
export function readSceneTreeFilter(storage: Storage): boolean {
  try {
    return storage?.getItem(SCENE_TREE_FILTER_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeSceneTreeFilter(storage: Storage, value: boolean): void {
  try {
    storage?.setItem(SCENE_TREE_FILTER_KEY, value ? '1' : '0');
  } catch {
    // 存储不可用（隐私模式 / 配额）时静默忽略
  }
}

/**
 * 一个槽位要不要列出它的显示对象子行。
 *
 * 官方语义：过滤**关**时全列；过滤**开**时，槽位只有 1 个显示对象就不列（父行已经代表它）。
 * `displayCount === 0` 时本来就没有子行可列。
 */
export function displayChildrenVisible(displayCount: number, filterOn: boolean): boolean {
  if (displayCount <= 0) return false;
  return !filterOn || displayCount !== 1;
}