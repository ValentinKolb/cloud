import { sql } from "bun";
import { listByTable as listFields } from "./fields";
import { parseJsonbRow } from "./jsonb";
import { collectFieldRefs, parseFormula } from "../formula/parser";
import { evaluate, renderResult } from "../formula/evaluator";
import { formulaError } from "../formula/types";
import type { Field, GridRecord } from "./types";

type DbRow = Record<string, unknown>;

// =============================================================================
// record_links junction-table helpers (v3)
// =============================================================================
// All relation-field reads/writes go through this layer. The previous
// JSONB-array storage in `records.data` is no longer the source of truth
// for relations — record_links is. The records-list pipeline hydrates
// each record's `data[relationFieldId]` from record_links just before
// returning, so consumers that read `record.data[fieldId]` keep working
// unchanged.

/**
 * Pre-flight check for a relation-write. Verifies every target id
 * exists and lives in the relation's configured target table, and
 * isn't soft-deleted. Returns the list of missing ids if any — the
 * caller surfaces this as a 400 BEFORE doing any DB mutation, so
 * we never end up with partial link state.
 *
 * Single round-trip — `id = ANY(uuid[])` plus a target-table filter.
 */
export const validateRelationTargets = async (
  targetTableId: string,
  targetIds: string[],
): Promise<{ ok: true } | { ok: false; missing: string[] }> => {
  if (targetIds.length === 0) return { ok: true };
  const arr = `{${targetIds.join(",")}}`;
  const rows = await sql<{ id: string }[]>`
    SELECT id::text AS id
    FROM grids.records
    WHERE id = ANY(${arr}::uuid[])
      AND table_id = ${targetTableId}::uuid
      AND deleted_at IS NULL
  `;
  const found = new Set(rows.map((r) => r.id));
  const missing = targetIds.filter((id) => !found.has(id));
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
};

/**
 * Replaces the link list for (recordId, fieldId) atomically. Used by
 * record-create and record-update for every relation field in the
 * payload. Targets are written in the order given (used as `position`).
 *
 * Single transaction: DELETE existing rows for this (record, field),
 * then INSERT the new set. Both sides of an empty target list are
 * handled — passing `[]` clears all links.
 *
 * Pre-flight target existence is the caller's job — call
 * `validateRelationTargets` first to avoid orphan-record states on
 * partial failure.
 */
export const writeRecordLinks = async (
  fromRecordId: string,
  fromFieldId: string,
  toRecordIds: string[],
): Promise<void> => {
  await sql.begin(async (tx) => {
    await tx`
      DELETE FROM grids.record_links
      WHERE from_record_id = ${fromRecordId}::uuid
        AND from_field_id = ${fromFieldId}::uuid
    `;
    if (toRecordIds.length === 0) return;
    // Build a single VALUES tuple list so the INSERT runs in one round-trip.
    // Position preserves the user-ordered cardinality:multiple semantic.
    const values = toRecordIds
      .map((id, i) => tx`(${fromRecordId}::uuid, ${fromFieldId}::uuid, ${id}::uuid, ${i})`)
      .reduce((acc, cur) => tx`${acc}, ${cur}`);
    await tx`
      INSERT INTO grids.record_links (from_record_id, from_field_id, to_record_id, position)
      VALUES ${values}
      ON CONFLICT (from_record_id, from_field_id, to_record_id) DO UPDATE
        SET position = EXCLUDED.position
    `;
  });
};

/**
 * Batch-fetches links for a set of records across multiple relation
 * fields. Returns a nested map `recordId → fieldId → toRecordId[]`,
 * preserving link order. ONE round-trip regardless of how many records
 * or fields — keeps the records-list hot path linear.
 *
 * Empty record list or empty field list → empty map.
 */
export const readRecordLinksBatch = async (
  recordIds: string[],
  fieldIds: string[],
): Promise<Map<string, Map<string, string[]>>> => {
  const out = new Map<string, Map<string, string[]>>();
  if (recordIds.length === 0 || fieldIds.length === 0) return out;
  const recArr = `{${recordIds.join(",")}}`;
  const fldArr = `{${fieldIds.join(",")}}`;
  const rows = await sql<DbRow[]>`
    SELECT from_record_id, from_field_id, to_record_id, position
    FROM grids.record_links
    WHERE from_record_id = ANY(${recArr}::uuid[])
      AND from_field_id  = ANY(${fldArr}::uuid[])
    ORDER BY from_record_id, from_field_id, position
  `;
  for (const row of rows) {
    const rid = row.from_record_id as string;
    const fid = row.from_field_id as string;
    const tid = row.to_record_id as string;
    let perRec = out.get(rid);
    if (!perRec) {
      perRec = new Map();
      out.set(rid, perRec);
    }
    const arr = perRec.get(fid) ?? [];
    arr.push(tid);
    perRec.set(fid, arr);
  }
  return out;
};

/**
 * Hydrates `record.data[relationFieldId]` for every relation field on
 * the table by reading from record_links. Mutates the records in place
 * (consistent with the other enrichment helpers). Old JSONB-array
 * values get overwritten — record_links is the source of truth.
 *
 * Empty input → no-op. Tables with no relation fields → no-op.
 */
export const hydrateRelationsFromLinks = async (
  records: GridRecord[],
  fields: Field[],
): Promise<void> => {
  if (records.length === 0) return;
  const relationFields = fields.filter((f) => f.type === "relation" && !f.deletedAt);
  if (relationFields.length === 0) return;
  const links = await readRecordLinksBatch(
    records.map((r) => r.id),
    relationFields.map((f) => f.id),
  );
  for (const rec of records) {
    const perRec = links.get(rec.id);
    for (const rf of relationFields) {
      rec.data[rf.id] = perRec?.get(rf.id) ?? [];
    }
  }
};

// v3 Slice 4: lookup/rollup VALUES are computed in the main records
// query as correlated subqueries over record_links (see
// `service/computed-projections.ts`). The previous JS-side enrichment
// pass — fetchLinkedValuesBatched + enrichRecordsWithLookups — has been
// deleted. Single source of truth (SQL), single round-trip per page,
// and filter/sort/group on lookup/rollup values is a tractable
// extension for Slice 8.

/**
 * Topologically orders formula fields by their inter-formula references.
 * A formula that depends on another formula's value evaluates AFTER its
 * dependency. Cycles are detected and surfaced as a #CYCLE error written
 * into every member's cell rather than crashing the read.
 */
const orderFormulasByDeps = (
  formulaFields: Field[],
  slugToId: Record<string, string>,
): { ordered: Array<{ field: Field; ast: ReturnType<typeof parseFormula> extends infer R ? R extends { ok: true; ast: infer A } ? A : never : never }>; cycle: Set<string> } => {
  // Refs in formulas are either UUIDs (legacy {uuid} syntax) or slugs
  // (#slug syntax). Normalise both to UUIDs via the slug-map so the
  // dep graph stays UUID-keyed.
  const resolveRef = (ref: string): string => slugToId[ref] ?? ref;

  const compiled = formulaFields
    .map((f) => {
      const expr = (f.config as { expression?: string }).expression;
      if (!expr) return null;
      const parsed = parseFormula(expr);
      if (!parsed.ok) return null;
      const refs = new Set(
        [...collectFieldRefs(parsed.ast)].map(resolveRef),
      );
      return { field: f, ast: parsed.ast, refs };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  const idSet = new Set(compiled.map((c) => c.field.id));
  const byId = new Map(compiled.map((c) => [c.field.id, c]));

  // DFS-based topological sort with cycle detection.
  const ordered: typeof compiled = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const cycle = new Set<string>();

  const visit = (id: string): boolean => {
    if (visited.has(id)) return true;
    if (inStack.has(id)) {
      cycle.add(id);
      return false;
    }
    const node = byId.get(id);
    if (!node) return true;
    inStack.add(id);
    for (const ref of node.refs) {
      if (idSet.has(ref) && !visit(ref)) cycle.add(id);
    }
    inStack.delete(id);
    visited.add(id);
    ordered.push(node);
    return true;
  };
  for (const c of compiled) visit(c.field.id);

  return { ordered, cycle };
};

/**
 * Evaluates every formula field for the visible records and writes the
 * rendered display value into each record's data. Formulas run AFTER
 * lookup/rollup so a formula can reference computed fields too.
 * Inter-formula references evaluate in dependency order; cycles surface
 * as #CYCLE rather than silent wrong values.
 */
export const enrichRecordsWithFormulas = (records: GridRecord[], fields: Field[]): GridRecord[] => {
  const formulaFields = fields.filter((f) => !f.deletedAt && f.type === "formula");
  if (formulaFields.length === 0) return records;

  // slug → fieldId map for #slug references in formula expressions.
  // Built across ALL alive fields (not just formulas) since a formula
  // can reference any field by slug.
  const slugToId: Record<string, string> = {};
  for (const f of fields) {
    if (!f.deletedAt && f.slug) slugToId[f.slug] = f.id;
  }

  const { ordered, cycle } = orderFormulasByDeps(formulaFields, slugToId);

  for (const rec of records) {
    // Mark cycle members first so dependents see the error sentinel
    // instead of the previous-iteration's value.
    for (const id of cycle) {
      rec.data[id] = renderResult(formulaError("CYCLE"));
    }
    for (const { field, ast } of ordered) {
      if (cycle.has(field.id)) continue;
      const value = evaluate(ast, { fields: rec.data, slugToId });
      rec.data[field.id] = renderResult(value);
    }
  }
  return records;
};

/**
 * SSR helper: walks every relation field on the visible records and
 * builds `recordId → label` for every linked target record. Labels
 * use the target table's `presentable` fields (joined with " · "),
 * fall back to the relation's `displayFieldId`, then to an 8-char
 * id prefix.
 *
 * Single SQL round-trip per target table — `WHERE id = ANY(uuid[])`.
 * Empty input → empty map; non-relation fields are skipped.
 */
export const buildRelationLabelCache = async (
  records: GridRecord[],
  fields: Field[],
): Promise<Record<string, string>> => {
  const idsByTargetTable = new Map<string, Set<string>>();
  const fieldsByTargetTable = new Map<string, { displayFieldId?: string }>();

  const relationFields = fields.filter((f) => f.type === "relation" && !f.deletedAt);
  if (relationFields.length === 0 || records.length === 0) return {};

  // v3: pull links from record_links in one batch; the JSONB array on
  // record.data is no longer authoritative.
  const links = await readRecordLinksBatch(
    records.map((r) => r.id),
    relationFields.map((rf) => rf.id),
  );

  for (const rf of relationFields) {
    const cfg = rf.config as { targetTableId?: string; displayFieldId?: string };
    if (!cfg.targetTableId) continue;
    fieldsByTargetTable.set(cfg.targetTableId, { displayFieldId: cfg.displayFieldId });
    const set = idsByTargetTable.get(cfg.targetTableId) ?? new Set<string>();
    for (const rec of records) {
      const linked = links.get(rec.id)?.get(rf.id);
      if (linked) for (const id of linked) set.add(id);
    }
    idsByTargetTable.set(cfg.targetTableId, set);
  }

  return resolveLabelsByTargetTable(idsByTargetTable, fieldsByTargetTable);
};

/**
 * Resolve presentable labels for a batch of (targetTable, recordId)
 * pairs. Same labelling rules as buildRelationLabelCache: presentable
 * fields joined by " · ", fall back to the relation's `displayFieldId`,
 * then to an 8-char id prefix. ONE SQL round-trip per target table.
 *
 * Splits out so that callers operating on group buckets (whose keys are
 * already raw target-record UUIDs, not records on the source table)
 * can reuse the lookup without manufacturing a fake `GridRecord[]`.
 */
export const resolveLabelsByTargetTable = async (
  idsByTargetTable: Map<string, Set<string>>,
  fieldsByTargetTable: Map<string, { displayFieldId?: string }>,
): Promise<Record<string, string>> => {
  const cache: Record<string, string> = {};
  if (idsByTargetTable.size === 0) return cache;

  for (const [targetTableId, idSet] of idsByTargetTable) {
    if (idSet.size === 0) continue;
    const targetFields = await listFields(targetTableId);
    const presentable = targetFields
      .filter((f) => !f.deletedAt && f.presentable)
      .sort((a, b) => a.position - b.position);
    const displayFieldId = fieldsByTargetTable.get(targetTableId)?.displayFieldId;
    const idArr = `{${[...idSet].join(",")}}`;
    const rows = await sql<DbRow[]>`
      SELECT id, data
      FROM grids.records
      WHERE id = ANY(${idArr}::uuid[])
        AND table_id = ${targetTableId}::uuid
        AND deleted_at IS NULL
    `;
    for (const row of rows) {
      const id = row.id as string;
      const data = parseJsonbRow<Record<string, unknown>>(row.data, {});
      let label: string;
      if (presentable.length > 0) {
        const parts = presentable
          .map((f) => formatLabelPart(data[f.id]))
          .filter((s) => s.length > 0);
        label = parts.length > 0 ? parts.join(" · ") : id.slice(0, 8);
      } else if (displayFieldId && data[displayFieldId] != null) {
        label = formatLabelPart(data[displayFieldId]) || id.slice(0, 8);
      } else {
        label = id.slice(0, 8);
      }
      cache[id] = label;
    }
  }
  return cache;
};

/**
 * Resolve labels for the relation-typed columns of a grouped result.
 * Each bucket carries `keys: unknown[]` parallel to the groupBy spec —
 * for relation groupBy, the key is the linked record's UUID. We collect
 * those UUIDs per target table (one set per relation column), then run
 * the shared label resolver. Empty input → empty map.
 */
export const buildLabelCacheForGroupedKeys = async (
  buckets: Array<{ keys: unknown[] }>,
  groupByFieldIds: string[],
  fields: Field[],
): Promise<Record<string, string>> => {
  if (buckets.length === 0) return {};
  const fieldsById = new Map(fields.map((f) => [f.id, f]));
  const idsByTargetTable = new Map<string, Set<string>>();
  const fieldsByTargetTable = new Map<string, { displayFieldId?: string }>();
  for (let i = 0; i < groupByFieldIds.length; i++) {
    const f = fieldsById.get(groupByFieldIds[i]!);
    if (!f || f.type !== "relation" || f.deletedAt) continue;
    const cfg = f.config as { targetTableId?: string; displayFieldId?: string };
    if (!cfg.targetTableId) continue;
    fieldsByTargetTable.set(cfg.targetTableId, { displayFieldId: cfg.displayFieldId });
    const set = idsByTargetTable.get(cfg.targetTableId) ?? new Set<string>();
    for (const b of buckets) {
      const k = b.keys[i];
      if (typeof k === "string" && k.length > 0) set.add(k);
    }
    idsByTargetTable.set(cfg.targetTableId, set);
  }
  return resolveLabelsByTargetTable(idsByTargetTable, fieldsByTargetTable);
};

/**
 * Search records of a target table by free text on its presentable
 * fields, returning up-to-N `{ id, label }` pairs for the relation
 * picker. Powers `GET /api/grids/tables/:tableId/lookup` — used by the
 * record-detail panel to let the user pick records to link.
 *
 * Search semantics: ILIKE on each text-shaped presentable field, OR'd.
 * Empty `q` → recent records (no filter), so an empty picker still
 * shows results to choose from.
 *
 * `excludeIds` lets the caller hide already-linked records from the
 * dropdown so the user can't pick the same row twice.
 */
export const lookupRecords = async (params: {
  targetTableId: string;
  q?: string | null;
  limit?: number;
  excludeIds?: string[];
}): Promise<{ items: { id: string; label: string }[] }> => {
  const limit = Math.min(Math.max(params.limit ?? 10, 1), 50);
  const fields = await listFields(params.targetTableId);
  const presentable = fields
    .filter((f) => !f.deletedAt && f.presentable)
    .sort((a, b) => a.position - b.position);

  // Searchable fields: text-shaped presentables. If no presentables are
  // configured, fall back to every text-shaped field so the picker can
  // at least find rows by id-prefix or any visible text content.
  const TEXT_TYPES = new Set([
    "text",
    "longtext",
    "email",
    "url",
    "phone",
    "slug",
    "barcode",
    "isbn",
  ]);
  const searchTargets = (presentable.length > 0 ? presentable : fields)
    .filter((f) => !f.deletedAt && TEXT_TYPES.has(f.type));

  const conditions: any[] = [
    sql`table_id = ${params.targetTableId}::uuid`,
    sql`deleted_at IS NULL`,
  ];

  const q = params.q?.trim();
  if (q && searchTargets.length > 0) {
    const pattern = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const orClauses = searchTargets.map(
      (f) => sql`data->>${f.id} ILIKE ${pattern}`,
    );
    const orClause = orClauses.reduce((acc, cur) => sql`${acc} OR ${cur}`);
    conditions.push(sql`(${orClause})`);
  }

  if (params.excludeIds && params.excludeIds.length > 0) {
    const excludeArr = `{${params.excludeIds.join(",")}}`;
    conditions.push(sql`id <> ALL(${excludeArr}::uuid[])`);
  }

  const where = conditions.reduce((acc, cond) => sql`${acc} AND ${cond}`);
  const rows = await sql<DbRow[]>`
    SELECT id, data
    FROM grids.records
    WHERE ${where}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  // Build labels using the same rules as buildRelationLabelCache:
  // joined presentable fields > id-prefix.
  const items = rows.map((row) => {
    const id = row.id as string;
    const data = parseJsonbRow<Record<string, unknown>>(row.data, {});
    let label: string;
    if (presentable.length > 0) {
      const parts = presentable
        .map((f) => formatLabelPart(data[f.id]))
        .filter((s) => s.length > 0);
      label = parts.length > 0 ? parts.join(" · ") : id.slice(0, 8);
    } else {
      label = id.slice(0, 8);
    }
    return { id, label };
  });

  return { items };
};

/** Tiny stringifier for relation-label parts. Coerces scalars and
 *  picks a sensible value for objects (currency.amount, location.label). */
const formatLabelPart = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(formatLabelPart).filter(Boolean).join(", ");
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    if (typeof obj.label === "string") return obj.label;
    if (typeof obj.amount === "string") return obj.amount;
    return "";
  }
  return String(v);
};
