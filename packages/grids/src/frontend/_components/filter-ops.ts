import type { Field } from "../../service";

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

const TEXT_OPS: FilterOp[] = [
  { id: "equals", label: "is", needsValue: true },
  { id: "notEquals", label: "is not", needsValue: true },
  { id: "contains", label: "contains", needsValue: true },
  { id: "notContains", label: "doesn't contain", needsValue: true },
  { id: "startsWith", label: "starts with", needsValue: true },
  { id: "endsWith", label: "ends with", needsValue: true },
  { id: "regex", label: "regex", needsValue: true },
  { id: "isEmpty", label: "is empty", needsValue: false },
  { id: "isNotEmpty", label: "is not empty", needsValue: false },
];

const NUMBER_OPS: FilterOp[] = [
  { id: "=", label: "=", needsValue: true },
  { id: "!=", label: "≠", needsValue: true },
  { id: "<", label: "<", needsValue: true },
  { id: "<=", label: "≤", needsValue: true },
  { id: ">", label: ">", needsValue: true },
  { id: ">=", label: "≥", needsValue: true },
  { id: "between", label: "between", needsValue: true, needsRange: true },
  { id: "isEmpty", label: "is empty", needsValue: false },
  { id: "isNotEmpty", label: "is not empty", needsValue: false },
];

const DATE_OPS: FilterOp[] = [
  { id: "=", label: "is", needsValue: true },
  { id: "before", label: "is before", needsValue: true },
  { id: "after", label: "is after", needsValue: true },
  { id: "between", label: "between", needsValue: true, needsRange: true },
  { id: "today", label: "is today", needsValue: false },
  { id: "thisWeek", label: "is this week", needsValue: false },
  { id: "thisMonth", label: "is this month", needsValue: false },
  { id: "lastNDays", label: "last N days", needsValue: true },
  { id: "isEmpty", label: "is empty", needsValue: false },
  { id: "isNotEmpty", label: "is not empty", needsValue: false },
];

const BOOL_OPS: FilterOp[] = [
  { id: "=", label: "is", needsValue: true },
  { id: "isEmpty", label: "is empty", needsValue: false },
  { id: "isNotEmpty", label: "is not empty", needsValue: false },
];

const SINGLE_SELECT_OPS: FilterOp[] = [
  { id: "is", label: "is", needsValue: true },
  { id: "isNot", label: "is not", needsValue: true },
  { id: "isAnyOf", label: "is any of", needsValue: true },
  { id: "isNoneOf", label: "is none of", needsValue: true },
  { id: "isEmpty", label: "is empty", needsValue: false },
  { id: "isNotEmpty", label: "is not empty", needsValue: false },
];

const MULTI_SELECT_OPS: FilterOp[] = [
  { id: "containsAll", label: "contains all", needsValue: true },
  { id: "containsAny", label: "contains any", needsValue: true },
  { id: "doesNotContain", label: "doesn't contain", needsValue: true },
  { id: "isEmpty", label: "is empty", needsValue: false },
  { id: "isNotEmpty", label: "is not empty", needsValue: false },
];

export const opsForType = (type: string): FilterOp[] => {
  switch (type) {
    case "text":
    case "longtext": return TEXT_OPS;
    case "number":
    case "decimal":
    case "rating":
    case "autonumber": return NUMBER_OPS;
    case "date": return DATE_OPS;
    case "boolean": return BOOL_OPS;
    case "single-select": return SINGLE_SELECT_OPS;
    case "multi-select": return MULTI_SELECT_OPS;
    default: return [];
  }
};

/**
 * Returns true if a field type can be filtered via the UI. System fields
 * and unsupported types fall through.
 */
export const isFilterable = (type: string): boolean => opsForType(type).length > 0;

/**
 * Filter fields available for the filter UI. Excludes deleted fields and
 * types we don't support filtering on (created_at/updated_at could be
 * filtered but they're stored as record columns — Phase 2 keeps the UI
 * scoped to data fields only).
 */
export const filterableFields = (fields: Field[]): Field[] =>
  fields.filter((f) => !f.deletedAt && isFilterable(f.type));
