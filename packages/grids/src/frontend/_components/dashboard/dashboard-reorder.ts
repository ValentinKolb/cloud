export const clampInsertionIndex = (idx: number, length: number) => Math.max(0, Math.min(idx, length));

export type ReorderDirection = -1 | 1;

const DASHBOARD_MAX_WIDGETS_PER_ROW = 12;

/** Convert a one-position keyboard move into the insertion index used by pointer DnD. */
export const adjacentInsertionIndex = (fromIdx: number, direction: ReorderDirection, length: number): number | null => {
  if (fromIdx < 0 || fromIdx >= length) return null;
  const targetIdx = fromIdx + direction;
  if (targetIdx < 0 || targetIdx >= length) return null;
  return direction === 1 ? targetIdx + 1 : targetIdx;
};

type AdjacentRowCellTarget = {
  rowIdx: number;
  cellIdx: number;
};

/** Keep the widget's column where possible when moving it to an adjacent row. */
export const adjacentRowCellTarget = (
  rowCellCounts: readonly number[],
  fromRowIdx: number,
  fromCellIdx: number,
  direction: ReorderDirection,
): AdjacentRowCellTarget | null => {
  const sourceCellCount = rowCellCounts[fromRowIdx];
  const targetRowIdx = fromRowIdx + direction;
  const targetCellCount = rowCellCounts[targetRowIdx];
  if (
    sourceCellCount === undefined ||
    fromCellIdx < 0 ||
    fromCellIdx >= sourceCellCount ||
    targetCellCount === undefined ||
    targetCellCount >= DASHBOARD_MAX_WIDGETS_PER_ROW
  ) {
    return null;
  }
  return { rowIdx: targetRowIdx, cellIdx: Math.min(fromCellIdx, targetCellCount) };
};

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
