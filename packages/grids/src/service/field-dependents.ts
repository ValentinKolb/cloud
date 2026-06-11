import { sql } from "bun";
import { parseFormula, collectFieldRefs } from "../formula/parser";
import { normalizeRefKey } from "../ref-syntax";

export type FieldDependent = {
  /** Kind of resource that references the field. */
  type: "view" | "form" | "formula" | "lookup" | "rollup" | "relation_display";
  /** ID of the dependent resource. */
  resourceId: string;
  /** Human label for error messages. */
  resourceName: string;
  /** Where in the resource the reference lives ("filter", "sort", etc). */
  context?: string;
  /**
   * If true, mutating the field requires the user to remove this dep first.
   * If false, the field-mutation path can auto-cleanup the reference.
   *
   * Today: views and forms auto-cleanup. Formulas/lookups/rollups/relation
   * displays block (Phase 4/5 introduces them — kept here for forward-compat).
   */
  blocking: boolean;
};

type DbRow = Record<string, unknown>;

export const findFieldRefsInValue = (value: unknown, fieldId: string): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value === fieldId;
  if (Array.isArray(value)) return value.some((v) => findFieldRefsInValue(v, fieldId));
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((v) =>
      findFieldRefsInValue(v, fieldId),
    );
  }
  return false;
};

export const findFieldRefContexts = (config: Record<string, unknown>, fieldId: string): string[] => {
  const contexts: string[] = [];
  // Common keys in view configs that may reference fields.
  const keys = ["filter", "sort", "visibleFields", "fieldOrder", "fieldWidths", "groupBy", "groupSort", "aggregations", "columns", "search"];
  for (const key of keys) {
    const part = config[key];
    if (part !== undefined && findFieldRefsInValue(part, fieldId)) {
      contexts.push(key);
    }
  }
  return contexts;
};

/**
 * Returns all resources that reference a field. Required pre-flight check
 * before mutating or deleting the field. Mutation paths consume the result
 * to either auto-cleanup non-blocking refs or surface a "remove dependent
 * first" error to the user.
 *
 * Cross-table awareness: a field can be referenced by lookup/rollup
 * fields on a DIFFERENT table (via a relation that points at the source
 * table) — those count as blocking deps too. Previously the scan was
 * limited to fields on the same table, so deleting a target-table field
 * referenced by another table's rollup silently left stale config
 * (chunk 4 important).
 *
 * Formula references are extracted via the formula parser, not a regex,
 * so both `{uuid}` and `#slug` syntaxes resolve correctly (chunk 6
 * important — slug is the canonical persisted form per locked decision).
 */
export const getFieldDependents = async (fieldId: string): Promise<FieldDependent[]> => {
  const dependents: FieldDependent[] = [];

  // Fetch the source field once so we know its table + base scope. We
  // also need the table's other fields' slug→id map to resolve `#slug`
  // formula refs, and the other tables in the same base for the cross-
  // table relation/lookup/rollup scan.
  const [sourceRow] = await sql<DbRow[]>`
    SELECT f.id::text AS id, f.table_id::text AS table_id, t.base_id::text AS base_id
    FROM grids.fields f
    JOIN grids.tables t ON t.id = f.table_id
    WHERE f.id = ${fieldId}::uuid
  `;
  if (!sourceRow) return dependents;
  const sourceTableId = sourceRow.table_id as string;
  const sourceBaseId = sourceRow.base_id as string;

  // ── views ─────────────────────────────────────────────
  // v3 renamed views.config → views.query. The previous SELECT used
  // `v.config` and 500'd at runtime (chunk 4 critical).
  const viewRows = await sql<DbRow[]>`
    SELECT v.id, v.name, v.query AS config
    FROM grids.views v
    WHERE v.table_id = ${sourceTableId}::uuid AND v.deleted_at IS NULL
  `;
  for (const row of viewRows) {
    const config = (row.config as Record<string, unknown>) ?? {};
    const contexts = findFieldRefContexts(config, fieldId);
    for (const context of contexts) {
      dependents.push({
        type: "view",
        resourceId: row.id as string,
        resourceName: row.name as string,
        context,
        blocking: false,
      });
    }
  }

  // ── forms ─────────────────────────────────────────────
  // Forms persist field IDs inside their config.fields[]. Keep the scan
  // here so deleting a field auto-cleans form references (UI promises it).
  const formRows = await sql<DbRow[]>`
    SELECT fo.id, fo.name, fo.config
    FROM grids.forms fo
    WHERE fo.table_id = ${sourceTableId}::uuid AND fo.deleted_at IS NULL
  `;
  for (const row of formRows) {
    const config = (row.config as { fields?: Array<{ fieldId?: string }> }) ?? {};
    const refs = (config.fields ?? []).filter((f) => f.fieldId === fieldId);
    if (refs.length > 0) {
      dependents.push({
        type: "form",
        resourceId: row.id as string,
        resourceName: row.name as string,
        context: "fields",
        blocking: false,
      });
    }
  }

  // ── computed / link field configs across the WHOLE base ──────
  // Lookup/rollup on table B can reference fields on table A through
  // a relation that points at A. Without scanning the whole base we'd
  // miss these (chunk 4 important).
  // Both `grids.fields` and `grids.tables` carry an `id` column, so
  // every projection has to be qualified — without aliases Postgres
  // raises 42702 "column reference 'id' is ambiguous". Aliasing both
  // tables also keeps the WHERE legible.
  const candidateFields = await sql<DbRow[]>`
    SELECT f.id, f.name, f.type, f.table_id::text AS table_id, f.config
    FROM grids.fields f
    JOIN grids.tables t ON t.id = f.table_id
    WHERE t.base_id = ${sourceBaseId}::uuid
      AND f.deleted_at IS NULL
      AND f.id <> ${fieldId}::uuid
      AND f.type IN ('lookup', 'rollup', 'formula', 'relation')
  `;

  // For each candidate, decide if it references our fieldId. Formula
  // refs need parser-level resolution (slug map) — we build the slug
  // map per source table (the candidate's table, since formulas
  // reference fields on their OWN table).
  const slugMapsByTable = new Map<string, Record<string, string>>();
  const ensureSlugMap = async (tableId: string): Promise<Record<string, string>> => {
    let map = slugMapsByTable.get(tableId);
    if (map) return map;
    const rows = await sql<{ id: string; short_id: string; name: string }[]>`
      SELECT id::text AS id, short_id, name
      FROM grids.fields
      WHERE table_id = ${tableId}::uuid AND deleted_at IS NULL AND short_id IS NOT NULL
    `;
    map = {};
    for (const row of rows) {
      map[row.id] = row.id;
      map[row.short_id] = row.id;
      map[normalizeRefKey(row.short_id)] = row.id;
      map[row.name] = row.id;
      map[normalizeRefKey(row.name)] = row.id;
    }
    slugMapsByTable.set(tableId, map);
    return map ?? {};
  };

  for (const row of candidateFields) {
    const config = (row.config as Record<string, unknown>) ?? {};
    const candidateTableId = row.table_id as string;
    const refs: string[] = [];

    // Direct-id refs are flat strings in config — the same shape on
    // every table.
    if (typeof config.relationFieldId === "string") refs.push(config.relationFieldId);
    if (typeof config.targetFieldId === "string") refs.push(config.targetFieldId);

    // Formula refs go through the parser so both `{uuid}` and `#slug`
    // work. The resolved fieldId set goes into `refs` alongside the
    // direct-id refs above.
    if (typeof config.expression === "string") {
      const parsed = parseFormula(config.expression);
      if (parsed.ok) {
        const slugMap = await ensureSlugMap(candidateTableId);
        for (const ref of collectFieldRefs(parsed.ast)) {
          refs.push(slugMap[ref] ?? slugMap[normalizeRefKey(ref)] ?? ref);
        }
      }
    }

    if (refs.includes(fieldId)) {
      const type = row.type as string;
      dependents.push({
        type:
          type === "formula" ? "formula" :
          type === "lookup" ? "lookup" :
          type === "rollup" ? "rollup" : "relation_display",
        resourceId: row.id as string,
        resourceName: row.name as string,
        context: "field-config",
        blocking: true,
      });
    }
  }

  return dependents;
};

/** True if any dependent is blocking — i.e. user must remove deps before mutating. */
export const hasBlockingDependents = (deps: FieldDependent[]): boolean =>
  deps.some((d) => d.blocking);
