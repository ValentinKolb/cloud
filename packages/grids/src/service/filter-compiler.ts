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
const VALUELESS_OPS = new Set(["isEmpty", "isNotEmpty", "today", "thisWeek", "thisMonth"]);
const NUMBER_TYPES = new Set(["number", "autonumber", "percent", "duration"]);

const isValidDateValue = (value: unknown, dateIncludeTime?: boolean): boolean => {
  const datePattern = dateIncludeTime ? LOCAL_DATE_TIME_REGEX : ISO_DATE_REGEX;
  return typeof value === "string" && datePattern.test(value);
};

const dateValueError = (dateIncludeTime?: boolean): string =>
  dateIncludeTime ? "expected local date-time string" : "expected ISO date string";

const validateDateBounds = (value: unknown, dateIncludeTime?: boolean): string | null => {
  if (!Array.isArray(value) || value.length !== 2) return "between expects [from, to]";
  for (const v of value) {
    if (!isValidDateValue(v, dateIncludeTime)) {
      return dateIncludeTime ? "between bounds must be local date-time strings" : "between bounds must be ISO date strings";
    }
  }
  return value[0] > value[1] ? "between lower bound must be before upper bound" : null;
};

const validateDateValue = (op: string, value: unknown, dateIncludeTime?: boolean): string | null => {
  if (op === "lastNDays") {
    return typeof value !== "number" || !Number.isInteger(value) || value < 0
      ? "lastNDays expects a non-negative integer"
      : null;
  }
  if (op === "between") return validateDateBounds(value, dateIncludeTime);
  return isValidDateValue(value, dateIncludeTime) ? null : dateValueError(dateIncludeTime);
};

const validateNumberBounds = (value: unknown): string | null => {
  if (!Array.isArray(value) || value.length !== 2) return "between expects [from, to]";
  for (const v of value) {
    if (typeof v !== "number" || !Number.isFinite(v)) return "between bounds must be finite numbers";
  }
  return value[0] > value[1] ? "between lower bound must be <= upper bound" : null;
};

const validateNumberValue = (op: string, value: unknown): string | null => {
  if (op === "between") return validateNumberBounds(value);
  return typeof value === "number" && Number.isFinite(value) ? null : "expected finite number";
};

const validateSelectValue = (op: string, value: unknown): string | null => {
  if (op === "isAnyOf" || op === "isNoneOf") {
    if (!Array.isArray(value)) return "expected array of option ids";
    for (const v of value) if (typeof v !== "string") return "option ids must be strings";
    return null;
  }
  return typeof value === "string" ? null : "expected option id";
};

const validateRelationValue = (op: string, value: unknown): string | null => {
  if (op !== "containsAny") return null;
  if (!Array.isArray(value) || value.length === 0) return "expected non-empty array of record ids";
  for (const v of value) {
    if (typeof v !== "string" || !UUID_REGEX.test(v)) return "record ids must be UUID strings";
  }
  return null;
};

const validatePredicateValue = (fieldType: string, op: string, value: unknown, dateIncludeTime?: boolean): string | null => {
  if (VALUELESS_OPS.has(op)) return null;
  if (fieldType === "boolean") return typeof value === "boolean" ? null : "expected boolean";
  if (fieldType === "date") return validateDateValue(op, value, dateIncludeTime);
  if (NUMBER_TYPES.has(fieldType)) return validateNumberValue(op, value);
  if (fieldType === "select") return validateSelectValue(op, value);
  if (fieldType === "relation") return validateRelationValue(op, value);
  return typeof value === "string" ? null : "expected string";
};

// ──────────────────────────────────────────────────────────────────
// Renderer: CompiledClause → bun.sql fragment
// ──────────────────────────────────────────────────────────────────

const escapeLikePattern = (s: string): string => s.replace(/([\\%_])/g, "\\$1");
type PredicateClause = Extract<CompiledClause, { kind: "predicate" }>;
type PredicateProjection = {
  text: any;
  numeric: any;
  date: any;
  dateOnly: any;
  bool: any;
};

const predicateProjection = (p: PredicateClause): PredicateProjection => {
  const fieldId = p.fieldId;
  return {
    text: p.caseInsensitive ? sql`LOWER(data->>${fieldId})` : sql`data->>${fieldId}`,
    numeric: sql`grids.try_numeric(data->>${fieldId})`,
    date: p.dateIncludeTime ? sql`grids.try_timestamp(data->>${fieldId})` : sql`grids.try_iso_date(data->>${fieldId})`,
    dateOnly: p.dateIncludeTime ? sql`grids.try_timestamp(data->>${fieldId})::date` : sql`grids.try_iso_date(data->>${fieldId})`,
    bool: sql`grids.try_boolean(data->>${fieldId})`,
  };
};

const predicateValue = (p: PredicateClause): unknown =>
  typeof p.value === "string" && p.caseInsensitive ? p.value.toLowerCase() : p.value;

const renderTextPredicate = (p: PredicateClause, projection: PredicateProjection): any => {
  const v = predicateValue(p);
  switch (p.op) {
    case "equals":
      return sql`${projection.text} = ${v}`;
    case "notEquals":
      return sql`${projection.text} <> ${v}`;
    case "contains":
      return sql`${projection.text} LIKE ${"%" + escapeLikePattern(String(v ?? "")) + "%"} ESCAPE '\\'`;
    case "notContains":
      return sql`${projection.text} NOT LIKE ${"%" + escapeLikePattern(String(v ?? "")) + "%"} ESCAPE '\\'`;
    case "startsWith":
      return sql`${projection.text} LIKE ${escapeLikePattern(String(v ?? "")) + "%"} ESCAPE '\\'`;
    case "endsWith":
      return sql`${projection.text} LIKE ${"%" + escapeLikePattern(String(v ?? ""))} ESCAPE '\\'`;
    case "regex":
      return sql`${projection.text} ~ ${String(v ?? "")}`;
    case "isEmpty":
      return sql`(data->>${p.fieldId} IS NULL OR data->>${p.fieldId} = '')`;
    case "isNotEmpty":
      return sql`(data->>${p.fieldId} IS NOT NULL AND data->>${p.fieldId} <> '')`;
    default:
      return sql`FALSE`;
  }
};

const renderNumberPredicate = (p: PredicateClause, projection: PredicateProjection): any => {
  switch (p.op) {
    case "=":
      return sql`${projection.numeric} = ${p.value}`;
    case "!=":
      return sql`${projection.numeric} <> ${p.value}`;
    case "<":
      return sql`${projection.numeric} < ${p.value}`;
    case "<=":
      return sql`${projection.numeric} <= ${p.value}`;
    case ">":
      return sql`${projection.numeric} > ${p.value}`;
    case ">=":
      return sql`${projection.numeric} >= ${p.value}`;
    case "between": {
      const v = p.value as [unknown, unknown] | undefined;
      return sql`${projection.numeric} BETWEEN ${v?.[0]} AND ${v?.[1]}`;
    }
    case "isEmpty":
      return sql`data->>${p.fieldId} IS NULL`;
    case "isNotEmpty":
      return sql`data->>${p.fieldId} IS NOT NULL`;
    default:
      return sql`FALSE`;
  }
};

const renderDateComparison = (p: PredicateClause, projection: PredicateProjection, opSql: "=" | "<" | ">"): any =>
  p.dateIncludeTime
    ? opSql === "="
      ? sql`${projection.date} = ${p.value}::timestamp`
      : opSql === "<"
        ? sql`${projection.date} < ${p.value}::timestamp`
        : sql`${projection.date} > ${p.value}::timestamp`
    : opSql === "="
      ? sql`${projection.date} = ${p.value}::date`
      : opSql === "<"
        ? sql`${projection.date} < ${p.value}::date`
        : sql`${projection.date} > ${p.value}::date`;

const renderDatePredicate = (p: PredicateClause, projection: PredicateProjection): any => {
  switch (p.op) {
    case "=":
      return renderDateComparison(p, projection, "=");
    case "before":
      return renderDateComparison(p, projection, "<");
    case "after":
      return renderDateComparison(p, projection, ">");
    case "between": {
      const v = p.value as [unknown, unknown] | undefined;
      return p.dateIncludeTime
        ? sql`${projection.date} BETWEEN ${v?.[0]}::timestamp AND ${v?.[1]}::timestamp`
        : sql`${projection.date} BETWEEN ${v?.[0]}::date AND ${v?.[1]}::date`;
    }
    case "today":
      return sql`${projection.dateOnly} = CURRENT_DATE`;
    case "thisWeek":
      return sql`date_trunc('week', ${projection.date}) = date_trunc('week', CURRENT_TIMESTAMP::timestamp)`;
    case "thisMonth":
      return sql`date_trunc('month', ${projection.date}) = date_trunc('month', CURRENT_TIMESTAMP::timestamp)`;
    case "lastNDays": {
      const n = Number(p.value ?? 0);
      return sql`(${projection.dateOnly} >= CURRENT_DATE - ${n}::int * INTERVAL '1 day' AND ${projection.dateOnly} <= CURRENT_DATE)`;
    }
    case "isEmpty":
      return sql`data->>${p.fieldId} IS NULL`;
    case "isNotEmpty":
      return sql`data->>${p.fieldId} IS NOT NULL`;
    default:
      return sql`FALSE`;
  }
};

const renderBooleanPredicate = (p: PredicateClause, projection: PredicateProjection): any => {
  switch (p.op) {
    case "=":
      return sql`${projection.bool} = ${Boolean(p.value)}`;
    case "isEmpty":
      return sql`data->>${p.fieldId} IS NULL`;
    case "isNotEmpty":
      return sql`data->>${p.fieldId} IS NOT NULL`;
    default:
      return sql`FALSE`;
  }
};

const selectContains = (fieldId: string, value: unknown): any => sql`(data->${fieldId})::jsonb @> ${[value]}::jsonb`;

const renderSelectPredicate = (p: PredicateClause): any => {
  const fieldId = p.fieldId;
  switch (p.op) {
    case "is":
      return selectContains(fieldId, p.value);
    case "isNot":
      return sql`(
          data->>${fieldId} IS NULL
          OR jsonb_typeof(data->${fieldId}) <> 'array'
          OR NOT (${selectContains(fieldId, p.value)})
        )`;
    case "isAnyOf": {
      const items = (p.value as string[]) ?? [];
      if (items.length === 0) return sql`FALSE`;
      const any = items.map((s) => selectContains(fieldId, s)).reduce((acc, cur) => sql`${acc} OR ${cur}`);
      return sql`(${any})`;
    }
    case "isNoneOf": {
      const items = (p.value as string[]) ?? [];
      if (items.length === 0) return sql`TRUE`;
      const none = items.map((s) => sql`NOT (${selectContains(fieldId, s)})`).reduce((acc, cur) => sql`${acc} AND ${cur}`);
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
    default:
      return sql`FALSE`;
  }
};

const renderRelationPredicate = (p: PredicateClause): any => {
  switch (p.op) {
    case "containsAny": {
      const ids = (p.value as string[]) ?? [];
      return sql`EXISTS (
            SELECT 1
            FROM grids.record_links rl
            WHERE rl.from_record_id = r.id
              AND rl.from_field_id = ${p.fieldId}::uuid
              AND rl.to_record_id = ANY(${sql.array(ids, "UUID")})
          )`;
    }
    case "isEmpty":
      return sql`NOT EXISTS (
          SELECT 1
          FROM grids.record_links rl
          WHERE rl.from_record_id = r.id
            AND rl.from_field_id = ${p.fieldId}::uuid
        )`;
    case "isNotEmpty":
      return sql`EXISTS (
          SELECT 1
          FROM grids.record_links rl
          WHERE rl.from_record_id = r.id
            AND rl.from_field_id = ${p.fieldId}::uuid
        )`;
    default:
      return sql`FALSE`;
  }
};

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

const renderPredicate = (p: PredicateClause): any => {
  const projection = predicateProjection(p);
  switch (p.fieldType) {
    case "text":
    case "longtext":
      return renderTextPredicate(p, projection);
    case "number":
    case "autonumber":
    case "percent":
    case "duration":
      return renderNumberPredicate(p, projection);
    case "date":
      return renderDatePredicate(p, projection);
    case "boolean":
      return renderBooleanPredicate(p, projection);
    case "select":
      return renderSelectPredicate(p);
    case "relation":
      return renderRelationPredicate(p);
    default:
      return sql`FALSE`;
  }
};
