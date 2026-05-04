import { sql } from "bun";
import { ok, fail, err, type Result } from "@valentinkolb/stdlib";
import { logAudit } from "./audit";
import {
  ensureFieldIndex,
  dropFieldIndex,
  ensureFieldUniqueIndex,
  dropFieldUniqueIndex,
  findUniqueConflicts,
  isUniqueable,
  dropAutonumberSequence,
} from "./field-indexes";
import { parseJsonbRow } from "./jsonb";
import { getHandler, isKnownFieldType } from "../field-types";
import type { Field, CreateFieldInput, UpdateFieldInput } from "./types";

type DbRow = Record<string, unknown>;

const mapRow = (row: DbRow): Field => ({
  id: row.id as string,
  tableId: row.table_id as string,
  name: row.name as string,
  description: (row.description as string | null) ?? null,
  type: row.type as string,
  config: parseJsonbRow<Record<string, unknown>>(row.config, {}),
  position: row.position as number,
  required: row.required as boolean,
  presentable: (row.presentable as boolean | null) ?? false,
  hideInTable: (row.hide_in_table as boolean | null) ?? false,
  defaultValue: parseJsonbRow<unknown>(row.default_value, null),
  indexed: row.indexed as boolean,
  uniqueConstraint: row.unique_constraint as boolean,
  deletedAt: row.deleted_at ? (row.deleted_at as Date).toISOString() : null,
  createdAt: (row.created_at as Date).toISOString(),
  updatedAt: (row.updated_at as Date).toISOString(),
});

export const listByTable = async (tableId: string, includeDeleted = false): Promise<Field[]> => {
  const rows = includeDeleted
    ? await sql<DbRow[]>`
        SELECT * FROM grids.fields WHERE table_id = ${tableId}::uuid
        ORDER BY position, created_at
      `
    : await sql<DbRow[]>`
        SELECT * FROM grids.fields
        WHERE table_id = ${tableId}::uuid AND deleted_at IS NULL
        ORDER BY position, created_at
      `;
  return rows.map(mapRow);
};

export const get = async (id: string): Promise<Field | null> => {
  const [row] = await sql<DbRow[]>`SELECT * FROM grids.fields WHERE id = ${id}::uuid`;
  return row ? mapRow(row) : null;
};

const validateFieldConfig = (type: string, config: Record<string, unknown>): Result<unknown> => {
  const handler = getHandler(type);
  if (!handler) return fail(err.badInput(`unknown field type "${type}"`));
  const parsed = handler.configSchema.safeParse(config);
  if (!parsed.success) return fail(err.badInput(`invalid config for type "${type}"`));
  return ok(parsed.data);
};

export const create = async (input: CreateFieldInput, actorId: string | null): Promise<Result<Field>> => {
  const name = input.name.trim();
  if (name.length === 0) return fail(err.badInput("name required"));
  if (!isKnownFieldType(input.type)) return fail(err.badInput(`unknown field type "${input.type}"`));

  const config = input.config ?? {};
  const cfgValidation = validateFieldConfig(input.type, config);
  if (!cfgValidation.ok) return cfgValidation;

  // Validate the default value against the type, if provided.
  if (input.defaultValue !== undefined && input.defaultValue !== null) {
    const handler = getHandler(input.type);
    if (handler && handler.userInput) {
      const v = handler.validate(input.defaultValue, config, false);
      if (!v.ok) return fail(err.badInput(`invalid default: ${v.error}`));
    }
  }

  const description = input.description?.trim() || null;
  // bun.sql passes primitive JS values (boolean / number / string) as
  // their native PG types — Postgres can't cast `true` directly to
  // jsonb. JSON.stringify on the wrapper produces a valid JSONB literal
  // for primitives (`true`, `42`, `"hello"`) and keeps objects working.
  const defaultValueJsonb =
    input.defaultValue === undefined || input.defaultValue === null
      ? null
      : JSON.stringify(input.defaultValue);
  const [row] = await sql<DbRow[]>`
    INSERT INTO grids.fields (
      table_id, name, description, type, config, position, required,
      presentable, hide_in_table, default_value, indexed, unique_constraint
    )
    VALUES (
      ${input.tableId}::uuid,
      ${name},
      -- bun.sql can't infer the type of a literal NULL; cast keeps the
      -- INSERT working when the user creates a field without a description.
      ${description}::text,
      ${input.type},
      ${config}::jsonb,
      COALESCE(${input.position ?? null}::int, (SELECT COALESCE(MAX(position) + 1, 0) FROM grids.fields WHERE table_id = ${input.tableId}::uuid AND deleted_at IS NULL)),
      ${input.required ?? false},
      ${input.presentable ?? false},
      ${input.hideInTable ?? false},
      ${defaultValueJsonb}::jsonb,
      ${input.indexed ?? false},
      ${input.uniqueConstraint ?? false}
    )
    RETURNING *
  `;
  if (!row) return fail(err.internal("insert failed"));
  const field = mapRow(row);

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
    void ensureFieldIndex(field.id, field.type);
  }
  // Unique-constraint indexes ARE correctness-critical: if the build
  // fails, the row claiming `unique_constraint = true` would lie about
  // enforcement. Await + roll back the metadata flag on failure.
  if (field.uniqueConstraint && isUniqueable(field.type)) {
    try {
      await ensureFieldUniqueIndex(field.id, field.type, field.tableId);
    } catch (e) {
      await sql`UPDATE grids.fields SET unique_constraint = FALSE WHERE id = ${field.id}::uuid`;
      return fail(err.internal(
        `field created but unique-constraint index build failed: ${(e as Error).message}`,
      ));
    }
  }

  return ok(field);
};

export const update = async (id: string, input: UpdateFieldInput, actorId: string | null): Promise<Result<Field>> => {
  const existing = await get(id);
  if (!existing || existing.deletedAt) return fail(err.notFound("Field"));

  const name = input.name?.trim();
  if (name !== undefined && name.length === 0) return fail(err.badInput("name cannot be empty"));

  const config = input.config !== undefined ? input.config : existing.config;
  const cfgValidation = validateFieldConfig(existing.type, config);
  if (!cfgValidation.ok) return cfgValidation;

  if (input.defaultValue !== undefined && input.defaultValue !== null) {
    const handler = getHandler(existing.type);
    if (handler && handler.userInput) {
      const v = handler.validate(input.defaultValue, config, false);
      if (!v.ok) return fail(err.badInput(`invalid default: ${v.error}`));
    }
  }

  // unique_constraint OFF → ON: pre-flight conflict check so we can
  // return a clean 409 BEFORE running the index build (which would
  // otherwise fail with a generic Postgres duplicate-key error).
  if (input.uniqueConstraint === true && !existing.uniqueConstraint) {
    if (!isUniqueable(existing.type)) {
      return fail(err.badInput(
        `unique_constraint not supported for type "${existing.type}" (use a scalar type)`,
      ));
    }
    const conflicts = await findUniqueConflicts(id, existing.tableId);
    if (conflicts.length > 0) {
      return fail(err.conflict(
        `unique_constraint cannot be enabled — duplicate values: ${conflicts.slice(0, 5).join(", ")}${conflicts.length > 5 ? ` (+${conflicts.length - 5} more)` : ""}`,
      ));
    }
  }

  const next = {
    name: name ?? existing.name,
    // Empty string in description input → store null (clears the helper).
    description:
      input.description !== undefined
        ? input.description?.trim() || null
        : existing.description,
    config,
    position: input.position ?? existing.position,
    required: input.required ?? existing.required,
    presentable: input.presentable ?? existing.presentable,
    hideInTable: input.hideInTable ?? existing.hideInTable,
    defaultValue: input.defaultValue !== undefined ? input.defaultValue : existing.defaultValue,
    indexed: input.indexed ?? existing.indexed,
    uniqueConstraint: input.uniqueConstraint ?? existing.uniqueConstraint,
  };

  // Same primitive-to-JSONB stringify dance as create.
  const nextDefaultValueJsonb =
    next.defaultValue === undefined || next.defaultValue === null
      ? null
      : JSON.stringify(next.defaultValue);
  const [row] = await sql<DbRow[]>`
    UPDATE grids.fields
    SET name = ${next.name},
        description = ${next.description}::text,
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
  const field = mapRow(row);

  const diff: Record<string, { old: unknown; new: unknown }> = {};
  if (next.name !== existing.name) diff.name = { old: existing.name, new: next.name };
  if (next.required !== existing.required) diff.required = { old: existing.required, new: next.required };
  if (Object.keys(diff).length > 0) {
    await logAudit({ tableId: existing.tableId, userId: actorId, action: "updated", diff });
  }

  // Toggle indexed state outside the row commit. Both calls are idempotent.
  if (existing.indexed !== field.indexed) {
    if (field.indexed) void ensureFieldIndex(field.id, field.type);
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
        return fail(err.internal(
          `unique-constraint index build failed: ${(e as Error).message}`,
        ));
      }
    } else {
      void dropFieldUniqueIndex(field.id);
    }
  }

  return ok(field);
};

/**
 * Reorders the live fields of a table to match the given id sequence.
 * Skips ids that don't belong to `tableId` (defensive — stops a malicious
 * client from reshuffling another user's table by mixing ids). Writes
 * positions in ONE round-trip via UNNEST + a CASE-driven UPDATE so the
 * change is atomic and the wire cost is constant in the field count.
 */
export const reorder = async (
  tableId: string,
  fieldIds: string[],
  actorId: string | null,
): Promise<Result<void>> => {
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
  const ids = `{${validOrdered.join(",")}}`;
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

  return ok();
};

export const softDelete = async (id: string, actorId: string | null): Promise<Result<void>> => {
  const existing = await get(id);
  if (!existing || existing.deletedAt) return fail(err.notFound("Field"));
  await sql`UPDATE grids.fields SET deleted_at = now() WHERE id = ${id}::uuid`;
  await logAudit({ tableId: existing.tableId, userId: actorId, action: "deleted" });
  // Auto-cleanup: strip the soft-deleted field id from every form's
  // config.fields[] in the same table. Views/forms see a stripped column
  // immediately rather than rendering a stale reference. Phase-1A made
  // the same promise for views — this catches up forms now that they exist.
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
  return ok();
};
