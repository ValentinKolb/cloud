import { sql } from "bun";
import { listByTable as listFields } from "./fields";
import { parseJsonbRow } from "./jsonb";
import type { SqlClient } from "./audit";
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
  client?: SqlClient,
): Promise<void> => {
  // When a tx client is supplied, run inside the caller's transaction so
  // record-row + link writes are atomic. When called bare (no tx), open
  // our own transaction so DELETE+INSERT remain atomic for that pair.
  if (client) {
    await runInClient(client, fromRecordId, fromFieldId, toRecordIds);
    return;
  }
  await sql.begin((tx) => runInClient(tx, fromRecordId, fromFieldId, toRecordIds));
};

const runInClient = async (
  client: SqlClient,
  fromRecordId: string,
  fromFieldId: string,
  toRecordIds: string[],
): Promise<void> => {
  await client`
    DELETE FROM grids.record_links
    WHERE from_record_id = ${fromRecordId}::uuid
      AND from_field_id = ${fromFieldId}::uuid
  `;
  if (toRecordIds.length === 0) return;
  // Build a single VALUES tuple list so the INSERT runs in one round-trip.
  // Position preserves the user-ordered cardinality:multiple semantic.
  const values = toRecordIds
    .map((id, i) => client`(${fromRecordId}::uuid, ${fromFieldId}::uuid, ${id}::uuid, ${i})`)
    .reduce((acc, cur) => client`${acc}, ${cur}`);
  await client`
    INSERT INTO grids.record_links (from_record_id, from_field_id, to_record_id, position)
    VALUES ${values}
    ON CONFLICT (from_record_id, from_field_id, to_record_id) DO UPDATE
      SET position = EXCLUDED.position
  `;
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

  // DFS-based topological sort with cycle detection. Tracks the active
  // stack as an ordered array (not just a Set) so that when we re-enter
  // a node we can mark every member from that re-entry point onward —
  // not just the re-entered node and the immediate unwinder. Previously
  // a cycle A→B→C→A only marked {A, C} (B silently rendered as the
  // last-iteration value, chunk 6 critical).
  const ordered: typeof compiled = [];
  const visited = new Set<string>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycle = new Set<string>();

  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (onStack.has(id)) {
      // Found a back-edge. Mark every stack frame from the first
      // occurrence of `id` onward — these are the cycle members.
      const startIdx = stack.indexOf(id);
      for (let i = startIdx; i < stack.length; i++) cycle.add(stack[i]!);
      return;
    }
    const node = byId.get(id);
    if (!node) return;
    stack.push(id);
    onStack.add(id);
    for (const ref of node.refs) {
      if (idSet.has(ref)) visit(ref);
    }
    stack.pop();
    onStack.delete(id);
    visited.add(id);
    ordered.push(node);
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
    if (!f.deletedAt && f.shortId) slugToId[f.shortId] = f.id;
  }

  const { ordered, cycle } = orderFormulasByDeps(formulaFields, slugToId);

  for (const rec of records) {
    // Two-pass evaluation. Previously we wrote the RENDERED display
    // string into rec.data[fid] after each formula, so a downstream
    // formula referencing the errored one saw "#DIV_ZERO" as a plain
    // string and either nulled or concatenated it (chunk 6 critical).
    //
    // Now: build a scratch lookup that overlays raw evaluator results
    // (FormulaError sentinels included) on top of rec.data. The
    // evaluator still gets a plain Record<string, unknown>; isFormulaError
    // checks in downstream formulas now hit the raw error. Render to
    // display strings only after every formula has been evaluated.
    const scratch: Record<string, unknown> = { ...rec.data };
    for (const id of cycle) {
      scratch[id] = formulaError("CYCLE");
    }
    for (const { field, ast } of ordered) {
      if (cycle.has(field.id)) continue;
      const value = evaluate(ast, { fields: scratch, slugToId });
      scratch[field.id] = value;
    }
    // Render once at the end — every formula's display string is now
    // computed against the final raw values, errors propagated honestly.
    for (const { field } of ordered) {
      rec.data[field.id] = renderResult(scratch[field.id]);
    }
    for (const id of cycle) {
      rec.data[id] = renderResult(scratch[id]);
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
 * pairs. ONE SQL round-trip per target table.
 *
 * Label-resolution rule (single source of truth, evaluated top-down):
 *
 *   1. relation.config.displayFieldId — the relation-owner's explicit
 *      per-relation override. Wins over everything when set AND points
 *      at a non-empty value on the target row.
 *   2. presentable fields on the target table, joined by " · " in
 *      position order. The table-owner's "what represents a row in
 *      this table" decision.
 *   3. First non-deleted text-shaped field on the target table.
 *      Defensive fallback so a relation always renders something
 *      readable even when nobody configured anything.
 *   4. 8-char id prefix. Last resort.
 *
 * Why displayFieldId now beats presentable (was the other way around
 * pre-cleanup): an explicit per-relation setting was being silently
 * overridden by the table's presentable flags, which surprised users
 * who configured displayFieldId expecting it to take effect. The new
 * order matches "more specific config wins" — table-level convention
 * provides the default, relation-level override applies on top.
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

  const TEXT_KINDS = new Set([
    "text",
    "longtext",
    "email",
    "url",
    "phone",
    "slug",
    "barcode",
    "isbn",
  ]);

  for (const [targetTableId, idSet] of idsByTargetTable) {
    if (idSet.size === 0) continue;
    const targetFields = await listFields(targetTableId);
    const alive = targetFields.filter((f) => !f.deletedAt);
    const presentable = alive
      .filter((f) => f.presentable)
      .sort((a, b) => a.position - b.position);
    const firstText = alive
      .slice()
      .sort((a, b) => a.position - b.position)
      .find((f) => TEXT_KINDS.has(f.type));
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
      let label: string | null = null;

      // 1. per-relation displayFieldId override
      if (displayFieldId && data[displayFieldId] != null) {
        const v = formatLabelPart(data[displayFieldId]);
        if (v.length > 0) label = v;
      }
      // 2. presentable fields joined
      if (label === null && presentable.length > 0) {
        const parts = presentable
          .map((f) => formatLabelPart(data[f.id]))
          .filter((s) => s.length > 0);
        if (parts.length > 0) label = parts.join(" · ");
      }
      // 3. first text-shaped field
      if (label === null && firstText && data[firstText.id] != null) {
        const v = formatLabelPart(data[firstText.id]);
        if (v.length > 0) label = v;
      }
      // 4. id prefix fallback
      cache[id] = label ?? id.slice(0, 8);
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

// =============================================================================
// Expansion (Phase 1 of the records-API refactor)
// =============================================================================
//
// `buildRelationLabelCache` (above) returns Record<uuid, string> — the joined
// label string ready to drop into the UI. That's been useful but rigid: it
// commits the server to one specific label format.
//
// `buildRelationExpansionCache` returns the RAW presentable fields per linked
// record instead: Record<uuid, Record<fieldId, unknown>>. The client can
// render whichever subset it wants — primary label in a cell, full presentable
// breakdown in a tooltip, custom join order, etc. This is the form embedded
// in `record.expanded` when service calls are passed `includeRelations: true`.
//
// Both functions use the same batched roundtrip pattern:
//   1× readRecordLinksBatch   (all links across all relation fields)
//   T× SELECT id,data         (one per unique target table)
// No N+1, regardless of record count or relation-cell count.
// =============================================================================

/**
 * Identical signature to `buildRelationLabelCache` but returns raw
 * presentable fields instead of a joined label string. Each entry in
 * the returned map is the linked record's `data` filtered down to the
 * fields the UI needs to render a label — the target table's
 * presentable fields PLUS any per-relation `displayFieldId` override.
 *
 * Empty input → empty map. Records linking to nonexistent / soft-
 * deleted targets are silently dropped (renderer falls back to a UUID
 * prefix).
 */
export const buildRelationExpansionCache = async (
  records: GridRecord[],
  fields: Field[],
): Promise<Record<string, Record<string, unknown>>> => {
  const relationFields = fields.filter((f) => f.type === "relation" && !f.deletedAt);
  if (relationFields.length === 0 || records.length === 0) return {};

  const links = await readRecordLinksBatch(
    records.map((r) => r.id),
    relationFields.map((rf) => rf.id),
  );

  const idsByTargetTable = new Map<string, Set<string>>();
  const displayFieldByTargetTable = new Map<string, string | undefined>();
  for (const rf of relationFields) {
    const cfg = rf.config as { targetTableId?: string; displayFieldId?: string };
    if (!cfg.targetTableId) continue;
    // Record the displayFieldId for THIS target table. If two relation
    // fields point at the same target table with different display
    // overrides, the LAST one wins — same precedence as buildLabelCache
    // (intentionally lossy here; the override is a table-level hint).
    displayFieldByTargetTable.set(cfg.targetTableId, cfg.displayFieldId);
    const set = idsByTargetTable.get(cfg.targetTableId) ?? new Set<string>();
    for (const rec of records) {
      const linked = links.get(rec.id)?.get(rf.id);
      if (linked) for (const id of linked) set.add(id);
    }
    idsByTargetTable.set(cfg.targetTableId, set);
  }

  return resolveExpansionByTargetTable(idsByTargetTable, displayFieldByTargetTable);
};

/**
 * Lower-level expansion resolver — input is already grouped by target
 * table. ONE SQL round-trip per target table. Picks the field set
 * needed for label rendering (presentable + displayFieldId), filters
 * the linked records' data down to those, and stitches them into a
 * single flat `uuid → fields` map keyed across all target tables.
 *
 * Splits out like `resolveLabelsByTargetTable` so the grouped-buckets
 * path (whose keys are raw target-record UUIDs, not records on the
 * source table) can call it directly when we wire group-bucket
 * expansion in a later phase.
 */
export const resolveExpansionByTargetTable = async (
  idsByTargetTable: Map<string, Set<string>>,
  displayFieldByTargetTable: Map<string, string | undefined>,
): Promise<Record<string, Record<string, unknown>>> => {
  const out: Record<string, Record<string, unknown>> = {};
  if (idsByTargetTable.size === 0) return out;

  for (const [targetTableId, idSet] of idsByTargetTable) {
    if (idSet.size === 0) continue;
    const targetFields = await listFields(targetTableId);
    const alive = targetFields.filter((f) => !f.deletedAt);
    const presentable = alive
      .filter((f) => f.presentable)
      .sort((a, b) => a.position - b.position);
    const displayFieldId = displayFieldByTargetTable.get(targetTableId);

    // Fast-skip when neither presentable nor displayFieldId are set.
    // Without either, expansion has nothing to surface — the renderer
    // falls back to UUID-prefix. The payload-trim alternative (return
    // first text field) lives in buildRelationLabelCache; we match
    // the user's schema rather than guess for them.
    if (presentable.length === 0 && !displayFieldId) continue;

    // We need data for BOTH the presentable fields and displayFieldId,
    // because precedence is decided per-row (displayFieldId wins ONLY
    // when its value is non-empty for THAT row). So the SQL projection
    // pulls a superset; the per-row filter below picks the actual subset.
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
      const subset: Record<string, unknown> = {};

      // Precedence: displayFieldId wins (when set + non-empty) — emit
      // ONLY that one. Otherwise emit every presentable field that has
      // a value. Matches buildRelationLabelCache's label precedence so
      // a client-side join-with-" · " produces the same string the
      // server-side cache used to emit.
      const displayValue = displayFieldId ? data[displayFieldId] : undefined;
      if (
        displayFieldId &&
        displayValue !== null &&
        displayValue !== undefined &&
        displayValue !== ""
      ) {
        subset[displayFieldId] = displayValue;
      } else {
        for (const f of presentable) {
          const v = data[f.id];
          if (v !== null && v !== undefined && v !== "") subset[f.id] = v;
        }
      }
      if (Object.keys(subset).length > 0) out[id] = subset;
    }
  }
  return out;
};

/**
 * Service-internal helper used by every record-returning call when
 * the caller passes `includeRelations: true`. Builds the page-level
 * expansion map once, then walks the records and assigns the subset
 * of UUIDs each record actually links to as `record.expanded`.
 *
 * Mutates the records in place — they're freshly constructed from
 * `mapRow` and have no external observers at this point in the call
 * chain. Returns void; the side-effected records are what callers
 * already have a handle on.
 */
export const attachRelationExpansion = async (
  records: GridRecord[],
  fields: Field[],
): Promise<void> => {
  if (records.length === 0) return;
  const expansion = await buildRelationExpansionCache(records, fields);
  if (Object.keys(expansion).length === 0) return;
  const relationFieldIds = fields
    .filter((f) => f.type === "relation" && !f.deletedAt)
    .map((f) => f.id);
  if (relationFieldIds.length === 0) return;
  // Per-record subset: only attach entries this record actually
  // references. Avoids duplicating large shared maps across records
  // that don't all touch the same linked rows. Reads the linked-id
  // arrays directly from each record's data (already hydrated by
  // hydrateRelationsFromLinks earlier in the pipeline).
  for (const rec of records) {
    const linkedIds: string[] = [];
    for (const fid of relationFieldIds) {
      const v = rec.data[fid];
      if (Array.isArray(v)) {
        for (const id of v) if (typeof id === "string") linkedIds.push(id);
      } else if (typeof v === "string") {
        linkedIds.push(v);
      }
    }
    if (linkedIds.length === 0) continue;
    const subset: Record<string, Record<string, unknown>> = {};
    for (const id of linkedIds) {
      const fields = expansion[id];
      if (fields) subset[id] = fields;
    }
    if (Object.keys(subset).length > 0) rec.expanded = subset;
  }
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
