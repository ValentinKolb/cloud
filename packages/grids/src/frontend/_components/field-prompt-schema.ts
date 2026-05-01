import type { Field } from "../../service";

/**
 * Returns true for field types that the QuickAdd / inline-edit forms can
 * render an input for. System / computed types are excluded — autonumber,
 * formula, lookup, rollup, created_*, updated_* are server-managed.
 */
export const isUserEditable = (type: string): boolean => {
  return [
    "text", "longtext", "number", "decimal", "rating",
    "boolean", "date", "single-select", "multi-select",
  ].includes(type);
};

/**
 * Builds a prompts.form schema entry for a single grids field, optionally
 * preloaded with an existing value (for edit flows). Maps grids types to
 * their closest prompts.form input shape; per-type config flows through
 * (selects' options, dates' includeTime, rating's scale).
 */
export const fieldToPromptSchema = (field: Field, currentValue?: unknown): any => {
  const required = field.required;
  const label = field.name;
  // prompts.form seeds inputs from `default`, not `value`. Use undefined
  // (not null) so the input renders blank rather than the string "null".
  const defaultVal = currentValue === null ? undefined : currentValue;

  switch (field.type) {
    case "text":
      return { type: "text", label, required, default: defaultVal };
    case "longtext":
      return { type: "text", label, required, multiline: true, lines: 4, default: defaultVal };
    case "number":
      return { type: "number", label, required, default: defaultVal };
    case "decimal":
      // No native decimal input; use number — server validates precision.
      return { type: "number", label, required, default: defaultVal };
    case "rating": {
      const scale = (field.config as { scale?: number }).scale ?? 5;
      return { type: "number", label, required, min: 0, max: scale, default: defaultVal };
    }
    case "boolean":
      return { type: "boolean", label, default: defaultVal === true };
    case "date": {
      const includeTime = (field.config as { includeTime?: boolean }).includeTime ?? false;
      return { type: "datetime", label, required, dateOnly: !includeTime, default: defaultVal };
    }
    case "single-select": {
      const options = ((field.config as { options?: Array<{ id: string; label: string }> }).options ?? []).map(
        (o) => ({ id: o.id, label: o.label }),
      );
      return { type: "select", label, required, options, clearable: !required, default: defaultVal };
    }
    case "multi-select":
      return { type: "tags", label, default: Array.isArray(defaultVal) ? defaultVal : [] };
    default:
      return null;
  }
};

/**
 * Strips empty / undefined / empty-array values from a prompts.form result
 * so the API layer applies defaults or leaves the field cleared.
 * Preserves `false` and `0` since they're meaningful for boolean / number.
 */
export const sanitizePayload = (result: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(result)) {
    if (v === "" || v === undefined) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
};
