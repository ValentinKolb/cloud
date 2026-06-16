import {
  type AccessEntry,
  createAccess,
  deleteAccess,
  getEffectivePermission,
  hasPermission,
  type PermissionLevel,
  type Principal,
  resolveDisplayNames,
  paginateItems,
} from "@valentinkolb/cloud/server";
import { err, fail, ok, type PageParams, type Paginated, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { isUuid, toPgUuidArray } from "./shared";

type DbWorkspaceAccess = {
  access_id: string;
  user_id: string | null;
  group_id: string | null;
  service_account_id: string | null;
  authenticated_only: boolean;
  permission: PermissionLevel;
  created_at: Date;
};

const principalFromRow = (row: Pick<DbWorkspaceAccess, "user_id" | "group_id" | "service_account_id" | "authenticated_only">): Principal => {
  if (row.user_id) return { type: "user", userId: row.user_id };
  if (row.group_id) return { type: "group", groupId: row.group_id };
  if (row.service_account_id) return { type: "service_account", serviceAccountId: row.service_account_id };
  if (row.authenticated_only) return { type: "authenticated" };
  return { type: "public" };
};

const isSamePrincipal = (left: Principal, right: Principal): boolean => {
  if (left.type !== right.type) return false;
  if (left.type === "user" && right.type === "user") return left.userId === right.userId;
  if (left.type === "group" && right.type === "group") return left.groupId === right.groupId;
  if (left.type === "service_account" && right.type === "service_account") return left.serviceAccountId === right.serviceAccountId;
  return true;
};

const requiresBroadAccessOptIn = (principal: Principal): boolean => principal.type === "public" || principal.type === "authenticated";

export const addWorkspaceAccess = async (workspaceId: string, accessId: string): Promise<Result<void>> => {
  if (!isUuid(workspaceId) || !isUuid(accessId)) {
    return fail(err.notFound("Workspace or access entry"));
  }

  try {
    await sql`
      INSERT INTO invoices.invoice_workspace_access (workspace_id, access_id)
      VALUES (${workspaceId}::uuid, ${accessId}::uuid)
    `;
    return ok();
  } catch (error: unknown) {
    const dbError = error as { code?: string };
    if (dbError.code === "23505") return fail(err.conflict("Workspace access entry"));
    if (dbError.code === "23503") return fail(err.notFound("Workspace or access entry"));
    throw error;
  }
};

export const listWorkspaceAccess = async (workspaceId: string): Promise<AccessEntry[]> => {
  if (!isUuid(workspaceId)) return [];

  const rows = await sql<DbWorkspaceAccess[]>`
    SELECT
      a.id AS access_id,
      a.user_id,
      a.group_id,
      a.service_account_id,
      a.authenticated_only,
      a.permission,
      a.created_at
    FROM invoices.invoice_workspace_access wa
    JOIN auth.access a ON wa.access_id = a.id
    WHERE wa.workspace_id = ${workspaceId}::uuid
    ORDER BY
      CASE
        WHEN a.user_id IS NULL AND a.group_id IS NULL AND a.service_account_id IS NULL AND a.authenticated_only = false THEN 4
        WHEN a.authenticated_only THEN 3
        WHEN a.group_id IS NOT NULL THEN 2
        WHEN a.service_account_id IS NOT NULL THEN 2
        ELSE 1
      END,
      a.created_at
  `;

  return resolveDisplayNames(
    rows.map((row) => ({
      id: row.access_id,
      principal: principalFromRow(row),
      permission: row.permission,
      createdAt: row.created_at.toISOString(),
    })),
  );
};

export const listWorkspaceAccessPaginated = async (config: {
  workspaceId: string;
  pagination?: PageParams;
  filter?: {
    query?: string;
    principalType?: AccessEntry["principal"]["type"];
  };
}): Promise<Paginated<AccessEntry>> => {
  const items = await listWorkspaceAccess(config.workspaceId);
  const query = config.filter?.query?.trim().toLowerCase();
  const principalType = config.filter?.principalType;

  const filtered = items.filter((entry) => {
    if (principalType && entry.principal.type !== principalType) return false;
    if (!query) return true;

    if ((entry.displayName ?? "").toLowerCase().includes(query)) return true;
    if (entry.principal.type === "user") return entry.principal.userId.toLowerCase().includes(query);
    if (entry.principal.type === "group") return entry.principal.groupId.toLowerCase().includes(query);
    if (entry.principal.type === "service_account") return entry.principal.serviceAccountId.toLowerCase().includes(query);
    if (entry.principal.type === "authenticated") return "all signed-in users authenticated".includes(query);
    return "public".includes(query);
  });

  return paginateItems(filtered, config.pagination);
};

export const grantWorkspaceAccess = async (config: {
  workspaceId: string;
  principal: Principal;
  permission: PermissionLevel;
  allowBroadAccess?: boolean;
}): Promise<Result<AccessEntry>> => {
  if (!isUuid(config.workspaceId)) return fail(err.notFound("Workspace"));
  if (requiresBroadAccessOptIn(config.principal) && config.allowBroadAccess !== true) {
    return fail(err.badInput("Broad invoice workspace access grants require explicit opt-in"));
  }

  const existing = await listWorkspaceAccess(config.workspaceId);
  if (existing.some((entry) => isSamePrincipal(entry.principal, config.principal))) {
    return fail({
      code: "CONFLICT",
      message: "This principal already has access to this invoice workspace",
      status: 409,
    });
  }

  const created = await createAccess({ principal: config.principal, permission: config.permission });
  if (!created.ok) return created;

  const linked = await addWorkspaceAccess(config.workspaceId, created.data.id);
  if (!linked.ok) {
    await deleteAccess({ id: created.data.id });
    return linked;
  }

  const entries = await listWorkspaceAccess(config.workspaceId);
  const createdEntry = entries.find((entry) => entry.id === created.data.id);
  if (!createdEntry) return fail(err.internal("Failed to retrieve created access entry"));
  return ok(createdEntry);
};

export const removeWorkspaceAccess = async (config: { workspaceId: string; accessId: string }): Promise<Result<void>> => {
  if (!isUuid(config.workspaceId) || !isUuid(config.accessId)) return fail(err.notFound("Workspace or access entry"));

  return sql.begin(async (tx) => {
    const [guard] = await tx<
      {
        total: number;
        other_admins: number;
        current_permission: PermissionLevel | null;
      }[]
    >`
      WITH locked AS (
        SELECT a.id, a.permission
        FROM invoices.invoice_workspace_access wa
        JOIN auth.access a ON wa.access_id = a.id
        WHERE wa.workspace_id = ${config.workspaceId}::uuid
        FOR UPDATE OF wa, a
      )
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (
          WHERE permission = 'admin'::auth.permission_level
            AND id <> ${config.accessId}::uuid
        )::int AS other_admins,
        MAX(CASE WHEN id = ${config.accessId}::uuid THEN permission END) AS current_permission
      FROM locked
    `;

    if (!guard?.current_permission) return fail(err.notFound("Access entry for this invoice workspace"));
    if (guard.total <= 1) return fail(err.badInput("Cannot remove the last access entry"));
    if (guard.current_permission === "admin" && guard.other_admins <= 0) return fail(err.badInput("Cannot remove the last admin"));

    const result = await tx`DELETE FROM auth.access WHERE id = ${config.accessId}::uuid`;
    if (result.count === 0) return fail(err.notFound("Access entry for this invoice workspace"));
    return ok();
  });
};

export const updateWorkspaceAccessPermission = async (config: {
  workspaceId: string;
  accessId: string;
  permission: PermissionLevel;
}): Promise<Result<void>> => {
  if (!isUuid(config.workspaceId) || !isUuid(config.accessId)) return fail(err.notFound("Workspace or access entry"));

  return sql.begin(async (tx) => {
    const [guard] = await tx<
      {
        other_admins: number;
        current_permission: PermissionLevel | null;
      }[]
    >`
      WITH locked AS (
        SELECT a.id, a.permission
        FROM invoices.invoice_workspace_access wa
        JOIN auth.access a ON wa.access_id = a.id
        WHERE wa.workspace_id = ${config.workspaceId}::uuid
        FOR UPDATE OF wa, a
      )
      SELECT
        COUNT(*) FILTER (
          WHERE permission = 'admin'::auth.permission_level
            AND id <> ${config.accessId}::uuid
        )::int AS other_admins,
        MAX(CASE WHEN id = ${config.accessId}::uuid THEN permission END) AS current_permission
      FROM locked
    `;

    if (!guard?.current_permission) return fail(err.notFound("Access entry for this invoice workspace"));
    if (guard.current_permission === "admin" && config.permission !== "admin" && guard.other_admins <= 0) {
      return fail(err.badInput("Cannot remove the last admin"));
    }

    const result = await tx`
      UPDATE auth.access
      SET permission = ${config.permission}::auth.permission_level
      WHERE id = ${config.accessId}::uuid
    `;
    if (result.count === 0) return fail(err.notFound("Access entry for this invoice workspace"));
    return ok();
  });
};

export const countWorkspaceAccess = async (workspaceId: string): Promise<number> => {
  if (!isUuid(workspaceId)) return 0;
  const [row] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM invoices.invoice_workspace_access
    WHERE workspace_id = ${workspaceId}::uuid
  `;
  return row?.count ?? 0;
};

export const getWorkspacePermission = async (config: {
  workspaceId: string;
  userId: string | null;
  userGroups: string[];
}): Promise<PermissionLevel> => {
  if (!isUuid(config.workspaceId)) return "none";

  const rows = await sql<{ access_id: string }[]>`
    SELECT access_id
    FROM invoices.invoice_workspace_access
    WHERE workspace_id = ${config.workspaceId}::uuid
  `;

  return getEffectivePermission({
    accessIds: rows.map((row) => row.access_id),
    userId: config.userId,
    userGroups: config.userGroups,
  });
};

export const canAccessWorkspace = async (config: {
  workspaceId: string;
  userId: string | null;
  userGroups: string[];
  requiredLevel?: PermissionLevel;
}): Promise<boolean> => {
  const permission = await getWorkspacePermission({
    workspaceId: config.workspaceId,
    userId: config.userId,
    userGroups: config.userGroups,
  });

  return hasPermission(permission, config.requiredLevel ?? "read");
};

export const addTemplateAccess = async (templateId: string, accessId: string): Promise<Result<void>> => {
  if (!isUuid(templateId) || !isUuid(accessId)) return fail(err.notFound("Template or access entry"));

  try {
    await sql`
      INSERT INTO invoices.invoice_template_access (template_id, access_id)
      VALUES (${templateId}::uuid, ${accessId}::uuid)
    `;
    return ok();
  } catch (error: unknown) {
    const dbError = error as { code?: string };
    if (dbError.code === "23505") return fail(err.conflict("Template access entry"));
    if (dbError.code === "23503") return fail(err.notFound("Template or access entry"));
    throw error;
  }
};

export const listTemplateAccess = async (config: { workspaceId: string; templateId: string }): Promise<AccessEntry[]> => {
  if (!isUuid(config.workspaceId) || !isUuid(config.templateId)) return [];

  const rows = await sql<DbWorkspaceAccess[]>`
    SELECT
      a.id AS access_id,
      a.user_id,
      a.group_id,
      a.service_account_id,
      a.authenticated_only,
      a.permission,
      a.created_at
    FROM invoices.invoice_template_access ta
    JOIN invoices.invoice_templates t ON t.id = ta.template_id
    JOIN auth.access a ON ta.access_id = a.id
    WHERE t.workspace_id = ${config.workspaceId}::uuid
      AND t.id = ${config.templateId}::uuid
      AND t.archived_at IS NULL
    ORDER BY
      CASE
        WHEN a.user_id IS NULL AND a.group_id IS NULL AND a.service_account_id IS NULL AND a.authenticated_only = false THEN 4
        WHEN a.authenticated_only THEN 3
        WHEN a.group_id IS NOT NULL THEN 2
        WHEN a.service_account_id IS NOT NULL THEN 2
        ELSE 1
      END,
      a.created_at
  `;

  return resolveDisplayNames(
    rows.map((row) => ({
      id: row.access_id,
      principal: principalFromRow(row),
      permission: row.permission,
      createdAt: row.created_at.toISOString(),
    })),
  );
};

export const listTemplateAccessPaginated = async (config: {
  workspaceId: string;
  templateId: string;
  pagination?: PageParams;
  filter?: {
    query?: string;
    principalType?: AccessEntry["principal"]["type"];
  };
}): Promise<Paginated<AccessEntry>> => {
  const items = await listTemplateAccess({ workspaceId: config.workspaceId, templateId: config.templateId });
  const query = config.filter?.query?.trim().toLowerCase();
  const principalType = config.filter?.principalType;

  const filtered = items.filter((entry) => {
    if (principalType && entry.principal.type !== principalType) return false;
    if (!query) return true;

    if ((entry.displayName ?? "").toLowerCase().includes(query)) return true;
    if (entry.principal.type === "user") return entry.principal.userId.toLowerCase().includes(query);
    if (entry.principal.type === "group") return entry.principal.groupId.toLowerCase().includes(query);
    if (entry.principal.type === "service_account") return entry.principal.serviceAccountId.toLowerCase().includes(query);
    if (entry.principal.type === "authenticated") return "all signed-in users authenticated".includes(query);
    return "public".includes(query);
  });

  return paginateItems(filtered, config.pagination);
};

export const grantTemplateAccess = async (config: {
  workspaceId: string;
  templateId: string;
  principal: Principal;
  permission: PermissionLevel;
  allowBroadAccess?: boolean;
}): Promise<Result<AccessEntry>> => {
  if (!isUuid(config.workspaceId) || !isUuid(config.templateId)) return fail(err.notFound("Template"));
  if (requiresBroadAccessOptIn(config.principal) && config.allowBroadAccess !== true) {
    return fail(err.badInput("Broad invoice template access grants require explicit opt-in"));
  }

  const [template] = await sql<{ id: string }[]>`
    SELECT id
    FROM invoices.invoice_templates
    WHERE workspace_id = ${config.workspaceId}::uuid
      AND id = ${config.templateId}::uuid
      AND archived_at IS NULL
  `;
  if (!template) return fail(err.notFound("Template"));

  const existing = await listTemplateAccess({ workspaceId: config.workspaceId, templateId: config.templateId });
  if (existing.some((entry) => isSamePrincipal(entry.principal, config.principal))) {
    return fail({
      code: "CONFLICT",
      message: "This principal already has access to this invoice template",
      status: 409,
    });
  }

  const created = await createAccess({ principal: config.principal, permission: config.permission });
  if (!created.ok) return created;

  const linked = await addTemplateAccess(config.templateId, created.data.id);
  if (!linked.ok) {
    await deleteAccess({ id: created.data.id });
    return linked;
  }

  const entries = await listTemplateAccess({ workspaceId: config.workspaceId, templateId: config.templateId });
  const createdEntry = entries.find((entry) => entry.id === created.data.id);
  if (!createdEntry) return fail(err.internal("Failed to retrieve created template access entry"));
  return ok(createdEntry);
};

export const removeTemplateAccess = async (config: { workspaceId: string; templateId: string; accessId: string }): Promise<Result<void>> => {
  if (!isUuid(config.workspaceId) || !isUuid(config.templateId) || !isUuid(config.accessId)) {
    return fail(err.notFound("Template or access entry"));
  }

  return sql.begin(async (tx) => {
    const [row] = await tx<{ access_id: string }[]>`
      SELECT ta.access_id
      FROM invoices.invoice_template_access ta
      JOIN invoices.invoice_templates t ON t.id = ta.template_id
      WHERE t.workspace_id = ${config.workspaceId}::uuid
        AND t.id = ${config.templateId}::uuid
        AND ta.access_id = ${config.accessId}::uuid
      FOR UPDATE OF ta
    `;
    if (!row) return fail(err.notFound("Template access entry"));

    const result = await tx`DELETE FROM auth.access WHERE id = ${config.accessId}::uuid`;
    if (result.count === 0) return fail(err.notFound("Template access entry"));
    return ok();
  });
};

export const updateTemplateAccessPermission = async (config: {
  workspaceId: string;
  templateId: string;
  accessId: string;
  permission: PermissionLevel;
}): Promise<Result<void>> => {
  if (!isUuid(config.workspaceId) || !isUuid(config.templateId) || !isUuid(config.accessId)) {
    return fail(err.notFound("Template or access entry"));
  }

  return sql.begin(async (tx) => {
    const [row] = await tx<{ access_id: string }[]>`
      SELECT ta.access_id
      FROM invoices.invoice_template_access ta
      JOIN invoices.invoice_templates t ON t.id = ta.template_id
      WHERE t.workspace_id = ${config.workspaceId}::uuid
        AND t.id = ${config.templateId}::uuid
        AND ta.access_id = ${config.accessId}::uuid
      FOR UPDATE OF ta
    `;
    if (!row) return fail(err.notFound("Template access entry"));

    const result = await tx`
      UPDATE auth.access
      SET permission = ${config.permission}::auth.permission_level
      WHERE id = ${config.accessId}::uuid
    `;
    if (result.count === 0) return fail(err.notFound("Template access entry"));
    return ok();
  });
};

export const getTemplatePermission = async (config: {
  workspaceId: string;
  templateId: string;
  userId: string | null;
  userGroups: string[];
}): Promise<PermissionLevel> => {
  if (!isUuid(config.workspaceId) || !isUuid(config.templateId)) return "none";

  const rows = await sql<{ access_id: string }[]>`
    SELECT wa.access_id
    FROM invoices.invoice_workspace_access wa
    WHERE wa.workspace_id = ${config.workspaceId}::uuid
    UNION
    SELECT ta.access_id
    FROM invoices.invoice_template_access ta
    JOIN invoices.invoice_templates t ON t.id = ta.template_id
    WHERE t.workspace_id = ${config.workspaceId}::uuid
      AND t.id = ${config.templateId}::uuid
      AND t.archived_at IS NULL
  `;

  return getEffectivePermission({
    accessIds: rows.map((row) => row.access_id),
    userId: config.userId,
    userGroups: config.userGroups,
  });
};

export const canAccessTemplate = async (config: {
  workspaceId: string;
  templateId: string;
  userId: string | null;
  userGroups: string[];
  requiredLevel?: PermissionLevel;
}): Promise<boolean> => {
  const permission = await getTemplatePermission({
    workspaceId: config.workspaceId,
    templateId: config.templateId,
    userId: config.userId,
    userGroups: config.userGroups,
  });

  return hasPermission(permission, config.requiredLevel ?? "read");
};
