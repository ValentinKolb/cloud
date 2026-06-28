import { sql } from "bun";
import { createHash } from "node:crypto";
import { ok, fail, err, type Result } from "@valentinkolb/stdlib";
import type { GridFile, GridFileContent, GridFilePreview } from "./types";

type FileFieldConfig = {
  maxFiles?: number;
  accept?: string[];
};

type DbRow = {
  id: string;
  record_id: string;
  field_id: string;
  position: number;
  filename: string;
  mime_type: string;
  size_bytes: number | string;
  sha256: string;
  created_by: string | null;
  created_at: Date | string;
};

const mapRow = (row: DbRow): GridFile => ({
  id: row.id,
  recordId: row.record_id,
  fieldId: row.field_id,
  position: row.position,
  filename: row.filename,
  mimeType: row.mime_type,
  sizeBytes: Number(row.size_bytes),
  sha256: row.sha256,
  createdBy: row.created_by,
  createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
});

const normalizeFilename = (name: string): string => {
  const trimmed = name.trim().replace(/[\\/]/g, "_");
  return trimmed.length > 0 ? trimmed.slice(0, 255) : "untitled";
};

const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const verifyTarget = async (tableId: string, recordId: string, fieldId: string): Promise<Result<{ config: FileFieldConfig }>> => {
  const [row] = await sql<{ record_ok: boolean; field_ok: boolean; config: unknown }[]>`
    SELECT
      EXISTS (
        SELECT 1
        FROM grids.records r
        JOIN grids.tables t ON t.id = r.table_id AND t.deleted_at IS NULL
        JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
        WHERE r.id = ${recordId}::uuid
          AND r.table_id = ${tableId}::uuid
          AND r.deleted_at IS NULL
      ) AS record_ok,
      COALESCE((
        SELECT TRUE
        FROM grids.fields f
        WHERE f.id = ${fieldId}::uuid
          AND f.table_id = ${tableId}::uuid
          AND f.type = 'file'
          AND f.deleted_at IS NULL
      ), FALSE) AS field_ok,
      (
        SELECT f.config
        FROM grids.fields f
        WHERE f.id = ${fieldId}::uuid
          AND f.table_id = ${tableId}::uuid
          AND f.type = 'file'
          AND f.deleted_at IS NULL
      ) AS config
  `;
  if (!row?.record_ok) return fail(err.notFound("Record"));
  if (!row.field_ok) return fail(err.badInput("field is not a live file field on this table"));
  return ok({ config: (row.config && typeof row.config === "object" ? row.config : {}) as FileFieldConfig });
};

const matchesAccept = (filename: string, mimeType: string, accept: string[] | undefined): boolean => {
  if (!accept || accept.length === 0) return true;
  const lowerName = filename.toLowerCase();
  const lowerMime = mimeType.toLowerCase();
  return accept.some((raw) => {
    const token = raw.trim().toLowerCase();
    if (token.length === 0) return false;
    if (token.startsWith(".")) return lowerName.endsWith(token);
    if (token.endsWith("/*")) return lowerMime.startsWith(token.slice(0, -1));
    return lowerMime === token;
  });
};

export const listForRecordField = async (params: { tableId: string; recordId: string; fieldId: string }): Promise<Result<GridFile[]>> => {
  const target = await verifyTarget(params.tableId, params.recordId, params.fieldId);
  if (!target.ok) return target;
  const rows = await sql<DbRow[]>`
    SELECT id::text AS id, record_id::text AS record_id, field_id::text AS field_id,
           position, filename, mime_type, size_bytes, sha256,
           created_by::text AS created_by, created_at
    FROM grids.files
    WHERE record_id = ${params.recordId}::uuid AND field_id = ${params.fieldId}::uuid
    ORDER BY position, created_at, id
  `;
  return ok(rows.map(mapRow));
};

export const listFirstImagePreviews = async (params: {
  recordIds: string[];
  fieldIds: string[];
}): Promise<Record<string, Record<string, GridFilePreview>>> => {
  const recordIds = [...new Set(params.recordIds)].filter(Boolean);
  const fieldIds = [...new Set(params.fieldIds)].filter(Boolean);
  if (recordIds.length === 0 || fieldIds.length === 0) return {};

  const rows = await sql<
    Array<{
      id: string;
      record_id: string;
      field_id: string;
      filename: string;
      mime_type: string;
      size_bytes: number | string;
    }>
  >`
    SELECT DISTINCT ON (record_id, field_id)
      id::text AS id,
      record_id::text AS record_id,
      field_id::text AS field_id,
      filename,
      mime_type,
      size_bytes
    FROM grids.files
    WHERE record_id = ANY(${sql.array(recordIds, "UUID")})
      AND field_id = ANY(${sql.array(fieldIds, "UUID")})
      AND mime_type LIKE 'image/%'
    ORDER BY record_id, field_id, position, created_at, id
  `;

  const out: Record<string, Record<string, GridFilePreview>> = {};
  for (const row of rows) {
    out[row.record_id] ??= {};
    out[row.record_id]![row.field_id] = {
      fileId: row.id,
      recordId: row.record_id,
      fieldId: row.field_id,
      filename: row.filename,
      mimeType: row.mime_type,
      sizeBytes: Number(row.size_bytes),
    };
  }
  return out;
};

export const upload = async (params: {
  tableId: string;
  recordId: string;
  fieldId: string;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  userId: string | null;
}): Promise<Result<GridFile>> => {
  const target = await verifyTarget(params.tableId, params.recordId, params.fieldId);
  if (!target.ok) return target;
  const filename = normalizeFilename(params.filename);
  if (!matchesAccept(filename, params.mimeType || "application/octet-stream", target.data.config.accept)) {
    return fail(err.badInput("file type is not accepted by this field"));
  }
  const maxFiles = target.data.config.maxFiles;

  return sql.begin(async (tx) => {
    await tx`
      SELECT pg_advisory_xact_lock(hashtext(${params.recordId}), hashtext(${params.fieldId}))
    `;

    if (typeof maxFiles === "number" && Number.isInteger(maxFiles) && maxFiles > 0) {
      const [countRow] = await tx<{ count: number }[]>`
        SELECT COUNT(*)::int AS count
        FROM grids.files
        WHERE record_id = ${params.recordId}::uuid AND field_id = ${params.fieldId}::uuid
      `;
      if ((countRow?.count ?? 0) >= maxFiles) {
        return fail(err.badInput(`file field already has the maximum of ${maxFiles} file(s)`));
      }
    }

    const [pos] = await tx<{ position: number }[]>`
      SELECT COALESCE(MAX(position) + 1, 0)::int AS position
      FROM grids.files
      WHERE record_id = ${params.recordId}::uuid AND field_id = ${params.fieldId}::uuid
    `;
    const [row] = await tx<DbRow[]>`
      INSERT INTO grids.files (
        record_id, field_id, position, filename, mime_type,
        size_bytes, sha256, bytes, created_by
      )
      VALUES (
        ${params.recordId}::uuid,
        ${params.fieldId}::uuid,
        ${pos?.position ?? 0},
        ${filename},
        ${params.mimeType || "application/octet-stream"},
        ${params.bytes.byteLength},
        ${sha256Hex(params.bytes)},
        ${params.bytes},
        ${params.userId}::uuid
      )
      RETURNING id::text AS id, record_id::text AS record_id, field_id::text AS field_id,
                position, filename, mime_type, size_bytes, sha256,
                created_by::text AS created_by, created_at
    `;
    if (!row) throw new Error("insert returned no row");
    return ok(mapRow(row));
  });
};

export const getContent = async (params: {
  tableId: string;
  recordId: string;
  fieldId: string;
  fileId: string;
}): Promise<Result<GridFileContent>> => {
  const target = await verifyTarget(params.tableId, params.recordId, params.fieldId);
  if (!target.ok) return target;
  const [row] = await sql<(DbRow & { bytes: Uint8Array })[]>`
    SELECT id::text AS id, record_id::text AS record_id, field_id::text AS field_id,
           position, filename, mime_type, size_bytes, sha256,
           created_by::text AS created_by, created_at, bytes
    FROM grids.files
    WHERE id = ${params.fileId}::uuid
      AND record_id = ${params.recordId}::uuid
      AND field_id = ${params.fieldId}::uuid
  `;
  if (!row) return fail(err.notFound("File"));
  return ok({ ...mapRow(row), bytes: row.bytes });
};

export const remove = async (params: { tableId: string; recordId: string; fieldId: string; fileId: string }): Promise<Result<void>> => {
  const target = await verifyTarget(params.tableId, params.recordId, params.fieldId);
  if (!target.ok) return target;
  const rows = await sql<{ id: string }[]>`
    DELETE FROM grids.files
    WHERE id = ${params.fileId}::uuid
      AND record_id = ${params.recordId}::uuid
      AND field_id = ${params.fieldId}::uuid
    RETURNING id::text AS id
  `;
  if (rows.length === 0) return fail(err.notFound("File"));
  return ok();
};
