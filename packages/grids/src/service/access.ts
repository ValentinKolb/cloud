import { sql } from "bun";
import { ok, fail, err, type Result } from "@valentinkolb/stdlib";
import {
  createAccess,
  deleteAccess as platformDeleteAccess,
  updateAccess as platformUpdateAccess,
  type Principal,
  type PermissionLevel,
  type AccessEntry,
} from "@valentinkolb/cloud/server";

const TABLE_BY_RESOURCE = {
  base: "grids.base_access",
  table: "grids.table_access",
  view: "grids.view_access",
  form: "grids.form_access",
  dashboard: "grids.dashboard_access",
} as const;

type DbAccessRow = {
  access_id: string;
  user_id: string | null;
  group_id: string | null;
  authenticated_only: boolean;
  permission: PermissionLevel;
  created_at: Date;
  display_name: string | null;
};

const principalFromRow = (row: DbAccessRow): Principal => {
  if (row.user_id) return { type: "user", userId: row.user_id };
  if (row.group_id) return { type: "group", groupId: row.group_id };
  if (row.authenticated_only) return { type: "authenticated" };
  return { type: "public" };
};

const mapAccessRow = (row: DbAccessRow): AccessEntry => ({
  id: row.access_id,
  principal: principalFromRow(row),
  permission: row.permission,
  createdAt: row.created_at.toISOString(),
  displayName: row.display_name ?? undefined,
});

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
  } else if (params.resourceType === "view") {
    await sql`INSERT INTO grids.view_access (view_id, access_id) VALUES (${params.resourceId}::uuid, ${accessId}::uuid)`;
  } else if (params.resourceType === "form") {
    await sql`INSERT INTO grids.form_access (form_id, access_id) VALUES (${params.resourceId}::uuid, ${accessId}::uuid)`;
  } else {
    await sql`INSERT INTO grids.dashboard_access (dashboard_id, access_id) VALUES (${params.resourceId}::uuid, ${accessId}::uuid)`;
  }

  return ok({ accessId });
};

const listAccess = async (resourceType: keyof typeof TABLE_BY_RESOURCE, resourceId: string): Promise<AccessEntry[]> => {
  // SELECT joining the matching junction table to auth.access. We left-join
  // auth.users / auth.groups to project a display name, falling back to the
  // raw uid/group name for anonymous principals.
  // Resource-type → junction column is hand-picked so SQL identifiers stay
  // out of user input.
  let rows: DbAccessRow[];
  if (resourceType === "base") {
    rows = await sql<DbAccessRow[]>`
      SELECT a.id AS access_id, a.user_id, a.group_id, a.authenticated_only,
             a.permission, a.created_at,
             COALESCE(u.uid, g.name, NULL) AS display_name
      FROM grids.base_access ba
      JOIN auth.access a ON a.id = ba.access_id
      LEFT JOIN auth.users u ON u.id = a.user_id
      LEFT JOIN auth.groups g ON g.id = a.group_id
      WHERE ba.base_id = ${resourceId}::uuid
      ORDER BY a.created_at
    `;
  } else if (resourceType === "table") {
    rows = await sql<DbAccessRow[]>`
      SELECT a.id AS access_id, a.user_id, a.group_id, a.authenticated_only,
             a.permission, a.created_at,
             COALESCE(u.uid, g.name, NULL) AS display_name
      FROM grids.table_access ta
      JOIN auth.access a ON a.id = ta.access_id
      LEFT JOIN auth.users u ON u.id = a.user_id
      LEFT JOIN auth.groups g ON g.id = a.group_id
      WHERE ta.table_id = ${resourceId}::uuid
      ORDER BY a.created_at
    `;
  } else if (resourceType === "view") {
    rows = await sql<DbAccessRow[]>`
      SELECT a.id AS access_id, a.user_id, a.group_id, a.authenticated_only,
             a.permission, a.created_at,
             COALESCE(u.uid, g.name, NULL) AS display_name
      FROM grids.view_access va
      JOIN auth.access a ON a.id = va.access_id
      LEFT JOIN auth.users u ON u.id = a.user_id
      LEFT JOIN auth.groups g ON g.id = a.group_id
      WHERE va.view_id = ${resourceId}::uuid
      ORDER BY a.created_at
    `;
  } else if (resourceType === "form") {
    rows = await sql<DbAccessRow[]>`
      SELECT a.id AS access_id, a.user_id, a.group_id, a.authenticated_only,
             a.permission, a.created_at,
             COALESCE(u.uid, g.name, NULL) AS display_name
      FROM grids.form_access fa
      JOIN auth.access a ON a.id = fa.access_id
      LEFT JOIN auth.users u ON u.id = a.user_id
      LEFT JOIN auth.groups g ON g.id = a.group_id
      WHERE fa.form_id = ${resourceId}::uuid
      ORDER BY a.created_at
    `;
  } else {
    rows = await sql<DbAccessRow[]>`
      SELECT a.id AS access_id, a.user_id, a.group_id, a.authenticated_only,
             a.permission, a.created_at,
             COALESCE(u.uid, g.name, NULL) AS display_name
      FROM grids.dashboard_access da
      JOIN auth.access a ON a.id = da.access_id
      LEFT JOIN auth.users u ON u.id = a.user_id
      LEFT JOIN auth.groups g ON g.id = a.group_id
      WHERE da.dashboard_id = ${resourceId}::uuid
      ORDER BY a.created_at
    `;
  }
  return rows.map(mapAccessRow);
};

export const listBaseAccess = (baseId: string) => listAccess("base", baseId);
export const listTableAccess = (tableId: string) => listAccess("table", tableId);
export const listViewAccess = (viewId: string) => listAccess("view", viewId);
export const listFormAccess = (formId: string) => listAccess("form", formId);
export const listDashboardAccess = (dashboardId: string) => listAccess("dashboard", dashboardId);

/**
 * Updates an existing access entry's permission level. Wraps the platform
 * service so callers don't need to know whether the entry came from base /
 * table / view ACL — they all share the auth.access row.
 */
export const updateAccessLevel = (accessId: string, level: PermissionLevel) =>
  platformUpdateAccess({ id: accessId, permission: level });

/**
 * Revokes an access binding. The auth.access row is also deleted: in this
 * codebase a row exists per resource-grant (no shared entries between
 * junctions), so removing the resource binding always means removing the
 * underlying access row too. CASCADE on the junctions handles the cleanup
 * automatically once the access row is gone.
 */
export const revokeAccess = async (accessId: string): Promise<Result<void>> => {
  const r = await platformDeleteAccess({ id: accessId });
  return r.ok ? ok() : fail(r.error);
};

/**
 * Resolves which grids resource an access id is bound to. Routes that
 * mutate an access row (PATCH / DELETE) call this first so they can gate
 * at admin on the parent resource — without this lookup, any authenticated
 * user with a known access-id could alter another resource's ACL.
 */
export type AccessBinding =
  | { resourceType: "base"; baseId: string }
  | { resourceType: "table"; baseId: string; tableId: string }
  | { resourceType: "view"; baseId: string; tableId: string; viewId: string }
  | { resourceType: "form"; baseId: string; tableId: string; formId: string }
  | { resourceType: "dashboard"; baseId: string; dashboardId: string };

export const resolveAccessBinding = async (accessId: string): Promise<AccessBinding | null> => {
  const [baseRow] = await sql<{ base_id: string }[]>`
    SELECT base_id FROM grids.base_access WHERE access_id = ${accessId}::uuid
  `;
  if (baseRow) return { resourceType: "base", baseId: baseRow.base_id };

  const [tableRow] = await sql<{ table_id: string; base_id: string }[]>`
    SELECT ta.table_id, t.base_id
    FROM grids.table_access ta
    JOIN grids.tables t ON t.id = ta.table_id
    WHERE ta.access_id = ${accessId}::uuid
  `;
  if (tableRow) {
    return { resourceType: "table", baseId: tableRow.base_id, tableId: tableRow.table_id };
  }

  const [viewRow] = await sql<{ view_id: string; table_id: string; base_id: string }[]>`
    SELECT va.view_id, v.table_id, t.base_id
    FROM grids.view_access va
    JOIN grids.views v ON v.id = va.view_id
    JOIN grids.tables t ON t.id = v.table_id
    WHERE va.access_id = ${accessId}::uuid
  `;
  if (viewRow) {
    return {
      resourceType: "view",
      baseId: viewRow.base_id,
      tableId: viewRow.table_id,
      viewId: viewRow.view_id,
    };
  }

  const [formRow] = await sql<{ form_id: string; table_id: string; base_id: string }[]>`
    SELECT fa.form_id, f.table_id, t.base_id
    FROM grids.form_access fa
    JOIN grids.forms f ON f.id = fa.form_id
    JOIN grids.tables t ON t.id = f.table_id
    WHERE fa.access_id = ${accessId}::uuid
  `;
  if (formRow) {
    return {
      resourceType: "form",
      baseId: formRow.base_id,
      tableId: formRow.table_id,
      formId: formRow.form_id,
    };
  }

  const [dashboardRow] = await sql<{ dashboard_id: string; base_id: string }[]>`
    SELECT da.dashboard_id, d.base_id
    FROM grids.dashboard_access da
    JOIN grids.dashboards d ON d.id = da.dashboard_id
    WHERE da.access_id = ${accessId}::uuid
  `;
  if (dashboardRow) {
    return {
      resourceType: "dashboard",
      baseId: dashboardRow.base_id,
      dashboardId: dashboardRow.dashboard_id,
    };
  }

  return null;
};
