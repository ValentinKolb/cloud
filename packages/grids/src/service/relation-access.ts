import { sql } from "bun";
import { hasAtLeast, loadGrantsForUser, resolveEffectivePermission } from "./permission-resolver";

export type ExpansionViewer = {
  userId: string | null;
  userGroups: string[];
  serviceAccountId?: string | null;
  isAdmin?: boolean;
};

export const filterReadableTableIdsByViewer = async (tableIds: Iterable<string>, viewer: ExpansionViewer): Promise<Set<string>> => {
  const uniqueIds = [...new Set(tableIds)];
  if (viewer.isAdmin) return new Set(uniqueIds);
  if (uniqueIds.length === 0) return new Set();
  const tables = await sql<Array<{ id: string; base_id: string }>>`
    SELECT id::text, base_id::text
    FROM grids.tables
    WHERE id = ANY(${sql.array(uniqueIds, "UUID")}::uuid[])
      AND deleted_at IS NULL
  `;
  const verdicts = await Promise.all(
    tables.map(async (table) => {
      const grants = await loadGrantsForUser({
        userId: viewer.userId,
        userGroups: viewer.userGroups,
        serviceAccountId: viewer.serviceAccountId,
        baseId: table.base_id,
        tableId: table.id,
      });
      const level = resolveEffectivePermission(grants, { baseId: table.base_id, tableId: table.id });
      return hasAtLeast(level, "read") ? table.id : null;
    }),
  );
  return new Set(verdicts.filter((tableId): tableId is string => tableId !== null));
};

export const filterRelationTargetsByViewer = async (
  idsByTargetTable: Map<string, Set<string>>,
  viewer: ExpansionViewer,
): Promise<Map<string, Set<string>>> => {
  const readable = await filterReadableTableIdsByViewer(idsByTargetTable.keys(), viewer);
  return new Map([...idsByTargetTable].filter(([tableId]) => readable.has(tableId)));
};
