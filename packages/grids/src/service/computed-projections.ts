import { sql } from "bun";
import type { Field } from "./types";
import { storageOf } from "./field-storage";

/**
 * Per-row SELECT-list projections for lookup and rollup fields.
 *
 * v3 (Slice 4) moves these computed values from a read-time JS pass to
 * the main records query as correlated subqueries over the
 * `record_links` junction. Wins:
 *
 *  - One query per page instead of N + 1 (one per lookup/rollup field
 *    via the old JS enrichment pipeline).
 *  - Single source of truth — no JS/SQL drift between filter scope and
 *    enrichment scope.
 *  - Filter / sort / group on lookup-rollup values becomes a tractable
 *    extension (the values are already real columns in the result set).
 *
 * Each projection is an independent correlated subquery rather than a
 * LEFT JOIN; that lets us mix any number of lookup/rollup fields on a
 * row without combinatorial join blow-up. Postgres' per-row evaluation
 * of correlated subqueries is fine here: relation cardinalities are
 * small (records typically link to 0–10 targets) and `record_links`
 * has the (from_record_id, from_field_id, position) index that makes
 * each subquery a tiny index scan.
 */

export type ComputedProjection = {
  /** The lookup/rollup field whose value this projection produces. */
  fieldId: string;
  /** SQL alias under which the value is exposed in the SELECT list. */
  alias: string;
  /** Effective output type — `text` for lookup, `numeric` or `int` for rollup. */
  outputType: "text" | "numeric" | "int" | "date" | "timestamptz";
  /** The full SQL fragment to embed AFTER `r.*,` in the SELECT list. */
  fragment: any;
};

const lookupAlias = (fieldId: string): string => `lkp_${fieldId.replace(/-/g, "")}`;
const rollupAlias = (fieldId: string): string => `rlp_${fieldId.replace(/-/g, "")}`;

/**
 * Walks the fields list and emits a projection per lookup/rollup that
 * has a complete config. Incomplete fields (config missing
 * relationFieldId / targetFieldId / agg) are silently skipped — the
 * UI lets users add the field first and configure later, so a partial
 * config is a normal intermediate state, not an error.
 */
export const buildComputedProjections = (fields: Field[]): ComputedProjection[] => {
  const fieldsById = new Map(fields.map((f) => [f.id, f]));
  const out: ComputedProjection[] = [];

  for (const field of fields) {
    if (field.deletedAt) continue;
    if (field.type !== "lookup" && field.type !== "rollup") continue;
    const cfg = field.config as {
      relationFieldId?: string;
      targetFieldId?: string;
      agg?: "count" | "sum" | "avg" | "min" | "max";
    };
    if (!cfg.relationFieldId) continue;

    const relationField = fieldsById.get(cfg.relationFieldId);
    if (!relationField || relationField.type !== "relation") continue;

    if (field.type === "lookup") {
      if (!cfg.targetFieldId) continue;
      // First non-null projected value, in link-position order. Returns
      // text because we don't know the target field's storage type at
      // SQL-emit time — the renderer / detail panel does the per-type
      // formatting using the resolved target-field metadata anyway.
      out.push({
        fieldId: field.id,
        alias: lookupAlias(field.id),
        outputType: "text",
        fragment: sql`
          (SELECT t.data->>${cfg.targetFieldId}
           FROM grids.record_links rl
           JOIN grids.records t ON t.id = rl.to_record_id
           WHERE rl.from_record_id = r.id
             AND rl.from_field_id = ${cfg.relationFieldId}::uuid
             AND t.deleted_at IS NULL
             AND t.data->>${cfg.targetFieldId} IS NOT NULL
           ORDER BY rl.position
           LIMIT 1) AS ${sql.unsafe(lookupAlias(field.id))}
        `,
      });
      continue;
    }

    // rollup
    if (cfg.agg === "count") {
      // count(*) over linked records — no target-field projection needed,
      // and rollup-count works even when targetFieldId is unset.
      out.push({
        fieldId: field.id,
        alias: rollupAlias(field.id),
        outputType: "int",
        fragment: sql`
          (SELECT count(*)::bigint
           FROM grids.record_links rl
           JOIN grids.records t ON t.id = rl.to_record_id
           WHERE rl.from_record_id = r.id
             AND rl.from_field_id = ${cfg.relationFieldId}::uuid
             AND t.deleted_at IS NULL) AS ${sql.unsafe(rollupAlias(field.id))}
        `,
      });
      continue;
    }

    if (!cfg.targetFieldId || !cfg.agg) continue;

    // sum / avg / min / max — numeric only. Resolves the target field's
    // storage descriptor so currency targets project the nested `amount`
    // (not the JSON-stringified blob). Closes chunk 3's "currency
    // rollups coerced differently from aggregates" critical: without
    // the descriptor, this path used `data->>${targetFieldId}` which
    // returned the JSON object as a text and try_numeric coerced to
    // NULL. Now currency rollups produce real amounts.
    const aggFn =
      cfg.agg === "sum" ? sql`SUM`
      : cfg.agg === "avg" ? sql`AVG`
      : cfg.agg === "min" ? sql`MIN`
      : cfg.agg === "max" ? sql`MAX`
      : null;
    if (!aggFn) continue;

    const targetField = fieldsById.get(cfg.targetFieldId);
    if (!targetField) continue;
    const targetProjection = storageOf(targetField).project(targetField, "t");
    if (!targetProjection) {
      // Target type is non-projectable (relation/lookup/rollup/formula/
      // multi-select/json/system-without-numeric). Skip silently — the
      // UI's lookup/rollup config editor should validate this at
      // save-time (Wave 5.2). Until then, a partial / nonsensical config
      // produces no rollup column rather than a crash.
      continue;
    }

    out.push({
      fieldId: field.id,
      alias: rollupAlias(field.id),
      outputType: "numeric",
      fragment: sql`
        (SELECT ${aggFn}(${targetProjection})
         FROM grids.record_links rl
         JOIN grids.records t ON t.id = rl.to_record_id
         WHERE rl.from_record_id = r.id
           AND rl.from_field_id = ${cfg.relationFieldId}::uuid
           AND t.deleted_at IS NULL) AS ${sql.unsafe(rollupAlias(field.id))}
      `,
    });
  }

  return out;
};

/**
 * Reads the computed-column values from a result row and merges them
 * into `record.data` under the lookup/rollup field's id. After this,
 * downstream code can treat the value as if it lived in JSONB —
 * exactly the contract the JS-based enrichment used to provide.
 */
export const applyComputedProjections = (
  rows: Array<Record<string, unknown>>,
  recordsById: Map<string, { data: Record<string, unknown> }>,
  projections: ComputedProjection[],
): void => {
  if (projections.length === 0) return;
  for (const row of rows) {
    const id = row.id as string;
    const rec = recordsById.get(id);
    if (!rec) continue;
    for (const p of projections) {
      const raw = row[p.alias];
      if (raw === null || raw === undefined) {
        rec.data[p.fieldId] = null;
        continue;
      }
      // bun-sql returns numeric/bigint values as JS numbers or strings
      // depending on size. Coerce to number for output-types we know
      // are numeric so the JSON payload is consistent.
      if (p.outputType === "numeric" || p.outputType === "int") {
        const n = typeof raw === "number" ? raw : Number(raw as string);
        rec.data[p.fieldId] = Number.isFinite(n) ? n : null;
        continue;
      }
      rec.data[p.fieldId] = raw;
    }
  }
};
