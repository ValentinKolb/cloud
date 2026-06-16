import type { AccessEntry, PermissionLevel, Principal } from "@valentinkolb/cloud/server";
import type { PageParams, Paginated } from "@valentinkolb/stdlib";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import {
  grantTemplateAccess,
  listTemplateAccessPaginated,
  removeTemplateAccess,
  updateTemplateAccessPermission,
  getTemplatePermission,
} from "./access";
import { requireInvoiceUser, requireTemplatePermission, requireWorkspacePermission } from "./authz";
import { isUuid, normalizeCurrency, parseJsonRecord, toJsonb } from "./shared";
import type { CreateInvoiceTemplateInput, CreateInvoiceTemplateVersionInput, InvoiceActor, InvoiceTemplate, InvoiceTemplateVersion, UpdateInvoiceTemplateInput } from "./types";

type DbTemplate = {
  id: string;
  workspace_id: string;
  issuer_profile_id: string;
  name: string;
  status: "draft" | "active" | "deprecated" | "archived";
  active_version_id: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
};

type DbTemplateVersion = {
  id: string;
  template_id: string;
  version: number;
  name_snapshot: string;
  issuer_profile_id: string;
  number_sequence_id: string;
  payment_terms_days: number;
  currency: string;
  tax_defaults: unknown;
  layout_settings: unknown;
  e_invoice_defaults: unknown;
  created_by: string | null;
  created_at: Date;
  activated_at: Date | null;
};

const mapTemplate = (row: DbTemplate): InvoiceTemplate => ({
  id: row.id,
  workspaceId: row.workspace_id,
  issuerProfileId: row.issuer_profile_id,
  name: row.name,
  status: row.status,
  activeVersionId: row.active_version_id,
  createdBy: row.created_by,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  archivedAt: row.archived_at?.toISOString() ?? null,
});

const mapTemplateVersion = (row: DbTemplateVersion): InvoiceTemplateVersion => ({
  id: row.id,
  templateId: row.template_id,
  version: row.version,
  nameSnapshot: row.name_snapshot,
  issuerProfileId: row.issuer_profile_id,
  numberSequenceId: row.number_sequence_id,
  paymentTermsDays: row.payment_terms_days,
  currency: row.currency,
  taxDefaults: parseJsonRecord(row.tax_defaults),
  layoutSettings: parseJsonRecord(row.layout_settings),
  eInvoiceDefaults: parseJsonRecord(row.e_invoice_defaults),
  createdBy: row.created_by,
  createdAt: row.created_at.toISOString(),
  activatedAt: row.activated_at?.toISOString() ?? null,
});

export const list = async (config: { workspaceId: string; actor: InvoiceActor }): Promise<InvoiceTemplate[]> => {
  if (!isUuid(config.workspaceId)) return [];

  const rows = await sql<DbTemplate[]>`
    SELECT *
    FROM invoices.invoice_templates
    WHERE workspace_id = ${config.workspaceId}::uuid
      AND archived_at IS NULL
    ORDER BY name ASC, created_at ASC
  `;

  const templates: InvoiceTemplate[] = [];
  for (const row of rows) {
    const permission = await getTemplatePermission({
      workspaceId: config.workspaceId,
      templateId: row.id,
      userId: config.actor.userId,
      userGroups: config.actor.userGroups,
    });
    if (permission !== "none") templates.push(mapTemplate(row));
  }
  return templates;
};

export const listForCreate = async (config: { workspaceId: string; actor: InvoiceActor }): Promise<InvoiceTemplate[]> => {
  const templates = await list(config);
  const allowed: InvoiceTemplate[] = [];
  for (const template of templates) {
    const permission = await getTemplatePermission({
      workspaceId: config.workspaceId,
      templateId: template.id,
      userId: config.actor.userId,
      userGroups: config.actor.userGroups,
    });
    if ((permission === "write" || permission === "admin") && template.status === "active" && template.activeVersionId) {
      allowed.push(template);
    }
  }
  return allowed;
};

export const get = async (config: { workspaceId: string; id: string; actor: InvoiceActor }): Promise<InvoiceTemplate | null> => {
  if (!isUuid(config.workspaceId) || !isUuid(config.id)) return null;
  const access = await requireTemplatePermission({ workspaceId: config.workspaceId, templateId: config.id, actor: config.actor, requiredLevel: "read" });
  if (!access.ok) return null;

  const [row] = await sql<DbTemplate[]>`
    SELECT *
    FROM invoices.invoice_templates
    WHERE workspace_id = ${config.workspaceId}::uuid
      AND id = ${config.id}::uuid
      AND archived_at IS NULL
  `;

  return row ? mapTemplate(row) : null;
};

export const create = async (config: {
  workspaceId: string;
  actor: InvoiceActor;
  data: CreateInvoiceTemplateInput;
}): Promise<Result<InvoiceTemplate>> => {
  if (!isUuid(config.workspaceId) || !isUuid(config.data.issuerProfileId)) {
    return fail(err.notFound("Workspace or issuer profile"));
  }
  const userId = requireInvoiceUser(config.actor);
  if (!userId.ok) return fail(userId.error);
  const access = await requireWorkspacePermission({ workspaceId: config.workspaceId, actor: config.actor, requiredLevel: "admin" });
  if (!access.ok) return fail(access.error);

  const name = config.data.name.trim();
  if (!name) return fail(err.badInput("Template name is required"));

  try {
    const [row] = await sql<DbTemplate[]>`
      INSERT INTO invoices.invoice_templates (workspace_id, issuer_profile_id, name, created_by)
      SELECT ${config.workspaceId}::uuid, ip.id, ${name}, ${userId.data}::uuid
      FROM invoices.invoice_issuer_profiles ip
      WHERE ip.workspace_id = ${config.workspaceId}::uuid
        AND ip.id = ${config.data.issuerProfileId}::uuid
        AND ip.archived_at IS NULL
      RETURNING *
    `;

    if (!row) return fail(err.notFound("Workspace issuer profile"));
    return ok(mapTemplate(row));
  } catch (error: unknown) {
    const dbError = error as { code?: string };
    if (dbError.code === "23503") return fail(err.notFound("Workspace or issuer profile"));
    if (dbError.code === "23505") return fail(err.conflict("Invoice template"));
    throw error;
  }
};

export const update = async (config: {
  workspaceId: string;
  templateId: string;
  actor: InvoiceActor;
  data: UpdateInvoiceTemplateInput;
}): Promise<Result<InvoiceTemplate>> => {
  if (!isUuid(config.workspaceId) || !isUuid(config.templateId)) return fail(err.notFound("Template"));
  const access = await requireTemplatePermission({ workspaceId: config.workspaceId, templateId: config.templateId, actor: config.actor, requiredLevel: "admin" });
  if (!access.ok) return fail(access.error);

  const name = config.data.name?.trim();
  const status = config.data.status;
  if (name === "") return fail(err.badInput("Template name is required"));
  if (status && !["draft", "active", "deprecated", "archived"].includes(status)) return fail(err.badInput("Unsupported template status"));
  const nextName = name ?? null;
  const nextStatus = status ?? null;

  try {
    const [row] = await sql<DbTemplate[]>`
      UPDATE invoices.invoice_templates
      SET
        name = COALESCE(${nextName}::text, name),
        status = COALESCE(${nextStatus}::text, status),
        archived_at = CASE
          WHEN ${nextStatus}::text = 'archived' THEN COALESCE(archived_at, now())
          WHEN ${nextStatus}::text IS NOT NULL AND ${nextStatus}::text <> 'archived' THEN NULL
          ELSE archived_at
        END,
        updated_at = now()
      WHERE workspace_id = ${config.workspaceId}::uuid
        AND id = ${config.templateId}::uuid
      RETURNING *
    `;
    if (!row) return fail(err.notFound("Template"));
    return ok(mapTemplate(row));
  } catch (error: unknown) {
    const dbError = error as { code?: string };
    if (dbError.code === "23505") return fail(err.conflict("Invoice template"));
    throw error;
  }
};

export const createVersion = async (config: {
  workspaceId: string;
  templateId: string;
  actor: InvoiceActor;
  data: CreateInvoiceTemplateVersionInput;
}): Promise<Result<InvoiceTemplateVersion>> => {
  if (!isUuid(config.workspaceId) || !isUuid(config.templateId) || !isUuid(config.data.issuerProfileId) || !isUuid(config.data.numberSequenceId)) {
    return fail(err.notFound("Template, issuer profile, or sequence"));
  }
  const userId = requireInvoiceUser(config.actor);
  if (!userId.ok) return fail(userId.error);
  const access = await requireWorkspacePermission({ workspaceId: config.workspaceId, actor: config.actor, requiredLevel: "admin" });
  if (!access.ok) return fail(access.error);

  return sql.begin(async (tx) => {
    const [template] = await tx<DbTemplate[]>`
      SELECT *
      FROM invoices.invoice_templates
      WHERE workspace_id = ${config.workspaceId}::uuid
        AND id = ${config.templateId}::uuid
        AND archived_at IS NULL
      FOR UPDATE
    `;
    if (!template) return fail(err.notFound("Template"));

    const [refs] = await tx<{ issuer_profile_id: string; sequence_id: string }[]>`
      SELECT ip.id AS issuer_profile_id, s.id AS sequence_id
      FROM invoices.invoice_issuer_profiles ip
      JOIN invoices.invoice_sequences s
        ON s.workspace_id = ip.workspace_id
       AND s.id = ${config.data.numberSequenceId}::uuid
       AND s.archived_at IS NULL
      WHERE ip.workspace_id = ${config.workspaceId}::uuid
        AND ip.id = ${config.data.issuerProfileId}::uuid
        AND ip.archived_at IS NULL
    `;
    if (!refs) return fail(err.notFound("Workspace issuer profile or sequence"));

    const [versionRow] = await tx<{ next_version: number }[]>`
      SELECT COALESCE(MAX(version), 0)::int + 1 AS next_version
      FROM invoices.invoice_template_versions
      WHERE template_id = ${config.templateId}::uuid
    `;
    const version = versionRow?.next_version ?? 1;

    const [row] = await tx<DbTemplateVersion[]>`
      INSERT INTO invoices.invoice_template_versions (
        template_id,
        version,
        name_snapshot,
        issuer_profile_id,
        number_sequence_id,
        payment_terms_days,
        currency,
        tax_defaults,
        layout_settings,
        e_invoice_defaults,
        created_by
      )
      VALUES (
        ${config.templateId}::uuid,
        ${version},
        ${config.data.nameSnapshot?.trim() || template.name},
        ${config.data.issuerProfileId}::uuid,
        ${config.data.numberSequenceId}::uuid,
        ${Math.max(0, config.data.paymentTermsDays ?? 14)},
        ${normalizeCurrency(config.data.currency)},
        (${toJsonb(config.data.taxDefaults)}::text)::jsonb,
        (${toJsonb(config.data.layoutSettings)}::text)::jsonb,
        (${toJsonb(config.data.eInvoiceDefaults)}::text)::jsonb,
        ${userId.data}::uuid
      )
      RETURNING *
    `;

    if (!row) return fail(err.internal("Failed to create invoice template version"));
    return ok(mapTemplateVersion(row));
  });
};

export const activateVersion = async (config: {
  workspaceId: string;
  templateId: string;
  versionId: string;
  actor: InvoiceActor;
}): Promise<Result<InvoiceTemplate>> => {
  if (!isUuid(config.workspaceId) || !isUuid(config.templateId) || !isUuid(config.versionId)) {
    return fail(err.notFound("Template version"));
  }
  const access = await requireWorkspacePermission({ workspaceId: config.workspaceId, actor: config.actor, requiredLevel: "admin" });
  if (!access.ok) return fail(access.error);

  return sql.begin(async (tx) => {
    const [version] = await tx<{ id: string }[]>`
      SELECT v.id
      FROM invoices.invoice_template_versions v
      JOIN invoices.invoice_templates t ON t.id = v.template_id
      WHERE t.workspace_id = ${config.workspaceId}::uuid
        AND t.id = ${config.templateId}::uuid
        AND v.id = ${config.versionId}::uuid
      FOR UPDATE OF t
    `;
    if (!version) return fail(err.notFound("Template version"));

    const [row] = await tx<DbTemplate[]>`
      UPDATE invoices.invoice_templates
      SET
        active_version_id = ${config.versionId}::uuid,
        status = 'active',
        updated_at = now()
      WHERE workspace_id = ${config.workspaceId}::uuid
        AND id = ${config.templateId}::uuid
      RETURNING *
    `;
    if (!row) return fail(err.internal("Failed to activate invoice template version"));

    await tx`
      UPDATE invoices.invoice_template_versions
      SET activated_at = COALESCE(activated_at, now())
      WHERE id = ${config.versionId}::uuid
    `;

    return ok(mapTemplate(row));
  });
};

export const versions = {
  create: createVersion,
  activate: activateVersion,
};

const requireTemplateAdmin = async (config: { workspaceId: string; templateId: string; actor: InvoiceActor }): Promise<Result<void>> => {
  const access = await requireTemplatePermission({ ...config, requiredLevel: "admin" });
  return access.ok ? ok(undefined) : fail(access.error);
};

export const access = {
  list: async (config: {
    workspaceId: string;
    templateId: string;
    actor: InvoiceActor;
    pagination?: PageParams;
    filter?: {
      query?: string;
      principalType?: AccessEntry["principal"]["type"];
    };
  }): Promise<Result<Paginated<AccessEntry>>> => {
    const admin = await requireTemplateAdmin(config);
    if (!admin.ok) return admin;
    return ok(await listTemplateAccessPaginated(config));
  },
  grant: async (config: {
    workspaceId: string;
    templateId: string;
    actor: InvoiceActor;
    principal: Principal;
    permission: PermissionLevel;
    allowBroadAccess?: boolean;
  }): Promise<Result<AccessEntry>> => {
    const admin = await requireTemplateAdmin(config);
    if (!admin.ok) return admin;
    return grantTemplateAccess(config);
  },
  remove: async (config: { workspaceId: string; templateId: string; actor: InvoiceActor; accessId: string }): Promise<Result<void>> => {
    const admin = await requireTemplateAdmin(config);
    if (!admin.ok) return admin;
    return removeTemplateAccess(config);
  },
  updatePermission: async (config: {
    workspaceId: string;
    templateId: string;
    actor: InvoiceActor;
    accessId: string;
    permission: PermissionLevel;
  }): Promise<Result<void>> => {
    const admin = await requireTemplateAdmin(config);
    if (!admin.ok) return admin;
    return updateTemplateAccessPermission(config);
  },
};
