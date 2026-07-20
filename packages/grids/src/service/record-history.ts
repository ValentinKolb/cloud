import * as storedAudit from "./audit";
import * as combinedAudit from "./combined-audit";
import { get as getTable } from "./tables";

export type RecordHistoryEntry =
  | Awaited<ReturnType<typeof storedAudit.listByRecord>>[number]
  | Awaited<ReturnType<typeof combinedAudit.listByRecord>>[number];

export const listByRecord = async (
  tableId: string,
  recordId: string,
  limit = 50,
  fieldIds?: readonly string[],
): Promise<RecordHistoryEntry[]> => {
  const table = await getTable(tableId);
  if (!table) return [];
  return table.kind === "federated"
    ? combinedAudit.listByRecord(tableId, recordId, limit, fieldIds)
    : storedAudit.listByRecord(tableId, recordId, limit);
};
