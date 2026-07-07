import type { AccessEntry, PermissionLevel, Principal } from "@valentinkolb/cloud/server";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { logAudit, type SqlClient } from "./audit";
import { emitMetadataEvent } from "./metadata-events";

const TABLE_BY_RESOURCE = {
  base: "grids.base_access",
  table: "grids.table_access",
  view: "grids.view_access",
  form: "grids.form_access",
  documentTemplate: "grids.document_template_access",
  dashboard: "grids.dashboard_access",
  workflow: "grids.workflow_access",
} as const;

type DbAccessRow = {
  access_id: string;
  user_id: string | null;
  group_id: string | null;
  service_account_id: string | null;
  authenticated_only: boolean;
  permission: PermissionLevel;
  created_at: Date;
  display_name: string | null;
};

type DbAccessSnapshot = {
  id: string;
  user_id: string | null;
  group_id: string | null;
  service_account_id: string | null;
  authenticated_only: boolean;
  permission: PermissionLevel;
};

type AccessResourceType = keyof typeof TABLE_BY_RESOURCE;

type AccessAuditSnapshot = {
  id: string;
  resourceType: AccessResourceType;
  resourceId: string;
  principal: Principal;
  permission: PermissionLevel;
};

export type ScopedAccessEntry = AccessEntry & {
  resourceType: AccessResourceType;
  resourceId: string;
  resourceName: string;
  tableId: string | null;
  tableName: string | null;
};

const emitAccessChanged = async (binding: AccessBinding | null, accessId: string, actorId: string | null = null): Promise<void> => {
  if (!binding) return;
  await emitMetadataEvent({
    type: "access.changed",
    baseId: binding.baseId,
    resource: {
      kind: "access",
      id: accessId,
      tableId: "tableId" in binding ? binding.tableId : undefined,
    },
    actorId,
  });
};

const principalFromRow = (row: Pick<DbAccessRow, "user_id" | "group_id" | "service_account_id" | "authenticated_only">): Principal => {
  if (row.user_id) return { type: "user", userId: row.user_id };
  if (row.group_id) return { type: "group", groupId: row.group_id };
  if (row.service_account_id) return { type: "service_account", serviceAccountId: row.service_account_id };
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

const mapScopedAccessRow = (
  row: DbAccessRow & {
    resource_type: AccessResourceType;
    resource_id: string;
    resource_name: string;
    table_id: string | null;
    table_name: string | null;
  },
): ScopedAccessEntry => ({
  ...mapAccessRow(row),
  resourceType: row.resource_type,
  resourceId: row.resource_id,
  resourceName: row.resource_name,
  tableId: row.table_id,
  tableName: row.table_name,
});

const resourceIdFromBinding = (binding: AccessBinding): string => {
  if (binding.resourceType === "base") return binding.baseId;
  if (binding.resourceType === "table") return binding.tableId;
  if (binding.resourceType === "view") return binding.viewId;
  if (binding.resourceType === "form") return binding.formId;
  if (binding.resourceType === "documentTemplate") return binding.documentTemplateId;
  if (binding.resourceType === "dashboard") return binding.dashboardId;
  return binding.workflowId;
};

const auditScopeFromBinding = (binding: AccessBinding): { baseId: string; tableId: string | null } => ({
  baseId: binding.baseId,
  tableId: "tableId" in binding ? binding.tableId : null,
});

export const buildAccessAuditDiff = (
  action: "access.granted" | "access.updated" | "access.revoked",
  binding: AccessBinding,
  access: Pick<DbAccessSnapshot, "id" | "permission" | "user_id" | "group_id" | "service_account_id" | "authenticated_only">,
  nextPermission: PermissionLevel | null,
): { access: { old: AccessAuditSnapshot | null; new: AccessAuditSnapshot | null } } => {
  const snapshot: AccessAuditSnapshot = {
    id: access.id,
    resourceType: binding.resourceType,
    resourceId: resourceIdFromBinding(binding),
    principal: principalFromRow({
      user_id: access.user_id,
      group_id: access.group_id,
      service_account_id: access.service_account_id,
      authenticated_only: access.authenticated_only,
    }),
    permission: access.permission,
  };

  return {
    access: {
      old: action === "access.granted" ? null : snapshot,
      new: nextPermission === null ? null : { ...snapshot, permission: nextPermission },
    },
  };
};

const getAccessSnapshot = async (accessId: string, client: SqlClient = sql): Promise<DbAccessSnapshot | null> => {
  const [row] = await client<DbAccessSnapshot[]>`
    SELECT id, user_id, group_id, service_account_id, authenticated_only, permission
    FROM auth.access
    WHERE id = ${accessId}::uuid
  `;
  return row ?? null;
};

const insertAccessRow = async (
  params: { principal: Principal; permission: PermissionLevel },
  client: SqlClient,
): Promise<Result<{ id: string }>> => {
  const { principal, permission } = params;

  let userId: string | null = null;
  let groupId: string | null = null;
  let serviceAccountId: string | null = null;
  let authenticatedOnly = false;

  if (principal.type === "user") {
    userId = principal.userId;
    const [user] = await client<{ id: string }[]>`
      SELECT id FROM auth.users WHERE id = ${userId}::uuid
    `;
    if (!user) return fail(err.notFound("User"));
  } else if (principal.type === "group") {
    groupId = principal.groupId;
    const [group] = await client<{ id: string }[]>`
      SELECT id FROM auth.groups WHERE id = ${groupId}::uuid
    `;
    if (!group) return fail(err.notFound("Group"));
  } else if (principal.type === "service_account") {
    serviceAccountId = principal.serviceAccountId;
    const [serviceAccount] = await client<{ id: string }[]>`
      SELECT id FROM auth.service_accounts WHERE id = ${serviceAccountId}::uuid AND status = 'active'
    `;
    if (!serviceAccount) return fail(err.notFound("Service account"));
  } else if (principal.type === "authenticated") {
    authenticatedOnly = true;
  }

  const [row] = await client<{ id: string }[]>`
    INSERT INTO auth.access (user_id, group_id, service_account_id, authenticated_only, permission)
    VALUES (${userId}::uuid, ${groupId}::uuid, ${serviceAccountId}::uuid, ${authenticatedOnly}, ${permission}::auth.permission_level)
    RETURNING id
  `;
  return row ? ok({ id: row.id }) : fail(err.internal("Failed to create access entry"));
};

const insertAccessBinding = async (
  resourceType: AccessResourceType,
  resourceId: string,
  accessId: string,
  client: SqlClient,
): Promise<void> => {
  // Bun's `sql` template tag doesn't support identifier interpolation; we hand-pick
  // the table+column name from the literal map above to keep the path safe.
  if (resourceType === "base") {
    await client`INSERT INTO grids.base_access (base_id, access_id) VALUES (${resourceId}::uuid, ${accessId}::uuid)`;
  } else if (resourceType === "table") {
    await client`INSERT INTO grids.table_access (table_id, access_id) VALUES (${resourceId}::uuid, ${accessId}::uuid)`;
  } else if (resourceType === "view") {
    await client`INSERT INTO grids.view_access (view_id, access_id) VALUES (${resourceId}::uuid, ${accessId}::uuid)`;
  } else if (resourceType === "form") {
    await client`INSERT INTO grids.form_access (form_id, access_id) VALUES (${resourceId}::uuid, ${accessId}::uuid)`;
  } else if (resourceType === "documentTemplate") {
    await client`INSERT INTO grids.document_template_access (template_id, access_id) VALUES (${resourceId}::uuid, ${accessId}::uuid)`;
  } else if (resourceType === "workflow") {
    await client`INSERT INTO grids.workflow_access (workflow_id, access_id) VALUES (${resourceId}::uuid, ${accessId}::uuid)`;
  } else {
    await client`INSERT INTO grids.dashboard_access (dashboard_id, access_id) VALUES (${resourceId}::uuid, ${accessId}::uuid)`;
  }
};

const logAccessAudit = async (params: {
  action: "access.granted" | "access.updated" | "access.revoked";
  binding: AccessBinding;
  access: DbAccessSnapshot;
  actorId: string | null;
  nextPermission: PermissionLevel | null;
  client: SqlClient;
}): Promise<void> => {
  const scope = auditScopeFromBinding(params.binding);
  await logAudit(
    {
      ...scope,
      userId: params.actorId,
      action: params.action,
      diff: buildAccessAuditDiff(params.action, params.binding, params.access, params.nextPermission),
    },
    params.client,
  );
};

/**
 * Creates an access entry on the platform `auth.access` table, binds it to a
 * grids resource via the matching junction, and writes the ACL audit entry in
 * the same DB transaction.
 */
export const grantAccess = async (params: {
  resourceType: AccessResourceType;
  resourceId: string;
  principal: Principal;
  permission: PermissionLevel;
  actorId?: string | null;
}): Promise<Result<{ accessId: string }>> => {
  const createdAccess = await sql.begin(async (tx): Promise<Result<{ accessId: string }>> => {
    const created = await insertAccessRow({ principal: params.principal, permission: params.permission }, tx);
    if (!created.ok) return fail(created.error);
    await insertAccessBinding(params.resourceType, params.resourceId, created.data.id, tx);
    const binding = await resolveAccessBinding(created.data.id, tx);
    if (!binding) throw err.internal("Failed to resolve access binding");
    const access = await getAccessSnapshot(created.data.id, tx);
    if (!access) throw err.internal("Failed to resolve access entry");
    await logAccessAudit({
      action: "access.granted",
      binding,
      access,
      actorId: params.actorId ?? null,
      nextPermission: params.permission,
      client: tx,
    });
    return ok({ accessId: created.data.id });
  });
  if (!createdAccess.ok) return fail(createdAccess.error);

  await emitAccessChanged(await resolveAccessBinding(createdAccess.data.accessId), createdAccess.data.accessId, params.actorId ?? null);
  return createdAccess;
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
      SELECT a.id AS access_id, a.user_id, a.group_id, a.service_account_id, a.authenticated_only,
             a.permission, a.created_at,
             COALESCE(u.uid, g.name, sa.name, NULL) AS display_name
      FROM grids.base_access ba
      JOIN auth.access a ON a.id = ba.access_id
      LEFT JOIN auth.users u ON u.id = a.user_id
      LEFT JOIN auth.groups g ON g.id = a.group_id
      LEFT JOIN auth.service_accounts sa ON sa.id = a.service_account_id
      WHERE ba.base_id = ${resourceId}::uuid
      ORDER BY a.created_at
    `;
  } else if (resourceType === "table") {
    rows = await sql<DbAccessRow[]>`
      SELECT a.id AS access_id, a.user_id, a.group_id, a.service_account_id, a.authenticated_only,
             a.permission, a.created_at,
             COALESCE(u.uid, g.name, sa.name, NULL) AS display_name
      FROM grids.table_access ta
      JOIN auth.access a ON a.id = ta.access_id
      LEFT JOIN auth.users u ON u.id = a.user_id
      LEFT JOIN auth.groups g ON g.id = a.group_id
      LEFT JOIN auth.service_accounts sa ON sa.id = a.service_account_id
      WHERE ta.table_id = ${resourceId}::uuid
      ORDER BY a.created_at
    `;
  } else if (resourceType === "view") {
    rows = await sql<DbAccessRow[]>`
      SELECT a.id AS access_id, a.user_id, a.group_id, a.service_account_id, a.authenticated_only,
             a.permission, a.created_at,
             COALESCE(u.uid, g.name, sa.name, NULL) AS display_name
      FROM grids.view_access va
      JOIN auth.access a ON a.id = va.access_id
      LEFT JOIN auth.users u ON u.id = a.user_id
      LEFT JOIN auth.groups g ON g.id = a.group_id
      LEFT JOIN auth.service_accounts sa ON sa.id = a.service_account_id
      WHERE va.view_id = ${resourceId}::uuid
      ORDER BY a.created_at
    `;
  } else if (resourceType === "form") {
    rows = await sql<DbAccessRow[]>`
      SELECT a.id AS access_id, a.user_id, a.group_id, a.service_account_id, a.authenticated_only,
             a.permission, a.created_at,
             COALESCE(u.uid, g.name, sa.name, NULL) AS display_name
      FROM grids.form_access fa
      JOIN auth.access a ON a.id = fa.access_id
      LEFT JOIN auth.users u ON u.id = a.user_id
      LEFT JOIN auth.groups g ON g.id = a.group_id
      LEFT JOIN auth.service_accounts sa ON sa.id = a.service_account_id
      WHERE fa.form_id = ${resourceId}::uuid
      ORDER BY a.created_at
    `;
  } else if (resourceType === "documentTemplate") {
    rows = await sql<DbAccessRow[]>`
      SELECT a.id AS access_id, a.user_id, a.group_id, a.service_account_id, a.authenticated_only,
             a.permission, a.created_at,
             COALESCE(u.uid, g.name, sa.name, NULL) AS display_name
      FROM grids.document_template_access dta
      JOIN auth.access a ON a.id = dta.access_id
      LEFT JOIN auth.users u ON u.id = a.user_id
      LEFT JOIN auth.groups g ON g.id = a.group_id
      LEFT JOIN auth.service_accounts sa ON sa.id = a.service_account_id
      WHERE dta.template_id = ${resourceId}::uuid
      ORDER BY a.created_at
    `;
  } else if (resourceType === "workflow") {
    rows = await sql<DbAccessRow[]>`
      SELECT a.id AS access_id, a.user_id, a.group_id, a.service_account_id, a.authenticated_only,
             a.permission, a.created_at,
             COALESCE(u.uid, g.name, sa.name, NULL) AS display_name
      FROM grids.workflow_access wa
      JOIN auth.access a ON a.id = wa.access_id
      LEFT JOIN auth.users u ON u.id = a.user_id
      LEFT JOIN auth.groups g ON g.id = a.group_id
      LEFT JOIN auth.service_accounts sa ON sa.id = a.service_account_id
      WHERE wa.workflow_id = ${resourceId}::uuid
      ORDER BY a.created_at
    `;
  } else {
    rows = await sql<DbAccessRow[]>`
      SELECT a.id AS access_id, a.user_id, a.group_id, a.service_account_id, a.authenticated_only,
             a.permission, a.created_at,
             COALESCE(u.uid, g.name, sa.name, NULL) AS display_name
      FROM grids.dashboard_access da
      JOIN auth.access a ON a.id = da.access_id
      LEFT JOIN auth.users u ON u.id = a.user_id
      LEFT JOIN auth.groups g ON g.id = a.group_id
      LEFT JOIN auth.service_accounts sa ON sa.id = a.service_account_id
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
export const listDocumentTemplateAccess = (templateId: string) => listAccess("documentTemplate", templateId);
export const listDashboardAccess = (dashboardId: string) => listAccess("dashboard", dashboardId);
export const listWorkflowAccess = (workflowId: string) => listAccess("workflow", workflowId);

export const listAccessForBaseTree = async (baseId: string): Promise<ScopedAccessEntry[]> => {
  const rows = await sql<
    (DbAccessRow & {
      resource_type: AccessResourceType;
      resource_id: string;
      resource_name: string;
      table_id: string | null;
      table_name: string | null;
    })[]
  >`
    SELECT *
    FROM (
      SELECT
        'base' AS resource_type,
        b.id AS resource_id,
        b.name AS resource_name,
        NULL::uuid AS table_id,
        NULL::text AS table_name,
        a.id AS access_id,
        a.user_id,
        a.group_id,
        a.service_account_id,
        a.authenticated_only,
        a.permission,
        a.created_at,
        COALESCE(u.uid, g.name, sa.name, NULL) AS display_name
      FROM grids.base_access ba
      JOIN grids.bases b ON b.id = ba.base_id
      JOIN auth.access a ON a.id = ba.access_id
      LEFT JOIN auth.users u ON u.id = a.user_id
      LEFT JOIN auth.groups g ON g.id = a.group_id
      LEFT JOIN auth.service_accounts sa ON sa.id = a.service_account_id
      WHERE b.id = ${baseId}::uuid AND b.deleted_at IS NULL

      UNION ALL

      SELECT
        'table' AS resource_type,
        t.id AS resource_id,
        t.name AS resource_name,
        t.id AS table_id,
        t.name AS table_name,
        a.id AS access_id,
        a.user_id,
        a.group_id,
        a.service_account_id,
        a.authenticated_only,
        a.permission,
        a.created_at,
        COALESCE(u.uid, g.name, sa.name, NULL) AS display_name
      FROM grids.table_access ta
      JOIN grids.tables t ON t.id = ta.table_id
      JOIN auth.access a ON a.id = ta.access_id
      LEFT JOIN auth.users u ON u.id = a.user_id
      LEFT JOIN auth.groups g ON g.id = a.group_id
      LEFT JOIN auth.service_accounts sa ON sa.id = a.service_account_id
      WHERE t.base_id = ${baseId}::uuid AND t.deleted_at IS NULL

      UNION ALL

      SELECT
        'view' AS resource_type,
        v.id AS resource_id,
        v.name AS resource_name,
        t.id AS table_id,
        t.name AS table_name,
        a.id AS access_id,
        a.user_id,
        a.group_id,
        a.service_account_id,
        a.authenticated_only,
        a.permission,
        a.created_at,
        COALESCE(u.uid, g.name, sa.name, NULL) AS display_name
      FROM grids.view_access va
      JOIN grids.views v ON v.id = va.view_id
      JOIN grids.tables t ON t.id = v.table_id
      JOIN auth.access a ON a.id = va.access_id
      LEFT JOIN auth.users u ON u.id = a.user_id
      LEFT JOIN auth.groups g ON g.id = a.group_id
      LEFT JOIN auth.service_accounts sa ON sa.id = a.service_account_id
      WHERE t.base_id = ${baseId}::uuid AND t.deleted_at IS NULL AND v.deleted_at IS NULL

      UNION ALL

      SELECT
        'form' AS resource_type,
        f.id AS resource_id,
        f.name AS resource_name,
        t.id AS table_id,
        t.name AS table_name,
        a.id AS access_id,
        a.user_id,
        a.group_id,
        a.service_account_id,
        a.authenticated_only,
        a.permission,
        a.created_at,
        COALESCE(u.uid, g.name, sa.name, NULL) AS display_name
      FROM grids.form_access fa
      JOIN grids.forms f ON f.id = fa.form_id
      JOIN grids.tables t ON t.id = f.table_id
      JOIN auth.access a ON a.id = fa.access_id
      LEFT JOIN auth.users u ON u.id = a.user_id
      LEFT JOIN auth.groups g ON g.id = a.group_id
      LEFT JOIN auth.service_accounts sa ON sa.id = a.service_account_id
      WHERE t.base_id = ${baseId}::uuid AND t.deleted_at IS NULL AND f.deleted_at IS NULL

      UNION ALL

      SELECT
        'documentTemplate' AS resource_type,
        dt.id AS resource_id,
        dt.name AS resource_name,
        t.id AS table_id,
        t.name AS table_name,
        a.id AS access_id,
        a.user_id,
        a.group_id,
        a.service_account_id,
        a.authenticated_only,
        a.permission,
        a.created_at,
        COALESCE(u.uid, g.name, sa.name, NULL) AS display_name
      FROM grids.document_template_access dta
      JOIN grids.document_templates dt ON dt.id = dta.template_id
      JOIN grids.tables t ON t.id = dt.table_id
      JOIN auth.access a ON a.id = dta.access_id
      LEFT JOIN auth.users u ON u.id = a.user_id
      LEFT JOIN auth.groups g ON g.id = a.group_id
      LEFT JOIN auth.service_accounts sa ON sa.id = a.service_account_id
      WHERE t.base_id = ${baseId}::uuid AND t.deleted_at IS NULL AND dt.deleted_at IS NULL

      UNION ALL

      SELECT
        'dashboard' AS resource_type,
        d.id AS resource_id,
        d.name AS resource_name,
        NULL::uuid AS table_id,
        NULL::text AS table_name,
        a.id AS access_id,
        a.user_id,
        a.group_id,
        a.service_account_id,
        a.authenticated_only,
        a.permission,
        a.created_at,
        COALESCE(u.uid, g.name, sa.name, NULL) AS display_name
      FROM grids.dashboard_access da
      JOIN grids.dashboards d ON d.id = da.dashboard_id
      JOIN auth.access a ON a.id = da.access_id
      LEFT JOIN auth.users u ON u.id = a.user_id
      LEFT JOIN auth.groups g ON g.id = a.group_id
      LEFT JOIN auth.service_accounts sa ON sa.id = a.service_account_id
      WHERE d.base_id = ${baseId}::uuid AND d.deleted_at IS NULL

      UNION ALL

      SELECT
        'workflow' AS resource_type,
        w.id AS resource_id,
        w.name AS resource_name,
        NULL::uuid AS table_id,
        NULL::text AS table_name,
        a.id AS access_id,
        a.user_id,
        a.group_id,
        a.service_account_id,
        a.authenticated_only,
        a.permission,
        a.created_at,
        COALESCE(u.uid, g.name, sa.name, NULL) AS display_name
      FROM grids.workflow_access wa
      JOIN grids.workflows w ON w.id = wa.workflow_id
      JOIN auth.access a ON a.id = wa.access_id
      LEFT JOIN auth.users u ON u.id = a.user_id
      LEFT JOIN auth.groups g ON g.id = a.group_id
      LEFT JOIN auth.service_accounts sa ON sa.id = a.service_account_id
      WHERE w.base_id = ${baseId}::uuid AND w.deleted_at IS NULL
    ) entries
    ORDER BY
      CASE resource_type
        WHEN 'base' THEN 0
        WHEN 'table' THEN 1
        WHEN 'view' THEN 2
        WHEN 'form' THEN 3
        WHEN 'documentTemplate' THEN 4
        WHEN 'dashboard' THEN 5
        ELSE 6
      END,
      resource_name,
      created_at
  `;
  return rows.map(mapScopedAccessRow);
};

/**
 * Updates an existing access entry's permission level and logs the ACL
 * change in the same DB transaction.
 */
export const updateAccessLevel = async (accessId: string, level: PermissionLevel, actorId: string | null = null): Promise<Result<void>> => {
  const binding = await resolveAccessBinding(accessId);
  if (!binding) return fail(err.notFound("Access entry"));
  const result = await sql.begin(async (tx) => {
    const access = await getAccessSnapshot(accessId, tx);
    if (!access) return fail(err.notFound("Access entry"));
    const update = await tx`
      UPDATE auth.access
      SET permission = ${level}::auth.permission_level
      WHERE id = ${accessId}::uuid
    `;
    if (update.count === 0) return fail(err.notFound("Access entry"));
    if (access.permission !== level) {
      await logAccessAudit({
        action: "access.updated",
        binding,
        access,
        actorId,
        nextPermission: level,
        client: tx,
      });
    }
    return ok();
  });
  if (result.ok) await emitAccessChanged(binding, accessId, actorId);
  return result;
};

/**
 * Revokes an access binding. The auth.access row is also deleted: in this
 * codebase a row exists per resource-grant (no shared entries between
 * junctions), so removing the resource binding always means removing the
 * underlying access row too. CASCADE on the junctions handles the cleanup
 * automatically once the access row is gone.
 */
export const revokeAccess = async (accessId: string, actorId: string | null = null): Promise<Result<void>> => {
  const binding = await resolveAccessBinding(accessId);
  if (!binding) return fail(err.notFound("Access entry"));
  const result = await sql.begin(async (tx) => {
    const access = await getAccessSnapshot(accessId, tx);
    if (!access) return fail(err.notFound("Access entry"));
    const deleted = await tx`
      DELETE FROM auth.access
      WHERE id = ${accessId}::uuid
    `;
    if (deleted.count === 0) return fail(err.notFound("Access entry"));
    await logAccessAudit({
      action: "access.revoked",
      binding,
      access,
      actorId,
      nextPermission: null,
      client: tx,
    });
    return ok();
  });
  if (result.ok) await emitAccessChanged(binding, accessId, actorId);
  return result;
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
  | { resourceType: "documentTemplate"; baseId: string; tableId: string; documentTemplateId: string }
  | { resourceType: "dashboard"; baseId: string; dashboardId: string }
  | { resourceType: "workflow"; baseId: string; workflowId: string };

export const resolveAccessBinding = async (accessId: string, client: SqlClient = sql): Promise<AccessBinding | null> => {
  const [baseRow] = await client<{ base_id: string }[]>`
    SELECT base_id FROM grids.base_access WHERE access_id = ${accessId}::uuid
  `;
  if (baseRow) return { resourceType: "base", baseId: baseRow.base_id };

  const [tableRow] = await client<{ table_id: string; base_id: string }[]>`
    SELECT ta.table_id, t.base_id
    FROM grids.table_access ta
    JOIN grids.tables t ON t.id = ta.table_id
    WHERE ta.access_id = ${accessId}::uuid
  `;
  if (tableRow) {
    return { resourceType: "table", baseId: tableRow.base_id, tableId: tableRow.table_id };
  }

  const [viewRow] = await client<{ view_id: string; table_id: string; base_id: string }[]>`
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

  const [formRow] = await client<{ form_id: string; table_id: string; base_id: string }[]>`
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

  const [documentTemplateRow] = await client<{ template_id: string; table_id: string; base_id: string }[]>`
    SELECT dta.template_id, dt.table_id, t.base_id
    FROM grids.document_template_access dta
    JOIN grids.document_templates dt ON dt.id = dta.template_id
    JOIN grids.tables t ON t.id = dt.table_id
    WHERE dta.access_id = ${accessId}::uuid
  `;
  if (documentTemplateRow) {
    return {
      resourceType: "documentTemplate",
      baseId: documentTemplateRow.base_id,
      tableId: documentTemplateRow.table_id,
      documentTemplateId: documentTemplateRow.template_id,
    };
  }

  const [dashboardRow] = await client<{ dashboard_id: string; base_id: string }[]>`
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

  const [workflowRow] = await client<{ workflow_id: string; base_id: string }[]>`
    SELECT wa.workflow_id, w.base_id
    FROM grids.workflow_access wa
    JOIN grids.workflows w ON w.id = wa.workflow_id
    WHERE wa.access_id = ${accessId}::uuid
  `;
  if (workflowRow) {
    return {
      resourceType: "workflow",
      baseId: workflowRow.base_id,
      workflowId: workflowRow.workflow_id,
    };
  }

  return null;
};
