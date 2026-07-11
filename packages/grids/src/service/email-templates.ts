import { isUniqueViolation } from "@valentinkolb/cloud/services";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type { CreateEmailTemplateInput, EmailTemplate, UpdateEmailTemplateInput } from "../contracts";
import { logAudit } from "./audit";
import { renderLiquidPlainText, renderLiquidText, validateLiquidRoots, validateLiquidTemplate } from "./documents";
import { insertWithShortId } from "./short-id";

type DbRow = Record<string, unknown>;

const EMAIL_TEMPLATE_ROOTS = new Set(["data", "app", "business", "workflow", "run", "date"]);

const mapEmailTemplate = (row: DbRow): EmailTemplate => ({
  id: row.id as string,
  shortId: row.short_id as string,
  baseId: row.base_id as string,
  name: row.name as string,
  description: (row.description as string | null) ?? null,
  subject: row.subject as string,
  html: row.html as string,
  enabled: row.enabled as boolean,
  position: row.position as number,
  createdBy: (row.created_by as string | null) ?? null,
  updatedBy: (row.updated_by as string | null) ?? null,
  deletedAt: row.deleted_at ? (row.deleted_at as Date).toISOString() : null,
  createdAt: (row.created_at as Date).toISOString(),
  updatedAt: (row.updated_at as Date).toISOString(),
});

const validateEmailLiquid = (source: string, label: string): Result<void> => {
  const syntax = validateLiquidTemplate(source);
  if (!syntax.ok) return syntax;
  return validateLiquidRoots(source, EMAIL_TEMPLATE_ROOTS, label);
};

export const validateEmailTemplateWrite = (input: { subject?: string | null; html?: string | null }): Result<void> => {
  if (input.subject !== undefined && input.subject !== null) {
    const valid = validateEmailLiquid(input.subject, "email subject");
    if (!valid.ok) return valid;
  }
  if (input.html !== undefined && input.html !== null) {
    const valid = validateEmailLiquid(input.html, "email HTML");
    if (!valid.ok) return valid;
  }
  return ok();
};

export const renderEmailTemplate = async (
  template: Pick<EmailTemplate, "subject" | "html">,
  data: Record<string, unknown>,
): Promise<Result<{ subject: string; html: string }>> => {
  const subject = await renderLiquidPlainText(template.subject, data, 1_000);
  if (!subject.ok) return subject;
  const html = await renderLiquidText(template.html, data, 300_000);
  if (!html.ok) return html;
  return ok({ subject: subject.data.trim(), html: html.data });
};

export const listForBase = async (baseId: string): Promise<EmailTemplate[]> => {
  const rows = await sql<DbRow[]>`
    SELECT *
    FROM grids.email_templates
    WHERE base_id = ${baseId}::uuid AND deleted_at IS NULL
    ORDER BY position, created_at, id
  `;
  return rows.map(mapEmailTemplate);
};

export const get = async (templateId: string, opts: { includeDeleted?: boolean } = {}): Promise<EmailTemplate | null> => {
  const [row] = opts.includeDeleted
    ? await sql<DbRow[]>`
        SELECT *
        FROM grids.email_templates
        WHERE id = ${templateId}::uuid
      `
    : await sql<DbRow[]>`
        SELECT *
        FROM grids.email_templates
        WHERE id = ${templateId}::uuid AND deleted_at IS NULL
      `;
  return row ? mapEmailTemplate(row) : null;
};

export const getByShortId = async (baseId: string, shortId: string): Promise<EmailTemplate | null> => {
  const [row] = await sql<DbRow[]>`
    SELECT *
    FROM grids.email_templates
    WHERE base_id = ${baseId}::uuid AND short_id = ${shortId} AND deleted_at IS NULL
  `;
  return row ? mapEmailTemplate(row) : null;
};

export const getByIdOrShortId = async (baseId: string, idOrShortId: string): Promise<EmailTemplate | null> => {
  if (idOrShortId.length === 36 && idOrShortId.includes("-")) {
    const template = await get(idOrShortId);
    return template && template.baseId === baseId ? template : null;
  }
  return getByShortId(baseId, idOrShortId);
};

export const getByRef = async (baseId: string, ref: string): Promise<EmailTemplate | null> => {
  const [row] = await sql<DbRow[]>`
    SELECT *
    FROM grids.email_templates
    WHERE base_id = ${baseId}::uuid
      AND deleted_at IS NULL
      AND (id::text = ${ref} OR short_id = ${ref} OR name = ${ref})
    ORDER BY CASE WHEN id::text = ${ref} THEN 0 WHEN short_id = ${ref} THEN 1 ELSE 2 END
    LIMIT 2
  `;
  return row ? mapEmailTemplate(row) : null;
};

export const create = async (baseId: string, input: CreateEmailTemplateInput, actorId: string | null): Promise<Result<EmailTemplate>> => {
  const valid = validateEmailTemplateWrite(input);
  if (!valid.ok) return valid;
  try {
    const created = await sql.begin(async (tx): Promise<EmailTemplate> => {
      const row = await insertWithShortId(async (shortId) => {
        const [inserted] = await tx<DbRow[]>`
          INSERT INTO grids.email_templates (
            short_id, base_id, name, description, subject, html, enabled, position, created_by, updated_by
          )
          VALUES (
            ${shortId},
            ${baseId}::uuid,
            ${input.name.trim()},
            ${input.description?.trim() || null},
            ${input.subject.trim()},
            ${input.html},
            ${input.enabled ?? true},
            ${input.position ?? 0},
            ${actorId}::uuid,
            ${actorId}::uuid
          )
          RETURNING *
        `;
        if (!inserted) throw err.internal("email template insert failed");
        return inserted;
      }, "idx_grids_email_templates_short_id");
      const mapped = mapEmailTemplate(row);
      await logAudit(
        {
          baseId,
          userId: actorId,
          action: "email_template.created",
          diff: { emailTemplate: { old: null, new: { id: mapped.id, name: mapped.name, enabled: mapped.enabled } } },
        },
        tx,
      );
      return mapped;
    });
    return ok(created);
  } catch (error) {
    if (isUniqueViolation(error, "idx_grids_email_templates_short_id")) return fail(err.conflict("Email template short id already exists"));
    throw error;
  }
};

export const update = async (
  templateId: string,
  input: UpdateEmailTemplateInput,
  actorId: string | null,
): Promise<Result<EmailTemplate>> => {
  const existing = await get(templateId);
  if (!existing) return fail(err.notFound("Email template"));
  const valid = validateEmailTemplateWrite(input);
  if (!valid.ok) return valid;
  const [row] = await sql<DbRow[]>`
    UPDATE grids.email_templates
    SET name = ${input.name === undefined ? existing.name : input.name.trim()},
        description = ${input.description === undefined ? existing.description : input.description?.trim() || null},
        subject = ${input.subject === undefined ? existing.subject : input.subject.trim()},
        html = ${input.html === undefined ? existing.html : input.html},
        enabled = ${input.enabled ?? existing.enabled},
        position = ${input.position ?? existing.position},
        updated_by = ${actorId}::uuid,
        updated_at = now()
    WHERE id = ${templateId}::uuid AND deleted_at IS NULL
    RETURNING *
  `;
  if (!row) return fail(err.notFound("Email template"));
  const updated = mapEmailTemplate(row);
  await logAudit({
    baseId: updated.baseId,
    userId: actorId,
    action: "email_template.updated",
    diff: {
      emailTemplate: {
        old: { id: existing.id, name: existing.name, enabled: existing.enabled },
        new: { id: updated.id, name: updated.name, enabled: updated.enabled },
      },
    },
  });
  return ok(updated);
};

export const remove = async (templateId: string, actorId: string | null): Promise<Result<void>> => {
  const existing = await get(templateId);
  if (!existing) return fail(err.notFound("Email template"));
  const updated = await sql`
    UPDATE grids.email_templates
    SET deleted_at = now(), enabled = FALSE, updated_by = ${actorId}::uuid, updated_at = now()
    WHERE id = ${templateId}::uuid AND deleted_at IS NULL
  `;
  if (updated.count === 0) return fail(err.notFound("Email template"));
  await logAudit({
    baseId: existing.baseId,
    userId: actorId,
    action: "email_template.deleted",
    diff: { emailTemplate: { old: { id: existing.id, name: existing.name }, new: null } },
  });
  return ok();
};
