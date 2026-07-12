import type { AccessEntry, PermissionLevel, Principal } from "@valentinkolb/cloud/server";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { logAudit, type SqlClient } from "./audit";
import { emitMetadataEvent } from "./metadata-events";

const ACCESS_RESOURCES = {
  base: {
    junctionTable: "grids.base_access",
    junctionResourceColumn: "base_id",
    resourceTable: "grids.bases",
    scope: "base",
    bindingIdKey: "baseId",
    allowedPermissions: ["read", "write", "admin", "none"],
    invalidPermissionMessage: "Base grants only accept 'read', 'write', 'admin', or 'none'",
  },
  table: {
    junctionTable: "grids.table_access",
    junctionResourceColumn: "table_id",
    resourceTable: "grids.tables",
    scope: "table",
    bindingIdKey: "tableId",
    allowedPermissions: ["read", "write", "none"],
    invalidPermissionMessage: "Table grants only accept 'read' / 'write' / 'none'",
  },
  view: {
    junctionTable: "grids.view_access",
    junctionResourceColumn: "view_id",
    resourceTable: "grids.views",
    scope: "tableChild",
    bindingIdKey: "viewId",
    allowedPermissions: ["read", "admin", "none"],
    invalidPermissionMessage: "View grants only accept 'read', 'admin', or 'none'",
  },
  form: {
    junctionTable: "grids.form_access",
    junctionResourceColumn: "form_id",
    resourceTable: "grids.forms",
    scope: "tableChild",
    bindingIdKey: "formId",
    allowedPermissions: ["write", "none"],
    invalidPermissionMessage: "Form grants only accept 'write' or 'none'",
  },
  documentTemplate: {
    junctionTable: "grids.document_template_access",
    junctionResourceColumn: "template_id",
    resourceTable: "grids.document_templates",
    scope: "tableChild",
    bindingIdKey: "documentTemplateId",
    allowedPermissions: ["read", "write", "admin", "none"],
    invalidPermissionMessage: "Document template grants only accept 'read', 'write', 'admin', or 'none'",
  },
  dashboard: {
    junctionTable: "grids.dashboard_access",
    junctionResourceColumn: "dashboard_id",
    resourceTable: "grids.dashboards",
    scope: "baseChild",
    bindingIdKey: "dashboardId",
    allowedPermissions: ["read", "none"],
    invalidPermissionMessage: "Dashboard grants only accept 'read' or 'none'",
  },
  workflow: {
    junctionTable: "grids.workflow_access",
    junctionResourceColumn: "workflow_id",
    resourceTable: "grids.workflows",
    scope: "baseChild",
    bindingIdKey: "workflowId",
    allowedPermissions: ["read", "write", "admin", "none"],
    invalidPermissionMessage: "Workflow grants only accept 'read', 'write', 'admin', or 'none'",
  },
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

export type AccessResourceType = keyof typeof ACCESS_RESOURCES;
type AccessResourceDefinition = (typeof ACCESS_RESOURCES)[AccessResourceType];

export const validateAccessPermission = (resourceType: AccessResourceType, permission: string): string | null => {
  const definition = ACCESS_RESOURCES[resourceType];
  return (definition.allowedPermissions as readonly string[]).includes(permission) ? null : definition.invalidPermissionMessage;
};

type AccessAuditSnapshot = {
  id: string;
  resourceType: AccessResourceType;
  resourceId: string;
  principal: Principal;
  permission: PermissionLevel;
};

type ScopedAccessEntry = AccessEntry & {
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
  const definition = ACCESS_RESOURCES[binding.resourceType];
  return (binding as unknown as Record<string, string>)[definition.bindingIdKey]!;
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
  const definition = ACCESS_RESOURCES[resourceType];
  await client`
    INSERT INTO ${client.unsafe(definition.junctionTable)} (${client.unsafe(definition.junctionResourceColumn)}, access_id)
    VALUES (${resourceId}::uuid, ${accessId}::uuid)
  `;
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

const listAccess = async (resourceType: AccessResourceType, resourceId: string): Promise<AccessEntry[]> => {
  const definition = ACCESS_RESOURCES[resourceType];
  const rows = await sql<DbAccessRow[]>`
    SELECT a.id AS access_id, a.user_id, a.group_id, a.service_account_id, a.authenticated_only,
           a.permission, a.created_at,
           COALESCE(u.uid, g.name, sa.name, NULL) AS display_name
    FROM ${sql.unsafe(definition.junctionTable)} binding
    JOIN auth.access a ON a.id = binding.access_id
    LEFT JOIN auth.users u ON u.id = a.user_id
    LEFT JOIN auth.groups g ON g.id = a.group_id
    LEFT JOIN auth.service_accounts sa ON sa.id = a.service_account_id
    WHERE ${sql.unsafe(`binding.${definition.junctionResourceColumn}`)} = ${resourceId}::uuid
    ORDER BY a.created_at
  `;
  return rows.map(mapAccessRow);
};

export const listBaseAccess = (baseId: string) => listAccess("base", baseId);
export const listTableAccess = (tableId: string) => listAccess("table", tableId);
export const listViewAccess = (viewId: string) => listAccess("view", viewId);
export const listFormAccess = (formId: string) => listAccess("form", formId);
export const listDocumentTemplateAccess = (templateId: string) => listAccess("documentTemplate", templateId);
export const listDashboardAccess = (dashboardId: string) => listAccess("dashboard", dashboardId);
export const listWorkflowAccess = (workflowId: string) => listAccess("workflow", workflowId);

const accessResourceEntries = Object.entries(ACCESS_RESOURCES) as [AccessResourceType, AccessResourceDefinition][];

const joinUnionAll = (parts: unknown[], client: SqlClient): unknown =>
  parts.slice(1).reduce((query, part) => client`${query} UNION ALL ${part}`, parts[0]);

const resourceScopeSql = (definition: AccessResourceDefinition) => ({
  tableJoin: definition.scope === "tableChild" ? "JOIN grids.tables parent_table ON parent_table.id = resource.table_id" : "",
  baseIdExpression:
    definition.scope === "base" ? "resource.id" : definition.scope === "tableChild" ? "parent_table.base_id" : "resource.base_id",
  tableIdExpression: definition.scope === "table" ? "resource.id" : definition.scope === "tableChild" ? "parent_table.id" : "NULL::uuid",
  tableNameExpression:
    definition.scope === "table" ? "resource.name" : definition.scope === "tableChild" ? "parent_table.name" : "NULL::text",
});

const baseTreeSelect = (resourceType: AccessResourceType, definition: AccessResourceDefinition, sortOrder: number, baseId: string) => {
  const { tableJoin, baseIdExpression, tableIdExpression, tableNameExpression } = resourceScopeSql(definition);
  const parentAlive = definition.scope === "tableChild" ? "AND parent_table.deleted_at IS NULL" : "";

  return sql`
    SELECT
      ${sortOrder}::int AS sort_order,
      ${resourceType}::text AS resource_type,
      resource.id AS resource_id,
      resource.name AS resource_name,
      ${sql.unsafe(tableIdExpression)} AS table_id,
      ${sql.unsafe(tableNameExpression)} AS table_name,
      a.id AS access_id,
      a.user_id,
      a.group_id,
      a.service_account_id,
      a.authenticated_only,
      a.permission,
      a.created_at,
      COALESCE(u.uid, g.name, sa.name, NULL) AS display_name
    FROM ${sql.unsafe(definition.junctionTable)} binding
    JOIN ${sql.unsafe(`${definition.resourceTable} resource`)} ON resource.id = ${sql.unsafe(`binding.${definition.junctionResourceColumn}`)}
    ${sql.unsafe(tableJoin)}
    JOIN auth.access a ON a.id = binding.access_id
    LEFT JOIN auth.users u ON u.id = a.user_id
    LEFT JOIN auth.groups g ON g.id = a.group_id
    LEFT JOIN auth.service_accounts sa ON sa.id = a.service_account_id
    WHERE ${sql.unsafe(baseIdExpression)} = ${baseId}::uuid
      AND resource.deleted_at IS NULL
      ${sql.unsafe(parentAlive)}
  `;
};

export const listAccessForBaseTree = async (baseId: string): Promise<ScopedAccessEntry[]> => {
  const union = joinUnionAll(
    accessResourceEntries.map(([resourceType, definition], index) => baseTreeSelect(resourceType, definition, index, baseId)),
    sql,
  );
  const rows = await sql<
    (DbAccessRow & {
      resource_type: AccessResourceType;
      resource_id: string;
      resource_name: string;
      table_id: string | null;
      table_name: string | null;
    })[]
  >`
    SELECT * FROM (${union}) entries
    ORDER BY sort_order, resource_name, created_at
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

type DbAccessBinding = {
  sort_order?: number;
  resource_type: AccessResourceType;
  resource_id: string;
  base_id: string;
  table_id: string | null;
};

const bindingSelect = (
  resourceType: AccessResourceType,
  definition: AccessResourceDefinition,
  sortOrder: number,
  accessId: string,
  client: SqlClient,
) => {
  const { tableJoin, baseIdExpression, tableIdExpression } = resourceScopeSql(definition);

  return client`
    SELECT
      ${sortOrder}::int AS sort_order,
      ${resourceType}::text AS resource_type,
      resource.id AS resource_id,
      ${client.unsafe(baseIdExpression)} AS base_id,
      ${client.unsafe(tableIdExpression)} AS table_id
    FROM ${client.unsafe(definition.junctionTable)} binding
    JOIN ${client.unsafe(`${definition.resourceTable} resource`)} ON resource.id = ${client.unsafe(`binding.${definition.junctionResourceColumn}`)}
    ${client.unsafe(tableJoin)}
    WHERE binding.access_id = ${accessId}::uuid
  `;
};

const mapAccessBinding = (row: DbAccessBinding): AccessBinding => {
  const definition = ACCESS_RESOURCES[row.resource_type];
  const base = { resourceType: row.resource_type, baseId: row.base_id };
  if (definition.scope === "base") return base as AccessBinding;
  if (definition.scope === "table") return { ...base, tableId: row.resource_id } as AccessBinding;
  if (definition.scope === "tableChild") {
    return { ...base, tableId: row.table_id, [definition.bindingIdKey]: row.resource_id } as AccessBinding;
  }
  return { ...base, [definition.bindingIdKey]: row.resource_id } as AccessBinding;
};

export const resolveResourceBinding = async (
  resourceType: AccessResourceType,
  resourceId: string,
  options: { includeDeleted?: boolean; client?: SqlClient } = {},
): Promise<AccessBinding | null> => {
  const client = options.client ?? sql;
  const definition = ACCESS_RESOURCES[resourceType];
  const { tableJoin, baseIdExpression, tableIdExpression } = resourceScopeSql(definition);
  const alive = options.includeDeleted === false ? "AND resource.deleted_at IS NULL" : "";
  const parentAlive = options.includeDeleted === false && definition.scope === "tableChild" ? "AND parent_table.deleted_at IS NULL" : "";
  const [row] = await client<DbAccessBinding[]>`
    SELECT
      ${resourceType}::text AS resource_type,
      resource.id AS resource_id,
      ${client.unsafe(baseIdExpression)} AS base_id,
      ${client.unsafe(tableIdExpression)} AS table_id
    FROM ${client.unsafe(`${definition.resourceTable} resource`)}
    ${client.unsafe(tableJoin)}
    WHERE resource.id = ${resourceId}::uuid
      ${client.unsafe(alive)}
      ${client.unsafe(parentAlive)}
  `;
  return row ? mapAccessBinding(row) : null;
};

export const resolveAccessBinding = async (accessId: string, client: SqlClient = sql): Promise<AccessBinding | null> => {
  const union = joinUnionAll(
    accessResourceEntries.map(([resourceType, definition], index) => bindingSelect(resourceType, definition, index, accessId, client)),
    client,
  );
  const [row] = await client<DbAccessBinding[]>`${union} ORDER BY sort_order LIMIT 1`;
  return row ? mapAccessBinding(row) : null;
};
