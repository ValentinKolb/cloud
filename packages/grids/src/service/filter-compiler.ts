import { sql } from "bun";
import type { Field } from "./types";

// ──────────────────────────────────────────────────────────────────
// Filter-tree shape (mirrors contracts.FilterTreeSchema)
// ──────────────────────────────────────────────────────────────────

export type FilterLeaf = {
  fieldId: string;
  op: string;
  value?: unknown;
  caseInsensitive?: boolean;
};

export type FilterGroup = {
  op: "AND" | "OR";
  filters: FilterTree[];
};

export type FilterTree = FilterLeaf | FilterGroup;

// ──────────────────────────────────────────────────────────────────
// Compiled clause IR — pure data, snapshot-testable.
// The renderer consumes this and emits a bun.sql fragment.
// ──────────────────────────────────────────────────────────────────

export type CompiledClause =
  | { kind: "true" }
  | { kind: "false" }
  | { kind: "and"; parts: CompiledClause[] }
  | { kind: "or"; parts: CompiledClause[] }
  | { kind: "not"; inner: CompiledClause }
  /** A typed predicate against a JSONB field. The renderer composes it. */
  | { kind: "predicate"; fieldId: string; fieldType: string; op: string; value?: unknown; caseInsensitive?: boolean };

// ──────────────────────────────────────────────────────────────────
// Operators per type (Phase-1B set)
// ──────────────────────────────────────────────────────────────────

const TEXT_OPS = new Set([
  "equals", "notEquals", "contains", "notContains", "startsWith", "endsWith",
  "regex", "isEmpty", "isNotEmpty",
]);
const NUMBER_OPS = new Set(["=", "!=", "<", "<=", ">", ">=", "between", "isEmpty", "isNotEmpty"]);
const DATE_OPS = new Set([
  "=", "before", "after", "between", "today", "thisWeek", "thisMonth",
  "lastNDays", "isEmpty", "isNotEmpty",
]);
const BOOL_OPS = new Set(["=", "isEmpty", "isNotEmpty"]);
const SINGLE_SELECT_OPS = new Set(["is", "isNot", "isAnyOf", "isNoneOf", "isEmpty", "isNotEmpty"]);
const MULTI_SELECT_OPS = new Set(["containsAll", "containsAny", "doesNotContain", "isEmpty", "isNotEmpty"]);

const opsForType = (type: string): Set<string> => {
  switch (type) {
    // Tier 1
    case "text": case "longtext":
    // Tier 2 / 3 text-shaped subtypes — same set of text ops apply.
    case "email": case "url": case "phone": case "slug":
    case "barcode": case "isbn":
      return TEXT_OPS;
    // Tier 1
    case "number": case "decimal": case "rating": case "autonumber":
    // Tier 2 number-shaped subtypes
    case "percent": case "duration":
      return NUMBER_OPS;
    case "date": return DATE_OPS;
    case "boolean": return BOOL_OPS;
    case "single-select": return SINGLE_SELECT_OPS;
    case "multi-select": return MULTI_SELECT_OPS;
    // currency / json stay unfilterable for now.
    default: return new Set();
  }
};

// ──────────────────────────────────────────────────────────────────
// Compiler
// ──────────────────────────────────────────────────────────────────

export type CompileError = { error: string; path?: string[] };

export type CompileResult =
  | { ok: true; clause: CompiledClause }
  | { ok: false; error: string };

// Distinguishes group vs leaf by SHAPE, not just `op`. A leaf with op
// "AND"/"OR" would otherwise be misclassified as a group with undefined
// `filters` and crash the walker. Both predicates must hold for a group.
const isGroup = (t: FilterTree): t is FilterGroup => {
  const g = t as Partial<FilterGroup>;
  return (g.op === "AND" || g.op === "OR") && Array.isArray(g.filters);
};

export const compileFilter = (
  tree: FilterTree | null | undefined,
  fields: Field[],
): CompileResult => {
  if (tree === null || tree === undefined) return { ok: true, clause: { kind: "true" } };

  const fieldsById = new Map(fields.map((f) => [f.id, f]));
  return walk(tree, fieldsById);
};

const walk = (tree: FilterTree, fieldsById: Map<string, Field>): CompileResult => {
  if (isGroup(tree)) {
    if (tree.filters.length === 0) {
      return { ok: true, clause: { kind: tree.op === "AND" ? "true" : "false" } };
    }
    const parts: CompiledClause[] = [];
    for (const f of tree.filters) {
      const r = walk(f, fieldsById);
      if (!r.ok) return r;
      parts.push(r.clause);
    }
    return { ok: true, clause: { kind: tree.op === "AND" ? "and" : "or", parts } };
  }

  const field = fieldsById.get(tree.fieldId);
  if (!field) return { ok: false, error: `unknown field "${tree.fieldId}"` };
  if (field.deletedAt) return { ok: false, error: `field "${field.name}" is deleted` };

  const allowed = opsForType(field.type);
  if (!allowed.has(tree.op)) {
    return { ok: false, error: `op "${tree.op}" not supported for type "${field.type}"` };
  }

  return {
    ok: true,
    clause: {
      kind: "predicate",
      fieldId: field.id,
      fieldType: field.type,
      op: tree.op,
      value: tree.value,
      caseInsensitive: tree.caseInsensitive,
    },
  };
};

// ──────────────────────────────────────────────────────────────────
// Renderer: CompiledClause → bun.sql fragment
// ──────────────────────────────────────────────────────────────────

const escapeLikePattern = (s: string): string => s.replace(/([\\%_])/g, "\\$1");

/**
 * Rendering uses Bun's sql template tag for parameterization. The IR is
 * structured, so SQL composition is mechanical — every value goes through
 * `${...}` and is escaped by Bun.
 */
// bun.sql template-tag types don't unify when fragments compose, so we
// follow the existing platform convention of typing fragments as `any`.
// Same approach is used in spaces / contacts for nested WHERE clauses.
export const renderClause = (clause: CompiledClause): any => {
  switch (clause.kind) {
    case "true": return sql`TRUE`;
    case "false": return sql`FALSE`;
    case "not": return sql`NOT (${renderClause(clause.inner)})`;
    case "and":
    case "or": {
      if (clause.parts.length === 0) return clause.kind === "and" ? sql`TRUE` : sql`FALSE`;
      const sep = clause.kind === "and" ? sql` AND ` : sql` OR `;
      return clause.parts
        .map((p) => sql`(${renderClause(p)})`)
        .reduce((acc, cur) => sql`${acc}${sep}${cur}`);
    }
    case "predicate":
      return renderPredicate(clause);
  }
};

const renderPredicate = (p: Extract<CompiledClause, { kind: "predicate" }>): any => {
  const fieldId = p.fieldId;
  // Text-side projection (no cast needed). Wrapped in LOWER() when CI.
  const textProjection = p.caseInsensitive
    ? sql`LOWER(data->>${fieldId})`
    : sql`data->>${fieldId}`;

  // Safe-cast wrappers: NULL on parse failure instead of raising.
  // A single corrupt record (e.g. "abc" stored in a number field after
  // schema drift) used to crash the entire query — now it just doesn't
  // match the predicate.
  const numericProjection = sql`grids.try_numeric(data->>${fieldId})`;
  const dateProjection = sql`grids.try_date(data->>${fieldId})`;
  const tsProjection = sql`grids.try_timestamptz(data->>${fieldId})`;
  const boolProjection = sql`grids.try_boolean(data->>${fieldId})`;

  const ciVal = (v: unknown) => (typeof v === "string" && p.caseInsensitive ? v.toLowerCase() : v);

  switch (p.fieldType) {
    case "text":
    case "longtext":
    // Text-shaped Tier-2/3 subtypes share the same projections + ops.
    case "email":
    case "url":
    case "phone":
    case "slug":
    case "barcode":
    case "isbn": {
      const v = ciVal(p.value);
      switch (p.op) {
        case "equals": return sql`${textProjection} = ${v}`;
        case "notEquals": return sql`${textProjection} <> ${v}`;
        case "contains": return sql`${textProjection} LIKE ${"%" + escapeLikePattern(String(v ?? "")) + "%"} ESCAPE '\\'`;
        case "notContains": return sql`${textProjection} NOT LIKE ${"%" + escapeLikePattern(String(v ?? "")) + "%"} ESCAPE '\\'`;
        case "startsWith": return sql`${textProjection} LIKE ${escapeLikePattern(String(v ?? "")) + "%"} ESCAPE '\\'`;
        case "endsWith": return sql`${textProjection} LIKE ${"%" + escapeLikePattern(String(v ?? ""))} ESCAPE '\\'`;
        case "regex": return sql`${textProjection} ~ ${String(v ?? "")}`;
        case "isEmpty": return sql`(data->>${fieldId} IS NULL OR data->>${fieldId} = '')`;
        case "isNotEmpty": return sql`(data->>${fieldId} IS NOT NULL AND data->>${fieldId} <> '')`;
      }
      break;
    }
    case "number":
    case "decimal":
    case "rating":
    case "autonumber":
    // Tier-2 number-shaped subtypes
    case "percent":
    case "duration":
      switch (p.op) {
        case "=": return sql`${numericProjection} = ${p.value}`;
        case "!=": return sql`${numericProjection} <> ${p.value}`;
        case "<": return sql`${numericProjection} < ${p.value}`;
        case "<=": return sql`${numericProjection} <= ${p.value}`;
        case ">": return sql`${numericProjection} > ${p.value}`;
        case ">=": return sql`${numericProjection} >= ${p.value}`;
        case "between": {
          const v = p.value as [unknown, unknown] | undefined;
          return sql`${numericProjection} BETWEEN ${v?.[0]} AND ${v?.[1]}`;
        }
        case "isEmpty": return sql`data->>${fieldId} IS NULL`;
        case "isNotEmpty": return sql`data->>${fieldId} IS NOT NULL`;
      }
      break;
    case "date":
      switch (p.op) {
        case "=": return sql`${dateProjection} = ${p.value}::date`;
        case "before": return sql`${dateProjection} < ${p.value}::date`;
        case "after": return sql`${dateProjection} > ${p.value}::date`;
        case "between": {
          const v = p.value as [unknown, unknown] | undefined;
          return sql`${dateProjection} BETWEEN ${v?.[0]}::date AND ${v?.[1]}::date`;
        }
        case "today": return sql`${dateProjection} = CURRENT_DATE`;
        case "thisWeek": return sql`date_trunc('week', ${tsProjection}) = date_trunc('week', now())`;
        case "thisMonth": return sql`date_trunc('month', ${tsProjection}) = date_trunc('month', now())`;
        case "lastNDays": {
          const n = Number(p.value ?? 0);
          return sql`${dateProjection} >= CURRENT_DATE - ${n}::int * INTERVAL '1 day'`;
        }
        case "isEmpty": return sql`data->>${fieldId} IS NULL`;
        case "isNotEmpty": return sql`data->>${fieldId} IS NOT NULL`;
      }
      break;
    case "boolean":
      switch (p.op) {
        case "=": return sql`${boolProjection} = ${Boolean(p.value)}`;
        case "isEmpty": return sql`data->>${fieldId} IS NULL`;
        case "isNotEmpty": return sql`data->>${fieldId} IS NOT NULL`;
      }
      break;
    case "single-select":
      switch (p.op) {
        case "is": return sql`data->>${fieldId} = ${p.value}`;
        case "isNot": return sql`data->>${fieldId} <> ${p.value}`;
        case "isAnyOf": return sql`data->>${fieldId} = ANY(${(p.value as string[]) ?? []}::text[])`;
        case "isNoneOf": return sql`(data->>${fieldId} IS NULL OR data->>${fieldId} <> ALL(${(p.value as string[]) ?? []}::text[]))`;
        case "isEmpty": return sql`data->>${fieldId} IS NULL`;
        case "isNotEmpty": return sql`data->>${fieldId} IS NOT NULL`;
      }
      break;
    case "multi-select":
      switch (p.op) {
        case "containsAll": {
          // jsonb @> for "must contain all": works on the JSONB array stored
          // for multi-select fields. Bun encodes the JS array as JSONB.
          const arr = (p.value as unknown[]) ?? [];
          return sql`(data->${fieldId})::jsonb @> ${arr}::jsonb`;
        }
        case "containsAny": {
          const items = (p.value as string[]) ?? [];
          if (items.length === 0) return sql`FALSE`;
          // Match ANY of: rewrite as OR of @> singletons.
          const parts = items.map((s) => sql`(data->${fieldId})::jsonb @> ${[s]}::jsonb`);
          return parts.reduce((acc, cur) => sql`${acc} OR ${cur}`);
        }
        case "doesNotContain": {
          const items = (p.value as string[]) ?? [];
          if (items.length === 0) return sql`TRUE`;
          const parts = items.map((s) => sql`NOT ((data->${fieldId})::jsonb @> ${[s]}::jsonb)`);
          return parts.reduce((acc, cur) => sql`${acc} AND ${cur}`);
        }
        // jsonb_array_length raises on non-arrays; corrupt JSONB
        // (scalar/object stored where the schema expects an array)
        // would crash the filter. Guard via jsonb_typeof so non-arrays
        // are treated as empty — symmetric with how try_numeric/etc
        // treat corrupt scalars elsewhere in the compiler.
        case "isEmpty": return sql`(
          data->>${fieldId} IS NULL
          OR jsonb_typeof(data->${fieldId}) <> 'array'
          OR jsonb_array_length(data->${fieldId}) = 0
        )`;
        case "isNotEmpty": return sql`(
          data->>${fieldId} IS NOT NULL
          AND jsonb_typeof(data->${fieldId}) = 'array'
          AND jsonb_array_length(data->${fieldId}) > 0
        )`;
      }
      break;
  }

  // Defensive: compileFilter validates op/type combos, so reaching here is a bug.
  return sql`FALSE`;
};
