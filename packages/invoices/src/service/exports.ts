import { createHash } from "node:crypto";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { requireInvoiceUser, requireWorkspacePermission } from "./authz";
import { isUuid, parseJsonRecord, toJsonb, toPgUuidArray, type JsonRecord } from "./shared";
import type {
  InvoiceActor,
  InvoiceExportBatch,
  InvoiceExportBatchDetail,
  InvoiceExportBatchStatus,
  InvoiceExportItem,
  InvoiceExportItemStatus,
  InvoiceExportType,
  RegisterInvoiceExportBatchInput,
  RegisterInvoiceExportItemInput,
} from "./types";

type SqlClient = typeof sql;

type DbExportBatch = {
  id: string;
  workspace_id: string;
  export_type: InvoiceExportType;
  status: InvoiceExportBatchStatus;
  filter_snapshot: unknown;
  selected_invoice_ids: string[] | string | null;
  format_version: string;
  generator_version: string;
  manifest: unknown;
  file_sha256: string | null;
  file_size: number | string | null;
  created_by: string | null;
  created_at: Date;
  completed_at: Date;
};

type DbExportItem = {
  id: string;
  batch_id: string;
  workspace_id: string;
  invoice_id: string;
  artifact_id: string | null;
  row_number: number;
  row_hash: string;
  amount_snapshot: unknown;
  tax_snapshot: unknown;
  accounting_snapshot: unknown;
  status: InvoiceExportItemStatus;
  error: string | null;
  created_at: Date;
};

type PreparedExportItem = Required<Pick<RegisterInvoiceExportItemInput, "rowNumber" | "status">> & {
  invoiceId: string;
  artifactId: string | null;
  rowHash: string;
  amountSnapshot: JsonRecord;
  taxSnapshot: JsonRecord;
  accountingSnapshot: JsonRecord;
  error: string | null;
};

type PreparedExportBatch = {
  exportType: InvoiceExportType;
  status: InvoiceExportBatchStatus;
  filterSnapshot: JsonRecord;
  selectedInvoiceIds: string[];
  formatVersion: string;
  generatorVersion: string;
  manifest: JsonRecord;
  fileSha256: string | null;
  fileSize: number | null;
  completedAt: string;
  items: PreparedExportItem[];
};

const SUPPORTED_V1_EXPORT_TYPES = new Set<InvoiceExportType>(["pdf_zip", "summary_csv"]);
const BATCH_STATUSES = new Set<InvoiceExportBatchStatus>(["completed", "failed"]);
const ITEM_STATUSES = new Set<InvoiceExportItemStatus>(["included", "skipped", "failed"]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const hashValue = (value: unknown): string => createHash("sha256").update(stableStringify(value)).digest("hex");

const unique = (values: string[]): string[] => [...new Set(values)];

const normalizeUuidArray = (value: string[] | string | null): string[] => {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return value
    .replace(/^{|}$/g, "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const mapBatch = (row: DbExportBatch): InvoiceExportBatch => ({
  id: row.id,
  workspaceId: row.workspace_id,
  exportType: row.export_type,
  status: row.status,
  filterSnapshot: parseJsonRecord(row.filter_snapshot),
  selectedInvoiceIds: normalizeUuidArray(row.selected_invoice_ids),
  formatVersion: row.format_version,
  generatorVersion: row.generator_version,
  manifest: parseJsonRecord(row.manifest),
  fileSha256: row.file_sha256,
  fileSize: row.file_size == null ? null : Number(row.file_size),
  createdBy: row.created_by,
  createdAt: row.created_at.toISOString(),
  completedAt: row.completed_at.toISOString(),
});

const mapItem = (row: DbExportItem): InvoiceExportItem => ({
  id: row.id,
  batchId: row.batch_id,
  workspaceId: row.workspace_id,
  invoiceId: row.invoice_id,
  artifactId: row.artifact_id,
  rowNumber: row.row_number,
  rowHash: row.row_hash,
  amountSnapshot: parseJsonRecord(row.amount_snapshot),
  taxSnapshot: parseJsonRecord(row.tax_snapshot),
  accountingSnapshot: parseJsonRecord(row.accounting_snapshot),
  status: row.status,
  error: row.error,
  createdAt: row.created_at.toISOString(),
});

const prepareItem = (input: RegisterInvoiceExportItemInput): Result<PreparedExportItem> => {
  if (!isUuid(input.invoiceId)) return fail(err.badInput("Export item invoice ID must be a UUID"));
  if (input.artifactId != null && !isUuid(input.artifactId)) return fail(err.badInput("Export item artifact ID must be a UUID"));
  if (!Number.isInteger(input.rowNumber) || input.rowNumber <= 0) return fail(err.badInput("Export item row number must be positive"));

  const status = input.status ?? "included";
  if (!ITEM_STATUSES.has(status)) return fail(err.badInput("Unsupported export item status"));
  if (status === "failed" && !input.error?.trim()) return fail(err.badInput("Failed export items require an error"));

  const amountSnapshot = input.amountSnapshot ?? {};
  const taxSnapshot = input.taxSnapshot ?? {};
  const accountingSnapshot = input.accountingSnapshot ?? {};
  const errorMessage = input.error?.trim() || null;
  const hashSource = {
    invoiceId: input.invoiceId,
    artifactId: input.artifactId ?? null,
    rowNumber: input.rowNumber,
    amountSnapshot,
    taxSnapshot,
    accountingSnapshot,
    status,
    error: errorMessage,
  };
  const rowHash = input.rowHash ?? hashValue(hashSource);
  if (!SHA256_PATTERN.test(rowHash)) return fail(err.badInput("Export item row hash must be a lowercase SHA-256 hex digest"));

  return ok({
    invoiceId: input.invoiceId,
    artifactId: input.artifactId ?? null,
    rowNumber: input.rowNumber,
    rowHash,
    amountSnapshot,
    taxSnapshot,
    accountingSnapshot,
    status,
    error: errorMessage,
  });
};

const prepareBatch = (input: RegisterInvoiceExportBatchInput): Result<PreparedExportBatch> => {
  if (!SUPPORTED_V1_EXPORT_TYPES.has(input.exportType)) {
    return fail(err.badInput("This export type is prepared in the ledger but not available in V1"));
  }

  const status = input.status ?? "completed";
  if (!BATCH_STATUSES.has(status)) return fail(err.badInput("Unsupported export batch status"));

  const formatVersion = input.formatVersion.trim();
  const generatorVersion = input.generatorVersion.trim();
  if (!formatVersion) return fail(err.badInput("Export format version is required"));
  if (!generatorVersion) return fail(err.badInput("Export generator version is required"));

  const items: PreparedExportItem[] = [];
  const rowNumbers = new Set<number>();
  for (const itemInput of input.items) {
    const item = prepareItem(itemInput);
    if (!item.ok) return item;
    if (rowNumbers.has(item.data.rowNumber)) return fail(err.badInput("Export item row numbers must be unique"));
    rowNumbers.add(item.data.rowNumber);
    items.push(item.data);
  }
  if (items.length === 0) return fail(err.badInput("At least one export item is required"));

  const selectedInvoiceIds = input.selectedInvoiceIds?.length ? unique(input.selectedInvoiceIds) : unique(items.map((item) => item.invoiceId));
  if (selectedInvoiceIds.some((id) => !isUuid(id))) return fail(err.badInput("Selected invoice IDs must be UUIDs"));

  const fileSha256 = input.fileSha256?.trim() || null;
  if (fileSha256 != null && !SHA256_PATTERN.test(fileSha256)) return fail(err.badInput("Export file hash must be a lowercase SHA-256 hex digest"));
  const fileSize = input.fileSize ?? null;
  if (fileSize != null && (!Number.isInteger(fileSize) || fileSize <= 0)) return fail(err.badInput("Export file size must be a positive byte count"));
  if (status === "completed" && (!fileSha256 || fileSize == null)) {
    return fail(err.badInput("Completed export batches require a file hash and byte size"));
  }

  const completedAt = input.completedAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(completedAt))) return fail(err.badInput("Export completion timestamp is invalid"));

  return ok({
    exportType: input.exportType,
    status,
    filterSnapshot: input.filterSnapshot ?? {},
    selectedInvoiceIds,
    formatVersion,
    generatorVersion,
    manifest: input.manifest ?? {},
    fileSha256,
    fileSize,
    completedAt,
    items,
  });
};

const writeEvent = async (client: SqlClient, config: { workspaceId: string; actorId: string; batch: InvoiceExportBatch; itemCount: number }): Promise<void> => {
  await client`
    INSERT INTO invoices.invoice_events (
      workspace_id,
      event_type,
      actor_id,
      metadata
    )
    VALUES (
      ${config.workspaceId}::uuid,
      'invoice.export_batch_registered',
      ${config.actorId}::uuid,
      (${toJsonb({
        batchId: config.batch.id,
        exportType: config.batch.exportType,
        status: config.batch.status,
        itemCount: config.itemCount,
        formatVersion: config.batch.formatVersion,
        generatorVersion: config.batch.generatorVersion,
      })}::text)::jsonb
    )
  `;
};

const assertInvoicesBelongToWorkspace = async (client: SqlClient, config: { workspaceId: string; invoiceIds: string[] }): Promise<Result<void>> => {
  const rows = await client<{ id: string }[]>`
    SELECT id
    FROM invoices.invoices
    WHERE workspace_id = ${config.workspaceId}::uuid
      AND status = 'issued'
      AND id = ANY(${toPgUuidArray(config.invoiceIds)}::uuid[])
  `;
  if (rows.length !== config.invoiceIds.length) return fail(err.badInput("Exports can only include issued invoices from the selected workspace"));
  return ok();
};

const assertArtifactsBelongToItems = async (client: SqlClient, config: { workspaceId: string; items: PreparedExportItem[] }): Promise<Result<void>> => {
  const artifactIds = unique(config.items.flatMap((item) => (item.artifactId ? [item.artifactId] : [])));
  if (artifactIds.length === 0) return ok();

  const rows = await client<{ id: string; invoice_id: string }[]>`
    SELECT a.id, a.invoice_id
    FROM invoices.invoice_artifacts a
    JOIN invoices.invoices i ON i.id = a.invoice_id
    WHERE i.workspace_id = ${config.workspaceId}::uuid
      AND a.id = ANY(${toPgUuidArray(artifactIds)}::uuid[])
  `;
  const invoiceByArtifactId = new Map(rows.map((row) => [row.id, row.invoice_id]));
  for (const item of config.items) {
    if (!item.artifactId) continue;
    if (invoiceByArtifactId.get(item.artifactId) !== item.invoiceId) {
      return fail(err.badInput("Export item artifacts must belong to their invoice and workspace"));
    }
  }
  return ok();
};

const loadDetail = async (config: { workspaceId: string; batchId: string }): Promise<InvoiceExportBatchDetail | null> => {
  const [batchRow] = await sql<DbExportBatch[]>`
    SELECT *
    FROM invoices.invoice_export_batches
    WHERE workspace_id = ${config.workspaceId}::uuid
      AND id = ${config.batchId}::uuid
  `;
  if (!batchRow) return null;

  const itemRows = await sql<DbExportItem[]>`
    SELECT *
    FROM invoices.invoice_export_items
    WHERE workspace_id = ${config.workspaceId}::uuid
      AND batch_id = ${config.batchId}::uuid
    ORDER BY row_number ASC
  `;

  return {
    ...mapBatch(batchRow),
    items: itemRows.map(mapItem),
  };
};

export const register = async (config: {
  workspaceId: string;
  actor: InvoiceActor;
  data: RegisterInvoiceExportBatchInput;
}): Promise<Result<InvoiceExportBatchDetail>> => {
  if (!isUuid(config.workspaceId)) return fail(err.notFound("Invoice workspace"));
  const userId = requireInvoiceUser(config.actor);
  if (!userId.ok) return fail(userId.error);
  const access = await requireWorkspacePermission({ workspaceId: config.workspaceId, actor: config.actor, requiredLevel: "admin" });
  if (!access.ok) return fail(access.error);

  const prepared = prepareBatch(config.data);
  if (!prepared.ok) return prepared;

  return sql.begin(async (tx) => {
    const invoiceIds = unique([...prepared.data.selectedInvoiceIds, ...prepared.data.items.map((item) => item.invoiceId)]);
    const invoicesOk = await assertInvoicesBelongToWorkspace(tx, { workspaceId: config.workspaceId, invoiceIds });
    if (!invoicesOk.ok) return invoicesOk;

    const artifactsOk = await assertArtifactsBelongToItems(tx, { workspaceId: config.workspaceId, items: prepared.data.items });
    if (!artifactsOk.ok) return artifactsOk;

    const [batchRow] = await tx<DbExportBatch[]>`
      INSERT INTO invoices.invoice_export_batches (
        workspace_id,
        export_type,
        status,
        filter_snapshot,
        selected_invoice_ids,
        format_version,
        generator_version,
        manifest,
        file_sha256,
        file_size,
        created_by,
        completed_at
      )
      VALUES (
        ${config.workspaceId}::uuid,
        ${prepared.data.exportType},
        ${prepared.data.status},
        (${toJsonb(prepared.data.filterSnapshot)}::text)::jsonb,
        ${toPgUuidArray(prepared.data.selectedInvoiceIds)}::uuid[],
        ${prepared.data.formatVersion},
        ${prepared.data.generatorVersion},
        (${toJsonb(prepared.data.manifest)}::text)::jsonb,
        ${prepared.data.fileSha256},
        ${prepared.data.fileSize},
        ${userId.data}::uuid,
        ${prepared.data.completedAt}::timestamptz
      )
      RETURNING *
    `;
    if (!batchRow) return fail(err.internal("Failed to register invoice export batch"));

    const batch = mapBatch(batchRow);
    const items: InvoiceExportItem[] = [];
    for (const item of prepared.data.items) {
      const [itemRow] = await tx<DbExportItem[]>`
        INSERT INTO invoices.invoice_export_items (
          batch_id,
          workspace_id,
          invoice_id,
          artifact_id,
          row_number,
          row_hash,
          amount_snapshot,
          tax_snapshot,
          accounting_snapshot,
          status,
          error
        )
        VALUES (
          ${batch.id}::uuid,
          ${config.workspaceId}::uuid,
          ${item.invoiceId}::uuid,
          ${item.artifactId}::uuid,
          ${item.rowNumber},
          ${item.rowHash},
          (${toJsonb(item.amountSnapshot)}::text)::jsonb,
          (${toJsonb(item.taxSnapshot)}::text)::jsonb,
          (${toJsonb(item.accountingSnapshot)}::text)::jsonb,
          ${item.status},
          ${item.error}
        )
        RETURNING *
      `;
      if (!itemRow) return fail(err.internal("Failed to register invoice export item"));
      items.push(mapItem(itemRow));
    }

    await writeEvent(tx, { workspaceId: config.workspaceId, actorId: userId.data, batch, itemCount: items.length });
    return ok({ ...batch, items });
  });
};

export const list = async (config: {
  workspaceId: string;
  actor: InvoiceActor;
  limit?: number;
}): Promise<InvoiceExportBatch[]> => {
  if (!isUuid(config.workspaceId)) return [];
  const access = await requireWorkspacePermission({ workspaceId: config.workspaceId, actor: config.actor, requiredLevel: "read" });
  if (!access.ok) return [];

  const limit = Math.min(Math.max(config.limit ?? 50, 1), 200);
  const rows = await sql<DbExportBatch[]>`
    SELECT *
    FROM invoices.invoice_export_batches
    WHERE workspace_id = ${config.workspaceId}::uuid
    ORDER BY completed_at DESC, created_at DESC
    LIMIT ${limit}
  `;
  return rows.map(mapBatch);
};

export const get = async (config: {
  workspaceId: string;
  batchId: string;
  actor: InvoiceActor;
}): Promise<InvoiceExportBatchDetail | null> => {
  if (!isUuid(config.workspaceId) || !isUuid(config.batchId)) return null;
  const access = await requireWorkspacePermission({ workspaceId: config.workspaceId, actor: config.actor, requiredLevel: "read" });
  if (!access.ok) return null;
  return loadDetail({ workspaceId: config.workspaceId, batchId: config.batchId });
};
