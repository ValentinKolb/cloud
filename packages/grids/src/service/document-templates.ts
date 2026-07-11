import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type { CreateDocumentTemplateInput, DocumentTemplate, UpdateDocumentTemplateInput } from "../contracts";
import { logAudit } from "./audit";
import {
  DEFAULT_DOCUMENT_NUMBER_TEMPLATE,
  DOCUMENT_NUMBER_ROOTS,
  DOCUMENT_SOURCE_ROOTS,
  utf8ByteLength,
  validateDocumentLiquidTemplate,
} from "./document-liquid";
import { type DocumentDbRow, mapDocumentTemplate } from "./document-mappers";
import { insertWithShortId } from "./short-id";
import { get as getTable } from "./tables";

const DEFAULT_SOURCE = (tableId: string) => `from table {${tableId}}\nwhere record.id = '{{ record.id }}'\nlimit 1`;
const DEFAULT_FILENAME_TEMPLATE = "{{ document.number }}.pdf";
const SOURCE_MAX_BYTES = 20_000;
const FILENAME_TEMPLATE_MAX_BYTES = 5_000;
const TEMPLATE_PART_MAX_BYTES = 50_000;

export const listTemplatesForTable = async (tableId: string): Promise<DocumentTemplate[]> => {
  const rows = await sql<DocumentDbRow[]>`
    SELECT dt.*
    FROM grids.document_templates dt
    JOIN grids.tables t ON t.id = dt.table_id AND t.deleted_at IS NULL
    JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
    WHERE dt.table_id = ${tableId}::uuid AND dt.deleted_at IS NULL
    ORDER BY dt.position, dt.created_at
  `;
  return rows.map(mapDocumentTemplate);
};

export const getTemplate = async (templateId: string): Promise<DocumentTemplate | null> => {
  const [row] = await sql<DocumentDbRow[]>`
    SELECT dt.*
    FROM grids.document_templates dt
    JOIN grids.tables t ON t.id = dt.table_id AND t.deleted_at IS NULL
    JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
    WHERE dt.id = ${templateId}::uuid AND dt.deleted_at IS NULL
  `;
  return row ? mapDocumentTemplate(row) : null;
};

export const getTemplateByShortId = async (tableId: string, shortId: string): Promise<DocumentTemplate | null> => {
  const [row] = await sql<DocumentDbRow[]>`
    SELECT dt.*
    FROM grids.document_templates dt
    JOIN grids.tables t ON t.id = dt.table_id AND t.deleted_at IS NULL
    JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
    WHERE dt.table_id = ${tableId}::uuid
      AND dt.short_id = ${shortId}
      AND dt.deleted_at IS NULL
  `;
  return row ? mapDocumentTemplate(row) : null;
};

export const getTemplateByIdOrShortId = async (tableId: string, idOrSlug: string): Promise<DocumentTemplate | null> => {
  if (idOrSlug.length === 36 && idOrSlug.includes("-")) {
    const template = await getTemplate(idOrSlug);
    return template && template.tableId === tableId ? template : null;
  }
  return getTemplateByShortId(tableId, idOrSlug);
};

export const validateTemplateWrite = (input: {
  source?: string;
  html?: string;
  headerHtml?: string | null;
  footerHtml?: string | null;
  pageCss?: string | null;
  numberTemplate?: string | null;
  filenameTemplate?: string | null;
}): Result<void> => {
  if (input.source !== undefined && utf8ByteLength(input.source) > SOURCE_MAX_BYTES) return fail(err.badInput("GQL source is too large"));
  if (input.html !== undefined) {
    const valid = validateDocumentLiquidTemplate(input.html, "HTML template");
    if (!valid.ok) return valid;
  }
  for (const [label, value] of [
    ["header HTML", input.headerHtml],
    ["footer HTML", input.footerHtml],
    ["page CSS", input.pageCss],
  ] as const) {
    if (value === undefined || value === null || value === "") continue;
    if (utf8ByteLength(value) > TEMPLATE_PART_MAX_BYTES) return fail(err.badInput(`${label} is too large`));
    const valid = validateDocumentLiquidTemplate(value, label);
    if (!valid.ok) return valid;
  }
  if (input.source !== undefined) {
    const valid = validateDocumentLiquidTemplate(input.source, "GQL source", DOCUMENT_SOURCE_ROOTS);
    if (!valid.ok) return valid;
  }
  if (input.numberTemplate !== undefined && input.numberTemplate !== null) {
    if (utf8ByteLength(input.numberTemplate) > FILENAME_TEMPLATE_MAX_BYTES)
      return fail(err.badInput("document number pattern is too large"));
    const valid = validateDocumentLiquidTemplate(input.numberTemplate, "document number pattern", DOCUMENT_NUMBER_ROOTS);
    if (!valid.ok) return valid;
  }
  if (input.filenameTemplate !== undefined && input.filenameTemplate !== null) {
    if (utf8ByteLength(input.filenameTemplate) > FILENAME_TEMPLATE_MAX_BYTES) return fail(err.badInput("filename template is too large"));
    const valid = validateDocumentLiquidTemplate(input.filenameTemplate, "filename template");
    if (!valid.ok) return valid;
  }
  return ok();
};

export const createTemplate = async (
  tableId: string,
  input: CreateDocumentTemplateInput,
  actorId: string | null,
): Promise<Result<DocumentTemplate>> => {
  const table = await getTable(tableId);
  if (!table) return fail(err.notFound("Table"));
  const valid = validateTemplateWrite(input);
  if (!valid.ok) return valid;

  const name = input.name.trim();
  if (!name) return fail(err.badInput("name required"));
  const source = input.source.trim() || DEFAULT_SOURCE(tableId);
  const html = input.html.trim();
  const headerHtml = input.headerHtml?.trim() || null;
  const footerHtml = input.footerHtml?.trim() || null;
  const pageCss = input.pageCss?.trim() || null;
  const numberTemplate = input.numberTemplate?.trim() || DEFAULT_DOCUMENT_NUMBER_TEMPLATE;
  const filenameTemplate = input.filenameTemplate?.trim() || DEFAULT_FILENAME_TEMPLATE;

  const row = await insertWithShortId<DocumentDbRow>(
    async (shortId) =>
      sql.begin(async (tx) => {
        const [created] = await tx<DocumentDbRow[]>`
          INSERT INTO grids.document_templates (
            short_id, table_id, name, description, source, html, header_html, footer_html, page_css, number_template, filename_template,
            enabled, position, created_by, updated_by
          )
          VALUES (
            ${shortId},
            ${tableId}::uuid,
            ${name},
            ${input.description ?? null},
            ${source},
            ${html},
            ${headerHtml},
            ${footerHtml},
            ${pageCss},
            ${numberTemplate},
            ${filenameTemplate},
            ${input.enabled ?? true},
            COALESCE((SELECT MAX(position) + 1 FROM grids.document_templates WHERE table_id = ${tableId}::uuid), 0),
            ${actorId}::uuid,
            ${actorId}::uuid
          )
          RETURNING *
        `;
        if (!created) throw new Error("insert returned no row");
        await logAudit(
          {
            baseId: table.baseId,
            tableId,
            userId: actorId,
            action: "document_template.created",
            diff: { documentTemplate: { old: null, new: { id: created.id, name, enabled: input.enabled ?? true } } },
          },
          tx,
        );
        return created;
      }),
    "idx_grids_document_templates_short_id",
  );
  return ok(mapDocumentTemplate(row));
};

export const updateTemplate = async (
  templateId: string,
  input: UpdateDocumentTemplateInput,
  actorId: string | null,
): Promise<Result<DocumentTemplate>> => {
  const existing = await getTemplate(templateId);
  if (!existing) return fail(err.notFound("Document template"));
  const valid = validateTemplateWrite(input);
  if (!valid.ok) return valid;

  const [row] = await sql<DocumentDbRow[]>`
    UPDATE grids.document_templates
    SET
      name = COALESCE(${input.name?.trim() || null}, name),
      description = ${input.description === undefined ? sql`description` : input.description},
      source = COALESCE(${input.source?.trim() || null}, source),
      html = COALESCE(${input.html?.trim() || null}, html),
      header_html = ${input.headerHtml === undefined ? sql`header_html` : input.headerHtml?.trim() || null},
      footer_html = ${input.footerHtml === undefined ? sql`footer_html` : input.footerHtml?.trim() || null},
      page_css = ${input.pageCss === undefined ? sql`page_css` : input.pageCss?.trim() || null},
      number_template = COALESCE(${input.numberTemplate?.trim() || null}, number_template),
      filename_template = COALESCE(${input.filenameTemplate?.trim() || null}, filename_template),
      enabled = COALESCE(${input.enabled ?? null}, enabled),
      position = COALESCE(${input.position ?? null}, position),
      updated_by = ${actorId}::uuid,
      updated_at = now()
    WHERE id = ${templateId}::uuid AND deleted_at IS NULL
    RETURNING *
  `;
  return row ? ok(mapDocumentTemplate(row)) : fail(err.notFound("Document template"));
};

export const removeTemplate = async (templateId: string, actorId: string | null): Promise<Result<void>> => {
  const [row] = await sql<DocumentDbRow[]>`
    UPDATE grids.document_templates
    SET deleted_at = now(), updated_by = ${actorId}::uuid, updated_at = now()
    WHERE id = ${templateId}::uuid AND deleted_at IS NULL
    RETURNING id
  `;
  return row ? ok() : fail(err.notFound("Document template"));
};
