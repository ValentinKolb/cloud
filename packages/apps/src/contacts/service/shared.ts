/**
 * UUID validator used to guard casts before running `::uuid` SQL comparisons.
 */
export const isUuid = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

/**
 * Escapes string values into a PostgreSQL `text[]` literal for `ANY(...)` filters.
 */
export const toPgTextArray = (values: string[] | null | undefined): string => {
  if (!Array.isArray(values) || values.length === 0) return "{}";
  return `{${values.map((value) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
};

/**
 * Escapes UUID values into a PostgreSQL `uuid[]` literal for `ANY(...)` filters.
 */
export const toPgUuidArray = (values: string[] | null | undefined): string => {
  if (!Array.isArray(values) || values.length === 0) return "{}";
  return `{${values.join(",")}}`;
};

/**
 * Normalizes empty strings to `null` for user-facing optional profile fields.
 */
export const emptyToNull = (value: string | null | undefined): string | null => {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

/**
 * Converts SQL date values into a stable `YYYY-MM-DD` representation.
 */
export const toDateOnly = (value: Date | string | null): string | null => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
};
