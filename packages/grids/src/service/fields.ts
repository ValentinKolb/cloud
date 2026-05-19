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
import { insertWithShortId } from "./short-id";
import { ViewQuerySchema } from "../contracts";
import type { Field, CreateFieldInput, UpdateFieldInput } from "./types";

type DbRow = Record<string, unknown>;

const mapRow = (row: DbRow): Field => ({
  id: row.id as string,
  shortId: row.short_id as string,
  tableId: row.table_id as string,
  name: row.name as string,
  description: (row.description as string | null) ?? null,
  icon: (row.icon as string | null) ?? null,
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

/**
 * Look up a field by (tableId, slug). Used by the formula evaluator
 * when resolving #slug references. Returns null for deleted fields,
 * AND for any field whose parent table or base is trashed (live-parent
 * invariant).
 */
export const getByShortId = async (tableId: string, shortId: string): Promise<Field | null> => {
  const [row] = await sql<DbRow[]>`
    SELECT f.*
    FROM grids.fields f
    JOIN grids.tables t ON t.id = f.table_id AND t.deleted_at IS NULL
    JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
    WHERE f.table_id = ${tableId}::uuid AND f.short_id = ${shortId} AND f.deleted_at IS NULL
  `;
  return row ? mapRow(row) : null;
};

export const listByTable = async (tableId: string, includeDeleted = false): Promise<Field[]> => {
  // Live-parent invariant: fields under a trashed table or base never list.
  const rows = includeDeleted
    ? await sql<DbRow[]>`
        SELECT f.*
        FROM grids.fields f
        JOIN grids.tables t ON t.id = f.table_id AND t.deleted_at IS NULL
        JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
        WHERE f.table_id = ${tableId}::uuid
        ORDER BY f.position, f.created_at
      `
    : await sql<DbRow[]>`
        SELECT f.*
        FROM grids.fields f
        JOIN grids.tables t ON t.id = f.table_id AND t.deleted_at IS NULL
        JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
        WHERE f.table_id = ${tableId}::uuid AND f.deleted_at IS NULL
        ORDER BY f.position, f.created_at
      `;
  return rows.map(mapRow);
};

/**
 * Soft-deleted fields across all (live) tables of a base — for the
 * base-settings trash view. Fields whose parent table is itself
 * trashed are intentionally excluded; they'll come back when the
 * table restores.
 */
export const listTrashedByBase = async (baseId: string): Promise<Field[]> => {
  const rows = await sql<DbRow[]>`
    SELECT f.*
    FROM grids.fields f
    JOIN grids.tables t ON t.id = f.table_id
    WHERE t.base_id = ${baseId}::uuid
      AND t.deleted_at IS NULL
      AND f.deleted_at IS NOT NULL
    ORDER BY f.deleted_at DESC
  `;
  return rows.map(mapRow);
};

/**
 * Reads a single field. Live-parent invariant: parent table AND base
 * must be alive. Soft-deleted fields ARE returned because restore /
 * trash flows need them; the caller decides whether to act on a
 * trashed field row by inspecting `field.deletedAt`.
 */
export const get = async (id: string): Promise<Field | null> => {
  const [row] = await sql<DbRow[]>`
    SELECT f.*
    FROM grids.fields f
    JOIN grids.tables t ON t.id = f.table_id AND t.deleted_at IS NULL
    JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
    WHERE f.id = ${id}::uuid
  `;
  return row ? mapRow(row) : null;
};

const validateFieldConfig = (type: string, config: Record<string, unknown>): Result<unknown> => {
  const handler = getHandler(type);
  if (!handler) return fail(err.badInput(`unknown field type "${type}"`));
  const parsed = handler.configSchema.safeParse(config);
  if (!parsed.success) {
    // Surface the first issue's message so users see WHY the config was
    // rejected (e.g. "scale cannot exceed precision") instead of a
    // generic "invalid config".
    const firstIssue = parsed.error.issues[0];
    const detail = firstIssue?.message ?? "invalid config";
    return fail(err.badInput(`invalid config for type "${type}": ${detail}`));
  }
  return ok(parsed.data);
};

const isDateNowDefault = (value: unknown): value is { kind: "now" } =>
  typeof value === "object"
  && value !== null
  && (value as { kind?: unknown }).kind === "now"
  && Object.keys(value as Record<string, unknown>).length === 1;

export const materializeFieldDefault = (field: Field): unknown => {
  if (field.type !== "date" || !isDateNowDefault(field.defaultValue)) return field.defaultValue;
  const includeTime = (field.config as { includeTime?: boolean }).includeTime ?? false;
  const now = new Date();
  if (!includeTime) return now.toISOString().slice(0, 10);
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}`;
};

export const validateDefaultValue = (type: string, config: Record<string, unknown>, value: unknown): Result<unknown> => {
  if (value === undefined || value === null) return ok(null);
  if (type === "date" && isDateNowDefault(value)) return ok(value);
  if (typeof value === "object" && value !== null && "kind" in value) {
    return fail(err.badInput("invalid default"));
  }
  const handler = getHandler(type);
  if (handler && handler.userInput) {
    const v = handler.validate(value, config, false);
    if (!v.ok) return fail(err.badInput(`invalid default: ${v.error}`));
    return ok(v.value);
  }
  return ok(value);
};

/**
 * DB-context validation for relation / lookup / rollup configs. Only
 * the field service knows the source field's table + base, so this
 * lives here rather than in the per-handler configSchema (which is
 * shape-only). Closes chunk 5 critical "Relation configs can point
 * across base boundaries" — a base-admin who knew another base's
 * table UUID could wire a relation at it and exfiltrate data through
 * lookup/labels.
 *
 * Same-base only: target table must share the source field's base.
 * Cross-table consistency: lookup/rollup relationFieldId must be a
 * relation on the source table; targetFieldId must belong to that
 * relation's target table.
 */
const validateLinkOrComputedConfig = async (
  type: string,
  config: Record<string, unknown>,
  sourceTableId: string,
): Promise<Result<void>> => {
  if (type !== "relation" && type !== "lookup" && type !== "rollup") return ok();

  // Resolve source table's base scope once.
  const [sourceTable] = await sql<{ base_id: string }[]>`
    SELECT base_id::text AS base_id FROM grids.tables WHERE id = ${sourceTableId}::uuid AND deleted_at IS NULL
  `;
  if (!sourceTable) return fail(err.badInput("source table not found"));
  const baseId = sourceTable.base_id;

  if (type === "relation") {
    const cfg = config as { targetTableId?: string };
    if (!cfg.targetTableId) return ok(); // pre-config; field can be created and wired up later.

    const [target] = await sql<{ base_id: string }[]>`
      SELECT base_id::text AS base_id FROM grids.tables
      WHERE id = ${cfg.targetTableId}::uuid AND deleted_at IS NULL
    `;
    if (!target) return fail(err.badInput("relation target table not found"));
    if (target.base_id !== baseId) {
      return fail(err.badInput("relation target must be in the same base as the source"));
    }
    return ok();
  }

  // lookup / rollup
  const cfg = config as { relationFieldId?: string; targetFieldId?: string };
  if (!cfg.relationFieldId || !cfg.targetFieldId) return ok(); // pre-config

  const [relField] = await sql<{ table_id: string; type: string; config: unknown }[]>`
    SELECT table_id::text AS table_id, type, config
    FROM grids.fields WHERE id = ${cfg.relationFieldId}::uuid AND deleted_at IS NULL
  `;
  if (!relField) return fail(err.badInput("relationFieldId not found"));
  if (relField.type !== "relation") {
    return fail(err.badInput("relationFieldId must point to a relation field"));
  }
  if (relField.table_id !== sourceTableId) {
    return fail(err.badInput("relationFieldId must be on the same table as this lookup/rollup"));
  }
  const relTargetTableId = (relField.config as { targetTableId?: string } | null)?.targetTableId;
  if (!relTargetTableId) {
    return fail(err.badInput("the chosen relation has no target table configured yet"));
  }
  const [targetField] = await sql<{ table_id: string }[]>`
    SELECT table_id::text AS table_id FROM grids.fields
    WHERE id = ${cfg.targetFieldId}::uuid AND deleted_at IS NULL
  `;
  if (!targetField) return fail(err.badInput("targetFieldId not found"));
  if (targetField.table_id !== relTargetTableId) {
    return fail(err.badInput("targetFieldId must belong to the relation's target table"));
  }
  return ok();
};

export const create = async (input: CreateFieldInput, actorId: string | null): Promise<Result<Field>> => {
  const name = input.name.trim();
  if (name.length === 0) return fail(err.badInput("name required"));
  if (!isKnownFieldType(input.type)) return fail(err.badInput(`unknown field type "${input.type}"`));

  const rawConfig = input.config ?? {};
  const cfgValidation = validateFieldConfig(input.type, rawConfig);
  if (!cfgValidation.ok) return cfgValidation;
  const config = cfgValidation.data as Record<string, unknown>;
  // DB-context validation: same-base relation + cross-table consistency.
  // Runs after Zod (so we know the shape's right) but before any DB
  // writes. Closes chunk 5 critical "Relation configs can point across
  // base boundaries".
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
  const defaultValueJsonb =
    defaultValue === undefined || defaultValue === null
      ? null
      : JSON.stringify(defaultValue);
  const row = await insertWithShortId<DbRow>(async (shortId) => {
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
        ${input.uniqueConstraint ?? false}
      )
      RETURNING *
    `;
    if (!r) throw new Error("insert returned no row");
    return r;
  }, "idx_grids_fields_short_id");
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
    void ensureFieldIndex(field.id, field.type, field.tableId);
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
    icon: input.icon !== undefined ? input.icon?.trim() || null : existing.icon,
    config,
    position: input.position ?? existing.position,
    required: input.required ?? existing.required,
    presentable: input.presentable ?? existing.presentable,
    hideInTable: input.hideInTable ?? existing.hideInTable,
    defaultValue: defaultValid.data,
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
  const field = mapRow(row);

  const diff: Record<string, { old: unknown; new: unknown }> = {};
  if (next.name !== existing.name) diff.name = { old: existing.name, new: next.name };
  if (next.required !== existing.required) diff.required = { old: existing.required, new: next.required };
  if (Object.keys(diff).length > 0) {
    await logAudit({ tableId: existing.tableId, userId: actorId, action: "updated", diff });
  }

  // Toggle indexed state outside the row commit. Both calls are idempotent.
  if (existing.indexed !== field.indexed) {
    if (field.indexed) void ensureFieldIndex(field.id, field.type, field.tableId);
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
  await sql`UPDATE grids.fields SET deleted_at = NULL, updated_at = now() WHERE id = ${id}::uuid`;
  await logAudit({ tableId: existing.tableId, userId: actorId, action: "restored" });
  // Re-create the expression index if the field was indexed.
  if (existing.indexed) void ensureFieldIndex(id, existing.type, existing.tableId);
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
  // Same auto-cleanup for saved views. View.query carries field refs in
  // filter (FilterTree leaf.fieldId), sort/groupBy/aggregations.fieldId,
  // and columns[].fieldId. The field-dependents scan reports views as
  // non-blocking (Phase-1A promised auto-cleanup), but the cleanup
  // itself was missing — saved views ended up with stale fieldIds and
  // record queries failed at compile time with `unknown field "X"`
  // (chunk 4 important).
  await cleanupViewFieldRefs(existing.tableId, id);
  // Drop any expression index since the field is gone.
  if (existing.indexed) void dropFieldIndex(id);
  return ok();
};

/**
 * Strips every reference to `fieldId` from saved-view query JSONB on
 * `tableId`: filter tree, sort, groupBy, groupSort, aggregations, columns. Run
 * after a soft-delete so saved views don't carry stale references that
 * would compile-error at record-list time.
 *
 * Implementation: read each view's query, walk the JS-side mutation
 * path (small enough that doing it in JS is clearer than building 5
 * jsonb_set sub-expressions), write back. Touching only views that
 * actually contained the ref keeps writes minimal.
 */
const cleanupViewFieldRefs = async (tableId: string, fieldId: string): Promise<void> => {
  const views = await sql<{ id: string; query: unknown }[]>`
    SELECT id::text AS id, query FROM grids.views
    WHERE table_id = ${tableId}::uuid AND deleted_at IS NULL
  `;

  type Q = {
    filter?: unknown;
    search?: { q?: string; fieldIds?: string[] };
    sort?: Array<{ fieldId?: string }>;
    groupBy?: Array<{ fieldId?: string }>;
    groupSort?: Array<{ fieldId?: string }>;
    aggregations?: Array<{ fieldId?: string }>;
    columns?: Array<{ fieldId?: string }>;
    [k: string]: unknown;
  };

  const stripFromFilter = (node: unknown): unknown => {
    if (!node || typeof node !== "object") return node;
    const n = node as { op?: string; filters?: unknown[]; fieldId?: string };
    if (n.op === "AND" || n.op === "OR") {
      const filtered = (n.filters ?? [])
        .map(stripFromFilter)
        .filter((f) => f !== null);
      return filtered.length === 0 ? null : { ...n, filters: filtered };
    }
    if (n.op === "NOT") {
      const inner = stripFromFilter((n as { filter?: unknown }).filter);
      return inner === null ? null : { ...n, filter: inner };
    }
    // Leaf
    return n.fieldId === fieldId ? null : node;
  };

  for (const v of views) {
    const q: Q = (typeof v.query === "string" ? JSON.parse(v.query) : v.query) ?? {};
    let changed = false;

    if (q.filter !== undefined) {
      const next = stripFromFilter(q.filter);
      if (JSON.stringify(next) !== JSON.stringify(q.filter)) {
        if (next === null) delete q.filter;
        else q.filter = next;
        changed = true;
      }
    }
    for (const key of ["sort", "groupBy", "groupSort", "aggregations", "columns"] as const) {
      const arr = q[key] as Array<{ fieldId?: string }> | undefined;
      if (Array.isArray(arr)) {
        const next = arr.filter((e) => e.fieldId !== fieldId);
        if (next.length !== arr.length) {
          if (next.length === 0) delete (q as Record<string, unknown>)[key];
          else (q as Record<string, unknown>)[key] = next;
          changed = true;
        }
      }
    }
    // search.fieldIds is the explicit search-scope list (when omitted,
    // search hits every text-ish field). Strip the deleted id; if that
    // empties the array, drop it so search reverts to "all fields"
    // rather than degenerating into an always-empty match list.
    if (q.search && Array.isArray(q.search.fieldIds)) {
      const next = q.search.fieldIds.filter((id) => id !== fieldId);
      if (next.length !== q.search.fieldIds.length) {
        if (next.length === 0) delete q.search.fieldIds;
        else q.search.fieldIds = next;
        changed = true;
      }
    }

    if (changed) {
      const parsed = ViewQuerySchema.safeParse(q);
      await sql`
        UPDATE grids.views
        SET query = ${parsed.success ? parsed.data : {}}::jsonb, updated_at = now()
        WHERE id = ${v.id}::uuid
      `;
    }
  }
};
