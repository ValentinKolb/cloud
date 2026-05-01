import { sql } from "bun";
import { ok, fail, err, type Result } from "@valentinkolb/stdlib";
import { createAccess } from "@valentinkolb/cloud/server/services/access";
import type { Principal, PermissionLevel } from "@valentinkolb/cloud/server";

const TABLE_BY_RESOURCE = {
  base: "grids.base_access",
  table: "grids.table_access",
  view: "grids.view_access",
} as const;

const COLUMN_BY_RESOURCE = {
  base: "base_id",
  table: "table_id",
  view: "view_id",
} as const;

/**
 * Creates an access entry on the platform `auth.access` table and binds it
 * to a grids resource via the matching junction. Mirrors the pattern other
 * apps (contacts, spaces) use, scoped to grids' three resource types.
 */
export const grantAccess = async (params: {
  resourceType: keyof typeof TABLE_BY_RESOURCE;
  resourceId: string;
  principal: Principal;
  permission: PermissionLevel;
}): Promise<Result<{ accessId: string }>> => {
  const created = await createAccess({ principal: params.principal, permission: params.permission });
  if (!created.ok) return fail(created.error);

  const accessId = created.data.id;
  // Bun's `sql` template tag doesn't support identifier interpolation; we hand-pick
  // the table+column name from the literal map above to keep the path safe.
  if (params.resourceType === "base") {
    await sql`INSERT INTO grids.base_access (base_id, access_id) VALUES (${params.resourceId}::uuid, ${accessId}::uuid)`;
  } else if (params.resourceType === "table") {
    await sql`INSERT INTO grids.table_access (table_id, access_id) VALUES (${params.resourceId}::uuid, ${accessId}::uuid)`;
  } else {
    await sql`INSERT INTO grids.view_access (view_id, access_id) VALUES (${params.resourceId}::uuid, ${accessId}::uuid)`;
  }

  return ok({ accessId });
};
