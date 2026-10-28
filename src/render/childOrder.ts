/** 纯函数（不依赖 pixi，便于单测）。 */
/**
 * 让容器的子节点顺序 = 本帧绘制顺序。网格按槽位名缓存、只在第一次出现时 addChild，
 * 所以之前子节点顺序永远停在「首次绘制」那一刻：改绑定顺序（右键移到上/下一层、层级面板）
 * 或播放 drawOrder / zOrder 时间轴时数据都对，舞台却不变。顺序没变时只做一次线性比较。
 */
export interface OrderedLayer<T> {
  readonly children: T[];
  removeChildren(): unknown;
  addChild(child: T): unknown;
}

export function syncChildOrder<T>(layer: OrderedLayer<T>, order: T[]): void {
  const children = layer.children;
  let k = 0;
  let same = true;
  const inOrder = new Set(order);
  for (const child of children) {
    if (!inOrder.has(child)) continue;
    if (child !== order[k++]) { same = false; break; }
  }
  if (same) return;
  // 先放本帧要画的（按顺序），隐藏的留在最后
  const rest = children.filter((child) => !inOrder.has(child));
  layer.removeChildren();
  for (const mesh of order) layer.addChild(mesh);
  for (const child of rest) layer.addChild(child);
}
