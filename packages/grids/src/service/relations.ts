import { sql } from "bun";
import { listByTable as listFields } from "./fields";
import { parseJsonbRow } from "./jsonb";
import type { Field, GridRecord } from "./types";

type DbRow = Record<string, unknown>;

/**
 * Walks a record's relation field, fetches the target records, and
 * projects the given field on each. Used by both lookup (single value
 * passthrough) and rollup (aggregate over the values).
 *
 * Batched: fetches every linked record across the page in ONE query
 * so the read pipeline stays O(pages) rather than O(records-per-page).
 */
export const fetchLinkedValuesBatched = async (params: {
  records: GridRecord[];
  relationField: Field;
  targetFieldId: string;
}): Promise<Map<string, unknown[]>> => {
  // Collect every record-id this page links to via the relation field.
  const allTargetIds = new Set<string>();
  const perRecord = new Map<string, string[]>();
  for (const rec of params.records) {
    const v = rec.data[params.relationField.id];
    const ids = Array.isArray(v) ? (v as string[]) : typeof v === "string" ? [v] : [];
    perRecord.set(rec.id, ids);
    for (const id of ids) allTargetIds.add(id);
  }
  if (allTargetIds.size === 0) {
    return new Map(params.records.map((r) => [r.id, []]));
  }

  // Fetch the projected field from every target record in one go.
  const ids = `{${[...allTargetIds].join(",")}}`;
  const rows = await sql<DbRow[]>`
    SELECT id, data
    FROM grids.records
    WHERE id = ANY(${ids}::uuid[]) AND deleted_at IS NULL
  `;
  const valuesById = new Map<string, unknown>();
  for (const row of rows) {
    const data = parseJsonbRow<Record<string, unknown>>(row.data, {});
    valuesById.set(row.id as string, data[params.targetFieldId]);
  }

  // Map each source record back to its array of projected target values.
  const result = new Map<string, unknown[]>();
  for (const rec of params.records) {
    const ids = perRecord.get(rec.id) ?? [];
    result.set(
      rec.id,
      ids.map((tid) => valuesById.get(tid)).filter((v) => v !== undefined),
    );
  }
  return result;
};

/**
 * Computes lookup + rollup values for a page of records and merges them
 * into each record's `data`. Relation fields stay as their raw id arrays
 * (consumers can render labels separately). Errors per-field are swallowed
 * — a misconfigured rollup shouldn't break the whole list response.
 */
export const enrichRecordsWithLookups = async (
  records: GridRecord[],
  fields: Field[],
): Promise<GridRecord[]> => {
  const computedFields = fields.filter(
    (f) => !f.deletedAt && (f.type === "lookup" || f.type === "rollup"),
  );
  if (computedFields.length === 0) return records;

  const fieldsById = new Map(fields.map((f) => [f.id, f]));
  // Lookups + rollups can target relations on the SAME table only (Phase 4
  // doesn't traverse multi-hop). The targetFieldId resolves on the OTHER
  // table; we need its metadata for type-aware aggregation.
  for (const computed of computedFields) {
    const config = computed.config as {
      relationFieldId?: string;
      targetFieldId?: string;
      agg?: "count" | "sum" | "avg" | "min" | "max";
    };
    if (!config.relationFieldId || !config.targetFieldId) continue;
    const relationField = fieldsById.get(config.relationFieldId);
    if (!relationField || relationField.type !== "relation") continue;

    let valuesByRecord: Map<string, unknown[]>;
    try {
      valuesByRecord = await fetchLinkedValuesBatched({
        records,
        relationField,
        targetFieldId: config.targetFieldId,
      });
    } catch {
      continue;
    }

    for (const rec of records) {
      const linked = valuesByRecord.get(rec.id) ?? [];
      if (computed.type === "lookup") {
        // First non-empty value (or null). Multi-link lookup picks the
        // first match — power users can switch to rollup for a real
        // aggregate.
        rec.data[computed.id] = linked.find((v) => v !== null && v !== undefined) ?? null;
        continue;
      }
      // rollup
      const numeric = linked
        .map((v) => (typeof v === "number" ? v : Number(v)))
        .filter((n) => Number.isFinite(n));
      switch (config.agg) {
        case "count":
          rec.data[computed.id] = linked.length;
          break;
        case "sum":
          rec.data[computed.id] = numeric.reduce((a, b) => a + b, 0);
          break;
        case "avg":
          rec.data[computed.id] = numeric.length === 0 ? null : numeric.reduce((a, b) => a + b, 0) / numeric.length;
          break;
        case "min":
          rec.data[computed.id] = numeric.length === 0 ? null : Math.min(...numeric);
          break;
        case "max":
          rec.data[computed.id] = numeric.length === 0 ? null : Math.max(...numeric);
          break;
        default:
          rec.data[computed.id] = null;
      }
    }
  }
  return records;
};

/**
 * Convenience: looks up the active fields for a table, then enriches.
 * Used at the records.list boundary so callers don't need to know about
 * computed-field plumbing.
 */
export const enrichRecordsForTable = async (records: GridRecord[], tableId: string): Promise<GridRecord[]> => {
  if (records.length === 0) return records;
  const fields = await listFields(tableId);
  return enrichRecordsWithLookups(records, fields);
};
