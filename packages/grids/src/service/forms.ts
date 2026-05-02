import { sql } from "bun";
import { ok, fail, err, type Result } from "@valentinkolb/stdlib";
import { logAudit } from "./audit";
import { parseJsonbRow } from "./jsonb";
import { listByTable as listFields } from "./fields";
import type { Field } from "./types";

type DbRow = Record<string, unknown>;

/**
 * A grids form. Stored forms live in grids.forms; the per-table "default
 * form" is virtual — built on-demand from the table's active fields and
 * never persisted. Both share this shape so callers can render either with
 * the same code path.
 */
export type FormFieldEntry = {
  fieldId: string;
  /** Override label shown in the form (defaults to field.name when empty). */
  label?: string;
  helpText?: string;
  /** Override the field's own required flag for this form. */
  required?: boolean;
  /** Pre-fill value for new submissions. */
  defaultValue?: unknown;
};

export type FormConfig = {
  title?: string;
  description?: string;
  fields: FormFieldEntry[];
  submitLabel?: string;
  successMessage?: string;
  redirectUrl?: string | null;
};

export type Form = {
  /** `default-<tableId>` for the virtual default form, real UUID otherwise. */
  id: string;
  tableId: string;
  name: string;
  config: FormConfig;
  publicToken: string | null;
  isActive: boolean;
  ownerUserId: string | null;
  position: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

const mapRow = (row: DbRow): Form => ({
  id: row.id as string,
  tableId: row.table_id as string,
  name: row.name as string,
  config: parseJsonbRow<FormConfig>(row.config, { fields: [] }),
  publicToken: (row.public_token as string | null) ?? null,
  isActive: row.is_active as boolean,
  ownerUserId: (row.owner_user_id as string | null) ?? null,
  position: row.position as number,
  isDefault: false,
  createdAt: (row.created_at as Date).toISOString(),
  updatedAt: (row.updated_at as Date).toISOString(),
});

// ──────────────────────────────────────────────────────────────────
// Virtual default form
// ──────────────────────────────────────────────────────────────────

/**
 * Field types that the default form can render an input for. Excludes
 * computed / system / autonumber fields — those are server-managed and
 * shouldn't surface as form inputs.
 */
const DEFAULT_FORM_TYPES = new Set([
  "text", "longtext", "number", "decimal", "rating",
  "boolean", "date", "single-select", "multi-select",
]);

export const isFormFieldEligible = (field: Field): boolean => {
  if (field.deletedAt) return false;
  return DEFAULT_FORM_TYPES.has(field.type);
};

/**
 * Builds the per-table default form on the fly. Includes every active,
 * eligible field in declared order; required + defaults flow from the
 * field config. Never persisted — the page calls this fresh on every
 * request so schema changes flow through without manual sync.
 */
export const buildDefaultForm = async (tableId: string): Promise<Form> => {
  const fields = await listFields(tableId);
  const eligible = fields.filter(isFormFieldEligible);
  const config: FormConfig = {
    title: "Quick add",
    fields: eligible.map((f) => ({
      fieldId: f.id,
      required: f.required,
      defaultValue: f.defaultValue,
    })),
    submitLabel: "Save",
    successMessage: "Saved",
  };
  return {
    id: `default-${tableId}`,
    tableId,
    name: "Quick add",
    config,
    publicToken: null,
    isActive: true,
    ownerUserId: null,
    position: -1,
    isDefault: true,
    createdAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
  };
};

// ──────────────────────────────────────────────────────────────────
// CRUD on stored forms
// ──────────────────────────────────────────────────────────────────

export const listForTable = async (tableId: string): Promise<Form[]> => {
  const rows = await sql<DbRow[]>`
    SELECT id, table_id, name, config, public_token, is_active, owner_user_id, position, created_at, updated_at
    FROM grids.forms
    WHERE table_id = ${tableId}::uuid
    ORDER BY position, created_at
  `;
  return rows.map(mapRow);
};

export const get = async (id: string): Promise<Form | null> => {
  const [row] = await sql<DbRow[]>`
    SELECT id, table_id, name, config, public_token, is_active, owner_user_id, position, created_at, updated_at
    FROM grids.forms WHERE id = ${id}::uuid
  `;
  return row ? mapRow(row) : null;
};

export const getByPublicToken = async (token: string): Promise<Form | null> => {
  const [row] = await sql<DbRow[]>`
    SELECT id, table_id, name, config, public_token, is_active, owner_user_id, position, created_at, updated_at
    FROM grids.forms WHERE public_token = ${token} AND is_active = TRUE
  `;
  return row ? mapRow(row) : null;
};

export type CreateFormInput = {
  tableId: string;
  name: string;
  config?: FormConfig;
  isPublic?: boolean;
};

const generatePublicToken = (): string => {
  // A short, URL-safe token. 22 base32-like chars ≈ 110 bits of entropy.
  return [...crypto.getRandomValues(new Uint8Array(15))]
    .map((b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]!)
    .join("");
};

export const create = async (input: CreateFormInput, actorId: string | null): Promise<Result<Form>> => {
  const name = input.name.trim();
  if (name.length === 0) return fail(err.badInput("name required"));
  const config = input.config ?? { fields: [] };
  const publicToken = input.isPublic ? generatePublicToken() : null;

  const [row] = await sql<DbRow[]>`
    INSERT INTO grids.forms (table_id, name, config, public_token, owner_user_id, position)
    VALUES (
      ${input.tableId}::uuid,
      ${name},
      ${config}::jsonb,
      ${publicToken},
      ${actorId}::uuid,
      COALESCE((SELECT MAX(position) + 1 FROM grids.forms WHERE table_id = ${input.tableId}::uuid), 0)
    )
    RETURNING id, table_id, name, config, public_token, is_active, owner_user_id, position, created_at, updated_at
  `;
  if (!row) return fail(err.internal("insert failed"));
  const form = mapRow(row);
  await logAudit({ tableId: input.tableId, userId: actorId, action: "created", diff: { form: { old: null, new: { id: form.id, name: form.name } } } });
  return ok(form);
};

export type UpdateFormInput = {
  name?: string;
  config?: FormConfig;
  isPublic?: boolean;
  isActive?: boolean;
  position?: number;
};

export const update = async (id: string, input: UpdateFormInput, actorId: string | null): Promise<Result<Form>> => {
  const existing = await get(id);
  if (!existing) return fail(err.notFound("Form"));

  const name = input.name?.trim();
  if (name !== undefined && name.length === 0) return fail(err.badInput("name cannot be empty"));

  const next = {
    name: name ?? existing.name,
    config: input.config !== undefined ? input.config : existing.config,
    publicToken:
      input.isPublic === true && !existing.publicToken
        ? generatePublicToken()
        : input.isPublic === false
          ? null
          : existing.publicToken,
    isActive: input.isActive ?? existing.isActive,
    position: input.position ?? existing.position,
  };

  const [row] = await sql<DbRow[]>`
    UPDATE grids.forms
    SET name = ${next.name},
        config = ${next.config}::jsonb,
        public_token = ${next.publicToken},
        is_active = ${next.isActive},
        position = ${next.position},
        updated_at = now()
    WHERE id = ${id}::uuid
    RETURNING id, table_id, name, config, public_token, is_active, owner_user_id, position, created_at, updated_at
  `;
  if (!row) return fail(err.internal("update failed"));
  const form = mapRow(row);
  await logAudit({ tableId: existing.tableId, userId: actorId, action: "updated", diff: { form: { old: existing.name, new: form.name } } });
  return ok(form);
};

export const remove = async (id: string, actorId: string | null): Promise<Result<void>> => {
  const existing = await get(id);
  if (!existing) return fail(err.notFound("Form"));
  await sql`DELETE FROM grids.forms WHERE id = ${id}::uuid`;
  await logAudit({ tableId: existing.tableId, userId: actorId, action: "deleted" });
  return ok();
};
