import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { FormConfigSchema } from "../contracts";
import { isRecordWritableFieldType } from "../field-types";
import { logAudit } from "./audit";
import { listByTable as listFields, validateDefaultValue } from "./fields";
import { parseJsonbRow } from "./jsonb";
import { emitTableMetadataEvent } from "./metadata-events";
import { insertWithShortId } from "./short-id";
import type { Field } from "./types";

type DbRow = Record<string, unknown>;

/**
 * A grids form. Stored forms live in grids.forms; the per-table "default
 * form" is virtual — built on-demand from the table's active fields and
 * never persisted. Both share this shape so callers can render either with
 * the same code path.
 *
 * v3 (Slice 6) introduces a tagged-union FormFieldEntry:
 *
 *   - `user_input`: rendered as an input in the form UI; the user
 *     supplies the value. Per-form label/helpText/required/defaultValue
 *     overrides apply.
 *
 *   - `form_value`: NEVER rendered to the user. The server applies the
 *     configured `value` on every submission. Use case: a public
 *     contact form that tags every submission with `source = "website"`.
 *     The value is locked at form-edit time, not at submit time.
 *
 * Pre-v3 entries (no `kind` discriminator) are normalized to `user_input`
 * on read so existing forms keep working.
 */
export type FormFieldEntry =
  | {
      kind: "user_input";
      fieldId: string;
      label?: string;
      helpText?: string;
      /** Tightens the field's own required flag for THIS form (cannot loosen). */
      required?: boolean;
      defaultValue?: unknown;
    }
  | {
      kind: "form_value";
      fieldId: string;
      /** Server-applied value. User payload for this field is rejected. */
      value: unknown;
    };

export type FormConfig = {
  title?: string;
  description?: string;
  fields: FormFieldEntry[];
  submitLabel?: string;
  successMessage?: string;
  redirectUrl?: string | null;
  /**
   * Optional title image rendered above the form's title/description.
   * Stored as a base64 data-URL (typically `data:image/webp;base64,...`)
   * inside the JSONB config — no separate blob storage, no migration.
   * The frontend resizes uploads to a sensible max-dimension before
   * emitting so this stays small (≤ ~150 KB per image at common
   * banner sizes).
   */
  titleImage?: string;
};

export type Form = {
  /** `default-<tableId>` for the virtual default form, real UUID otherwise. */
  id: string;
  /** Short readable handle (5 chars), unique per table. Empty string
   *  for the virtual default form (which is identified by its prefix
   *  in the id, not by a short_id). */
  shortId: string;
  tableId: string;
  name: string;
  config: FormConfig;
  publicToken: string | null;
  isActive: boolean;
  ownerUserId: string | null;
  position: number;
  isDefault: boolean;
  /** Soft-delete tombstone. null on the virtual default form. */
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const COLS = sql`id, short_id, table_id, name, config, public_token, is_active, owner_user_id, position, deleted_at, created_at, updated_at`;

/**
 * Normalises a raw FormFieldEntry, defaulting `kind` to "user_input"
 * when the discriminator is missing (pre-v3 entries). Keeps the rest
 * of the type system honest without forcing a destructive migration.
 */
const normalizeFieldEntry = (raw: unknown): FormFieldEntry | null => {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const fieldId = obj.fieldId;
  if (typeof fieldId !== "string") return null;
  const kind = obj.kind;
  if (kind === "form_value") {
    return { kind: "form_value", fieldId, value: obj.value };
  }
  // Default → user_input (covers explicit "user_input" and pre-v3 entries).
  return {
    kind: "user_input",
    fieldId,
    label: typeof obj.label === "string" ? obj.label : undefined,
    helpText: typeof obj.helpText === "string" ? obj.helpText : undefined,
    required: typeof obj.required === "boolean" ? obj.required : undefined,
    defaultValue: obj.defaultValue,
  };
};

const normalizeFormConfig = (raw: unknown): FormConfig => {
  const cfg = parseJsonbRow<Partial<FormConfig> & { fields?: unknown[] }>(raw, {});
  const entries: FormFieldEntry[] = Array.isArray(cfg.fields)
    ? cfg.fields.map(normalizeFieldEntry).filter((e): e is FormFieldEntry => e !== null)
    : [];
  return {
    title: cfg.title,
    description: cfg.description,
    fields: entries,
    submitLabel: cfg.submitLabel,
    successMessage: cfg.successMessage,
    redirectUrl: cfg.redirectUrl,
    titleImage: typeof cfg.titleImage === "string" ? cfg.titleImage : undefined,
  };
};

const mapRow = (row: DbRow): Form => ({
  id: row.id as string,
  shortId: row.short_id as string,
  tableId: row.table_id as string,
  name: row.name as string,
  config: normalizeFormConfig(row.config),
  publicToken: (row.public_token as string | null) ?? null,
  isActive: row.is_active as boolean,
  ownerUserId: (row.owner_user_id as string | null) ?? null,
  position: row.position as number,
  isDefault: false,
  deletedAt: row.deleted_at ? (row.deleted_at as Date).toISOString() : null,
  createdAt: (row.created_at as Date).toISOString(),
  updatedAt: (row.updated_at as Date).toISOString(),
});

/**
 * Look up a form by (tableId, slug). Used for slug-based URL routing.
 * Returns null for soft-deleted forms.
 */
export const getByShortId = async (tableId: string, shortId: string): Promise<Form | null> => {
  const [row] = await sql<DbRow[]>`
    SELECT f.id, f.short_id, f.table_id, f.name, f.config, f.public_token, f.is_active, f.owner_user_id, f.position, f.deleted_at, f.created_at, f.updated_at
    FROM grids.forms f
    JOIN grids.tables t ON t.id = f.table_id AND t.deleted_at IS NULL
    JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
    WHERE f.table_id = ${tableId}::uuid AND f.short_id = ${shortId} AND f.deleted_at IS NULL
  `;
  return row ? mapRow(row) : null;
};

// ──────────────────────────────────────────────────────────────────
// Virtual default form
// ──────────────────────────────────────────────────────────────────

/**
 * Field types that the default form can render an input for. Excludes
 * computed / system / autonumber fields — those are server-managed and
 * shouldn't surface as form inputs.
 */
const DEFAULT_FORM_TYPES = new Set(["text", "longtext", "number", "boolean", "date", "select"]);

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
      kind: "user_input" as const,
      fieldId: f.id,
      required: f.required,
      defaultValue: f.defaultValue,
    })),
    submitLabel: "Save",
    successMessage: "Saved",
  };
  return {
    id: `default-${tableId}`,
    // Virtual default form has no real short_id — never appears in URLs
    // since it's accessed by the always-derived `default-<tableId>` id.
    shortId: "",
    tableId,
    name: "Quick add",
    config,
    publicToken: null,
    isActive: true,
    ownerUserId: null,
    position: -1,
    isDefault: true,
    deletedAt: null,
    createdAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
  };
};

// ──────────────────────────────────────────────────────────────────
// CRUD on stored forms
// ──────────────────────────────────────────────────────────────────

export const listForTable = async (tableId: string, opts: { includeDeleted?: boolean } = {}): Promise<Form[]> => {
  // Live-parent invariant: forms under a trashed table or base never list.
  const rows = opts.includeDeleted
    ? await sql<DbRow[]>`
        SELECT f.id, f.short_id, f.table_id, f.name, f.config, f.public_token, f.is_active, f.owner_user_id, f.position, f.deleted_at, f.created_at, f.updated_at
        FROM grids.forms f
        JOIN grids.tables t ON t.id = f.table_id AND t.deleted_at IS NULL
        JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
        WHERE f.table_id = ${tableId}::uuid
        ORDER BY f.position, f.created_at
      `
    : await sql<DbRow[]>`
        SELECT f.id, f.short_id, f.table_id, f.name, f.config, f.public_token, f.is_active, f.owner_user_id, f.position, f.deleted_at, f.created_at, f.updated_at
        FROM grids.forms f
        JOIN grids.tables t ON t.id = f.table_id AND t.deleted_at IS NULL
        JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
        WHERE f.table_id = ${tableId}::uuid AND f.deleted_at IS NULL
        ORDER BY f.position, f.created_at
      `;
  return rows.map(mapRow);
};

/**
 * Soft-deleted forms across all (live) tables of a base — for the
 * base-settings trash view. Forms whose parent table is itself
 * trashed are excluded; they'll come back when the table restores.
 */
export const listTrashedByBase = async (baseId: string): Promise<Form[]> => {
  const rows = await sql<DbRow[]>`
    SELECT ${sql`f.id, f.short_id, f.table_id, f.name, f.config, f.public_token, f.is_active, f.owner_user_id, f.position, f.deleted_at, f.created_at, f.updated_at`}
    FROM grids.forms f
    JOIN grids.tables t ON t.id = f.table_id
    WHERE t.base_id = ${baseId}::uuid
      AND t.deleted_at IS NULL
      AND f.deleted_at IS NOT NULL
    ORDER BY f.deleted_at DESC
  `;
  return rows.map(mapRow);
};

export const get = async (id: string, opts: { includeDeleted?: boolean } = {}): Promise<Form | null> => {
  const [row] = opts.includeDeleted
    ? await sql<DbRow[]>`
        SELECT f.id, f.short_id, f.table_id, f.name, f.config, f.public_token, f.is_active, f.owner_user_id, f.position, f.deleted_at, f.created_at, f.updated_at
        FROM grids.forms f
        JOIN grids.tables t ON t.id = f.table_id AND t.deleted_at IS NULL
        JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
        WHERE f.id = ${id}::uuid
      `
    : await sql<DbRow[]>`
        SELECT f.id, f.short_id, f.table_id, f.name, f.config, f.public_token, f.is_active, f.owner_user_id, f.position, f.deleted_at, f.created_at, f.updated_at
        FROM grids.forms f
        JOIN grids.tables t ON t.id = f.table_id AND t.deleted_at IS NULL
        JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
        WHERE f.id = ${id}::uuid AND f.deleted_at IS NULL
      `;
  return row ? mapRow(row) : null;
};

/**
 * Public-token lookup for anonymous form submission. Soft-deleted forms
 * are intentionally excluded — once trashed, the public URL stops
 * resolving. Restoring the form re-enables it.
 *
 * v3 Slice 5/6 follow-up: also verify the parent table and base are
 * alive. A soft-deleted parent must invalidate the form's public URL,
 * otherwise anonymous callers could keep submitting records into a
 * trashed table — the records would survive cascade-restore but stand
 * orphaned in any other restore order.
 */
export const getByPublicToken = async (token: string): Promise<Form | null> => {
  const [row] = await sql<DbRow[]>`
    SELECT f.id, f.short_id, f.table_id, f.name, f.config,
           f.public_token, f.is_active, f.owner_user_id, f.position,
           f.deleted_at, f.created_at, f.updated_at
    FROM grids.forms f
    JOIN grids.tables t ON t.id = f.table_id AND t.deleted_at IS NULL
    JOIN grids.bases  b ON b.id = t.base_id  AND b.deleted_at IS NULL
    WHERE f.public_token = ${token}
      AND f.is_active = TRUE
      AND f.deleted_at IS NULL
  `;
  return row ? mapRow(row) : null;
};

export type CreateFormInput = {
  tableId: string;
  name: string;
  config?: FormConfig;
  isPublic?: boolean;
};

const validateFormConfig = async (tableId: string, config: unknown): Promise<Result<FormConfig>> => {
  const parsed = FormConfigSchema.safeParse(config);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const detail = firstIssue?.message ?? "invalid form config";
    return fail(err.badInput(`invalid form config: ${detail}`));
  }
  const normalized = parsed.data as FormConfig;
  const fields = await listFields(tableId);
  const byId = new Map(fields.filter((f) => !f.deletedAt).map((f) => [f.id, f]));
  const seen = new Set<string>();

  for (let i = 0; i < normalized.fields.length; i++) {
    const entry = normalized.fields[i]!;
    const field = byId.get(entry.fieldId);
    if (!field) return fail(err.badInput("form references an unknown field"));
    if (seen.has(entry.fieldId)) {
      return fail(err.badInput(`form references field "${field.name}" more than once`));
    }
    seen.add(entry.fieldId);

    if (!isRecordWritableFieldType(field.type)) {
      return fail(err.badInput(`field "${field.name}" cannot be used in a form`));
    }

    const raw = entry.kind === "form_value" ? entry.value : entry.defaultValue;
    const validated = validateDefaultValue(field.type, field.config, raw);
    if (!validated.ok) return fail(err.badInput(`invalid form value for "${field.name}": ${validated.error.message}`));
    if (entry.kind === "form_value") {
      normalized.fields[i] = { ...entry, value: validated.data };
    } else if (entry.defaultValue !== undefined) {
      normalized.fields[i] = { ...entry, defaultValue: validated.data };
    }
  }

  return ok(normalized);
};

const generatePublicToken = (): string => {
  // A short, URL-safe token. 22 base32-like chars ≈ 110 bits of entropy.
  return [...crypto.getRandomValues(new Uint8Array(15))].map((b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]!).join("");
};

export const create = async (input: CreateFormInput, actorId: string | null): Promise<Result<Form>> => {
  const name = input.name.trim();
  if (name.length === 0) return fail(err.badInput("name required"));
  const configValid = await validateFormConfig(input.tableId, input.config ?? { fields: [] });
  if (!configValid.ok) return configValid;
  const config = configValid.data;
  const publicToken = input.isPublic ? generatePublicToken() : null;
  const row = await insertWithShortId<DbRow>(async (shortId) => {
    const [r] = await sql<DbRow[]>`
      INSERT INTO grids.forms (short_id, table_id, name, config, public_token, owner_user_id, position)
      VALUES (
        ${shortId},
        ${input.tableId}::uuid,
        ${name},
        ${config}::jsonb,
        ${publicToken},
        ${actorId}::uuid,
        COALESCE((SELECT MAX(position) + 1 FROM grids.forms WHERE table_id = ${input.tableId}::uuid AND deleted_at IS NULL), 0)
      )
      RETURNING ${COLS}
    `;
    if (!r) throw new Error("insert returned no row");
    return r;
  }, "idx_grids_forms_short_id");
  const form = mapRow(row);
  await logAudit({
    tableId: input.tableId,
    userId: actorId,
    action: "created",
    diff: { form: { old: null, new: { id: form.id, name: form.name } } },
  });
  await emitTableMetadataEvent(input.tableId, {
    type: "form.created",
    resource: { kind: "form", id: form.id, tableId: input.tableId },
    actorId,
  });
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
      input.isPublic === true && !existing.publicToken ? generatePublicToken() : input.isPublic === false ? null : existing.publicToken,
    isActive: input.isActive ?? existing.isActive,
    position: input.position ?? existing.position,
  };
  const configValid = await validateFormConfig(existing.tableId, next.config);
  if (!configValid.ok) return configValid;
  next.config = configValid.data;

  const [row] = await sql<DbRow[]>`
    UPDATE grids.forms
    SET name = ${next.name},
        config = ${next.config}::jsonb,
        public_token = ${next.publicToken},
        is_active = ${next.isActive},
        position = ${next.position},
        updated_at = now()
    WHERE id = ${id}::uuid AND deleted_at IS NULL
    RETURNING ${COLS}
  `;
  if (!row) return fail(err.internal("update failed"));
  const form = mapRow(row);
  await logAudit({ tableId: existing.tableId, userId: actorId, action: "updated", diff: { form: { old: existing.name, new: form.name } } });
  await emitTableMetadataEvent(existing.tableId, {
    type: "form.updated",
    resource: { kind: "form", id: form.id, tableId: existing.tableId },
    actorId,
  });
  return ok(form);
};

/**
 * Soft-deletes the form. The public URL stops resolving immediately
 * (getByPublicToken filters out tombstoned rows). Hard purge happens
 * after the grace period via the maintenance job.
 */
export const remove = async (id: string, actorId: string | null): Promise<Result<void>> => {
  const existing = await get(id);
  if (!existing) return fail(err.notFound("Form"));
  await sql`UPDATE grids.forms SET deleted_at = now() WHERE id = ${id}::uuid AND deleted_at IS NULL`;
  await logAudit({ tableId: existing.tableId, userId: actorId, action: "deleted" });
  await emitTableMetadataEvent(existing.tableId, {
    type: "form.deleted",
    resource: { kind: "form", id, tableId: existing.tableId },
    actorId,
  });
  return ok();
};

export const restore = async (id: string, actorId: string | null): Promise<Result<Form>> => {
  const existing = await get(id, { includeDeleted: true });
  if (!existing) return fail(err.notFound("Form"));
  if (existing.deletedAt === null) return ok(existing);
  const [row] = await sql<DbRow[]>`
    UPDATE grids.forms SET deleted_at = NULL, updated_at = now()
    WHERE id = ${id}::uuid
    RETURNING ${COLS}
  `;
  if (!row) return fail(err.internal("restore failed"));
  const form = mapRow(row);
  await logAudit({ tableId: existing.tableId, userId: actorId, action: "restored" });
  await emitTableMetadataEvent(existing.tableId, {
    type: "form.restored",
    resource: { kind: "form", id, tableId: existing.tableId },
    actorId,
  });
  return ok(form);
};
