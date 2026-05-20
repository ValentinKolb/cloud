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
  | {
      kind: "predicate";
      fieldId: string;
      fieldType: string;
      op: string;
      value?: unknown;
      caseInsensitive?: boolean;
      dateIncludeTime?: boolean;
    };

// ──────────────────────────────────────────────────────────────────
// Operators per type (Phase-1B set)
// ──────────────────────────────────────────────────────────────────

const TEXT_OPS = new Set(["equals", "notEquals", "contains", "notContains", "startsWith", "endsWith", "regex", "isEmpty", "isNotEmpty"]);
const NUMBER_OPS = new Set(["=", "!=", "<", "<=", ">", ">=", "between", "isEmpty", "isNotEmpty"]);
const DATE_OPS = new Set(["=", "before", "after", "between", "today", "thisWeek", "thisMonth", "lastNDays", "isEmpty", "isNotEmpty"]);
const BOOL_OPS = new Set(["=", "isEmpty", "isNotEmpty"]);
const SELECT_OPS = new Set(["is", "isNot", "isAnyOf", "isNoneOf", "isEmpty", "isNotEmpty"]);
const RELATION_OPS = new Set(["containsAny", "isEmpty", "isNotEmpty"]);

const opsForType = (type: string): Set<string> => {
  switch (type) {
    case "text":
    case "longtext":
      return TEXT_OPS;
    case "number":
    case "decimal":
    case "autonumber":
    case "percent":
    case "duration":
      return NUMBER_OPS;
    case "date":
      return DATE_OPS;
    case "boolean":
      return BOOL_OPS;
    case "select":
      return SELECT_OPS;
    case "relation":
      return RELATION_OPS;
    // json and computed/link fields stay unfilterable here.
    default:
      return new Set();
  }
};

// ──────────────────────────────────────────────────────────────────
// Compiler
// ──────────────────────────────────────────────────────────────────

type CompileResult = { ok: true; clause: CompiledClause } | { ok: false; error: string };

// Distinguishes group vs leaf by SHAPE, not just `op`. A leaf with op
// "AND"/"OR" would otherwise be misclassified as a group with undefined
// `filters` and crash the walker. Both predicates must hold for a group.
const isGroup = (t: FilterTree): t is FilterGroup => {
  const g = t as Partial<FilterGroup>;
  return (g.op === "AND" || g.op === "OR") && Array.isArray(g.filters);
};

export const compileFilter = (tree: FilterTree | null | undefined, fields: Field[]): CompileResult => {
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
  if (!field) return { ok: false, error: "unknown field" };
  if (field.deletedAt) return { ok: false, error: `field "${field.name}" is deleted` };

  const allowed = opsForType(field.type);
  if (!allowed.has(tree.op)) {
    return { ok: false, error: `op "${tree.op}" not supported for type "${field.type}"` };
  }

  // Per-op value-shape validation. Without this, the renderer was
  // coercing whatever it got: Boolean("false") → true, Number("abc")
  // → NaN, ${nonStringValue}::date → SQL cast crash on page load.
  // (chunk 3 important.)
  const dateIncludeTime = field.type === "date" ? Boolean((field.config as { includeTime?: boolean }).includeTime) : undefined;
  const valueErr = validatePredicateValue(field.type, tree.op, tree.value, dateIncludeTime);
  if (valueErr) {
    return { ok: false, error: `field "${field.name}" / op "${tree.op}": ${valueErr}` };
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
      dateIncludeTime,
    },
  };
};

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATE_TIME_REGEX = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const validatePredicateValue = (fieldType: string, op: string, value: unknown, dateIncludeTime?: boolean): string | null => {
  // Empty-checks don't read the value.
  if (op === "isEmpty" || op === "isNotEmpty") return null;
  // Date placeholders are value-less.
  if (op === "today" || op === "thisWeek" || op === "thisMonth") return null;

  if (fieldType === "boolean") {
    if (typeof value !== "boolean") return "expected boolean";
    return null;
  }
  if (fieldType === "date") {
    const datePattern = dateIncludeTime ? LOCAL_DATE_TIME_REGEX : ISO_DATE_REGEX;
    const dateError = dateIncludeTime ? "expected local date-time string" : "expected ISO date string";
    if (op === "lastNDays") {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        return "lastNDays expects a non-negative integer";
      }
      return null;
    }
    if (op === "between") {
      if (!Array.isArray(value) || value.length !== 2) return "between expects [from, to]";
      for (const v of value) {
        if (typeof v !== "string" || !datePattern.test(v)) {
          return dateIncludeTime ? "between bounds must be local date-time strings" : "between bounds must be ISO date strings";
        }
      }
      if (value[0] > value[1]) return "between lower bound must be before upper bound";
      return null;
    }
    // =, before, after
    if (typeof value !== "string" || !datePattern.test(value)) {
      return dateError;
    }
    return null;
  }
  if (
    fieldType === "number" ||
    fieldType === "decimal" ||
    fieldType === "autonumber" ||
    fieldType === "percent" ||
    fieldType === "duration"
  ) {
    if (op === "between") {
      if (!Array.isArray(value) || value.length !== 2) return "between expects [from, to]";
      for (const v of value) {
        if (typeof v !== "number" || !Number.isFinite(v)) return "between bounds must be finite numbers";
      }
      if (value[0] > value[1]) return "between lower bound must be <= upper bound";
      return null;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) return "expected finite number";
    return null;
  }
  if (fieldType === "select") {
    if (op === "isAnyOf" || op === "isNoneOf") {
      if (!Array.isArray(value)) return "expected array of option ids";
      for (const v of value) if (typeof v !== "string") return "option ids must be strings";
      return null;
    }
    if (typeof value !== "string") return "expected option id";
    return null;
  }
  if (fieldType === "relation") {
    if (op === "containsAny") {
      if (!Array.isArray(value) || value.length === 0) return "expected non-empty array of record ids";
      for (const v of value) {
        if (typeof v !== "string" || !UUID_REGEX.test(v)) return "record ids must be UUID strings";
      }
      return null;
    }
    return null;
  }
  // Text family: regex / contains / startsWith / endsWith / equals / etc
  if (typeof value !== "string") return "expected string";
  return null;
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
    case "true":
      return sql`TRUE`;
    case "false":
      return sql`FALSE`;
    case "not":
      return sql`NOT (${renderClause(clause.inner)})`;
    case "and":
    case "or": {
      if (clause.parts.length === 0) return clause.kind === "and" ? sql`TRUE` : sql`FALSE`;
      const sep = clause.kind === "and" ? sql` AND ` : sql` OR `;
      const joined = clause.parts.map((p) => sql`(${renderClause(p)})`).reduce((acc, cur) => sql`${acc}${sep}${cur}`);
      return sql`(${joined})`;
    }
    case "predicate":
      return renderPredicate(clause);
  }
};

const renderPredicate = (p: Extract<CompiledClause, { kind: "predicate" }>): any => {
  const fieldId = p.fieldId;
  // Text-side projection (no cast needed). Wrapped in LOWER() when CI.
  const textProjection = p.caseInsensitive ? sql`LOWER(data->>${fieldId})` : sql`data->>${fieldId}`;

  // Safe-cast wrappers: NULL on parse failure instead of raising.
  // A single corrupt record (e.g. "abc" stored in a number field after
  // schema drift) used to crash the entire query — now it just doesn't
  // match the predicate.
  const numericProjection = sql`grids.try_numeric(data->>${fieldId})`;
  const dateProjection = p.dateIncludeTime ? sql`grids.try_timestamp(data->>${fieldId})` : sql`grids.try_iso_date(data->>${fieldId})`;
  const dateOnlyProjection = p.dateIncludeTime
    ? sql`grids.try_timestamp(data->>${fieldId})::date`
    : sql`grids.try_iso_date(data->>${fieldId})`;
  const boolProjection = sql`grids.try_boolean(data->>${fieldId})`;

  const ciVal = (v: unknown) => (typeof v === "string" && p.caseInsensitive ? v.toLowerCase() : v);

  switch (p.fieldType) {
    case "text":
    case "longtext": {
      const v = ciVal(p.value);
      switch (p.op) {
        case "equals":
          return sql`${textProjection} = ${v}`;
        case "notEquals":
          return sql`${textProjection} <> ${v}`;
        case "contains":
          return sql`${textProjection} LIKE ${"%" + escapeLikePattern(String(v ?? "")) + "%"} ESCAPE '\\'`;
        case "notContains":
          return sql`${textProjection} NOT LIKE ${"%" + escapeLikePattern(String(v ?? "")) + "%"} ESCAPE '\\'`;
        case "startsWith":
          return sql`${textProjection} LIKE ${escapeLikePattern(String(v ?? "")) + "%"} ESCAPE '\\'`;
        case "endsWith":
          return sql`${textProjection} LIKE ${"%" + escapeLikePattern(String(v ?? ""))} ESCAPE '\\'`;
        case "regex":
          return sql`${textProjection} ~ ${String(v ?? "")}`;
        case "isEmpty":
          return sql`(data->>${fieldId} IS NULL OR data->>${fieldId} = '')`;
        case "isNotEmpty":
          return sql`(data->>${fieldId} IS NOT NULL AND data->>${fieldId} <> '')`;
      }
      break;
    }
    case "number":
    case "decimal":
    case "autonumber":
    case "percent":
    case "duration":
      switch (p.op) {
        case "=":
          return sql`${numericProjection} = ${p.value}`;
        case "!=":
          return sql`${numericProjection} <> ${p.value}`;
        case "<":
          return sql`${numericProjection} < ${p.value}`;
        case "<=":
          return sql`${numericProjection} <= ${p.value}`;
        case ">":
          return sql`${numericProjection} > ${p.value}`;
        case ">=":
          return sql`${numericProjection} >= ${p.value}`;
        case "between": {
          const v = p.value as [unknown, unknown] | undefined;
          return sql`${numericProjection} BETWEEN ${v?.[0]} AND ${v?.[1]}`;
        }
        case "isEmpty":
          return sql`data->>${fieldId} IS NULL`;
        case "isNotEmpty":
          return sql`data->>${fieldId} IS NOT NULL`;
      }
      break;
    case "date":
      switch (p.op) {
        case "=":
          return p.dateIncludeTime ? sql`${dateProjection} = ${p.value}::timestamp` : sql`${dateProjection} = ${p.value}::date`;
        case "before":
          return p.dateIncludeTime ? sql`${dateProjection} < ${p.value}::timestamp` : sql`${dateProjection} < ${p.value}::date`;
        case "after":
          return p.dateIncludeTime ? sql`${dateProjection} > ${p.value}::timestamp` : sql`${dateProjection} > ${p.value}::date`;
        case "between": {
          const v = p.value as [unknown, unknown] | undefined;
          return p.dateIncludeTime
            ? sql`${dateProjection} BETWEEN ${v?.[0]}::timestamp AND ${v?.[1]}::timestamp`
            : sql`${dateProjection} BETWEEN ${v?.[0]}::date AND ${v?.[1]}::date`;
        }
        case "today":
          return sql`${dateOnlyProjection} = CURRENT_DATE`;
        case "thisWeek":
          return sql`date_trunc('week', ${dateProjection}) = date_trunc('week', CURRENT_TIMESTAMP::timestamp)`;
        case "thisMonth":
          return sql`date_trunc('month', ${dateProjection}) = date_trunc('month', CURRENT_TIMESTAMP::timestamp)`;
        case "lastNDays": {
          const n = Number(p.value ?? 0);
          return sql`(${dateOnlyProjection} >= CURRENT_DATE - ${n}::int * INTERVAL '1 day' AND ${dateOnlyProjection} <= CURRENT_DATE)`;
        }
        case "isEmpty":
          return sql`data->>${fieldId} IS NULL`;
        case "isNotEmpty":
          return sql`data->>${fieldId} IS NOT NULL`;
      }
      break;
    case "boolean":
      switch (p.op) {
        case "=":
          return sql`${boolProjection} = ${Boolean(p.value)}`;
        case "isEmpty":
          return sql`data->>${fieldId} IS NULL`;
        case "isNotEmpty":
          return sql`data->>${fieldId} IS NOT NULL`;
      }
      break;
    case "select":
      switch (p.op) {
        case "is":
          return sql`(data->${fieldId})::jsonb @> ${[p.value]}::jsonb`;
        case "isNot":
          return sql`(
          data->>${fieldId} IS NULL
          OR jsonb_typeof(data->${fieldId}) <> 'array'
          OR NOT ((data->${fieldId})::jsonb @> ${[p.value]}::jsonb)
        )`;
        case "isAnyOf": {
          const items = (p.value as string[]) ?? [];
          if (items.length === 0) return sql`FALSE`;
          const any = items.map((s) => sql`(data->${fieldId})::jsonb @> ${[s]}::jsonb`).reduce((acc, cur) => sql`${acc} OR ${cur}`);
          return sql`(${any})`;
        }
        case "isNoneOf": {
          const items = (p.value as string[]) ?? [];
          if (items.length === 0) return sql`TRUE`;
          const none = items.map((s) => sql`NOT ((data->${fieldId})::jsonb @> ${[s]}::jsonb)`).reduce((acc, cur) => sql`${acc} AND ${cur}`);
          return sql`(
            data->>${fieldId} IS NULL
            OR jsonb_typeof(data->${fieldId}) <> 'array'
            OR (${none})
          )`;
        }
        case "isEmpty":
          return sql`(
          data->>${fieldId} IS NULL
          OR jsonb_typeof(data->${fieldId}) <> 'array'
          OR jsonb_array_length(data->${fieldId}) = 0
        )`;
        case "isNotEmpty":
          return sql`(
          data->>${fieldId} IS NOT NULL
          AND jsonb_typeof(data->${fieldId}) = 'array'
          AND jsonb_array_length(data->${fieldId}) > 0
        )`;
      }
      break;
    case "relation":
      switch (p.op) {
        case "containsAny": {
          const ids = (p.value as string[]) ?? [];
          return sql`EXISTS (
            SELECT 1
            FROM grids.record_links rl
            WHERE rl.from_record_id = r.id
              AND rl.from_field_id = ${fieldId}::uuid
              AND rl.to_record_id = ANY(${sql.array(ids, "UUID")})
          )`;
        }
        case "isEmpty":
          return sql`NOT EXISTS (
          SELECT 1
          FROM grids.record_links rl
          WHERE rl.from_record_id = r.id
            AND rl.from_field_id = ${fieldId}::uuid
        )`;
        case "isNotEmpty":
          return sql`EXISTS (
          SELECT 1
          FROM grids.record_links rl
          WHERE rl.from_record_id = r.id
            AND rl.from_field_id = ${fieldId}::uuid
        )`;
      }
      break;
  }

  // Defensive: compileFilter validates op/type combos, so reaching here is a bug.
  return sql`FALSE`;
};
