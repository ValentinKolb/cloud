import { Buffer } from "node:buffer";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { toPgTextArray, toPgUuidArray } from "@valentinkolb/cloud/services";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { z } from "zod";
import { RecordAuditContextSchema } from "../contracts";
import { buildDslSqlRecordSource } from "../query-dsl/sql-record-source";
import { getActive, verifyRevisionScope } from "./federated-tables";
import { listByTables } from "./field-read";
import { listByTable as listFields } from "./fields";
import { parseJsonbRow } from "./jsonb";
import { get as getTable } from "./tables";
import type { AuditAction, AuditEntry, Field } from "./types";

type DbRow = Record<string, unknown>;

const RECORD_ACTIONS = ["created", "updated", "deleted", "restored", "imported"] as const satisfies readonly AuditAction[];
type CombinedRecordAuditAction = (typeof RECORD_ACTIONS)[number];

type CombinedAuditSource = {
  ref: string;
  baseName: string;
  tableName: string;
};

type CombinedAuditContext = {
  operation: "delete" | "restore" | "update";
  answers: Array<{
    label: string;
    type: "text" | "longtext" | "select";
    required: boolean;
    value: string;
    optionLabel?: string;
  }>;
};

export type CombinedAuditEntry = Omit<AuditEntry, "context"> & {
  context: CombinedAuditContext | null;
  userDisplayName: string | null;
  source: CombinedAuditSource;
  recordDeletedAt: string | null;
};

export type CombinedAuditPage = {
  items: CombinedAuditEntry[];
  sources: CombinedAuditSource[];
  nextCursor: string | null;
};

export type CombinedRecordOrigin = {
  source: CombinedAuditSource;
  deletedAt: string | null;
};

export type CombinedAuditProjectionMapping = {
  targetFieldId: string;
  targetField: Field;
  sourceFieldId: string;
  sourceField: Field;
  config: Record<string, unknown>;
};

type ProjectionSource = {
  tableId: string;
  descriptor: CombinedAuditSource;
  mappings: CombinedAuditProjectionMapping[];
};

type Projection = {
  targetBaseId: string;
  targetTableId: string;
  revisionId: string;
  revisionToken: string;
  fingerprint: string;
  sources: ProjectionSource[];
};

const AuditCursorSchema = z.object({
  fingerprint: z.string().min(1).max(200),
  createdAt: z.string().min(1).max(100),
  id: z.string().uuid(),
});

type AuditCursor = z.infer<typeof AuditCursorSchema>;

const AUDIT_CURSOR_SIGNATURE_DOMAIN = "grids:combined-audit-cursor:v1\0";

const auditCursorSigningKey = (): string => {
  const key = process.env.APP_SECRET?.trim();
  if (!key) throw new Error("APP_SECRET is required for Combined audit pagination");
  return key;
};

const cursorSignature = (payload: string): string =>
  createHmac("sha256", auditCursorSigningKey()).update(AUDIT_CURSOR_SIGNATURE_DOMAIN).update(payload).digest("base64url");

const encodeCursor = (cursor: AuditCursor): string => {
  const payload = Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
  return `${payload}.${cursorSignature(payload)}`;
};

const decodeCursor = (value: string | null | undefined): AuditCursor | null => {
  if (!value || value.length > 2_000) return null;
  try {
    const [payload, signature, extra] = value.split(".");
    if (!payload || !signature || extra !== undefined) return null;
    const expected = Buffer.from(cursorSignature(payload), "utf8");
    const received = Buffer.from(signature, "utf8");
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
    const parsed = AuditCursorSchema.safeParse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const iso = (value: unknown): string => (value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString());

const auditCursorFingerprint = (
  projectionFingerprint: string,
  filters: {
    recordId?: string;
    fieldIds?: readonly string[];
    sourceRef?: string;
    action?: CombinedRecordAuditAction;
    from?: string;
    to?: string;
  },
): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        publication: projectionFingerprint,
        recordId: filters.recordId ?? null,
        fieldIds: filters.fieldIds ? [...filters.fieldIds].sort() : null,
        sourceRef: filters.sourceRef ?? null,
        action: filters.action ?? null,
        from: filters.from ?? null,
        to: filters.to ?? null,
      }),
    )
    .digest("base64url");

const mappedSelectValue = (value: unknown, config: Record<string, unknown>, targetField: Field): unknown => {
  if (value === null || value === undefined) return value;
  const optionMap = (config.optionMap ?? {}) as Record<string, unknown>;
  const targetOptions = new Map(
    ((targetField.config as { options?: Array<{ id?: unknown; label?: unknown }> }).options ?? []).flatMap((option) =>
      typeof option.id === "string" && typeof option.label === "string" ? [[option.id, option.label] as const] : [],
    ),
  );
  const mapOne = (item: unknown): unknown => {
    if (typeof item !== "string") return "Unavailable in current Combined mapping";
    const targetOptionId = optionMap[item];
    return typeof targetOptionId === "string"
      ? (targetOptions.get(targetOptionId) ?? "Unavailable in current Combined mapping")
      : "Unavailable in current Combined mapping";
  };
  return Array.isArray(value) ? value.map(mapOne) : mapOne(value);
};

const countedValue = (value: unknown, singular: string, plural: string): unknown => {
  if (value === null || value === undefined) return value;
  const count = Array.isArray(value) ? value.length : 1;
  return `${count} ${count === 1 ? singular : plural}`;
};

const projectMappedValue = (value: unknown, mapping: CombinedAuditProjectionMapping): unknown => {
  if (mapping.sourceField.type === "select") return mappedSelectValue(value, mapping.config, mapping.targetField);
  if (mapping.targetField.type === "relation") return countedValue(value, "related record", "related records");
  if (mapping.targetField.type === "file") return countedValue(value, "file", "files");
  return value;
};

export const projectCombinedAuditContext = (value: unknown): CombinedAuditContext | null => {
  if (value === null || value === undefined) return null;
  const parsed = RecordAuditContextSchema.safeParse(value);
  if (!parsed.success) throw new Error("Combined audit history contains invalid mutation context");
  if (parsed.data.answers.some((answer) => answer.type === "select" && !answer.optionLabel)) {
    throw new Error("Combined audit history contains an unlabeled select answer");
  }
  return {
    operation: parsed.data.operation,
    answers: parsed.data.answers.map(({ label, type, required, value: answer, optionLabel }) => ({
      label,
      type,
      required,
      value: type === "select" && optionLabel ? optionLabel : answer,
      ...(optionLabel ? { optionLabel } : {}),
    })),
  };
};

export const projectCombinedAuditDiff = (
  diff: AuditEntry["diff"],
  mappings: readonly CombinedAuditProjectionMapping[],
): AuditEntry["diff"] => {
  if (!diff) return null;
  const projected: NonNullable<AuditEntry["diff"]> = {};
  for (const mapping of mappings) {
    const change = diff[mapping.sourceFieldId];
    if (!change) continue;
    projected[mapping.targetFieldId] = {
      old: projectMappedValue(change.old, mapping),
      new: projectMappedValue(change.new, mapping),
    };
  }
  return Object.keys(projected).length > 0 ? projected : null;
};

const loadProjection = async (tableId: string, fieldIds?: readonly string[]): Promise<Result<Projection>> => {
  const [table, active, targetFields] = await Promise.all([getTable(tableId), getActive(tableId), listFields(tableId)]);
  if (!table || table.kind !== "federated") return fail(err.badInput("Audit projection requires a Combined table"));
  if (!active.ok) return active;

  const revision = active.data;
  const sourceTableIds = revision.sources.map((source) => source.sourceTableId);
  const [sourceFieldsByTable, sourceRows] = await Promise.all([
    listByTables(sourceTableIds),
    sql<Array<{ table_id: string; table_name: string; base_name: string }>>`
      SELECT source_table.id::text AS table_id,
             source_table.name AS table_name,
             source_base.name AS base_name
      FROM grids.tables source_table
      JOIN grids.bases source_base
        ON source_base.id = source_table.base_id
       AND source_base.deleted_at IS NULL
      WHERE source_table.id = ANY(${toPgUuidArray(sourceTableIds)}::uuid[])
        AND source_table.kind = 'stored'
        AND source_table.deleted_at IS NULL
    `,
  ]);
  if (sourceRows.length !== revision.sources.length) {
    return fail(err.conflict("Combined table source is no longer available"));
  }

  const targetFieldsById = new Map(targetFields.filter((field) => !field.deletedAt).map((field) => [field.id, field]));
  const allowedTargetFieldIds = fieldIds ? new Set(fieldIds) : null;
  const sourceLabels = new Map(sourceRows.map((row) => [row.table_id, row]));
  const sources: ProjectionSource[] = [];
  for (const source of revision.sources) {
    const label = sourceLabels.get(source.sourceTableId);
    if (!label) return fail(err.conflict("Combined table source is no longer available"));
    const sourceFields = new Map((sourceFieldsByTable.get(source.sourceTableId) ?? []).map((field) => [field.id, field]));
    const mappings: CombinedAuditProjectionMapping[] = [];
    for (const mapping of revision.mappings) {
      if (mapping.sourceTableId !== source.sourceTableId) continue;
      const targetField = targetFieldsById.get(mapping.targetFieldId);
      if (!targetField) return fail(err.conflict("Combined table mapping is no longer available"));
      const sourceField = sourceFields.get(mapping.sourceFieldId);
      if (!sourceField || sourceField.deletedAt) return fail(err.conflict("Combined table mapping is no longer available"));
      if (allowedTargetFieldIds && !allowedTargetFieldIds.has(mapping.targetFieldId)) continue;
      mappings.push({
        targetFieldId: mapping.targetFieldId,
        targetField,
        sourceFieldId: mapping.sourceFieldId,
        sourceField,
        config: mapping.config,
      });
    }
    sources.push({
      tableId: source.sourceTableId,
      descriptor: {
        ref: String(source.position),
        baseName: label.base_name,
        tableName: label.table_name,
      },
      mappings,
    });
  }

  return ok({
    targetBaseId: table.baseId,
    targetTableId: table.id,
    revisionId: revision.id,
    revisionToken: revision.revisionToken,
    fingerprint: `${revision.id}:${revision.revisionToken}`,
    sources,
  });
};

const resolveOrigin = async (projection: Projection, recordId: string): Promise<Result<CombinedRecordOrigin>> => {
  const fields = await listFields(projection.targetTableId);
  const recordSource = await buildDslSqlRecordSource(
    projection.targetTableId,
    { [projection.targetTableId]: fields },
    { includeDeleted: true },
  );
  if (!recordSource) return fail(err.notFound("Combined record"));
  const rows = await sql<Array<{ source_table_id: string; deleted_at: Date | null }>>`
    SELECT source_table_id::text, deleted_at
    FROM ${recordSource.relation} combined_record
    WHERE combined_record.id = ${recordId}::uuid
    LIMIT 2
  `;
  if (rows.length !== 1) return fail(err.notFound("Combined record"));
  const row = rows[0]!;
  const source = projection.sources.find((item) => item.tableId === row.source_table_id);
  if (!source) return fail(err.conflict("Combined record source is no longer published"));
  return ok({
    source: source.descriptor,
    deletedAt: row.deleted_at ? iso(row.deleted_at) : null,
  });
};

const mapAuditRow = (row: DbRow, projection: Projection): CombinedAuditEntry | null => {
  const source = projection.sources.find((item) => item.tableId === row.table_id);
  if (!source) return null;
  return {
    id: row.id as string,
    baseId: projection.targetBaseId,
    tableId: projection.targetTableId,
    recordId: (row.record_id as string | null) ?? null,
    userId: (row.user_id as string | null) ?? null,
    userDisplayName: (row.user_display_name as string | null) ?? null,
    action: row.action as CombinedRecordAuditAction,
    diff: projectCombinedAuditDiff(parseJsonbRow<AuditEntry["diff"]>(row.diff, null), source.mappings),
    context: projectCombinedAuditContext(parseJsonbRow<unknown>(row.context, null)),
    ip: null,
    userAgent: null,
    createdAt: iso(row.created_at),
    source: source.descriptor,
    recordDeletedAt: row.record_deleted_at ? iso(row.record_deleted_at) : null,
  };
};

export const describeRecord = async (tableId: string, recordId: string): Promise<Result<CombinedRecordOrigin>> => {
  const projection = await loadProjection(tableId);
  if (!projection.ok) return projection;
  return resolveOrigin(projection.data, recordId);
};

export const list = async (params: {
  tableId: string;
  recordId?: string;
  fieldIds?: readonly string[];
  sourceRef?: string;
  action?: CombinedRecordAuditAction;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string | null;
}): Promise<Result<CombinedAuditPage>> => {
  const projectionResult = await loadProjection(params.tableId, params.fieldIds);
  if (!projectionResult.ok) return projectionResult;
  const projection = projectionResult.data;

  let scopedSources = projection.sources;
  if (params.recordId) {
    const origin = await resolveOrigin(projection, params.recordId);
    if (!origin.ok) return origin;
    scopedSources = projection.sources.filter((source) => source.descriptor.ref === origin.data.source.ref);
  }
  if (params.sourceRef !== undefined) {
    scopedSources = scopedSources.filter((source) => source.descriptor.ref === params.sourceRef);
    if (scopedSources.length === 0) return fail(err.badInput("Unknown Combined source filter"));
  }

  const cursor = decodeCursor(params.cursor);
  if (params.cursor && !cursor) return fail(err.badInput("Invalid audit cursor"));
  const cursorFingerprint = auditCursorFingerprint(projection.fingerprint, params);
  if (cursor && cursor.fingerprint !== cursorFingerprint) {
    return fail(err.conflict("Combined audit filters or publication changed; restart the audit search"));
  }

  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const tableIds = scopedSources.map((source) => source.tableId);
  const publishedSourceFieldIds = scopedSources.flatMap((source) => source.mappings.map((mapping) => mapping.sourceFieldId));
  const actions = params.action ? [params.action] : [...RECORD_ACTIONS];
  const rows = await sql<(DbRow & { cursor_created_at: string })[]>`
    SELECT audit.id::text, audit.table_id::text, audit.record_id::text, audit.user_id::text,
           audit.action, audit.diff, audit.context, audit.created_at,
           audit.created_at::text AS cursor_created_at,
           auth_user.uid AS user_display_name,
           current_record.deleted_at AS record_deleted_at
    FROM grids.audit_log audit
    LEFT JOIN auth.users auth_user ON auth_user.id = audit.user_id
    LEFT JOIN grids.records current_record
      ON current_record.table_id = audit.table_id
     AND current_record.id = audit.record_id
    WHERE audit.table_id = ANY(${toPgUuidArray(tableIds)}::uuid[])
      AND audit.record_id IS NOT NULL
      AND audit.action = ANY(${`{${actions.join(",")}}`}::text[])
      AND (
        audit.action <> 'updated'
        OR COALESCE(audit.diff ?| ${toPgTextArray(publishedSourceFieldIds)}::text[], false)
      )
      AND (${params.recordId ?? null}::uuid IS NULL OR audit.record_id = ${params.recordId ?? null}::uuid)
      AND (${params.from ?? null}::timestamptz IS NULL OR audit.created_at >= ${params.from ?? null}::timestamptz)
      AND (${params.to ?? null}::timestamptz IS NULL OR audit.created_at < ${params.to ?? null}::timestamptz)
      AND (
        ${cursor?.createdAt ?? null}::timestamptz IS NULL
        OR (audit.created_at, audit.id) < (${cursor?.createdAt ?? null}::timestamptz, ${cursor?.id ?? null}::uuid)
      )
    ORDER BY audit.created_at DESC, audit.id DESC
    LIMIT ${limit + 1}
  `;
  const currentRevision = await verifyRevisionScope([
    {
      tableId: projection.targetTableId,
      revisionId: projection.revisionId,
      revisionToken: projection.revisionToken,
    },
  ]);
  if (!currentRevision.ok) return currentRevision;
  let mapped: CombinedAuditEntry[];
  try {
    mapped = rows.flatMap((row) => {
      const entry = mapAuditRow(row, projection);
      return entry ? [entry] : [];
    });
  } catch {
    return fail(err.conflict("Combined audit history contains invalid mutation context"));
  }
  const items = mapped.slice(0, limit);
  const lastRow = rows[items.length - 1];
  return ok({
    items,
    sources: projection.sources.map((source) => source.descriptor),
    nextCursor:
      rows.length > limit && lastRow
        ? encodeCursor({
            fingerprint: cursorFingerprint,
            createdAt: lastRow.cursor_created_at,
            id: lastRow.id as string,
          })
        : null,
  });
};

export const listByRecord = async (
  tableId: string,
  recordId: string,
  limit = 50,
  fieldIds?: readonly string[],
): Promise<CombinedAuditEntry[]> => {
  const page = await list({ tableId, recordId, limit, fieldIds });
  if (!page.ok) throw new Error(page.error.message);
  return page.data.items;
};
