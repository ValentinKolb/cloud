import { sql } from "bun";
import type { SqlClient } from "./audit";
import { loadBaseTableGrantsForSubject, resolveAuthorizedRecordAccess } from "./permission-resolver";
import { ALL_RECORD_ACCESS, type AuthorizedRecordAccess, recordAccessPredicate } from "./record-access";

export type ExpansionViewer = {
  userId: string | null;
  userGroups: string[];
  serviceAccountId?: string | null;
  isAdmin?: boolean;
  /** Complete readable-table catalog resolved for this request. */
  readableTableIds?: ReadonlySet<string>;
  /** Request-local cache shared by relation, lookup, and computed-field reads. */
  recordAccessByTableId?: Map<string, AuthorizedRecordAccess | null>;
};

export const resolveRecordAccessByTableIds = async (
  tableIds: Iterable<string>,
  viewer: ExpansionViewer,
  db: SqlClient = sql,
): Promise<Map<string, AuthorizedRecordAccess>> => {
  const uniqueIds = [...new Set(tableIds)];
  if (viewer.isAdmin) return new Map(uniqueIds.map((tableId) => [tableId, ALL_RECORD_ACCESS]));
  if (uniqueIds.length === 0) return new Map();

  const candidateIds = viewer.readableTableIds ? uniqueIds.filter((tableId) => viewer.readableTableIds!.has(tableId)) : uniqueIds;
  const candidateIdSet = new Set(candidateIds);
  const cached = viewer.recordAccessByTableId ?? new Map<string, AuthorizedRecordAccess | null>();
  viewer.recordAccessByTableId = cached;
  const unresolvedIds = candidateIds.filter((tableId) => !cached.has(tableId));
  for (const tableId of uniqueIds) {
    if (!candidateIdSet.has(tableId)) cached.set(tableId, null);
  }
  if (unresolvedIds.length === 0) {
    return new Map(
      candidateIds.flatMap((tableId) => {
        const access = cached.get(tableId);
        return access ? [[tableId, access] as const] : [];
      }),
    );
  }

  const tables = await db<Array<{ id: string; base_id: string }>>`
    SELECT id::text, base_id::text
    FROM grids.tables
    WHERE id = ANY(${db.array(unresolvedIds, "UUID")}::uuid[])
      AND deleted_at IS NULL
  `;
  const subject = viewer.userId
    ? { type: "user" as const, userId: viewer.userId }
    : viewer.serviceAccountId
      ? { type: "service_account" as const, serviceAccountId: viewer.serviceAccountId }
      : null;
  const grantsByBase = new Map(
    await Promise.all(
      [...new Set(tables.map((table) => table.base_id))].map(
        async (baseId) => [baseId, await loadBaseTableGrantsForSubject({ baseId, subject }, db)] as const,
      ),
    ),
  );
  const existingIds = new Set(tables.map((table) => table.id));
  for (const tableId of unresolvedIds) {
    if (!existingIds.has(tableId)) cached.set(tableId, null);
  }
  for (const table of tables) {
    const resolved = resolveAuthorizedRecordAccess(
      grantsByBase.get(table.base_id) ?? [],
      { baseId: table.base_id, tableId: table.id },
      "read",
      viewer.userId,
    );
    cached.set(table.id, resolved.recordAccess);
  }
  return new Map(
    candidateIds.flatMap((tableId) => {
      const access = cached.get(tableId);
      return access ? [[tableId, access] as const] : [];
    }),
  );
};

export const filterReadableTableIdsByViewer = async (tableIds: Iterable<string>, viewer: ExpansionViewer): Promise<Set<string>> =>
  new Set((await resolveRecordAccessByTableIds(tableIds, viewer)).keys());

/**
 * Filters linked record ids with the exact same predicate used by direct
 * record reads. This keeps relation UUIDs themselves from becoming a side
 * channel when labels or expansions are hidden.
 */
export const accessibleRecordIdsByTable = async (
  idsByTableId: ReadonlyMap<string, ReadonlySet<string>>,
  viewer: ExpansionViewer,
  db: SqlClient = sql,
): Promise<Map<string, Set<string>>> => {
  const accessByTableId = await resolveRecordAccessByTableIds(idsByTableId.keys(), viewer, db);
  const clauses = [...idsByTableId].flatMap(([tableId, ids]) => {
    const access = accessByTableId.get(tableId);
    if (!access || ids.size === 0) return [];
    return [
      db`(r.table_id = ${tableId}::uuid
      AND r.id = ANY(${db.array([...ids], "UUID")}::uuid[])
      AND ${recordAccessPredicate(access, "r")})`,
    ];
  });
  if (clauses.length === 0) return new Map();
  const where = clauses.slice(1).reduce((combined, clause) => db`${combined} OR ${clause}`, clauses[0]!);
  const rows = await db<Array<{ id: string; table_id: string }>>`
    SELECT r.id::text, r.table_id::text
    FROM grids.records r
    JOIN grids.tables t ON t.id = r.table_id AND t.deleted_at IS NULL
    JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
    WHERE r.deleted_at IS NULL AND (${where})
  `;
  const result = new Map<string, Set<string>>();
  for (const row of rows) {
    const ids = result.get(row.table_id) ?? new Set<string>();
    ids.add(row.id);
    result.set(row.table_id, ids);
  }
  return result;
};
