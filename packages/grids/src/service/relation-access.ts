import { hasAtLeast, loadGrantsForUser, resolveEffectivePermission } from "./permission-resolver";
import { get as getTable } from "./tables";

export type ExpansionViewer = {
  userId: string | null;
  userGroups: string[];
  serviceAccountId?: string | null;
  isAdmin?: boolean;
};

export const filterRelationTargetsByViewer = async (
  idsByTargetTable: Map<string, Set<string>>,
  viewer: ExpansionViewer,
): Promise<Map<string, Set<string>>> => {
  if (viewer.isAdmin) return idsByTargetTable;
  const verdicts = await Promise.all(
    [...idsByTargetTable.entries()].map(async ([tableId, ids]) => {
      const table = await getTable(tableId);
      if (!table) return null;
      const grants = await loadGrantsForUser({
        userId: viewer.userId,
        userGroups: viewer.userGroups,
        serviceAccountId: viewer.serviceAccountId,
        baseId: table.baseId,
        tableId,
      });
      const level = resolveEffectivePermission(grants, { baseId: table.baseId, tableId });
      return hasAtLeast(level, "read") ? ([tableId, ids] as const) : null;
    }),
  );
  return new Map(verdicts.filter((entry): entry is NonNullable<typeof entry> => entry !== null));
};
