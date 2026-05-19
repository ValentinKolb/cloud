export const clampInsertionIndex = (idx: number, length: number) => Math.max(0, Math.min(idx, length));

export const moveItemByInsertionIndex = <T>(items: T[], fromIdx: number, toInsertionIdx: number): T[] => {
  if (fromIdx < 0 || fromIdx >= items.length) return items;

  const targetInsertionIdx = clampInsertionIndex(toInsertionIdx, items.length);
  const next = [...items];
  const [item] = next.splice(fromIdx, 1);
  if (item === undefined) return items;

  const targetIdx = clampInsertionIndex(fromIdx < targetInsertionIdx ? targetInsertionIdx - 1 : targetInsertionIdx, next.length);
  next.splice(targetIdx, 0, item);
  return next;
};
