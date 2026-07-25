import type { RecordQuery } from "../../../contracts";

type BulkSelectionRunPayload = { recordIds: string[] } | { query: RecordQuery };

export const bulkSelectionQuery = (query: RecordQuery): RecordQuery => ({
  ...(query.filter ? { filter: query.filter } : {}),
  ...(query.search ? { search: query.search } : {}),
  ...(query.recordMeta ? { recordMeta: query.recordMeta } : {}),
  ...(query.sort ? { sort: query.sort } : {}),
  ...(query.limit ? { limit: query.limit } : {}),
});

export const bulkSelectionRunPayload = (selectedRecordIds: readonly string[], query: RecordQuery): BulkSelectionRunPayload => {
  const uniqueIds = [...new Set(selectedRecordIds)];
  return uniqueIds.length > 0 ? { recordIds: uniqueIds } : { query: bulkSelectionQuery(query) };
};

export const pruneBulkSelection = (selectedRecordIds: ReadonlySet<string>, visibleRecordIds: ReadonlySet<string>): Set<string> => {
  let changed = false;
  const next = new Set<string>();
  for (const id of selectedRecordIds) {
    if (visibleRecordIds.has(id)) next.add(id);
    else changed = true;
  }
  return changed ? next : new Set(selectedRecordIds);
};

export const sameBulkSelection = (left: ReadonlySet<string>, right: ReadonlySet<string>): boolean => {
  if (left.size !== right.size) return false;
  for (const id of left) if (!right.has(id)) return false;
  return true;
};

export const bulkWorkflowActionLabel = (workflowName: string, selectedCount: number): string =>
  selectedCount > 0 ? `Run ${workflowName} for ${selectedCount} selected` : `Run ${workflowName} for current query`;

export const bulkWorkflowTargetLabel = (selectedCount: number): string =>
  selectedCount > 0 ? `${selectedCount} record${selectedCount === 1 ? "" : "s"}` : "the current result set";
