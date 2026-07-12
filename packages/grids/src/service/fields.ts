import { toPgUuidArray } from "@valentinkolb/cloud/services";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { isKnownFieldType } from "../field-types";
import { normalizeRefKey } from "../ref-syntax";
import { logAudit, type SqlClient } from "./audit";
import {
  dropFieldIndex,
  dropFieldUniqueIndex,
  dropGeneratedIdSequences,
  ensureFieldIndex,
  ensureFieldUniqueIndex,
  findUniqueConflicts,
  isUniqueable,
} from "./field-indexes";
import { get, mapFieldRow } from "./field-read";
import { materializeFieldDefault, validateDefaultValue, validateFieldConfig, validateLinkOrComputedConfig } from "./field-validation";
import { emitTableMetadataEvent } from "./metadata-events";
import { namedResourceConflict, writeNamedResource } from "./named-resource-conflict";
import { rewriteFieldNameReferences } from "./reference-renames";
import { insertWithShortId } from "./short-id";
import type { CreateFieldInput, Field, UpdateFieldInput } from "./types";

type DbRow = Record<string, unknown>;

type FieldUpdateState = {
  name: string;
  description: string | null;
  icon: string | null;
  config: Record<string, unknown>;
  position: number;
  required: boolean;
  presentable: boolean;
  hideInTable: boolean;
  defaultValue: unknown;
  indexed: boolean;
  uniqueConstraint: boolean;
};

const updatedNullableText = (value: string | null | undefined, current: string | null): string | null => {
  if (value === undefined) return current;
  return typeof value === "string" ? value.trim() || null : null;
};

const ensureUniqueFieldName = async (tableId: string, name: string, exceptFieldId: string | null = null): Promise<Result<void>> => {
  const [row] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM grids.fields
    WHERE table_id = ${tableId}::uuid
      AND deleted_at IS NULL
      AND lower(trim(name)) = ${normalizeRefKey(name)}
      AND (${exceptFieldId}::uuid IS NULL OR id <> ${exceptFieldId}::uuid)
  `;
  return (row?.count ?? 0) === 0 ? ok() : fail(err.conflict("field name must be unique within this table"));
};

export const create = async (input: CreateFieldInput, actorId: string | null): Promise<Result<Field>> => {
  const name = input.name.trim();
  if (name.length === 0) return fail(err.badInput("name required"));
  if (!isKnownFieldType(input.type)) return fail(err.badInput(`unknown field type "${input.type}"`));
  const uniqueName = await ensureUniqueFieldName(input.tableId, name);
  if (!uniqueName.ok) return uniqueName;

  const rawConfig = input.config ?? {};
  const cfgValidation = validateFieldConfig(input.type, rawConfig);
  if (!cfgValidation.ok) return cfgValidation;
  const config = cfgValidation.data as Record<string, unknown>;
  // Relation and computed configs reference persisted resources, so their
  // cross-table invariants require database context after shape validation.
  const linkValidation = await validateLinkOrComputedConfig(input.type, config, input.tableId);
  if (!linkValidation.ok) return linkValidation;

  // Validate the default value against the type, if provided.
  const defaultValid = validateDefaultValue(input.type, config, input.defaultValue);
  if (!defaultValid.ok) return defaultValid;
  const defaultValue = defaultValid.data;

  const description = input.description?.trim() || null;
  const icon = input.icon?.trim() || null;
  // bun.sql passes primitive JS values (boolean / number / string) as
  // their native PG types — Postgres can't cast `true` directly to
  // jsonb. JSON.stringify on the wrapper produces a valid JSONB literal
  // for primitives (`true`, `42`, `"hello"`) and keeps objects working.
  const defaultValueJsonb = defaultValue === undefined || defaultValue === null ? null : JSON.stringify(defaultValue);
  const uniqueConstraint = input.type === "id" ? true : (input.uniqueConstraint ?? false);

  const inserted = await writeNamedResource(
    () =>
      insertWithShortId<DbRow>(async (shortId) => {
        const [r] = await sql<DbRow[]>`
      INSERT INTO grids.fields (
        short_id, table_id, name, description, icon, type, config, position, required,
        presentable, hide_in_table, default_value, indexed, unique_constraint
      )
      VALUES (
        ${shortId},
        ${input.tableId}::uuid,
        ${name},
        -- bun.sql can't infer the type of a literal NULL; cast keeps the
        -- INSERT working when the user creates a field without a description.
        ${description}::text,
        ${icon}::text,
        ${input.type},
        ${config}::jsonb,
        COALESCE(${input.position ?? null}::int, (SELECT COALESCE(MAX(position) + 1, 0) FROM grids.fields WHERE table_id = ${input.tableId}::uuid AND deleted_at IS NULL)),
        ${input.required ?? false},
        ${input.presentable ?? false},
        ${input.hideInTable ?? false},
        ${defaultValueJsonb}::jsonb,
        ${input.indexed ?? false},
        ${uniqueConstraint}
      )
      RETURNING *
      `;
        if (!r) throw new Error("insert returned no row");
        return r;
      }, "idx_grids_fields_short_id"),
    "idx_grids_fields_live_name",
    "field name must be unique within this table",
  );
  if (!inserted.ok) return inserted;
  const field = mapFieldRow(inserted.data);

  await logAudit({
    tableId: input.tableId,
    userId: actorId,
    action: "created",
    diff: { field: { old: null, new: { id: field.id, name: field.name, type: field.type } } },
  });

  // CONCURRENTLY-built filterable index fires after the row commits.
  // Failures don't block create — they're logged so the user can
  // re-toggle (filterable indexes are nice-to-have for performance,
  // not correctness — fields work without them).
  if (field.indexed) {
    void ensureFieldIndex(field.id, field.type, field.tableId, field.config);
  }
  // Unique-constraint indexes ARE correctness-critical: if the build
  // fails, the row claiming `unique_constraint = true` would lie about
  // enforcement. Await + roll back the metadata flag on failure.
  if (field.uniqueConstraint && isUniqueable(field.type)) {
    try {
      await ensureFieldUniqueIndex(field.id, field.type, field.tableId);
    } catch (e) {
      await sql`UPDATE grids.fields SET unique_constraint = FALSE WHERE id = ${field.id}::uuid`;
      return fail(err.internal(`field created but unique-constraint index build failed: ${(e as Error).message}`));
    }
  }

  await emitTableMetadataEvent(input.tableId, {
    type: "field.created",
    resource: { kind: "field", id: field.id, tableId: input.tableId },
    actorId,
  });
  return ok(field);
};

const validateFieldUpdate = async (existing: Field, input: UpdateFieldInput): Promise<Result<FieldUpdateState>> => {
  const name = input.name?.trim();
  if (name !== undefined && name.length === 0) return fail(err.badInput("name cannot be empty"));

  const rawConfig = input.config !== undefined ? input.config : existing.config;
  const cfgValidation = validateFieldConfig(existing.type, rawConfig);
  if (!cfgValidation.ok) return cfgValidation;
  const config = cfgValidation.data as Record<string, unknown>;
  // Same-base + cross-table consistency on every update path. Important:
  // the user can't change `tableId` after creation, so the source-table
  // scope is stable, but config keys (targetTableId / relationFieldId /
  // targetFieldId) ARE editable — re-validate.
  const linkValidation = await validateLinkOrComputedConfig(existing.type, config as Record<string, unknown>, existing.tableId);
  if (!linkValidation.ok) return linkValidation;

  const rawDefaultValue = input.defaultValue !== undefined ? input.defaultValue : existing.defaultValue;
  const defaultValid = validateDefaultValue(existing.type, config as Record<string, unknown>, rawDefaultValue);
  if (!defaultValid.ok) return defaultValid;

  return ok({
    name: name ?? existing.name,
    // Empty string in description input → store null (clears the helper).
    description: updatedNullableText(input.description, existing.description),
    icon: updatedNullableText(input.icon, existing.icon ?? null),
    config,
    position: input.position ?? existing.position,
    required: input.required ?? existing.required,
    presentable: input.presentable ?? existing.presentable,
    hideInTable: input.hideInTable ?? existing.hideInTable,
    defaultValue: defaultValid.data,
    indexed: input.indexed ?? existing.indexed,
    uniqueConstraint: existing.type === "id" ? true : (input.uniqueConstraint ?? existing.uniqueConstraint),
  });
};

const ensureUniqueToggleAllowed = async (fieldId: string, existing: Field, input: UpdateFieldInput): Promise<Result<void>> => {
  // Pre-flight conflict check so users get a clean 409 before the unique
  // index build could fail with a generic Postgres duplicate-key error.
  if (input.uniqueConstraint === true && !existing.uniqueConstraint) {
    if (!isUniqueable(existing.type)) {
      return fail(err.badInput(`unique_constraint not supported for type "${existing.type}" (use a scalar type)`));
    }
    const conflicts = await findUniqueConflicts(fieldId, existing.tableId);
    if (conflicts.length > 0) {
      return fail(
        err.conflict(
          `unique_constraint cannot be enabled — duplicate values: ${conflicts.slice(0, 5).join(", ")}${conflicts.length > 5 ? ` (+${conflicts.length - 5} more)` : ""}`,
        ),
      );
    }
  }
  return ok();
};

const persistFieldUpdate = async (id: string, next: FieldUpdateState, client: SqlClient = sql): Promise<Result<Field>> => {
  // Same primitive-to-JSONB stringify dance as create.
  const nextDefaultValueJsonb = next.defaultValue === undefined || next.defaultValue === null ? null : JSON.stringify(next.defaultValue);
  const [row] = await client<DbRow[]>`
    UPDATE grids.fields
    SET name = ${next.name},
        description = ${next.description}::text,
        icon = ${next.icon}::text,
        config = ${next.config}::jsonb,
        position = ${next.position},
        required = ${next.required},
        presentable = ${next.presentable},
        hide_in_table = ${next.hideInTable},
        default_value = ${nextDefaultValueJsonb}::jsonb,
        indexed = ${next.indexed},
        unique_constraint = ${next.uniqueConstraint},
        updated_at = now()
    WHERE id = ${id}::uuid
    RETURNING *
  `;
  if (!row) return fail(err.internal("update failed"));
  return ok(mapFieldRow(row));
};

const logFieldUpdateDiff = async (
  existing: Field,
  next: FieldUpdateState,
  actorId: string | null,
  client: SqlClient = sql,
): Promise<void> => {
  const diff: Record<string, { old: unknown; new: unknown }> = {};
  if (next.name !== existing.name) diff.name = { old: existing.name, new: next.name };
  if (next.required !== existing.required) diff.required = { old: existing.required, new: next.required };
  if (Object.keys(diff).length > 0) {
    await logAudit({ tableId: existing.tableId, userId: actorId, action: "updated", diff }, client);
  }
};

const syncFieldIndexes = async (existing: Field, field: Field): Promise<Result<void>> => {
  // Toggle indexed state outside the row commit. Both calls are idempotent.
  if (existing.indexed !== field.indexed) {
    if (field.indexed) void ensureFieldIndex(field.id, field.type, field.tableId, field.config);
    else void dropFieldIndex(field.id);
  }
  // Unique-constraint enable: AWAIT the build and roll back the metadata
  // flag if it fails. The pre-flight conflict check above already
  // rejected the toggle when duplicates exist, but the CONCURRENTLY
  // build can still fail on transient errors (locks, disk pressure).
  if (existing.uniqueConstraint !== field.uniqueConstraint) {
    if (field.uniqueConstraint) {
      try {
        await ensureFieldUniqueIndex(field.id, field.type, field.tableId);
      } catch (e) {
        await sql`UPDATE grids.fields SET unique_constraint = FALSE WHERE id = ${field.id}::uuid`;
        return fail(err.internal(`unique-constraint index build failed: ${(e as Error).message}`));
      }
    } else {
      void dropFieldUniqueIndex(field.id);
    }
  }
  return ok();
};

export const update = async (id: string, input: UpdateFieldInput, actorId: string | null): Promise<Result<Field>> => {
  const existing = await get(id);
  if (!existing || existing.deletedAt) return fail(err.notFound("Field"));

  const nextResult = await validateFieldUpdate(existing, input);
  if (!nextResult.ok) return nextResult;
  const uniqueName = await ensureUniqueFieldName(existing.tableId, nextResult.data.name, existing.id);
  if (!uniqueName.ok) return uniqueName;

  const uniqueAllowed = await ensureUniqueToggleAllowed(id, existing, input);
  if (!uniqueAllowed.ok) return uniqueAllowed;

  const txResult = await sql
    .begin(async (tx): Promise<Result<Field>> => {
      const fieldResult = await persistFieldUpdate(id, nextResult.data, tx);
      if (!fieldResult.ok) throw fieldResult;
      const field = fieldResult.data;

      await logFieldUpdateDiff(existing, nextResult.data, actorId, tx);

      if (existing.name !== field.name) {
        await rewriteFieldNameReferences({ tableId: existing.tableId, oldName: existing.name, newName: field.name }, tx);
      }

      return ok(field);
    })
    .catch((e: unknown) => {
      if (typeof e === "object" && e !== null && "ok" in e && (e as { ok?: unknown }).ok === false) {
        return e as Result<Field>;
      }
      const conflict = namedResourceConflict<Field>(e, "idx_grids_fields_live_name", "field name must be unique within this table");
      if (conflict) return conflict;
      return fail(err.internal(`field update failed: ${(e as Error).message}`));
    });
  if (!txResult.ok) return txResult;
  const field = txResult.data;

  const indexResult = await syncFieldIndexes(existing, field);
  if (!indexResult.ok) return indexResult;

  await emitTableMetadataEvent(existing.tableId, {
    type: "field.updated",
    resource: { kind: "field", id: field.id, tableId: existing.tableId },
    actorId,
  });
  return ok(field);
};

/**
 * Reorders the live fields of a table to match the given id sequence.
 * Skips ids that don't belong to `tableId` (defensive — stops a malicious
 * client from reshuffling another user's table by mixing ids). Writes
 * positions in ONE round-trip via UNNEST + a CASE-driven UPDATE so the
 * change is atomic and the wire cost is constant in the field count.
 */
export const reorder = async (tableId: string, fieldIds: string[], actorId: string | null): Promise<Result<void>> => {
  if (fieldIds.length === 0) return ok();

  // Filter to ids that actually belong to this table — protects against
  // the client passing an id from another (e.g. recently-renamed) table.
  const owned = await sql<{ id: string }[]>`
    SELECT id::text AS id FROM grids.fields
    WHERE table_id = ${tableId}::uuid AND deleted_at IS NULL
  `;
  const ownedIds = new Set(owned.map((r) => r.id));
  const validOrdered = fieldIds.filter((id) => ownedIds.has(id));
  if (validOrdered.length === 0) return ok();

  // Single-statement reorder via VALUES (id, position).
  const positions = `{${validOrdered.map((_, i) => i).join(",")}}`;
  const ids = toPgUuidArray(validOrdered);
  await sql`
    UPDATE grids.fields AS f
    SET position = u.position, updated_at = now()
    FROM unnest(${ids}::uuid[], ${positions}::int[]) AS u(id, position)
    WHERE f.id = u.id AND f.table_id = ${tableId}::uuid
  `;

  await logAudit({
    tableId,
    userId: actorId,
    action: "updated",
    diff: { fieldOrder: { old: null, new: validOrdered } },
  });
  await emitTableMetadataEvent(tableId, {
    type: "field.reordered",
    resource: { kind: "field", id: tableId, tableId },
    actorId,
  });

  return ok();
};

/**
 * Reverses a soft-delete. The field row is un-trashed but already-
 * stripped form/view references are NOT auto-restored — those would
 * need manual re-add since their context could have moved on. Useful
 * when the user accidentally deletes a field they want back; rare
 * enough that the form/view re-add cost is acceptable.
 */
export const restore = async (id: string, actorId: string | null): Promise<Result<Field>> => {
  // get() now returns trashed rows but enforces the live-parent JOIN —
  // a field whose parent table or base is trashed resolves to null
  // here, which we surface as notFound (top-down restore: act on the
  // parent first).
  const existing = await get(id);
  if (!existing) return fail(err.notFound("Field"));
  if (existing.deletedAt === null) return ok(existing);
  const restored = await writeNamedResource(
    async () => {
      await sql`UPDATE grids.fields SET deleted_at = NULL, updated_at = now() WHERE id = ${id}::uuid`;
    },
    "idx_grids_fields_live_name",
    "field name must be unique within this table",
  );
  if (!restored.ok) return restored;
  await logAudit({ tableId: existing.tableId, userId: actorId, action: "restored" });
  await emitTableMetadataEvent(existing.tableId, {
    type: "field.restored",
    resource: { kind: "field", id, tableId: existing.tableId },
    actorId,
  });
  // Re-create the expression index if the field was indexed.
  if (existing.indexed) void ensureFieldIndex(id, existing.type, existing.tableId, existing.config);
  return ok({ ...existing, deletedAt: null });
};

export const softDelete = async (id: string, actorId: string | null): Promise<Result<void>> => {
  const existing = await get(id);
  if (!existing || existing.deletedAt) return fail(err.notFound("Field"));
  await sql`UPDATE grids.fields SET deleted_at = now() WHERE id = ${id}::uuid`;
  await logAudit({ tableId: existing.tableId, userId: actorId, action: "deleted" });
  // Auto-cleanup: strip the soft-deleted field id from every form's
  // config.fields[] in the same table. Views/forms see a stripped column
  // immediately rather than rendering a stale reference.
  await sql`
    UPDATE grids.forms
    SET config = jsonb_set(
      config,
      '{fields}',
      COALESCE(
        (
          SELECT jsonb_agg(elem)
          FROM jsonb_array_elements(config->'fields') AS elem
          WHERE elem->>'fieldId' <> ${id}
        ),
        '[]'::jsonb
      )
    )
    WHERE table_id = ${existing.tableId}::uuid
      AND config->'fields' @> jsonb_build_array(jsonb_build_object('fieldId', ${id}::text))
  `;
  // Drop any expression index since the field is gone.
  if (existing.indexed) void dropFieldIndex(id);
  if (existing.uniqueConstraint) void dropFieldUniqueIndex(id);
  if (existing.type === "id") void dropGeneratedIdSequences(id);
  await emitTableMetadataEvent(existing.tableId, {
    type: "field.deleted",
    resource: { kind: "field", id, tableId: existing.tableId },
    actorId,
  });
  return ok();
};

export { get, getByShortId, listByTable, listTrashedByBase } from "./field-read";

export { materializeFieldDefault, validateDefaultValue };
