import { sql } from "bun";
import { ok, fail, err, type Result } from "@valentinkolb/stdlib";
import { logAudit } from "./audit";
import { ensureFieldIndex, dropFieldIndex } from "./field-indexes";
import { getHandler, isKnownFieldType } from "../field-types";
import type { Field, CreateFieldInput, UpdateFieldInput } from "./types";

type DbRow = Record<string, unknown>;

const mapRow = (row: DbRow): Field => ({
  id: row.id as string,
  tableId: row.table_id as string,
  name: row.name as string,
  type: row.type as string,
  config: (row.config as Record<string, unknown>) ?? {},
  position: row.position as number,
  required: row.required as boolean,
  defaultValue: row.default_value ?? null,
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

  const [row] = await sql<DbRow[]>`
    INSERT INTO grids.fields (table_id, name, type, config, position, required, default_value, indexed, unique_constraint)
    VALUES (
      ${input.tableId}::uuid,
      ${name},
      ${input.type},
      ${JSON.stringify(config)}::jsonb,
      COALESCE(${input.position ?? null}::int, (SELECT COALESCE(MAX(position) + 1, 0) FROM grids.fields WHERE table_id = ${input.tableId}::uuid)),
      ${input.required ?? false},
      ${input.defaultValue !== undefined ? JSON.stringify(input.defaultValue) : null}::jsonb,
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

  // CONCURRENTLY-built index fires after the row commits. Failures don't
  // block create — they're logged so the user can re-toggle.
  if (field.indexed) {
    void ensureFieldIndex(field.id, field.type);
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

  const next = {
    name: name ?? existing.name,
    config,
    position: input.position ?? existing.position,
    required: input.required ?? existing.required,
    defaultValue: input.defaultValue !== undefined ? input.defaultValue : existing.defaultValue,
    indexed: input.indexed ?? existing.indexed,
    uniqueConstraint: input.uniqueConstraint ?? existing.uniqueConstraint,
  };

  const [row] = await sql<DbRow[]>`
    UPDATE grids.fields
    SET name = ${next.name},
        config = ${JSON.stringify(next.config)}::jsonb,
        position = ${next.position},
        required = ${next.required},
        default_value = ${next.defaultValue !== undefined && next.defaultValue !== null ? JSON.stringify(next.defaultValue) : null}::jsonb,
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

  return ok(field);
};

export const softDelete = async (id: string, actorId: string | null): Promise<Result<void>> => {
  const existing = await get(id);
  if (!existing || existing.deletedAt) return fail(err.notFound("Field"));
  await sql`UPDATE grids.fields SET deleted_at = now() WHERE id = ${id}::uuid`;
  await logAudit({ tableId: existing.tableId, userId: actorId, action: "deleted" });
  // Drop any expression index since the field is gone.
  if (existing.indexed) void dropFieldIndex(id);
  return ok();
};
