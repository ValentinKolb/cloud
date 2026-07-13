const TEXT_OPS = new Set(["equals", "notEquals", "contains", "notContains", "startsWith", "endsWith", "regex", "isEmpty", "isNotEmpty"]);
const NUMBER_OPS = new Set(["=", "!=", "<", "<=", ">", ">=", "between", "isEmpty", "isNotEmpty"]);
const DATE_OPS = new Set([
  "=",
  "notEquals",
  "before",
  "after",
  "onOrBefore",
  "onOrAfter",
  "between",
  "today",
  "thisWeek",
  "thisMonth",
  "lastNDays",
  "isEmpty",
  "isNotEmpty",
]);
const BOOL_OPS = new Set(["=", "isEmpty", "isNotEmpty"]);
const SELECT_OPS = new Set(["is", "isNot", "isAnyOf", "isNoneOf", "isEmpty", "isNotEmpty"]);
const RELATION_OPS = new Set(["containsAny", "notContainsAny", "isEmpty", "isNotEmpty"]);

export const filterOperatorsForType = (type: string): Set<string> => {
  switch (type) {
    case "text":
    case "id":
    case "longtext":
      return TEXT_OPS;
    case "number":
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
    default:
      return new Set();
  }
};

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:[zZ]|[+-]\d{2}:?\d{2})$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VALUELESS_OPS = new Set(["isEmpty", "isNotEmpty", "today", "thisWeek", "thisMonth"]);
const NUMBER_TYPES = new Set(["number", "percent", "duration"]);

const isValidIsoDate = (value: string): boolean => {
  if (!ISO_DATE_REGEX.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day || month > 12) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1]!;
};

const isValidDateValue = (value: unknown, dateIncludeTime?: boolean): boolean => {
  if (typeof value !== "string") return false;
  if (!isValidIsoDate(value.slice(0, 10))) return false;
  if (!dateIncludeTime) return value.length === 10;
  if (!INSTANT_REGEX.test(value)) return false;
  return !Number.isNaN(new Date(value).getTime());
};

const validateDateBounds = (value: unknown, dateIncludeTime?: boolean): string | null => {
  if (!Array.isArray(value) || value.length !== 2) return "between expects [from, to]";
  for (const bound of value) {
    if (!isValidDateValue(bound, dateIncludeTime)) {
      return dateIncludeTime ? "between bounds must be timezone-aware ISO date-time strings" : "between bounds must be ISO date strings";
    }
  }
  const lower = dateIncludeTime ? new Date(String(value[0])).getTime() : String(value[0]);
  const upper = dateIncludeTime ? new Date(String(value[1])).getTime() : String(value[1]);
  return lower > upper ? "between lower bound must be before upper bound" : null;
};

const validateDateValue = (op: string, value: unknown, dateIncludeTime?: boolean): string | null => {
  if (op === "lastNDays") {
    return typeof value !== "number" || !Number.isInteger(value) || value < 0 ? "lastNDays expects a non-negative integer" : null;
  }
  if (op === "between") return validateDateBounds(value, dateIncludeTime);
  if (isValidDateValue(value, dateIncludeTime)) return null;
  return dateIncludeTime ? "expected a valid timezone-aware ISO date-time string" : "expected a valid ISO date string";
};

const validateNumberValue = (op: string, value: unknown): string | null => {
  if (op !== "between") return typeof value === "number" && Number.isFinite(value) ? null : "expected finite number";
  if (!Array.isArray(value) || value.length !== 2) return "between expects [from, to]";
  for (const bound of value) {
    if (typeof bound !== "number" || !Number.isFinite(bound)) return "between bounds must be finite numbers";
  }
  return value[0] > value[1] ? "between lower bound must be <= upper bound" : null;
};

const validateSelectValue = (op: string, value: unknown): string | null => {
  if (op !== "isAnyOf" && op !== "isNoneOf") return typeof value === "string" ? null : "expected option id";
  if (!Array.isArray(value)) return "expected array of option ids";
  for (const option of value) if (typeof option !== "string") return "option ids must be strings";
  return null;
};

const validateRelationValue = (op: string, value: unknown): string | null => {
  if (op !== "containsAny" && op !== "notContainsAny") return null;
  if (!Array.isArray(value) || value.length === 0) return "expected non-empty array of record ids";
  for (const id of value) if (typeof id !== "string" || !UUID_REGEX.test(id)) return "record ids must be UUID strings";
  return null;
};

export const validateFilterValue = (fieldType: string, op: string, value: unknown, dateIncludeTime?: boolean): string | null => {
  if (VALUELESS_OPS.has(op)) return null;
  if (fieldType === "boolean") return typeof value === "boolean" ? null : "expected boolean";
  if (fieldType === "date") return validateDateValue(op, value, dateIncludeTime);
  if (NUMBER_TYPES.has(fieldType)) return validateNumberValue(op, value);
  if (fieldType === "select") return validateSelectValue(op, value);
  if (fieldType === "relation") return validateRelationValue(op, value);
  return typeof value === "string" ? null : "expected string";
};
