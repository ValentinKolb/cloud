import { type DateContext, err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { getRecordWritableFieldType, isRecordWritableFieldType } from "../field-types";
import { logAudit, type SqlClient } from "./audit";
import { listByTable as listFields, materializeFieldDefault } from "./fields";
import { generatedIdRequiresRetry, generateIdValue, isGeneratedIdUniqueCollision } from "./generated-ids";
import { requireTableAlive } from "./parent-checks";
import { type GridsRecordEvent, publishRecordEvent } from "./record-events";
import { buildPersistedUpdateData, buildRecordDiff, mapRecordRow, splitRelationsFromData } from "./record-persistence";
import { get } from "./record-read";
import { type ExpansionViewer, enrichRecordsWithFormulas, validateRelationTargets, writeRecordLinks } from "./relations";
import type { Field, GridRecord } from "./types";

type DbRow = Record<string, unknown>;

const recordVersionConflict = () => ({
  code: "CONFLICT" as const,
  status: 409 as const,
  message: "This record changed since you opened it. Another user or tab may have edited it in the meantime. Reload and try again.",
});

const formatFieldValidationError = (fieldName: string, validationError: string): string =>
  validationError === "required" ? `Field "${fieldName}" is required` : `Field "${fieldName}": ${validationError}`;

const baseIdForTable = async (tableId: string): Promise<string | null> => {
  const [row] = await sql<{ base_id: string }[]>`
    SELECT base_id FROM grids.tables WHERE id = ${tableId}::uuid AND deleted_at IS NULL
  `;
  return row?.base_id ?? null;
};

const emitRecordEvent = async (event: Omit<GridsRecordEvent, "v" | "occurredAt">): Promise<void> => {
  const payload: GridsRecordEvent = { v: 1, occurredAt: new Date().toISOString(), ...event };
  await publishRecordEvent(payload);
};

export const emitCreatedRecordEvent = async (
  tableId: string,
  record: GridRecord,
  changedFieldIds: string[],
  actorId: string | null,
): Promise<void> => {
  const baseId = await baseIdForTable(tableId);
  if (!baseId) return;
  await emitRecordEvent({
    type: "record.created",
    baseId,
    tableId,
    recordId: record.id,
    version: record.version,
    changedFieldIds,
    actorId,
  });
};

/**
 * Pre-flight relation-target existence, batched per targetTableId. The
 * naive shape (one validateRelationTargets call per relation field)
 * makes N round-trips when N fields point at the same target table; the
 * batched shape collapses to one call per distinct target table. The FK
 * inside the write transaction is the actual safety net — this just
 * gives a clean 400 with a useful "missing target records" message
 * instead of letting a 23503 leak through.
 */
const preflightRelationTargets = async (
  relations: Map<string, string[]>, // fieldId -> toIds
  fieldsById: Map<string, Field>,
  client: SqlClient = sql,
): Promise<Result<void>> => {
  // Group all (fieldId, toIds) by their relation field's targetTableId.
  // Track which fields contributed to each group so we can attribute
  // missing-target errors back to the right field name in the message.
  const groups = new Map<string, { ids: Set<string>; fieldNames: string[] }>();
  for (const [fieldId, toIds] of relations) {
    const f = fieldsById.get(fieldId);
    const targetTableId = (f?.config as { targetTableId?: string } | undefined)?.targetTableId;
    if (!targetTableId) continue;
    const g = groups.get(targetTableId) ?? { ids: new Set<string>(), fieldNames: [] };
    for (const id of toIds) g.ids.add(id);
    if (toIds.length > 0 && f) g.fieldNames.push(f.name);
    groups.set(targetTableId, g);
  }

  for (const [targetTableId, group] of groups) {
    const ids = [...group.ids];
    if (ids.length === 0) continue;
    const check = await validateRelationTargets(targetTableId, ids, client);
    if (!check.ok) {
      const fieldNamePart =
        group.fieldNames.length === 1 ? `field "${group.fieldNames[0]}"` : `fields [${group.fieldNames.map((n) => `"${n}"`).join(", ")}]`;
      const noun = check.missing.length === 1 ? "record" : "records";
      return fail(err.badInput(`${fieldNamePart}: linked ${noun} no longer exists`));
    }
  }
  return ok();
};

/**
 * Create-path validation: every user-writable field is materialized using
 * either the provided value or the field's default. Required-checks apply.
 * Generated ID fields receive a server-generated value.
 */
const validateForCreate = async (
  tableId: string,
  payload: Record<string, unknown>,
  options: { dateConfig?: DateContext; client?: SqlClient } = {},
): Promise<Result<Record<string, unknown>>> => {
  const fields = await listFields(tableId);
  const fieldsById = new Map(fields.map((f) => [f.id, f]));

  for (const key of Object.keys(payload)) {
    const field = fieldsById.get(key);
    if (!field) return fail(err.badInput("unknown field"));
    if (!isRecordWritableFieldType(field.type)) {
      return fail(err.badInput(`field "${field.name}" is not user-writable`));
    }
  }

  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.type === "id") {
      out[field.id] = await generateIdValue(field, {
        client: options.client,
        dateConfig: options.dateConfig,
      });
      continue;
    }
    const handler = getRecordWritableFieldType(field.type);
    if (!handler) continue;

    const provided = Object.prototype.hasOwnProperty.call(payload, field.id);
    const raw = provided ? payload[field.id] : materializeFieldDefault(field, { dateConfig: options.dateConfig });
    const result = handler.validate(raw, field.config, field.required);
    if (!result.ok) return fail(err.badInput(formatFieldValidationError(field.name, result.error)));
    if (result.value !== null && result.value !== undefined) {
      out[field.id] = result.value;
    }
  }
  return ok(out);
};

/**
 * Update-path validation: ONLY the fields present in the payload are validated.
 * Omitted fields are left to the merge step in `update()` to preserve existing
 * values. Explicit `null` is a clear-the-field intent and must round-trip.
 */
const validateForUpdate = async (tableId: string, payload: Record<string, unknown>): Promise<Result<Record<string, unknown>>> => {
  const fields = await listFields(tableId);
  const fieldsById = new Map(fields.map((f) => [f.id, f]));

  for (const key of Object.keys(payload)) {
    if (!fieldsById.has(key)) return fail(err.badInput("unknown field"));
  }

  const out: Record<string, unknown> = {};
  for (const [fieldId, raw] of Object.entries(payload)) {
    const field = fieldsById.get(fieldId)!;
    const handler = getRecordWritableFieldType(field.type);
    if (!handler) {
      return fail(err.badInput(`field "${field.name}" is not user-writable`));
    }
    const result = handler.validate(raw, field.config, field.required);
    if (!result.ok) return fail(err.badInput(formatFieldValidationError(field.name, result.error)));
    out[fieldId] = result.value;
  }
  return ok(out);
};

type CreateRecordInTransactionResult = {
  record: GridRecord;
  changedFieldIds: string[];
};

export const createInTransaction = async (
  client: SqlClient,
  tableId: string,
  payload: Record<string, unknown>,
  actorId: string | null,
  opts: {
    bypassDirectInsertCheck?: boolean;
    dateConfig?: DateContext;
  } = {},
): Promise<Result<CreateRecordInTransactionResult>> => {
  const parentAlive = await requireTableAlive(tableId);
  if (!parentAlive.ok) return parentAlive;

  if (!opts.bypassDirectInsertCheck) {
    const [row] = await client<{ disable_direct_insert: boolean }[]>`
      SELECT disable_direct_insert FROM grids.tables WHERE id = ${tableId}::uuid AND deleted_at IS NULL
    `;
    if (row?.disable_direct_insert) {
      return fail(err.forbidden("Direct insert is disabled for this table; records can only be added via a form."));
    }
  }

  const fields = await listFields(tableId);
  const fieldsById = new Map(fields.map((f) => [f.id, f]));
  const hasRetryGeneratedId = fields.some(generatedIdRequiresRetry);
  const maxAttempts = hasRetryGeneratedId ? 10 : 1;
  let row: DbRow | undefined;
  let id = "";
  let validated: Result<Record<string, unknown>> | null = null;
  let split: { data: Record<string, unknown>; relations: Map<string, string[]> } | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    validated = await validateForCreate(tableId, payload, {
      dateConfig: opts.dateConfig,
      client,
    });
    if (!validated.ok) return validated;

    split = splitRelationsFromData(validated.data, fields);
    const preflight = await preflightRelationTargets(split.relations, fieldsById, client);
    if (!preflight.ok) return preflight;

    id = Bun.randomUUIDv7();
    if (hasRetryGeneratedId) await client`SAVEPOINT grids_generated_id_insert`;
    try {
      const rows = await client<DbRow[]>`
        INSERT INTO grids.records (id, table_id, data, version, created_by, updated_by)
        VALUES (
          ${id}::uuid,
          ${tableId}::uuid,
          ${split.data}::jsonb,
          1,
          ${actorId}::uuid,
          ${actorId}::uuid
        )
        RETURNING *
      `;
      row = rows[0];
      if (hasRetryGeneratedId) await client`RELEASE SAVEPOINT grids_generated_id_insert`;
      break;
    } catch (e) {
      if (hasRetryGeneratedId) {
        await client`ROLLBACK TO SAVEPOINT grids_generated_id_insert`;
        await client`RELEASE SAVEPOINT grids_generated_id_insert`;
        if (isGeneratedIdUniqueCollision(e, fields)) continue;
      }
      throw e;
    }
  }
  if (!row && hasRetryGeneratedId) return fail(err.conflict("Could not generate a unique ID. Try again."));
  if (!row) throw new Error("insert returned no row");
  if (!validated?.ok || !split) throw new Error("record create validation state missing");

  for (const [fieldId, toIds] of split.relations) {
    await writeRecordLinks(id, fieldId, toIds, client);
  }

  await logAudit(
    {
      tableId,
      recordId: id,
      userId: actorId,
      action: "created",
      diff: Object.fromEntries(Object.entries(validated.data).map(([k, v]) => [k, { old: null, new: v }])),
    },
    client,
  );

  const record = mapRecordRow(row);
  for (const [fieldId, toIds] of split.relations) {
    record.data[fieldId] = toIds;
  }
  enrichRecordsWithFormulas([record], fields, { dateConfig: opts.dateConfig });

  return ok({ record, changedFieldIds: Object.keys(validated.data) });
};

export const create = async (
  tableId: string,
  payload: Record<string, unknown>,
  actorId: string | null,
  opts: {
    bypassDirectInsertCheck?: boolean;
    includeRelations?: boolean;
    viewer?: ExpansionViewer;
    dateConfig?: DateContext;
  } = {},
): Promise<Result<GridRecord>> => {
  const created = await sql.begin((tx) =>
    createInTransaction(tx, tableId, payload, actorId, {
      bypassDirectInsertCheck: opts.bypassDirectInsertCheck,
      dateConfig: opts.dateConfig,
    }),
  );
  if (!created.ok) return created;
  const record = await get(tableId, created.data.record.id, opts);
  if (!record) return fail(err.notFound("Record"));
  await emitCreatedRecordEvent(tableId, record, created.data.changedFieldIds, actorId);
  return ok(record);
};

export const createMany = async (
  tableId: string,
  payloads: Record<string, unknown>[],
  actorId: string | null,
  opts: {
    bypassDirectInsertCheck?: boolean;
    includeRelations?: boolean;
    viewer?: ExpansionViewer;
    dateConfig?: DateContext;
  } = {},
): Promise<Result<GridRecord[]>> => {
  if (payloads.length === 0) return ok([]);
  type RollbackError = Error & { result: Result<CreateRecordInTransactionResult[]> };
  const created = await sql
    .begin(async (tx) => {
      const results: CreateRecordInTransactionResult[] = [];
      for (const payload of payloads) {
        const result = await createInTransaction(tx, tableId, payload, actorId, {
          bypassDirectInsertCheck: opts.bypassDirectInsertCheck,
          dateConfig: opts.dateConfig,
        });
        if (!result.ok) {
          const rollback = new Error(result.error.message) as RollbackError;
          rollback.result = result as Result<CreateRecordInTransactionResult[]>;
          throw rollback;
        }
        results.push(result.data);
      }
      return ok(results);
    })
    .catch((error: unknown) => {
      if (error && typeof error === "object" && "result" in error) return (error as RollbackError).result;
      throw error;
    });
  if (!created.ok) return created;

  const records: GridRecord[] = [];
  for (const item of created.data) {
    const record = await get(tableId, item.record.id, opts);
    if (!record) return fail(err.notFound("Record"));
    records.push(record);
    await emitCreatedRecordEvent(tableId, record, item.changedFieldIds, actorId);
  }
  return ok(records);
};

export const update = async (
  tableId: string,
  recordId: string,
  payload: Record<string, unknown>,
  actorId: string | null,
  ifMatchVersion?: number,
  opts: { includeRelations?: boolean; viewer?: ExpansionViewer; dateConfig?: DateContext } = {},
): Promise<Result<GridRecord>> => {
  const existing = await get(tableId, recordId);
  if (!existing || existing.deletedAt) return fail(err.notFound("Record"));
  if (ifMatchVersion !== undefined && ifMatchVersion !== existing.version) {
    return fail(recordVersionConflict());
  }

  const validated = await validateForUpdate(tableId, payload);
  if (!validated.ok) return validated;

  const fields = await listFields(tableId);
  const split = splitRelationsFromData(validated.data, fields);

  // Pre-flight relation-target existence check (same reasoning as create).
  // Batched per target table; runs outside the write transaction.
  const fieldsById = new Map(fields.map((f) => [f.id, f]));
  const preflight = await preflightRelationTargets(split.relations, fieldsById);
  if (!preflight.ok) return preflight;

  // Merge: existing JSONB data + only the validated NON-RELATION fields.
  // Relations are managed exclusively via record_links — they MUST NOT
  // re-enter the JSONB blob (otherwise the hydration step on read
  // would have to special-case "JSONB takes precedence" semantics).
  const merged = buildPersistedUpdateData(existing.data, split.data, fields);

  // Build the diff up front so we can pass it into the transaction.
  const diff = buildRecordDiff(existing.data, validated.data);

  // ATOMIC: row UPDATE + relation link writes + audit in one transaction.
  // The version-check WHERE clause still gives us the optimistic-lock
  // semantics; if it fires, no link writes happen.
  const txResult = await sql
    .begin(async (tx) => {
      const [r] = await tx<DbRow[]>`
      UPDATE grids.records
      SET data = ${merged}::jsonb,
          version = version + 1,
          updated_by = ${actorId}::uuid,
          updated_at = now()
      WHERE id = ${recordId}::uuid
        AND table_id = ${tableId}::uuid
        AND deleted_at IS NULL
        AND version = ${existing.version}
      RETURNING *
    `;
      if (!r) {
        // Trigger rollback by throwing a sentinel; caller catches it and
        // converts to err.conflict. (`fail(...)` from inside a tx would
        // commit because bun.sql treats only thrown errors as rollback.)
        const e = new Error("VERSION_CONFLICT");
        (e as Error & { __versionConflict: true }).__versionConflict = true;
        throw e;
      }

      for (const [fieldId, toIds] of split.relations) {
        await writeRecordLinks(recordId, fieldId, toIds, tx);
      }

      if (Object.keys(diff).length > 0) {
        await logAudit({ tableId, recordId, userId: actorId, action: "updated", diff }, tx);
      }
      return r;
    })
    .catch((e: unknown) => {
      if ((e as { __versionConflict?: true })?.__versionConflict) return null;
      throw e;
    });
  if (!txResult) return fail(recordVersionConflict());

  const record = await get(tableId, recordId, opts);
  if (!record) return fail(err.notFound("Record"));
  const baseId = await baseIdForTable(tableId);
  if (baseId) {
    await emitRecordEvent({
      type: "record.updated",
      baseId,
      tableId,
      recordId: record.id,
      version: record.version,
      changedFieldIds: Object.keys(diff),
      actorId,
    });
  }
  return ok(record);
};

export const softDelete = async (tableId: string, recordId: string, actorId: string | null): Promise<Result<void>> => {
  const existing = await get(tableId, recordId);
  const deleted = await sql.begin(async (tx) => {
    const result = await tx`
      UPDATE grids.records
      SET deleted_at = now(), updated_by = ${actorId}::uuid, updated_at = now()
      WHERE id = ${recordId}::uuid AND table_id = ${tableId}::uuid AND deleted_at IS NULL
    `;
    if (result.count === 0) return false;
    await logAudit({ tableId, recordId, userId: actorId, action: "deleted" }, tx);
    return true;
  });
  if (!deleted) return fail(err.notFound("Record"));
  const baseId = await baseIdForTable(tableId);
  if (baseId) {
    await emitRecordEvent({
      type: "record.deleted",
      baseId,
      tableId,
      recordId,
      version: existing?.version ?? null,
      changedFieldIds: existing ? Object.keys(existing.data) : [],
      actorId,
    });
  }
  return ok();
};

export const restore = async (tableId: string, recordId: string, actorId: string | null): Promise<Result<void>> => {
  // Top-down restore: the parent table + base must be alive. Refusing
  // the restore here is more honest than UPDATEing a record that the
  // user can't read afterward (live-parent invariant).
  const parentAlive = await requireTableAlive(tableId);
  if (!parentAlive.ok) return parentAlive;

  const restored = await sql.begin(async (tx) => {
    const result = await tx`
      UPDATE grids.records
      SET deleted_at = NULL, updated_by = ${actorId}::uuid, updated_at = now()
      WHERE id = ${recordId}::uuid AND table_id = ${tableId}::uuid AND deleted_at IS NOT NULL
    `;
    if (result.count === 0) return false;
    await logAudit({ tableId, recordId, userId: actorId, action: "restored" }, tx);
    return true;
  });
  if (!restored) return fail(err.notFound("Record"));
  const baseId = await baseIdForTable(tableId);
  if (baseId) {
    await emitRecordEvent({
      type: "record.restored",
      baseId,
      tableId,
      recordId,
      version: null,
      changedFieldIds: [],
      actorId,
    });
  }
  return ok();
};
