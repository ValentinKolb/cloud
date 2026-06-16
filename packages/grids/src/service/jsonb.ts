/**
 * Bun's `sql` driver returns JSONB columns inconsistently: SELECT path
 * returns parsed JS values, INSERT/UPDATE RETURNING (and a few SELECT
 * paths) return the raw JSON text. parseJsonbRow papers over the
 * difference for the call sites that pass JSONB documents back to
 * consumers (record.data, fields.config, views.ui, forms.config,
 * dashboards.config, audit.diff).
 *
 * Strategy:
 *   - null / undefined → fallback.
 *   - already-parsed object/array/etc → pass through.
 *   - string starting with `{`, `[`, or `"` → JSON document text, parse.
 *   - any other string → already-parsed scalar, return as-is.
 *
 * Note: we deliberately do NOT parse bare-literal strings like "42",
 * "true", "null", etc. The previous version's `looksLikeJson` matched
 * those and called JSON.parse, which would corrupt a JSONB string
 * scalar that happens to be the text of a number/boolean/null
 * (chunk 3 review). All current call sites pass document-shaped values
 * (object / array / null), so the narrower trigger is safe and
 * eliminates a quiet type-coercion footgun for any future caller that
 * holds a JSONB string column.
 *
 * Never throws. The fallback is only used for genuinely invalid input
 * that LOOKED like JSON but failed to parse.
 */
const looksLikeJsonDocument = (s: string): boolean => {
  if (s.length === 0) return false;
  const c = s[0];
  return c === "{" || c === "[" || c === '"';
};

export const parseJsonbRow = <T>(value: unknown, fallback: T): T => {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value as T;
  if (!looksLikeJsonDocument(value)) {
    // Bun returned a parsed scalar string already (e.g. a slug or a
    // user-typed text default_value). Don't re-parse — that would
    // turn "42" into 42, "true" into true, etc.
    return value as T;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    // Looked like JSON but wasn't (truncated, malformed). Safer to
    // return the fallback than the half-parsed string; consumers
    // expect document-shaped values here.
    return fallback;
  }
};
