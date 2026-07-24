import { sql } from "bun";
import { hasAtLeast, loadBaseTableGrantsForSubject, resolveEffectivePermission } from "./permission-resolver";

export type ExpansionViewer = {
  userId: string | null;
  userGroups: string[];
  serviceAccountId?: string | null;
  isAdmin?: boolean;
  /** Complete readable-table catalog resolved for this request. */
  readableTableIds?: ReadonlySet<string>;
};

export const filterReadableTableIdsByViewer = async (tableIds: Iterable<string>, viewer: ExpansionViewer): Promise<Set<string>> => {
  const uniqueIds = [...new Set(tableIds)];
  if (viewer.isAdmin) return new Set(uniqueIds);
  if (uniqueIds.length === 0) return new Set();
  if (viewer.readableTableIds) {
    return new Set(uniqueIds.filter((tableId) => viewer.readableTableIds!.has(tableId)));
  }
  const tables = await sql<Array<{ id: string; base_id: string }>>`
    SELECT id::text, base_id::text
    FROM grids.tables
    WHERE id = ANY(${sql.array(uniqueIds, "UUID")}::uuid[])
      AND deleted_at IS NULL
  `;
  const subject = viewer.userId
    ? { type: "user" as const, userId: viewer.userId }
    : viewer.serviceAccountId
      ? { type: "service_account" as const, serviceAccountId: viewer.serviceAccountId }
      : null;
  const baseIds = [...new Set(tables.map((table) => table.base_id))];
  const grantsByBase = new Map<string, Awaited<ReturnType<typeof loadBaseTableGrantsForSubject>>>();
  for (const baseId of baseIds) {
    grantsByBase.set(baseId, await loadBaseTableGrantsForSubject({ baseId, subject }));
  }
  return new Set(
    tables
      .filter((table) => {
        const level = resolveEffectivePermission(grantsByBase.get(table.base_id) ?? [], {
          baseId: table.base_id,
          tableId: table.id,
        });
        return hasAtLeast(level, "read");
      })
      .map((table) => table.id),
  );
};

export const filterRelationTargetsByViewer = async (
  idsByTargetTable: Map<string, Set<string>>,
  viewer: ExpansionViewer,
): Promise<Map<string, Set<string>>> => {
  const readable = await filterReadableTableIdsByViewer(idsByTargetTable.keys(), viewer);
  return new Map([...idsByTargetTable].filter(([tableId]) => readable.has(tableId)));
};
