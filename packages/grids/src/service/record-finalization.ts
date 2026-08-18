import { type DateContext, err, fail, ok, type Result } from "@k2b/stdlib";
import { sql } from "bun";
import { getRecordWritableFieldType } from "../field-types";
import { logAudit, type SqlClient } from "./audit";
import { captureRecordRevision, prepareRecordMutation } from "./durable-history";
import { listByTable as listFields } from "./fields";
import { allocateNumberInTransaction, bindNumberAllocation } from "./number-series";
import { requireStoredTableWritable } from "./parent-checks";
import { type AuthorizedRecordAccess, recordAccessPredicate } from "./record-access";
import { captureRecordEventSnapshot, enqueueRecordEvent, notifyRecordEventOutbox } from "./record-event-outbox";
import { mapRecordRow } from "./record-persistence";
import { get as getRecord } from "./record-read";
import type { Field, GridRecord } from "./types";

export const finalizedRecordConflict = () => err.conflict("This record is finalized and cannot be changed.");

export type RecordFinalizationStatus =
  | { enabled: false; durableHistory: "disabled" | "activating" | "active" }
  | { enabled: true; durableHistory: "active"; enabledAt: string; finalizedCount: number; canDisable: boolean };

export type FinalizationRequirement = { fieldId: string; fieldName: string; message: string };
export type RecordFinalizationReadiness = {
  enabled: boolean;
  finalized: boolean;
  finalizedAt: string | null;
  missing: FinalizationRequirement[];
  assignedOnFinalization: Array<{ fieldId: string; fieldName: string }>;
};

const iso = (value: Date | string): string => (value instanceof Date ? value.toISOString() : new Date(value).toISOString());

export const assertRecordMutable = async (client: SqlClient, tableId: string, recordId: string): Promise<Result<void>> => {
  const [record] = await client<Array<{ finalized_at: Date | string | null }>>`
    SELECT finalized_at
    FROM grids.records
    WHERE id = ${recordId}::uuid AND table_id = ${tableId}::uuid
    FOR UPDATE
  `;
  if (!record) return fail(err.notFound("Record"));
  return record.finalized_at ? fail(finalizedRecordConflict()) : ok();
};

export const getStatus = async (tableId: string, client: SqlClient = sql): Promise<Result<RecordFinalizationStatus>> => {
  const writable = await requireStoredTableWritable(tableId, client);
  if (!writable.ok) return writable;
  const [row] = await client<
    Array<{
      enabled_at: Date | string | null;
      history_status: "activating" | "active" | null;
      finalized_count: number;
    }>
  >`
    SELECT activation.enabled_at,
           history.status AS history_status,
           COUNT(record.id) FILTER (WHERE record.finalized_at IS NOT NULL)::int AS finalized_count
    FROM grids.tables table_ref
    LEFT JOIN grids.durable_history_activations history ON history.table_id = table_ref.id
    LEFT JOIN grids.table_finalization_activations activation ON activation.table_id = table_ref.id
    LEFT JOIN grids.records record ON record.table_id = table_ref.id
    WHERE table_ref.id = ${tableId}::uuid AND table_ref.deleted_at IS NULL
    GROUP BY activation.enabled_at, history.status
  `;
  if (!row) return fail(err.notFound("Table"));
  const durableHistory = row.history_status ?? "disabled";
  if (!row.enabled_at) return ok({ enabled: false, durableHistory });
  const finalizedCount = Number(row.finalized_count);
  return ok({ enabled: true, durableHistory: "active", enabledAt: iso(row.enabled_at), finalizedCount, canDisable: finalizedCount === 0 });
};

export const enable = async (tableId: string, actorId: string | null): Promise<Result<RecordFinalizationStatus>> =>
  sql.begin(async (tx): Promise<Result<RecordFinalizationStatus>> => {
    const writable = await requireStoredTableWritable(tableId, tx);
    if (!writable.ok) return writable;
    const [history] = await tx<Array<{ status: string }>>`
      SELECT status FROM grids.durable_history_activations WHERE table_id = ${tableId}::uuid FOR SHARE
    `;
    if (history?.status !== "active")
      return fail(err.badInput("Durable History must finish its baseline before Finalization can be enabled."));
    const inserted = await tx`
      INSERT INTO grids.table_finalization_activations (table_id, enabled_by)
      VALUES (${tableId}::uuid, ${actorId}::uuid)
      ON CONFLICT (table_id) DO NOTHING
      RETURNING table_id
    `;
    if (inserted.length > 0) await logAudit({ tableId, userId: actorId, action: "finalization.enabled" }, tx);
    return getStatus(tableId, tx);
  });

export const disable = async (tableId: string, actorId: string | null): Promise<Result<RecordFinalizationStatus>> =>
  sql.begin(async (tx): Promise<Result<RecordFinalizationStatus>> => {
    const [activation] = await tx<Array<{ table_id: string }>>`
      SELECT table_id::text FROM grids.table_finalization_activations WHERE table_id = ${tableId}::uuid FOR UPDATE
    `;
    if (!activation) return getStatus(tableId, tx);
    const [records] = await tx<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count FROM grids.records WHERE table_id = ${tableId}::uuid AND finalized_at IS NOT NULL
    `;
    if ((records?.count ?? 0) > 0) return fail(err.conflict("Finalization cannot be disabled after the first record is finalized."));
    const [finalizationFields] = await tx<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM grids.fields
      WHERE table_id = ${tableId}::uuid AND deleted_at IS NULL AND type = 'id' AND config->>'assignment' = 'finalization'
    `;
    if ((finalizationFields?.count ?? 0) > 0) {
      return fail(err.conflict("Change every ID field to assign on record creation before disabling Finalization."));
    }
    await tx`DELETE FROM grids.table_finalization_activations WHERE table_id = ${tableId}::uuid`;
    await logAudit({ tableId, userId: actorId, action: "finalization.disabled" }, tx);
    return getStatus(tableId, tx);
  });

const loadRecordValues = async (
  client: SqlClient,
  tableId: string,
  recordId: string,
  recordAccess?: AuthorizedRecordAccess,
): Promise<{ row: Record<string, unknown>; data: Record<string, unknown> } | null> => {
  const [row] = await client<Array<Record<string, unknown>>>`
    SELECT record.*
    FROM grids.records record
    WHERE record.id = ${recordId}::uuid AND record.table_id = ${tableId}::uuid
      AND record.deleted_at IS NULL AND ${recordAccessPredicate(recordAccess, "record")}
  `;
  if (!row) return null;
  const data = { ...mapRecordRow(row).data };
  const relations = await client<Array<{ field_id: string; record_ids: string[] }>>`
    SELECT from_field_id::text AS field_id, array_agg(to_record_id::text ORDER BY position, to_record_id) AS record_ids
    FROM grids.record_links WHERE from_record_id = ${recordId}::uuid GROUP BY from_field_id
  `;
  for (const relation of relations) data[relation.field_id] = relation.record_ids;
  return { row, data };
};

const requirements = async (
  client: SqlClient,
  recordId: string,
  fields: Field[],
  data: Record<string, unknown>,
): Promise<{ missing: FinalizationRequirement[]; assignedOnFinalization: Array<{ fieldId: string; fieldName: string }> }> => {
  const missing: FinalizationRequirement[] = [];
  const assignedOnFinalization: Array<{ fieldId: string; fieldName: string }> = [];
  const invalidRelations = new Set(
    (
      await client<Array<{ field_id: string }>>`
        SELECT DISTINCT link.from_field_id::text AS field_id
        FROM grids.record_links link
        JOIN grids.fields field ON field.id = link.from_field_id AND field.deleted_at IS NULL
        LEFT JOIN grids.records target ON target.id = link.to_record_id
          AND target.table_id::text = field.config->>'targetTableId'
          AND target.deleted_at IS NULL
        LEFT JOIN grids.tables target_table ON target_table.id = target.table_id AND target_table.deleted_at IS NULL
        LEFT JOIN grids.bases target_base ON target_base.id = target_table.base_id AND target_base.deleted_at IS NULL
        WHERE link.from_record_id = ${recordId}::uuid
          AND (target.id IS NULL OR target_table.id IS NULL OR target_base.id IS NULL)
      `
    ).map((row) => row.field_id),
  );
  for (const field of fields) {
    if (field.type === "id") {
      if (data[field.id] != null) continue;
      if ((field.config as { assignment?: string }).assignment === "finalization") {
        assignedOnFinalization.push({ fieldId: field.id, fieldName: field.name });
      } else {
        missing.push({ fieldId: field.id, fieldName: field.name, message: "The generated ID is missing." });
      }
      continue;
    }
    if (field.type === "file") {
      if (!field.required) continue;
      const [count] = await client<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS count FROM grids.file_attachments
        WHERE record_id = ${recordId}::uuid AND field_id = ${field.id}::uuid
      `;
      if ((count?.count ?? 0) === 0) missing.push({ fieldId: field.id, fieldName: field.name, message: "A file is required." });
      continue;
    }
    if (field.type === "relation" && invalidRelations.has(field.id)) {
      missing.push({ fieldId: field.id, fieldName: field.name, message: "A linked record is no longer available." });
      continue;
    }
    const handler = getRecordWritableFieldType(field.type);
    if (!handler) continue;
    const result = handler.validate(data[field.id], field.config, field.required);
    if (!result.ok) {
      missing.push({
        fieldId: field.id,
        fieldName: field.name,
        message: result.error === "required" ? "A value is required." : result.error,
      });
    }
  }
  return { missing, assignedOnFinalization };
};

export const inspect = async (params: {
  tableId: string;
  recordId: string;
  recordAccess?: AuthorizedRecordAccess;
  client?: SqlClient;
}): Promise<Result<RecordFinalizationReadiness>> => {
  const client = params.client ?? sql;
  const status = await getStatus(params.tableId, client);
  if (!status.ok) return status;
  const record = await loadRecordValues(client, params.tableId, params.recordId, params.recordAccess);
  if (!record) return fail(err.notFound("Record"));
  const finalizedAt = record.row.finalized_at ? iso(record.row.finalized_at as Date | string) : null;
  const fields = await listFields(params.tableId, false, client);
  const checked = await requirements(client, params.recordId, fields, record.data);
  return ok({ enabled: status.data.enabled, finalized: finalizedAt !== null, finalizedAt, ...checked });
};

export const finalizeInTransaction = async (
  client: SqlClient,
  params: {
    tableId: string;
    recordId: string;
    actorId: string | null;
    recordAccess?: AuthorizedRecordAccess;
    dateConfig?: DateContext;
  },
): Promise<Result<{ record: GridRecord; outboxId: string | null }>> => {
  const writable = await requireStoredTableWritable(params.tableId, client);
  if (!writable.ok) return writable;
  const [target] = await client<Array<{ id: string }>>`
    SELECT record.id::text
    FROM grids.records record
    WHERE record.id = ${params.recordId}::uuid AND record.table_id = ${params.tableId}::uuid
      AND record.deleted_at IS NULL AND ${recordAccessPredicate(params.recordAccess, "record")}
  `;
  if (!target) return fail(err.notFound("Record"));
  const [activation] = await client<Array<{ table_id: string }>>`
    SELECT table_id::text FROM grids.table_finalization_activations
    WHERE table_id = ${params.tableId}::uuid FOR SHARE
  `;
  if (!activation) return fail(err.badInput("Finalization is not enabled for this table."));
  await prepareRecordMutation(client, params.tableId, params.recordId);
  const record = await loadRecordValues(client, params.tableId, params.recordId, params.recordAccess);
  if (!record) return fail(err.notFound("Record"));
  if (record.row.finalized_at) return ok({ record: mapRecordRow(record.row), outboxId: null });

  const fields = await listFields(params.tableId, false, client);
  const checked = await requirements(client, params.recordId, fields, record.data);
  if (checked.missing.length > 0) {
    return fail(err.badInput(`Record is not ready to finalize: ${checked.missing.map((item) => item.fieldName).join(", ")}.`));
  }

  const data = { ...mapRecordRow(record.row).data };
  const allocations: Array<{ id: string; fieldId: string; value: string }> = [];
  for (const field of fields) {
    if (field.type !== "id" || (field.config as { assignment?: string }).assignment !== "finalization" || data[field.id] != null) continue;
    const allocation = await allocateNumberInTransaction({
      client,
      owner: { kind: "field", id: field.id },
      expectedAssignment: "finalization",
      dateConfig: params.dateConfig,
    });
    data[field.id] = allocation.renderedValue;
    allocations.push({ id: allocation.id, fieldId: field.id, value: allocation.renderedValue });
  }

  const changedFieldIds = allocations.map((allocation) => allocation.fieldId);
  const nextVersion = Number(record.row.version) + 1;
  const [updated] = await client<Array<Record<string, unknown>>>`
    UPDATE grids.records
    SET data = ${data}::jsonb, version = ${nextVersion}, updated_by = ${params.actorId}::uuid, updated_at = now()
    WHERE id = ${params.recordId}::uuid AND table_id = ${params.tableId}::uuid
      AND deleted_at IS NULL AND finalized_at IS NULL
      AND ${recordAccessPredicate(params.recordAccess, "grids.records")}
    RETURNING *
  `;
  if (!updated) return fail(finalizedRecordConflict());
  for (const allocation of allocations) await bindNumberAllocation(client, allocation.id, { kind: "record", id: params.recordId });
  const revision = await captureRecordRevision(client, {
    tableId: params.tableId,
    recordId: params.recordId,
    action: "finalized",
    changedFieldIds,
    actorId: params.actorId,
    schemaFields: fields,
  });
  if (!revision) throw new Error("Finalization requires active Durable History.");
  const [finalized] = await client<Array<Record<string, unknown>>>`
    UPDATE grids.records
    SET finalized_at = now(), finalized_by = ${params.actorId}::uuid, final_revision_id = ${revision.id}::uuid
    WHERE id = ${params.recordId}::uuid AND finalized_at IS NULL
    RETURNING *
  `;
  if (!finalized) throw new Error("record finalization marker was not written");
  const outboxId = await enqueueRecordEvent(client, {
    type: "record.finalized",
    baseId: (await client<Array<{ base_id: string }>>`SELECT base_id::text FROM grids.tables WHERE id = ${params.tableId}::uuid`)[0]!
      .base_id,
    tableId: params.tableId,
    recordId: params.recordId,
    version: nextVersion,
    changedFieldIds,
    actorId: params.actorId,
  });
  await captureRecordEventSnapshot(client, {
    snapshotId: outboxId,
    tableId: params.tableId,
    recordId: params.recordId,
    eventType: "record.finalized",
  });
  await logAudit({ tableId: params.tableId, recordId: params.recordId, userId: params.actorId, action: "finalized" }, client);
  return ok({ record: mapRecordRow(finalized), outboxId });
};

export const finalize = async (params: {
  tableId: string;
  recordId: string;
  actorId: string | null;
  recordAccess?: AuthorizedRecordAccess;
  dateConfig?: DateContext;
}): Promise<Result<GridRecord>> => {
  const result = await sql.begin((tx) => finalizeInTransaction(tx, params));
  if (!result.ok) return result;
  if (result.data.outboxId) notifyRecordEventOutbox(result.data.outboxId);
  const record = await getRecord(params.tableId, params.recordId, {
    recordAccess: params.recordAccess,
    dateConfig: params.dateConfig,
  });
  return record ? ok(record) : fail(err.notFound("Record"));
};
