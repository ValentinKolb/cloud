import type { Field } from "../../../service";

export type FilterOp = {
  /** Op identifier sent to the API. */
  id: string;
  /** Human label shown in the dropdown. */
  label: string;
  /** True if this op needs a value input. `between` needs two; we render them inline. */
  needsValue: boolean;
  /** True if this op needs two value inputs (`between`). */
  needsRange?: boolean;
};

// Op labels are tightened (no "is " prefix, "doesn't contain" → "not contains")
// because the filter row already reads "where {field} {op} {value}", so the
// implicit "is" is obvious from context. Backend op `id`s stay the same.
const TEXT_OPS: FilterOp[] = [
  { id: "equals", label: "is", needsValue: true },
  { id: "notEquals", label: "is not", needsValue: true },
  { id: "contains", label: "contains", needsValue: true },
  { id: "notContains", label: "not contains", needsValue: true },
  { id: "startsWith", label: "starts with", needsValue: true },
  { id: "endsWith", label: "ends with", needsValue: true },
  { id: "regex", label: "regex", needsValue: true },
  { id: "isEmpty", label: "empty", needsValue: false },
  { id: "isNotEmpty", label: "not empty", needsValue: false },
];

const NUMBER_OPS: FilterOp[] = [
  { id: "=", label: "=", needsValue: true },
  { id: "!=", label: "≠", needsValue: true },
  { id: "<", label: "<", needsValue: true },
  { id: "<=", label: "≤", needsValue: true },
  { id: ">", label: ">", needsValue: true },
  { id: ">=", label: "≥", needsValue: true },
  { id: "between", label: "between", needsValue: true, needsRange: true },
  { id: "isEmpty", label: "empty", needsValue: false },
  { id: "isNotEmpty", label: "not empty", needsValue: false },
];

const DATE_OPS: FilterOp[] = [
  { id: "=", label: "is", needsValue: true },
  { id: "before", label: "before", needsValue: true },
  { id: "after", label: "after", needsValue: true },
  { id: "between", label: "between", needsValue: true, needsRange: true },
  { id: "today", label: "today", needsValue: false },
  { id: "thisWeek", label: "this week", needsValue: false },
  { id: "thisMonth", label: "this month", needsValue: false },
  { id: "lastNDays", label: "last N days", needsValue: true },
  { id: "isEmpty", label: "empty", needsValue: false },
  { id: "isNotEmpty", label: "not empty", needsValue: false },
];

const BOOL_OPS: FilterOp[] = [
  { id: "=", label: "is", needsValue: true },
  { id: "isEmpty", label: "empty", needsValue: false },
  { id: "isNotEmpty", label: "not empty", needsValue: false },
];

const SELECT_OPS: FilterOp[] = [
  { id: "is", label: "is", needsValue: true },
  { id: "isNot", label: "is not", needsValue: true },
  { id: "isAnyOf", label: "one of", needsValue: true },
  { id: "isNoneOf", label: "none of", needsValue: true },
  { id: "isEmpty", label: "empty", needsValue: false },
  { id: "isNotEmpty", label: "not empty", needsValue: false },
];

const RELATION_OPS: FilterOp[] = [
  { id: "containsAny", label: "contains", needsValue: true },
  { id: "isEmpty", label: "empty", needsValue: false },
  { id: "isNotEmpty", label: "not empty", needsValue: false },
];

export const opsForType = (type: string): FilterOp[] => {
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
    // json: opaque to filter — no ops surfaced.
    default:
      return [];
  }
};

/**
 * Returns true if a field type can be filtered via the UI. System fields
 * and unsupported types fall through.
 */
const isFilterable = (type: string): boolean => opsForType(type).length > 0;

/**
 * Filter fields available for the filter UI. Excludes deleted fields and
 * types we don't support filtering on (created_at/updated_at could be
 * filtered but they're stored as record columns — Phase 2 keeps the UI
 * scoped to data fields only).
 */
export const filterableFields = (fields: Field[]): Field[] => fields.filter((f) => !f.deletedAt && isFilterable(f.type));
