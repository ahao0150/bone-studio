/**
 * P-19「选项卡管理」（官方 `CloseTabButton.*` / `TabGroup.*`，见 `格式规范` §63）。
 *
 * 官方关闭按钮是个右键菜单：关闭 / 关闭其他 / 关闭全部（`_1376/CloseTabButton.as` 的 `_9584`/`_3935`），
 * 中键点击直接关闭当前页签。这里把"该留哪些文档、关完之后激活哪一个"抽成纯函数，UI 只做接线。
 */

export interface DocLike { id: string }

/** 关闭一个：留下除它以外的（保持原顺序） */
export function closeOne<T extends DocLike>(docs: readonly T[], id: string): T[] {
  return docs.filter((doc) => doc.id !== id);
}

/** 关闭其他：只留 keepId 那一个 */
export function closeOthers<T extends DocLike>(docs: readonly T[], keepId: string): T[] {
  return docs.filter((doc) => doc.id === keepId);
}

/** 关闭全部 */
export function closeAll<T extends DocLike>(): T[] {
  return [];
}

/**
 * 关掉 `closingId` 之后该激活谁：优先右邻居，没有就取左邻居，都空则 `null`
 * （官方选项卡组在关闭当前页后把焦点交给相邻页）。
 */
export function nextActiveAfterClose<T extends DocLike>(docs: readonly T[], closingId: string): string | null {
  const index = docs.findIndex((doc) => doc.id === closingId);
  if (index < 0) return docs[0]?.id ?? null;
  const rest = closeOne(docs, closingId);
  if (rest.length === 0) return null;
  return (rest[index] ?? rest[rest.length - 1]).id;
}
