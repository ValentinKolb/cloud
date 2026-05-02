/**
 * Bun's `sql` driver returns JSONB columns as strings on INSERT/UPDATE
 * RETURNING (and depending on the bun-sql version, sometimes on SELECT
 * too). The application layer expects parsed objects everywhere, so we
 * normalize at the boundary — every place that reads a JSONB column
 * goes through this helper.
 *
 * Safe: returns the fallback when the input is null / undefined / a
 * malformed JSON string. Never throws.
 */
export const parseJsonbRow = <T>(value: unknown, fallback: T): T => {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};
