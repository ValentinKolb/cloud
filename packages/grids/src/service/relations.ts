import { sql } from "bun";
import { listByTable as listFields } from "./fields";
import { parseJsonbRow } from "./jsonb";
import { collectFieldRefs, parseFormula } from "../formula/parser";
import { evaluate, renderResult } from "../formula/evaluator";
import { formulaError } from "../formula/types";
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

  // Fetch the projected field from every target record in one go,
  // constrained to the relation's configured target table. Without the
  // table filter, a UUID from another table would silently leak its
  // data into the lookup / rollup pipeline.
  const targetTableId = (params.relationField.config as { targetTableId?: string }).targetTableId;
  if (!targetTableId) {
    return new Map(params.records.map((r) => [r.id, []]));
  }
  const ids = `{${[...allTargetIds].join(",")}}`;
  const rows = await sql<DbRow[]>`
    SELECT id, data
    FROM grids.records
    WHERE id = ANY(${ids}::uuid[])
      AND table_id = ${targetTableId}::uuid
      AND deleted_at IS NULL
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
 * Topologically orders formula fields by their inter-formula references.
 * A formula that depends on another formula's value evaluates AFTER its
 * dependency. Cycles are detected and surfaced as a #CYCLE error written
 * into every member's cell rather than crashing the read.
 */
const orderFormulasByDeps = (
  formulaFields: Field[],
): { ordered: Array<{ field: Field; ast: ReturnType<typeof parseFormula> extends infer R ? R extends { ok: true; ast: infer A } ? A : never : never }>; cycle: Set<string> } => {
  const compiled = formulaFields
    .map((f) => {
      const expr = (f.config as { expression?: string }).expression;
      if (!expr) return null;
      const parsed = parseFormula(expr);
      if (!parsed.ok) return null;
      const refs = collectFieldRefs(parsed.ast);
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

  const { ordered, cycle } = orderFormulasByDeps(formulaFields);

  for (const rec of records) {
    // Mark cycle members first so dependents see the error sentinel
    // instead of the previous-iteration's value.
    for (const id of cycle) {
      rec.data[id] = renderResult(formulaError("CYCLE"));
    }
    for (const { field, ast } of ordered) {
      if (cycle.has(field.id)) continue;
      const value = evaluate(ast, { fields: rec.data });
      rec.data[field.id] = renderResult(value);
    }
  }
  return records;
};

/**
 * Convenience: looks up the active fields for a table, then enriches
 * with both lookup/rollup values AND formula display strings. Used at
 * the records.list boundary so callers don't need to know about the
 * computed-field plumbing.
 */
export const enrichRecordsForTable = async (records: GridRecord[], tableId: string): Promise<GridRecord[]> => {
  if (records.length === 0) return records;
  const fields = await listFields(tableId);
  await enrichRecordsWithLookups(records, fields);
  enrichRecordsWithFormulas(records, fields);
  return records;
};
