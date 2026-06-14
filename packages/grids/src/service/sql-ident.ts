/**
 * Guard for the handful of places that interpolate a derived identifier into
 * `sql.unsafe(...)` (aggregate result keys, group aliases). Every such value is
 * already built from validated parts — UUID field ids, `"*"`, a fixed aggregate
 * enum, or a regex-checked formula alias — so this never fires in practice. It
 * exists so a future caller that forgets to validate fails loudly here instead
 * of opening a SQL-injection hole. The allowed charset matches everything those
 * builders produce (hex/underscore/digit/letter, `-` for UUIDs, `*` for COUNT(*))
 * and nothing that could break out of an identifier (`"`, `;`, whitespace, …).
 */
const SAFE_IDENTIFIER_RE = /^[A-Za-z0-9_*-]+$/;

export const assertSqlIdentifier = (value: string): string => {
  if (!SAFE_IDENTIFIER_RE.test(value)) {
    throw new Error(`unsafe SQL identifier: ${JSON.stringify(value)}`);
  }
  return value;
};
