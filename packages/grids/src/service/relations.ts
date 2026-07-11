import { toPgUuidArray } from "@valentinkolb/cloud/services";
import { sql } from "bun";
import { listByTable as listFields } from "./fields";
import { parseJsonbRow } from "./jsonb";
import { liveRecordParentJoinSql } from "./parent-checks";
import { hasAtLeast, loadGrantsForUser, resolveEffectivePermission } from "./permission-resolver";
import { readRecordLinksBatch } from "./relation-links";
import { get as getTable } from "./tables";
import type { Field, GridRecord } from "./types";

export { enrichRecordsWithComputedColumns, enrichRecordsWithFormulas } from "./relation-formulas";
export { hydrateRelationsFromLinks, validateRelationTargets, writeRecordLinks } from "./relation-links";

type DbRow = Record<string, unknown>;
const LABEL_TEXT_TYPES = new Set(["text"]);

export const relationLabelFields = (fields: Field[]): Field[] => {
  const alive = fields.filter((f) => !f.deletedAt).sort((a, b) => a.position - b.position);
  const presentable = alive.filter((f) => f.presentable);
  if (presentable.length > 0) return presentable;
  const firstText = alive.find((f) => LABEL_TEXT_TYPES.has(f.type));
  return firstText ? [firstText] : [];
};

/**
 * SSR helper: walks every relation field on the visible records and
 * builds `recordId → label` for every linked target record. Labels use
 * the target table's `presentable` fields (joined with " · "), then
 * automatically fall back to the first text-shaped field.
 *
 * Single SQL round-trip per target table — `WHERE id = ANY(uuid[])`.
 * Empty input → empty map; non-relation fields are skipped.
 */
export const buildRelationLabelCache = async (
  records: GridRecord[],
  fields: Field[],
  viewer?: ExpansionViewer,
): Promise<Record<string, string>> => {
  const idsByTargetTable = new Map<string, Set<string>>();

  const relationFields = fields.filter((f) => f.type === "relation" && !f.deletedAt);
  if (relationFields.length === 0 || records.length === 0) return {};

  // Pull links from record_links in one batch; the JSONB array on
  // record.data is no longer authoritative.
  const links = await readRecordLinksBatch(
    records.map((r) => r.id),
    relationFields.map((rf) => rf.id),
  );

  for (const rf of relationFields) {
    const cfg = rf.config as { targetTableId?: string };
    if (!cfg.targetTableId) continue;
    const set = idsByTargetTable.get(cfg.targetTableId) ?? new Set<string>();
    for (const rec of records) {
      const linked = links.get(rec.id)?.get(rf.id);
      if (linked) for (const id of linked) set.add(id);
    }
    idsByTargetTable.set(cfg.targetTableId, set);
  }

  const gated = viewer ? await filterTargetsByViewerPermission(idsByTargetTable, viewer) : idsByTargetTable;
  return resolveLabelsByTargetTable(gated);
};

/**
 * Resolve presentable labels for a batch of (targetTable, recordId)
 * pairs. ONE SQL round-trip per target table.
 *
 * Label-resolution rule (single source of truth, evaluated top-down):
 *
 *   1. presentable fields on the target table, joined by " · " in
 *      position order. The table-owner's "what represents a row in
 *      this table" decision.
 *   2. First non-deleted text-shaped field on the target table.
 *      Defensive fallback so a relation always renders something
 *      readable even when nobody configured anything.
 *   3. "Untitled record". Last resort.
 *
 * Splits out so that callers operating on group buckets (whose keys are
 * already raw target-record UUIDs, not records on the source table)
 * can reuse the lookup without manufacturing a fake `GridRecord[]`.
 */
const resolveLabelsByTargetTable = async (idsByTargetTable: Map<string, Set<string>>): Promise<Record<string, string>> => {
  const cache: Record<string, string> = {};
  if (idsByTargetTable.size === 0) return cache;

  for (const [targetTableId, idSet] of idsByTargetTable) {
    if (idSet.size === 0) continue;
    const targetFields = await listFields(targetTableId);
    const labelFields = relationLabelFields(targetFields);
    const idArr = toPgUuidArray([...idSet]);
    const rows = await sql<DbRow[]>`
      SELECT r.id, r.data
      FROM grids.records r
      ${liveRecordParentJoinSql("r", "rt", "rb")}
      WHERE r.id = ANY(${idArr}::uuid[])
        AND r.table_id = ${targetTableId}::uuid
        AND r.deleted_at IS NULL
    `;
    for (const row of rows) {
      const id = row.id as string;
      const data = parseJsonbRow<Record<string, unknown>>(row.data, {});
      let label: string | null = null;

      if (labelFields.length > 0) {
        const parts = labelFields.map((f) => formatLabelPart(data[f.id])).filter((s) => s.length > 0);
        if (parts.length > 0) label = parts.join(" · ");
      }
      cache[id] = label ?? "Untitled record";
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
  viewer?: ExpansionViewer,
): Promise<Record<string, string>> => {
  if (buckets.length === 0) return {};
  const fieldsById = new Map(fields.map((f) => [f.id, f]));
  const idsByTargetTable = new Map<string, Set<string>>();
  for (let i = 0; i < groupByFieldIds.length; i++) {
    const f = fieldsById.get(groupByFieldIds[i]!);
    if (!f || f.type !== "relation" || f.deletedAt) continue;
    const cfg = f.config as { targetTableId?: string };
    if (!cfg.targetTableId) continue;
    const set = idsByTargetTable.get(cfg.targetTableId) ?? new Set<string>();
    for (const b of buckets) {
      const k = b.keys[i];
      if (typeof k === "string" && k.length > 0) set.add(k);
    }
    idsByTargetTable.set(cfg.targetTableId, set);
  }
  const gated = viewer ? await filterTargetsByViewerPermission(idsByTargetTable, viewer) : idsByTargetTable;
  return resolveLabelsByTargetTable(gated);
};

/**
 * Resolve labels for relation ids the caller already has. This is used by
 * read-only projections such as GQL preview where the SQL result carries raw
 * target UUIDs but does not return normal GridRecord shapes.
 */
export const buildRelationLabelCacheForIds = async (
  idsByTargetTable: Map<string, Set<string>>,
  viewer?: ExpansionViewer,
): Promise<Record<string, string>> => {
  const gated = viewer ? await filterTargetsByViewerPermission(idsByTargetTable, viewer) : idsByTargetTable;
  return resolveLabelsByTargetTable(gated);
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
 * Viewer context that gates relation expansion by per-target-table
 * read permission. Pass to `attachRelationExpansion` /
 * `buildRelationExpansionCache` to ensure links to records in tables
 * the viewer can't read are NOT expanded — the renderer falls back
 * to a neutral placeholder, matching the access experience the
 * user would have if they navigated to the target table directly.
 */
export type ExpansionViewer = {
  userId: string | null;
  userGroups: string[];
  serviceAccountId?: string | null;
  /** Trusted internal renderers can bypass per-resource ACLs after their own gate. */
  isAdmin?: boolean;
};

/**
 * Filters the (targetTable → recordIds) map down to only the target
 * tables the viewer has at least `read` on. Runs grant resolution in
 * parallel — N targets cost ~N permission-resolver roundtrips (each
 * a single UNION ALL query). Target tables that don't exist are
 * dropped silently; the renderer falls back to a neutral placeholder.
 *
 * Cross-base relations work: each target's `baseId` is looked up
 * independently, and grants are resolved within that target's base.
 * Trusted internal renderers (`viewer.isAdmin`) bypass the check entirely.
 */
const filterTargetsByViewerPermission = async (
  idsByTargetTable: Map<string, Set<string>>,
  viewer: ExpansionViewer,
): Promise<Map<string, Set<string>>> => {
  if (viewer.isAdmin) return idsByTargetTable;
  const entries = [...idsByTargetTable.entries()];
  const verdicts = await Promise.all(
    entries.map(async ([tableId, ids]) => {
      const target = await getTable(tableId);
      if (!target) return null;
      const grants = await loadGrantsForUser({
        userId: viewer.userId,
        userGroups: viewer.userGroups,
        serviceAccountId: viewer.serviceAccountId,
        baseId: target.baseId,
        tableId,
      });
      const level = resolveEffectivePermission(grants, { baseId: target.baseId, tableId });
      return hasAtLeast(level, "read") ? ([tableId, ids] as const) : null;
    }),
  );
  const filtered = new Map<string, Set<string>>();
  for (const entry of verdicts) {
    if (entry) filtered.set(entry[0], entry[1]);
  }
  return filtered;
};

/**
 * Identical signature to `buildRelationLabelCache` but returns raw
 * presentable fields instead of a joined label string. Each entry in
 * the returned map is the linked record's `data` filtered down to the
 * fields the UI needs to render a label — the target table's
 * presentable fields, or the first text-shaped field as fallback.
 *
 * Empty input → empty map. Records linking to nonexistent / soft-
 * deleted targets are silently dropped (renderer falls back to a
 * neutral placeholder).
 *
 * Pass `viewer` to gate expansion by per-target-table read permission —
 * tables the viewer can't read are dropped from the result, so a row
 * referencing a forbidden record renders as a neutral placeholder
 * instead of leaking the linked row's data. Omit for unfiltered expansion (used
 * by internal paths that already gated access elsewhere).
 */
export const buildRelationExpansionCache = async (
  records: GridRecord[],
  fields: Field[],
  viewer?: ExpansionViewer,
): Promise<Record<string, Record<string, unknown>>> => {
  const relationFields = fields.filter((f) => f.type === "relation" && !f.deletedAt);
  if (relationFields.length === 0 || records.length === 0) return {};

  const links = await readRecordLinksBatch(
    records.map((r) => r.id),
    relationFields.map((rf) => rf.id),
  );

  const idsByTargetTable = new Map<string, Set<string>>();
  for (const rf of relationFields) {
    const cfg = rf.config as { targetTableId?: string };
    if (!cfg.targetTableId) continue;
    const set = idsByTargetTable.get(cfg.targetTableId) ?? new Set<string>();
    for (const rec of records) {
      const linked = links.get(rec.id)?.get(rf.id);
      if (linked) for (const id of linked) set.add(id);
    }
    idsByTargetTable.set(cfg.targetTableId, set);
  }

  const gated = viewer ? await filterTargetsByViewerPermission(idsByTargetTable, viewer) : idsByTargetTable;

  return resolveExpansionByTargetTable(gated);
};

/**
 * Lower-level expansion resolver — input is already grouped by target
 * table. ONE SQL round-trip per target table. Picks the field set
 * needed for label rendering, filters
 * the linked records' data down to those, and stitches them into a
 * single flat `uuid → fields` map keyed across all target tables.
 *
 * Splits out like `resolveLabelsByTargetTable` so the grouped-buckets
 * path (whose keys are raw target-record UUIDs, not records on the
 * source table) can call it directly when we wire group-bucket
 * expansion in a later phase.
 */
const resolveExpansionByTargetTable = async (
  idsByTargetTable: Map<string, Set<string>>,
): Promise<Record<string, Record<string, unknown>>> => {
  const out: Record<string, Record<string, unknown>> = {};
  if (idsByTargetTable.size === 0) return out;

  for (const [targetTableId, idSet] of idsByTargetTable) {
    if (idSet.size === 0) continue;
    const targetFields = await listFields(targetTableId);
    const labelFields = relationLabelFields(targetFields);
    if (labelFields.length === 0) continue;

    const idArr = toPgUuidArray([...idSet]);
    const rows = await sql<DbRow[]>`
      SELECT r.id, r.data
      FROM grids.records r
      ${liveRecordParentJoinSql("r", "rt", "rb")}
      WHERE r.id = ANY(${idArr}::uuid[])
        AND r.table_id = ${targetTableId}::uuid
        AND r.deleted_at IS NULL
    `;
    for (const row of rows) {
      const id = row.id as string;
      const data = parseJsonbRow<Record<string, unknown>>(row.data, {});
      const subset: Record<string, unknown> = {};

      for (const f of labelFields) {
        const v = data[f.id];
        if (v !== null && v !== undefined && v !== "") subset[f.id] = v;
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
 * Pass `viewer` to gate expansion by per-target-table read access —
 * records the viewer can't reach contribute UUIDs that don't expand,
 * and the renderer falls back to a neutral placeholder for those. Omit for
 * unfiltered expansion (use only when the surrounding call site has
 * already gated access).
 *
 * Mutates the records in place — they're freshly constructed from
 * `mapRow` and have no external observers at this point in the call
 * chain. Returns void; the side-effected records are what callers
 * already have a handle on.
 */
export const attachRelationExpansion = async (records: GridRecord[], fields: Field[], viewer?: ExpansionViewer): Promise<void> => {
  if (records.length === 0) return;
  const expansion = await buildRelationExpansionCache(records, fields, viewer);
  if (Object.keys(expansion).length === 0) return;
  const relationFieldIds = fields.filter((f) => f.type === "relation" && !f.deletedAt).map((f) => f.id);
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
  const presentable = relationLabelFields(fields);

  const searchTargets = presentable.filter((f) => LABEL_TEXT_TYPES.has(f.type));

  const conditions: any[] = [sql`r.table_id = ${params.targetTableId}::uuid`, sql`r.deleted_at IS NULL`];

  const q = params.q?.trim();
  if (q && searchTargets.length > 0) {
    const pattern = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const orClauses = searchTargets.map((f) => sql`r.data->>${f.id} ILIKE ${pattern}`);
    const orClause = orClauses.reduce((acc, cur) => sql`${acc} OR ${cur}`);
    conditions.push(sql`(${orClause})`);
  }

  if (params.excludeIds && params.excludeIds.length > 0) {
    conditions.push(sql`r.id <> ALL(${sql.array(params.excludeIds, "UUID")})`);
  }

  const where = conditions.reduce((acc, cond) => sql`${acc} AND ${cond}`);
  const rows = await sql<DbRow[]>`
    SELECT r.id, r.data
    FROM grids.records r
    ${liveRecordParentJoinSql("r", "rt", "rb")}
    WHERE ${where}
    ORDER BY r.created_at DESC
    LIMIT ${limit}
  `;

  // Build labels using the same rules as buildRelationLabelCache:
  // joined presentable fields, first text fallback, then neutral fallback.
  const items = rows.map((row) => {
    const id = row.id as string;
    const data = parseJsonbRow<Record<string, unknown>>(row.data, {});
    let label: string;
    if (presentable.length > 0) {
      const parts = presentable.map((f) => formatLabelPart(data[f.id])).filter((s) => s.length > 0);
      label = parts.length > 0 ? parts.join(" · ") : "Untitled record";
    } else {
      label = "Untitled record";
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
