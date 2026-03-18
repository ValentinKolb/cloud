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
