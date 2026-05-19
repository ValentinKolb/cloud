/**
 * Returns true for field types that the QuickAdd / inline-edit forms can
 * render an input for. System / computed types are excluded — autonumber,
 * formula, lookup, rollup, created_*, updated_* are server-managed.
 */
export const isUserEditable = (type: string): boolean => {
  return ["text", "longtext", "number", "decimal", "boolean", "date", "select", "percent", "duration", "json"].includes(type);
};
