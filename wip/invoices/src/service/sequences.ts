import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { requireWorkspacePermission } from "./authz";
import { emptyToNull, isUuid } from "./shared";
import type { AllocatedInvoiceNumber, CreateInvoiceSequenceInput, InvoiceActor, InvoiceDocumentType, InvoiceSequence } from "./types";

type DbSequence = {
  id: string;
  workspace_id: string;
  issuer_profile_id: string;
  document_type: string;
  name: string;
  prefix: string;
  period: string | null;
  next_number: number;
  padding: number;
  last_allocated_at: Date | null;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
};

const mapSequence = (row: DbSequence): InvoiceSequence => ({
  id: row.id,
  workspaceId: row.workspace_id,
  issuerProfileId: row.issuer_profile_id,
  documentType: row.document_type,
  name: row.name,
  prefix: row.prefix,
  period: row.period,
  nextNumber: row.next_number,
  padding: row.padding,
  lastAllocatedAt: row.last_allocated_at?.toISOString() ?? null,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  archivedAt: row.archived_at?.toISOString() ?? null,
});

export const formatInvoiceNumber = (config: { prefix: string; value: number; padding: number }): string =>
  `${config.prefix}${String(config.value).padStart(config.padding, "0")}`;

export const list = async (config: { workspaceId: string; actor: InvoiceActor }): Promise<InvoiceSequence[]> => {
  if (!isUuid(config.workspaceId)) return [];
  const access = await requireWorkspacePermission({ workspaceId: config.workspaceId, actor: config.actor, requiredLevel: "read" });
  if (!access.ok) return [];

  const rows = await sql<DbSequence[]>`
    SELECT *
    FROM invoices.invoice_sequences
    WHERE workspace_id = ${config.workspaceId}::uuid
      AND archived_at IS NULL
    ORDER BY document_type ASC, name ASC, created_at ASC
  `;

  return rows.map(mapSequence);
};

export const get = async (config: { workspaceId: string; id: string; actor: InvoiceActor }): Promise<InvoiceSequence | null> => {
  if (!isUuid(config.workspaceId) || !isUuid(config.id)) return null;
  const access = await requireWorkspacePermission({ workspaceId: config.workspaceId, actor: config.actor, requiredLevel: "read" });
  if (!access.ok) return null;

  const [row] = await sql<DbSequence[]>`
    SELECT *
    FROM invoices.invoice_sequences
    WHERE workspace_id = ${config.workspaceId}::uuid
      AND id = ${config.id}::uuid
      AND archived_at IS NULL
  `;

  return row ? mapSequence(row) : null;
};

const isInvoiceDocumentType = (value: string): value is InvoiceDocumentType =>
  value === "invoice" || value === "correction" || value === "cancellation";

export const create = async (config: { workspaceId: string; actor: InvoiceActor; data: CreateInvoiceSequenceInput }): Promise<Result<InvoiceSequence>> => {
  if (!isUuid(config.workspaceId) || !isUuid(config.data.issuerProfileId)) {
    return fail(err.notFound("Workspace or issuer profile"));
  }
  const access = await requireWorkspacePermission({ workspaceId: config.workspaceId, actor: config.actor, requiredLevel: "admin" });
  if (!access.ok) return fail(access.error);

  const name = config.data.name.trim();
  if (!name) return fail(err.badInput("Sequence name is required"));
  const documentType = config.data.documentType ?? "invoice";
  if (!isInvoiceDocumentType(documentType)) return fail(err.badInput("Unsupported invoice document type"));

  try {
    const [row] = await sql<DbSequence[]>`
      INSERT INTO invoices.invoice_sequences (
        workspace_id,
        issuer_profile_id,
        document_type,
        name,
        prefix,
        period,
        next_number,
        padding
      )
      SELECT
        ${config.workspaceId}::uuid,
        ip.id,
        ${documentType},
        ${name},
        ${config.data.prefix ?? ""},
        ${emptyToNull(config.data.period)},
        ${Math.max(1, config.data.nextNumber ?? 1)},
        ${Math.min(Math.max(0, config.data.padding ?? 4), 20)}
      FROM invoices.invoice_issuer_profiles ip
      WHERE ip.workspace_id = ${config.workspaceId}::uuid
        AND ip.id = ${config.data.issuerProfileId}::uuid
        AND ip.archived_at IS NULL
      RETURNING *
    `;

    if (!row) return fail(err.notFound("Workspace issuer profile"));
    return ok(mapSequence(row));
  } catch (error: unknown) {
    const dbError = error as { code?: string };
    if (dbError.code === "23503") return fail(err.notFound("Workspace or issuer profile"));
    if (dbError.code === "23505") return fail(err.conflict("Invoice sequence"));
    throw error;
  }
};

export const allocateNext = async (config: { workspaceId: string; id: string }): Promise<Result<AllocatedInvoiceNumber>> => {
  if (!isUuid(config.workspaceId) || !isUuid(config.id)) return fail(err.notFound("Invoice sequence"));

  return sql.begin(async (tx) => {
    const [row] = await tx<DbSequence[]>`
      SELECT *
      FROM invoices.invoice_sequences
      WHERE workspace_id = ${config.workspaceId}::uuid
        AND id = ${config.id}::uuid
        AND archived_at IS NULL
      FOR UPDATE
    `;

    if (!row) return fail(err.notFound("Invoice sequence"));

    const allocated = row.next_number;
    const result = await tx`
      UPDATE invoices.invoice_sequences
      SET
        next_number = next_number + 1,
        last_allocated_at = now(),
        updated_at = now()
      WHERE id = ${config.id}::uuid
    `;
    if (result.count === 0) return fail(err.internal("Failed to allocate invoice number"));

    return ok({
      sequenceId: row.id,
      value: allocated,
      formatted: formatInvoiceNumber({ prefix: row.prefix, value: allocated, padding: row.padding }),
    });
  });
};
