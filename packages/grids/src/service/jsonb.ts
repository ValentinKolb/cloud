/**
 * Bun's `sql` driver returns JSONB columns inconsistently: objects and
 * arrays come back parsed, but on INSERT/UPDATE RETURNING (and some
 * SELECTs) the raw JSON text shows up instead. Scalar JSONB values
 * (strings, numbers, booleans) are returned already-parsed as JS
 * primitives, so the JSON.parse branch must NOT throw away a perfectly
 * valid scalar string just because it isn't a JSON document on its own.
 *
 * Strategy:
 *   - null / undefined → fallback
 *   - string starting with `{`, `[`, `"`, or matching a literal
 *     (true/false/null/number) → JSON-encoded, parse it
 *   - any other string → already-parsed scalar, pass through
 *   - everything else → return as-is (already an object/array/etc)
 *
 * Never throws. The fallback is only used for genuinely invalid input.
 */
const looksLikeJson = (s: string): boolean => {
  if (s.length === 0) return false;
  const c = s[0];
  if (c === "{" || c === "[" || c === '"') return true;
  if (s === "true" || s === "false" || s === "null") return true;
  // Numbers: leading digit, "-", or "."
  return c === "-" || c === "." || (c! >= "0" && c! <= "9");
};

export const parseJsonbRow = <T>(value: unknown, fallback: T): T => {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value as T;
  if (!looksLikeJson(value)) {
    // Bun returned a parsed scalar string already (e.g. a default_value
    // of "hello"); don't try to re-parse and lose it.
    return value as T;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    // Looked like JSON but wasn't — safest is to return the original
    // string so consumers can do their own recovery.
    return value as T;
  }
};
