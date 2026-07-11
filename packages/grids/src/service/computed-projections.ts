import type { DateContext } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type { ComputedColumnSpec } from "../contracts";
import { decimalStringToCanonical } from "../formula/numeric";
import { storageOf } from "./field-storage";
import { get as getField } from "./fields";
import { compileFormulaSourceToSql, type FormulaSqlExpression, type FormulaSqlType } from "./formula-sql-compiler";
import { liveRecordParentJoinSql } from "./parent-checks";
import { assertSqlIdentifier } from "./sql-ident";
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

type ComputedProjectionOutputType = "text" | "numeric" | "decimal" | "int" | "date" | "timestamptz" | "boolean" | "json";

export type ComputedProjection = {
  /** The lookup/rollup field whose value this projection produces. */
  fieldId: string;
  /** SQL alias under which the value is exposed in the SELECT list. */
  alias: string;
  /** Effective output type — used to normalize bun-sql values into JSON-safe record.data. */
  outputType: ComputedProjectionOutputType;
  /** Bare projection expression (no `AS alias`) over base record alias `r`.
   *  Set for lookup/rollup; reusable wherever a scalar expression is needed
   *  (GQL select/sort/filter/formula operand). */
  expr?: any;
  /** The full SQL fragment to embed AFTER `r.*,` in the SELECT list. */
  fragment: any;
};

/** Maps a projection output type onto the formula-compiler's SQL type system so
 *  GQL can treat lookup/rollup values like any other typed expression. */
const computedOutputToFormulaType = (output: ComputedProjectionOutputType): FormulaSqlType =>
  output === "numeric" || output === "decimal" || output === "int"
    ? "numeric"
    : output === "date"
      ? "date"
      : output === "timestamptz"
        ? "datetime"
        : output === "boolean"
          ? "boolean"
          : output === "json"
            ? "unknown"
            : "text";

const lookupAlias = (fieldId: string): string => `lkp_${fieldId.replace(/-/g, "")}`;
const rollupAlias = (fieldId: string): string => `rlp_${fieldId.replace(/-/g, "")}`;
const formulaAlias = (fieldId: string): string => `fml_${fieldId.replace(/-/g, "")}`;

const stableAliasHash = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
};

const computedColumnAlias = (columnId: string): string => {
  const slug = columnId
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase()
    .slice(0, 32);
  return `ccl_${slug}_${stableAliasHash(columnId)}`;
};

const outputTypeForFormula = (type: FormulaSqlType): ComputedProjection["outputType"] => {
  if (type === "numeric") return "decimal";
  if (type === "date") return "date";
  if (type === "datetime") return "timestamptz";
  if (type === "boolean") return "boolean";
  return "text";
};

const decimalProjectionValue = (raw: unknown): string | null => {
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  const value = String(raw);
  return decimalStringToCanonical(value) ?? value;
};

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
export const buildComputedProjections = async (fields: Field[], options: { recordAlias?: string } = {}): Promise<ComputedProjection[]> => {
  const fieldsById = new Map(fields.map((f) => [f.id, f]));
  const out: ComputedProjection[] = [];
  const recordAlias = assertSqlIdentifier(options.recordAlias ?? "r");

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
      const lookupExpr = sql`
          (SELECT ${projected}
           FROM grids.record_links rl
           JOIN grids.records t ON t.id = rl.to_record_id
           ${liveRecordParentJoinSql("t", "tt", "tb")}
           WHERE rl.from_record_id = ${sql.unsafe(recordAlias)}.id
             AND rl.from_field_id = ${cfg.relationFieldId}::uuid
             AND t.deleted_at IS NULL
             AND t.data->${cfg.targetFieldId} IS NOT NULL
           ORDER BY rl.position
           LIMIT 1)`;
      out.push({
        fieldId: field.id,
        alias: lookupAlias(field.id),
        outputType,
        expr: lookupExpr,
        fragment: sql`${lookupExpr} AS ${sql.unsafe(lookupAlias(field.id))}`,
      });
      continue;
    }

    // rollup
    if (cfg.agg === "count") {
      // count(*) over linked records — no target-field projection needed,
      // and rollup-count works even when targetFieldId is unset.
      const countExpr = sql`
          (SELECT count(*)::bigint
           FROM grids.record_links rl
           JOIN grids.records t ON t.id = rl.to_record_id
           ${liveRecordParentJoinSql("t", "tt", "tb")}
           WHERE rl.from_record_id = ${sql.unsafe(recordAlias)}.id
             AND rl.from_field_id = ${cfg.relationFieldId}::uuid
             AND t.deleted_at IS NULL)`;
      out.push({
        fieldId: field.id,
        alias: rollupAlias(field.id),
        outputType: "int",
        expr: countExpr,
        fragment: sql`${countExpr} AS ${sql.unsafe(rollupAlias(field.id))}`,
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
      // save-time. A partial or nonsensical config produces no rollup
      // column rather than a crash.
      continue;
    }

    const rollupExpr = sql`
        (SELECT ${aggFn}(${targetProjection})
         FROM grids.record_links rl
         JOIN grids.records t ON t.id = rl.to_record_id
         ${liveRecordParentJoinSql("t", "tt", "tb")}
         WHERE rl.from_record_id = ${sql.unsafe(recordAlias)}.id
           AND rl.from_field_id = ${cfg.relationFieldId}::uuid
           AND t.deleted_at IS NULL)`;
    out.push({
      fieldId: field.id,
      alias: rollupAlias(field.id),
      outputType: "numeric",
      expr: rollupExpr,
      fragment: sql`${rollupExpr} AS ${sql.unsafe(rollupAlias(field.id))}`,
    });
  }

  return out;
};

/**
 * Builds a `fieldId → typed SQL expression` map for the lookup/rollup fields on
 * a table, for the GQL compiler to treat them like any other scalar expression
 * (select / sort / filter / formula operand). Reuses the same correlated
 * subqueries as the records pipeline, so values match exactly.
 */
export const buildComputedFieldSqlMap = async (
  fields: Field[],
  options: { recordAlias?: string } = {},
): Promise<Map<string, FormulaSqlExpression>> => {
  const projections = await buildComputedProjections(fields, options);
  return new Map(projections.map((p) => [p.fieldId, { sql: p.expr, type: computedOutputToFormulaType(p.outputType) }]));
};

/**
 * Emits SQL projections for formula fields that can be represented from
 * the current record row alone. Non-projectable formulas are skipped
 * deliberately; the read path keeps the JS evaluator as a compatibility
 * fallback for formulas that reference relations, lookup/rollup values,
 * select arrays, files, or other formula fields.
 */
export const buildFormulaSqlProjections = (
  fields: Field[],
  options: { dateConfig?: DateContext; now?: Date } = {},
): ComputedProjection[] => {
  const out: ComputedProjection[] = [];
  const now = options.now ?? new Date();
  for (const field of fields) {
    if (field.deletedAt || field.type !== "formula") continue;
    const expression = (field.config as { expression?: unknown }).expression;
    if (typeof expression !== "string" || expression.trim().length === 0) continue;
    const compiled = compileFormulaSourceToSql(expression, {
      fields,
      recordAlias: "r",
      dateConfig: options.dateConfig,
      now,
    });
    if (!compiled.ok) continue;
    const alias = formulaAlias(field.id);
    out.push({
      fieldId: field.id,
      alias,
      outputType: outputTypeForFormula(compiled.expression.type),
      fragment: sql`${compiled.expression.sql} AS ${sql.unsafe(alias)}`,
    });
  }
  return out;
};

/**
 * SQL projections for view-level computed columns (`ComputedColumnSpec`).
 *
 * These are the same display-formula expressions the GQL preview compiles
 * to SQL. Evaluating them in SQL here too — instead of the post-query JS
 * evaluator — makes a saved view's computed cell render identically to its
 * GQL preview, and gives one consistent semantics (NULLIF-guarded division,
 * `IS NOT DISTINCT FROM` equality, decimal-safe numerics). Columns whose
 * expression cannot project to SQL (e.g. references to relation / select /
 * lookup values) return in `jsColumnIds` for the JS fallback.
 */
export const buildComputedColumnSqlProjections = (
  columns: ComputedColumnSpec[] | undefined,
  fields: Field[],
  options: { dateConfig?: DateContext; now?: Date } = {},
): { projections: ComputedProjection[]; sqlColumnIds: Set<string> } => {
  const projections: ComputedProjection[] = [];
  const sqlColumnIds = new Set<string>();
  const now = options.now ?? new Date();
  for (const column of columns ?? []) {
    if (column.expression.trim().length === 0) continue;
    const compiled = compileFormulaSourceToSql(column.expression, {
      fields,
      recordAlias: "r",
      dateConfig: options.dateConfig,
      now,
    });
    if (!compiled.ok) continue; // not SQL-projectable → JS evaluator handles it
    const alias = computedColumnAlias(column.id);
    projections.push({
      fieldId: column.id,
      alias,
      outputType: outputTypeForFormula(compiled.expression.type),
      fragment: sql`${compiled.expression.sql} AS ${sql.unsafe(alias)}`,
    });
    sqlColumnIds.add(column.id);
  }
  return { projections, sqlColumnIds };
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
      if (p.outputType === "decimal") {
        rec.data[p.fieldId] = decimalProjectionValue(raw);
        continue;
      }
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
