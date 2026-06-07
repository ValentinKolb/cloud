import { sql } from "bun";
import { storageOf } from "./field-storage";
import { get as getField } from "./fields";
import type { Field } from "./types";

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

type ComputedProjection = {
  /** The lookup/rollup field whose value this projection produces. */
  fieldId: string;
  /** SQL alias under which the value is exposed in the SELECT list. */
  alias: string;
  /** Effective output type — used to normalize bun-sql values into JSON-safe record.data. */
  outputType: "text" | "numeric" | "int" | "date" | "timestamptz" | "boolean" | "json";
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
 *
 * Async because rollup/lookup `targetFieldId` lives on a DIFFERENT
 * table (the relation's target). The source-field list passed in only
 * has the current table's fields; we fetch missing target fields
 * one by one. Cross-table targets are common in real schemas, so
 * resolving them is necessary so the storage descriptor can project
 * the target field with the same rules as filters, sorts, and
 * aggregates. Without this lookup, cross-table rollup columns were
 * silently skipped.
 */
export const buildComputedProjections = async (fields: Field[]): Promise<ComputedProjection[]> => {
  const fieldsById = new Map(fields.map((f) => [f.id, f]));
  const out: ComputedProjection[] = [];

  const targetFieldCache = new Map<string, Field | null>();
  const resolveTargetField = async (id: string): Promise<Field | null> => {
    if (fieldsById.has(id)) return fieldsById.get(id)!;
    if (targetFieldCache.has(id)) return targetFieldCache.get(id)!;
    const f = await getField(id);
    targetFieldCache.set(id, f);
    return f;
  };

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
      const targetField = await resolveTargetField(cfg.targetFieldId);
      if (!targetField || targetField.deletedAt) continue;
      const descriptor = storageOf(targetField);
      const projected =
        descriptor.kind === "jsonbArray" || descriptor.kind === "json"
          ? sql`t.data->${cfg.targetFieldId}`
          : descriptor.project(targetField, "t");
      if (!projected) continue;
      const outputType =
        descriptor.kind === "numeric"
          ? "numeric"
          : descriptor.kind === "date"
            ? (targetField.config as { includeTime?: boolean }).includeTime
              ? "timestamptz"
              : "date"
            : descriptor.kind === "datetime"
              ? "timestamptz"
              : descriptor.kind === "boolean"
                ? "boolean"
                : descriptor.kind === "jsonbArray" || descriptor.kind === "json"
                  ? "json"
                  : "text";

      // First non-null projected value, in link-position order. The target
      // field drives the SQL projection so lookup values keep their real
      // shape (number/date/select/json) instead of being flattened to text.
      out.push({
        fieldId: field.id,
        alias: lookupAlias(field.id),
        outputType,
        fragment: sql`
          (SELECT ${projected}
           FROM grids.record_links rl
           JOIN grids.records t ON t.id = rl.to_record_id
           WHERE rl.from_record_id = r.id
             AND rl.from_field_id = ${cfg.relationFieldId}::uuid
             AND t.deleted_at IS NULL
             AND t.data->${cfg.targetFieldId} IS NOT NULL
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

    // sum / avg / min / max — numeric only. Resolve the target field's
    // storage descriptor so rollups use the same typed projection as
    // filters, sorts, groups, and aggregates.
    const aggFn =
      cfg.agg === "sum" ? sql`SUM` : cfg.agg === "avg" ? sql`AVG` : cfg.agg === "min" ? sql`MIN` : cfg.agg === "max" ? sql`MAX` : null;
    if (!aggFn) continue;

    const targetField = await resolveTargetField(cfg.targetFieldId);
    if (!targetField || targetField.deletedAt) continue;
    const targetProjection = storageOf(targetField).project(targetField, "t");
    if (!targetProjection) {
      // Target type is non-projectable (relation/lookup/rollup/formula/
      // select/json/system-without-numeric). Skip silently — the
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
      if (p.outputType === "date") {
        rec.data[p.fieldId] = raw instanceof Date ? raw.toISOString().slice(0, 10) : raw;
        continue;
      }
      if (p.outputType === "timestamptz") {
        rec.data[p.fieldId] = raw instanceof Date ? raw.toISOString() : raw;
        continue;
      }
      if (p.outputType === "boolean") {
        rec.data[p.fieldId] = typeof raw === "boolean" ? raw : raw === "true" ? true : raw === "false" ? false : null;
        continue;
      }
      rec.data[p.fieldId] = raw;
    }
  }
};
