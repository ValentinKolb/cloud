import type { CustomAppBlock, CustomAppPage } from "../../../custom-apps/contracts";

type CustomAppRow = CustomAppPage["rows"][number];
type CustomAppColumn = CustomAppRow["columns"][number];

export type CustomAppBlockDropIntent =
  | { kind: "stack"; targetBlockId: string; edge: "before" | "after" }
  | { kind: "beside"; firstBlockId: string; lastBlockId: string; side: "left" | "right" }
  | { kind: "row"; targetRowId: string; edge: "before" | "after" };

export type CustomAppBlockDropSegment = "horizontal" | "left" | "right";

export type CustomAppLayoutIds = {
  rowIds: readonly [string, string];
  columnIds: readonly [string, string, string];
};

const customAppBlockDropIntentKey = (intent: CustomAppBlockDropIntent | null): string => {
  if (!intent) return "";
  if (intent.kind === "stack") return [intent.kind, intent.targetBlockId, intent.edge].join("\0");
  if (intent.kind === "beside") return [intent.kind, intent.firstBlockId, intent.lastBlockId, intent.side].join("\0");
  return [intent.kind, intent.targetRowId, intent.edge].join("\0");
};

export const sameCustomAppBlockDropIntent = (left: CustomAppBlockDropIntent | null, right: CustomAppBlockDropIntent | null): boolean =>
  customAppBlockDropIntentKey(left) === customAppBlockDropIntentKey(right);

export const customAppColumnRangeNeedsDropZone = (blockIds: readonly string[], activeBlockId: string | null): boolean => {
  const remaining = activeBlockId ? blockIds.filter((blockId) => blockId !== activeBlockId) : [...blockIds];
  if (remaining.length < 2) return false;
  if (remaining.length > 2) return true;
  return blockIds.indexOf(remaining[1]!) - blockIds.indexOf(remaining[0]!) > 1;
};

type CustomAppBlockDropCandidate = {
  id: string;
  distance: number;
  rect: { top: number; right: number; bottom: number; left: number; width: number; height: number };
  meta: { priority: number; segment: CustomAppBlockDropSegment };
};

type CustomAppDropPointer = { x: number; y: number };

const DROP_MAGNET_RADIUS = 32;
const DROP_SWITCH_THRESHOLD = 10;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

const dropSegmentDistance = (candidate: CustomAppBlockDropCandidate, pointer: CustomAppDropPointer): number => {
  const { rect, meta } = candidate;
  const closest =
    meta.segment === "horizontal"
      ? { x: clamp(pointer.x, rect.left, rect.right), y: rect.top + rect.height / 2 }
      : {
          x: meta.segment === "left" ? rect.left : rect.right,
          y: clamp(pointer.y, rect.top, rect.bottom),
        };
  return Math.hypot(pointer.x - closest.x, pointer.y - closest.y);
};

const dropSegmentLength = (candidate: CustomAppBlockDropCandidate): number =>
  candidate.meta.segment === "horizontal" ? candidate.rect.width : candidate.rect.height;

export const selectCustomAppBlockDropTarget = (
  candidates: readonly CustomAppBlockDropCandidate[],
  pointer: CustomAppDropPointer,
  previousOverId: string | null,
): string | null => {
  const keyboardTarget = candidates.find((candidate) => candidate.distance === 0);
  if (keyboardTarget) return keyboardTarget.id;

  const scored = candidates
    .map((candidate) => ({ candidate, distance: dropSegmentDistance(candidate, pointer) }))
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        dropSegmentLength(left.candidate) - dropSegmentLength(right.candidate) ||
        right.candidate.meta.priority - left.candidate.meta.priority,
    );
  const best = scored.find((entry) => entry.distance <= DROP_MAGNET_RADIUS);
  const previous = previousOverId ? scored.find((entry) => entry.candidate.id === previousOverId) : undefined;
  if (
    previous &&
    previous.distance <= DROP_MAGNET_RADIUS + DROP_SWITCH_THRESHOLD &&
    (!best || previous.distance <= best.distance + DROP_SWITCH_THRESHOLD)
  ) {
    return previous.candidate.id;
  }
  return best?.candidate.id ?? null;
};

const balanceColumns = (columns: CustomAppColumn[]): CustomAppColumn[] => {
  const width = Math.floor(12 / columns.length);
  const remainder = 12 % columns.length;
  return columns.map((column, index) => ({ ...column, span: width + (index < remainder ? 1 : 0) }));
};

export const normalizeCustomAppPageLayout = (page: CustomAppPage): CustomAppPage => {
  let changed = false;
  const rows: CustomAppRow[] = [];

  for (const row of page.rows) {
    const nonEmptyColumns = row.columns.filter((column) => column.blocks.length > 0);
    if (nonEmptyColumns.length === 0) {
      changed = true;
      continue;
    }

    let columns = nonEmptyColumns;
    if (nonEmptyColumns.length !== row.columns.length) {
      columns = nonEmptyColumns.length === 1 ? [{ ...nonEmptyColumns[0]!, span: 12 }] : balanceColumns(nonEmptyColumns);
      changed = true;
    } else if (nonEmptyColumns.length === 1 && nonEmptyColumns[0]!.span !== 12) {
      columns = [{ ...nonEmptyColumns[0]!, span: 12 }];
      changed = true;
    }

    const nextRow = columns === row.columns ? row : { ...row, columns };
    const previous = rows.at(-1);
    if (previous?.columns.length === 1 && nextRow.columns.length === 1) {
      const previousColumn = previous.columns[0]!;
      rows[rows.length - 1] = {
        ...previous,
        columns: [{ ...previousColumn, span: 12, blocks: [...previousColumn.blocks, ...nextRow.columns[0]!.blocks] }],
      };
      changed = true;
    } else {
      rows.push(nextRow);
    }
  }

  return changed ? { ...page, rows } : page;
};

const findBlock = (page: CustomAppPage, blockId: string) => {
  for (const [rowIndex, row] of page.rows.entries()) {
    for (const [columnIndex, column] of row.columns.entries()) {
      const blockIndex = column.blocks.findIndex((block) => block.id === blockId);
      if (blockIndex >= 0) return { rowIndex, columnIndex, blockIndex, row, column, block: column.blocks[blockIndex]! };
    }
  }
  return null;
};

const removeBlock = (page: CustomAppPage, blockId: string): CustomAppPage => ({
  ...page,
  rows: page.rows.map((row) => ({
    ...row,
    columns: row.columns.map((column) => ({ ...column, blocks: column.blocks.filter((block) => block.id !== blockId) })),
  })),
});

const blockIds = (page: CustomAppPage) =>
  page.rows.flatMap((row) => row.columns.flatMap((column) => column.blocks.map((block) => block.id))).sort();

const sameBlockLayout = (left: CustomAppPage, right: CustomAppPage): boolean =>
  left.rows.length === right.rows.length &&
  left.rows.every((row, rowIndex) => {
    const otherRow = right.rows[rowIndex];
    return (
      otherRow !== undefined &&
      row.columns.length === otherRow.columns.length &&
      row.columns.every((column, columnIndex) => {
        const otherColumn = otherRow.columns[columnIndex];
        return (
          otherColumn !== undefined &&
          otherColumn.span === column.span &&
          column.blocks.length === otherColumn.blocks.length &&
          column.blocks.every((block, blockIndex) => block.id === otherColumn.blocks[blockIndex]?.id)
        );
      })
    );
  });

const validResult = (before: CustomAppPage, after: CustomAppPage): boolean => {
  if (after.rows.length === 0 || after.rows.length > 24) return false;
  if (blockIds(before).join("\0") !== blockIds(after).join("\0")) return false;
  return after.rows.every(
    (row) =>
      row.columns.length > 0 &&
      row.columns.length <= 12 &&
      row.columns.reduce((sum, column) => sum + column.span, 0) <= 12 &&
      row.columns.every((column) => column.blocks.length > 0 && column.blocks.length <= 24),
  );
};

const validNewIds = (page: CustomAppPage, ids: CustomAppLayoutIds): boolean => {
  const existing = new Set(page.rows.flatMap((row) => [row.id, ...row.columns.map((column) => column.id)]));
  const supplied = [...ids.rowIds, ...ids.columnIds];
  return supplied.every((id) => id.length > 0 && !existing.has(id)) && new Set(supplied).size === supplied.length;
};

const insertStacked = (
  page: CustomAppPage,
  active: CustomAppBlock,
  targetBlockId: string,
  edge: "before" | "after",
): CustomAppPage | null => {
  const target = findBlock(page, targetBlockId);
  if (!target) return null;
  const blocks = [...target.column.blocks];
  blocks.splice(target.blockIndex + (edge === "after" ? 1 : 0), 0, active);
  return {
    ...page,
    rows: page.rows.map((row, rowIndex) =>
      rowIndex !== target.rowIndex
        ? row
        : {
            ...row,
            columns: row.columns.map((column, columnIndex) => (columnIndex === target.columnIndex ? { ...column, blocks } : column)),
          },
    ),
  };
};

const insertBeside = (
  page: CustomAppPage,
  active: CustomAppBlock,
  intent: Extract<CustomAppBlockDropIntent, { kind: "beside" }>,
  ids: CustomAppLayoutIds,
): CustomAppPage | null => {
  if (!validNewIds(page, ids)) return null;
  const first = findBlock(page, intent.firstBlockId);
  const last = findBlock(page, intent.lastBlockId);
  if (!first || !last || first.rowIndex !== last.rowIndex || first.columnIndex !== last.columnIndex || first.blockIndex > last.blockIndex) {
    return null;
  }

  const row = first.row;
  const column = first.column;
  const range = column.blocks.slice(first.blockIndex, last.blockIndex + 1);
  const isWholeColumn = range.length === column.blocks.length;
  const activeColumn: CustomAppColumn = { id: ids.columnIds[0], span: 6, blocks: [active] };

  if (row.columns.length > 1) {
    if (!isWholeColumn || row.columns.length >= 12) return null;
    const columns = [...row.columns];
    columns.splice(first.columnIndex + (intent.side === "right" ? 1 : 0), 0, activeColumn);
    return {
      ...page,
      rows: page.rows.map((candidate, rowIndex) =>
        rowIndex === first.rowIndex ? { ...candidate, columns: balanceColumns(columns) } : candidate,
      ),
    };
  }

  const prefix = column.blocks.slice(0, first.blockIndex);
  const suffix = column.blocks.slice(last.blockIndex + 1);
  const rangeColumn: CustomAppColumn = { ...column, span: 6, blocks: range };
  const centerColumns = intent.side === "left" ? [activeColumn, rangeColumn] : [rangeColumn, activeColumn];
  const replacement: CustomAppRow[] = [];
  if (prefix.length > 0) {
    replacement.push({ id: ids.rowIds[0], columns: [{ id: ids.columnIds[1], span: 12, blocks: prefix }] });
  }
  replacement.push({ ...row, columns: centerColumns });
  if (suffix.length > 0) {
    replacement.push({ id: ids.rowIds[1], columns: [{ id: ids.columnIds[2], span: 12, blocks: suffix }] });
  }

  return { ...page, rows: page.rows.flatMap((candidate, rowIndex) => (rowIndex === first.rowIndex ? replacement : [candidate])) };
};

const insertRow = (
  page: CustomAppPage,
  active: CustomAppBlock,
  targetRowId: string,
  edge: "before" | "after",
  ids: CustomAppLayoutIds,
): CustomAppPage | null => {
  if (!validNewIds(page, ids)) return null;
  const targetIndex = page.rows.findIndex((row) => row.id === targetRowId);
  if (targetIndex < 0) return null;

  const rows = [...page.rows];
  rows.splice(targetIndex + (edge === "after" ? 1 : 0), 0, {
    id: ids.rowIds[0],
    columns: [{ id: ids.columnIds[0], span: 12, blocks: [active] }],
  });
  return { ...page, rows };
};

export const applyCustomAppBlockDrop = (
  page: CustomAppPage,
  activeBlockId: string,
  intent: CustomAppBlockDropIntent,
  ids: CustomAppLayoutIds,
): CustomAppPage => {
  const normalized = normalizeCustomAppPageLayout(page);
  const active = findBlock(normalized, activeBlockId)?.block;
  if (!active) return page;
  if (intent.kind === "stack" && intent.targetBlockId === activeBlockId) return page;
  if (intent.kind === "beside" && (intent.firstBlockId === activeBlockId || intent.lastBlockId === activeBlockId)) return page;

  const detached = normalizeCustomAppPageLayout(removeBlock(normalized, activeBlockId));
  const inserted = (() => {
    if (intent.kind === "stack") return insertStacked(detached, active, intent.targetBlockId, intent.edge);
    if (intent.kind === "beside") return insertBeside(detached, active, intent, ids);
    return insertRow(detached, active, intent.targetRowId, intent.edge, ids);
  })();
  if (!inserted) return page;

  const result = normalizeCustomAppPageLayout(inserted);
  if (!validResult(normalized, result) || sameBlockLayout(normalized, result)) return page;
  return result;
};
