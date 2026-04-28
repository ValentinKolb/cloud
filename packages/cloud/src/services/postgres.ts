/** Convert a JS string array to a Postgres TEXT[] literal (Bun sql can't serialize empty arrays). */
export const toPgTextArray = (values: string[] | null | undefined): string => {
  if (!Array.isArray(values) || values.length === 0) return "{}";
  return `{${values.map((value) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
};

/** Convert UUID strings into a Postgres UUID[] literal for `ANY(...)`/`ALL(...)` filters. */
export const toPgUuidArray = (values: string[] | null | undefined): string => {
  if (!Array.isArray(values) || values.length === 0) return "{}";
  return `{${values.join(",")}}`;
};

/** Escape a user string for safe use inside a LIKE/ILIKE pattern with `ESCAPE '\'`. */
export const escapeLikePattern = (value: string): string => value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");

/** Normalize a Postgres JSON/JSONB value that may come back as a parsed value or a JSON string. */
export const parsePgJsonValue = (value: unknown): unknown => {
  if (value == null || typeof value !== "string") return value;

  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
};

/** Normalize a Postgres JSON/JSONB object value to a plain record. */
export const parsePgJsonRecord = (value: unknown): Record<string, unknown> | null => {
  const parsed = parsePgJsonValue(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
};

/**
 * Classify a thrown Postgres error. Bun's sql driver surfaces the canonical
 * SQLSTATE on `.code`. Use this at service boundaries to turn
 * unique-constraint violations into typed 409 results instead of bubbling up
 * raw DB errors to API clients.
 */
export type PgError = { code?: string; constraint_name?: string; detail?: string; message?: string };

export const isUniqueViolation = (error: unknown, constraintName?: string): boolean => {
  if (!error || typeof error !== "object") return false;
  const e = error as PgError;
  if (e.code !== "23505") return false;
  if (!constraintName) return true;
  return e.constraint_name === constraintName;
};
