import type { AccessEntry, PermissionLevel, Principal } from "@valentinkolb/cloud/server";
import { err, fail, ok, type PageParams, type Paginated, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import {
  canAccessWorkspace,
  countWorkspaceAccess,
  getWorkspacePermission,
  grantWorkspaceAccess,
  listWorkspaceAccessPaginated,
  removeWorkspaceAccess,
  updateWorkspaceAccessPermission,
} from "./access";
import { requireInvoiceUser, requireWorkspacePermission } from "./authz";
import { isUuid, slugify, toPgUuidArray } from "./shared";
import type { CreateInvoiceWorkspaceInput, InvoiceActor, InvoiceWorkspace } from "./types";

type DbWorkspace = {
  id: string;
  name: string;
  slug: string;
  default_currency: string;
  locale: string;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
};

const mapWorkspace = (row: DbWorkspace): InvoiceWorkspace => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  defaultCurrency: row.default_currency,
  locale: row.locale,
  createdBy: row.created_by,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  archivedAt: row.archived_at?.toISOString() ?? null,
});

export const list = async (config: { actor: InvoiceActor }): Promise<InvoiceWorkspace[]> => {
  const rows = await sql<DbWorkspace[]>`
    SELECT DISTINCT w.id, w.name, w.slug, w.default_currency, w.locale, w.created_by, w.created_at, w.updated_at, w.archived_at
    FROM invoices.invoice_workspaces w
    WHERE w.archived_at IS NULL
      AND (
        EXISTS (
          SELECT 1
          FROM invoices.invoice_workspace_access wa
          JOIN auth.access a ON a.id = wa.access_id
          WHERE wa.workspace_id = w.id
            AND a.permission IN ('read'::auth.permission_level, 'write'::auth.permission_level, 'admin'::auth.permission_level)
            AND (
              a.user_id = ${config.actor.userId}::uuid
              OR a.group_id = ANY(${toPgUuidArray(config.actor.userGroups)}::uuid[])
              OR (${config.actor.userId}::uuid IS NOT NULL AND a.authenticated_only = true)
              OR (a.user_id IS NULL AND a.group_id IS NULL AND a.authenticated_only = false)
            )
        )
        OR EXISTS (
          SELECT 1
          FROM invoices.invoice_templates t
          JOIN invoices.invoice_template_access ta ON ta.template_id = t.id
          JOIN auth.access a ON a.id = ta.access_id
          WHERE t.workspace_id = w.id
            AND t.archived_at IS NULL
            AND a.permission IN ('read'::auth.permission_level, 'write'::auth.permission_level, 'admin'::auth.permission_level)
            AND (
              a.user_id = ${config.actor.userId}::uuid
              OR a.group_id = ANY(${toPgUuidArray(config.actor.userGroups)}::uuid[])
              OR (${config.actor.userId}::uuid IS NOT NULL AND a.authenticated_only = true)
              OR (a.user_id IS NULL AND a.group_id IS NULL AND a.authenticated_only = false)
            )
        )
      )
    ORDER BY w.name ASC
  `;

  return rows.map(mapWorkspace);
};

const canAccessThroughTemplate = async (config: { workspaceId: string; actor: InvoiceActor }): Promise<boolean> => {
  if (!isUuid(config.workspaceId)) return false;
  const [row] = await sql<{ allowed: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM invoices.invoice_templates t
      JOIN invoices.invoice_template_access ta ON ta.template_id = t.id
      JOIN auth.access a ON a.id = ta.access_id
      WHERE t.workspace_id = ${config.workspaceId}::uuid
        AND t.archived_at IS NULL
        AND a.permission IN ('read'::auth.permission_level, 'write'::auth.permission_level, 'admin'::auth.permission_level)
        AND (
          a.user_id = ${config.actor.userId}::uuid
          OR a.group_id = ANY(${toPgUuidArray(config.actor.userGroups)}::uuid[])
          OR (${config.actor.userId}::uuid IS NOT NULL AND a.authenticated_only = true)
          OR (a.user_id IS NULL AND a.group_id IS NULL AND a.authenticated_only = false)
        )
    ) AS allowed
  `;
  return row?.allowed === true;
};

export const get = async (config: { id: string; actor: InvoiceActor }): Promise<InvoiceWorkspace | null> => {
  if (!isUuid(config.id)) return null;
  const workspacePermission = await getWorkspacePermission({
    workspaceId: config.id,
    userId: config.actor.userId,
    userGroups: config.actor.userGroups,
  });
  if (!["read", "write", "admin"].includes(workspacePermission) && !(await canAccessThroughTemplate({ workspaceId: config.id, actor: config.actor }))) {
    return null;
  }

  const [row] = await sql<DbWorkspace[]>`
    SELECT id, name, slug, default_currency, locale, created_by, created_at, updated_at, archived_at
    FROM invoices.invoice_workspaces
    WHERE id = ${config.id}::uuid
      AND archived_at IS NULL
  `;

  return row ? mapWorkspace(row) : null;
};

export const create = async (config: { data: CreateInvoiceWorkspaceInput; actor: InvoiceActor }): Promise<Result<InvoiceWorkspace>> => {
  const userId = requireInvoiceUser(config.actor);
  if (!userId.ok) return fail(userId.error);

  const name = config.data.name.trim();
  if (!name) return fail(err.badInput("Workspace name is required"));

  const [row] = await sql<DbWorkspace[]>`
    INSERT INTO invoices.invoice_workspaces (name, slug, default_currency, locale, created_by)
    VALUES (
      ${name},
      ${slugify(config.data.slug ?? name)},
      ${(config.data.defaultCurrency ?? "EUR").trim().toUpperCase().slice(0, 3)},
      ${config.data.locale ?? "de-DE"},
      ${userId.data}::uuid
    )
    RETURNING id, name, slug, default_currency, locale, created_by, created_at, updated_at, archived_at
  `;

  if (!row) return fail(err.internal("Failed to create invoice workspace"));

  const accessResult = await grantWorkspaceAccess({
    workspaceId: row.id,
    principal: { type: "user", userId: userId.data },
    permission: "admin",
  });
  if (!accessResult.ok) {
    await sql`DELETE FROM invoices.invoice_workspaces WHERE id = ${row.id}::uuid`;
    return fail(accessResult.error);
  }

  return ok(mapWorkspace(row));
};

export const permission = {
  get: (config: { workspaceId: string; userId: string | null; userGroups: string[] }): Promise<PermissionLevel> => getWorkspacePermission(config),
  canAccess: (config: {
    workspaceId: string;
    userId: string | null;
    userGroups: string[];
    requiredLevel?: PermissionLevel;
  }): Promise<boolean> => canAccessWorkspace(config),
};

const requireWorkspaceAdmin = async (config: { workspaceId: string; actor: InvoiceActor }): Promise<Result<void>> => {
  const access = await requireWorkspacePermission({ ...config, requiredLevel: "admin" });
  return access.ok ? ok(undefined) : fail(access.error);
};

export const access = {
  list: async (config: {
    workspaceId: string;
    actor: InvoiceActor;
    pagination?: PageParams;
    filter?: {
      query?: string;
      principalType?: AccessEntry["principal"]["type"];
    };
  }): Promise<Result<Paginated<AccessEntry>>> => {
    const admin = await requireWorkspaceAdmin(config);
    if (!admin.ok) return admin;
    return ok(await listWorkspaceAccessPaginated(config));
  },
  grant: async (config: {
    workspaceId: string;
    actor: InvoiceActor;
    principal: Principal;
    permission: PermissionLevel;
    allowBroadAccess?: boolean;
  }): Promise<Result<AccessEntry>> => {
    const admin = await requireWorkspaceAdmin(config);
    if (!admin.ok) return admin;
    return grantWorkspaceAccess(config);
  },
  remove: async (config: { workspaceId: string; actor: InvoiceActor; accessId: string }): Promise<Result<void>> => {
    const admin = await requireWorkspaceAdmin(config);
    if (!admin.ok) return admin;
    return removeWorkspaceAccess(config);
  },
  updatePermission: async (config: {
    workspaceId: string;
    actor: InvoiceActor;
    accessId: string;
    permission: PermissionLevel;
  }): Promise<Result<void>> => {
    const admin = await requireWorkspaceAdmin(config);
    if (!admin.ok) return admin;
    return updateWorkspaceAccessPermission(config);
  },
  count: (config: { workspaceId: string }) => countWorkspaceAccess(config.workspaceId),
};
