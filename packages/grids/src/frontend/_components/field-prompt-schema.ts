import type { Field } from "../../service";

/**
 * Returns true for field types that the QuickAdd / inline-edit forms can
 * render an input for. System / computed types are excluded — autonumber,
 * formula, lookup, rollup, created_*, updated_* are server-managed.
 */
export const isUserEditable = (type: string): boolean => {
  return [
    // Tier 1
    "text", "longtext", "number", "decimal", "rating",
    "boolean", "date", "single-select", "multi-select",
    // Tier 2
    "email", "url", "phone", "currency", "percent", "duration", "slug",
    // Tier 3 (text-input or json fallback)
    "barcode", "isbn", "color", "rich-text", "json",
  ].includes(type);
};

/**
 * Builds a prompts.form schema entry for a single grids field, optionally
 * preloaded with an existing value (for edit flows). Maps grids types to
 * their closest prompts.form input shape; per-type config flows through
 * (selects' options, dates' includeTime, rating's scale).
 *
 * Per-field descriptions live under `field.config.description` (Zod
 * configSchemas are non-strict by default, so unknown keys round-trip
 * through the DB unmodified). They appear under the input label in the
 * prompts.form modal.
 */
export const fieldToPromptSchema = (field: Field, currentValue?: unknown): any => {
  const required = field.required;
  const label = field.name;
  // Description is a top-level Field column now (string | null).
  const description = field.description ?? undefined;
  // prompts.form seeds inputs from `default`, not `value`. Use undefined
  // (not null) so the input renders blank rather than the string "null".
  const defaultVal = currentValue === null ? undefined : currentValue;

  // Common metadata for every input — label / required / description.
  const base = { label, required, description } as const;

  switch (field.type) {
    case "text":
      return { type: "text", ...base, default: defaultVal };
    case "longtext":
      return { type: "text", ...base, multiline: true, lines: 4, default: defaultVal };
    case "number":
      return { type: "number", ...base, default: defaultVal };
    case "decimal":
      // No native decimal input; use number — server validates precision.
      return { type: "number", ...base, default: defaultVal };
    case "rating": {
      const scale = (field.config as { scale?: number }).scale ?? 5;
      return { type: "number", ...base, min: 0, max: scale, default: defaultVal };
    }
    case "boolean":
      // Only seed a default when there's an actual prior value; defaulting
      // to `false` would overwrite a server-side null/default with false
      // when the user submits without touching this field.
      return defaultVal === undefined
        ? { type: "boolean", label, description }
        : { type: "boolean", label, description, default: defaultVal === true };
    case "date": {
      const includeTime = (field.config as { includeTime?: boolean }).includeTime ?? false;
      return { type: "datetime", ...base, dateOnly: !includeTime, default: defaultVal };
    }
    case "single-select": {
      const options = ((field.config as { options?: Array<{ id: string; label: string }> }).options ?? []).map(
        (o) => ({ id: o.id, label: o.label }),
      );
      return { type: "select", ...base, options, clearable: !required, default: defaultVal };
    }
    case "multi-select":
      return { type: "tags", label, description, default: Array.isArray(defaultVal) ? defaultVal : [] };
    // Tier 2 — text-shaped with format hint via placeholder
    case "email":
      return { type: "text", ...base, placeholder: "name@example.com", default: defaultVal };
    case "url":
      return { type: "text", ...base, placeholder: "https://…", default: defaultVal };
    case "phone":
      return { type: "text", ...base, placeholder: "+49 151 …", default: defaultVal };
    case "slug":
      return { type: "text", ...base, placeholder: "my-slug", default: defaultVal };
    case "percent":
      return { type: "number", ...base, min: 0, max: 100, default: defaultVal };
    case "duration":
      return { type: "text", ...base, placeholder: "HH:MM:SS or seconds", default: defaultVal };
    case "currency":
      // Currency stores `{ amount, currency }` server-side. The UI input
      // is a plain number for the amount; on edit we have to round-trip
      // the per-row currency code so saving without touching the field
      // doesn't silently rewrite USD → EUR via the field's default code.
      // Sentinel: pre-format the default with the existing currency code
      // and let the server treat that string as `{amount, currency}`.
      // Currency handler accepts either form.
      if (typeof defaultVal === "object" && defaultVal && "amount" in defaultVal) {
        const obj = defaultVal as { amount?: string; currency?: string };
        return {
          type: "text",
          ...base,
          placeholder: "12.34 EUR",
          default: obj.amount && obj.currency ? `${obj.amount} ${obj.currency}` : obj.amount,
        };
      }
      return { type: "text", ...base, placeholder: "12.34 EUR", default: defaultVal };
    // Tier 3
    case "barcode":
    case "isbn":
      return { type: "text", ...base, default: defaultVal };
    case "color":
      return { type: "text", ...base, placeholder: "#3b82f6", default: defaultVal };
    case "rich-text":
      return { type: "text", ...base, multiline: true, lines: 8, default: defaultVal };
    case "json":
      // Free-form JSON via multiline; server parses + validates.
      return {
        type: "text",
        ...base,
        multiline: true,
        lines: 6,
        default: defaultVal !== undefined ? JSON.stringify(defaultVal, null, 2) : undefined,
      };
    // Location / signature: not yet exposed in the inline form (need
    // dedicated capture UIs). Set via API for now.
    default:
      return null;
  }
};

/**
 * CREATE path: drop empty / undefined / empty-array values so server-side
 * defaults / nulls apply for un-touched fields. Keep `false` and `0`.
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

/**
 * EDIT path: clearing a field in the dialog must round-trip as an explicit
 * null so the records-update service treats it as "set to null" rather than
 * "leave unchanged" (omitted keys are preserved). Every form-rendered field
 * is included; empty values become null.
 */
export const sanitizeEditPayload = (
  result: Record<string, unknown>,
  formFieldIds: string[],
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const fieldId of formFieldIds) {
    const v = result[fieldId];
    if (v === undefined || v === "") {
      out[fieldId] = null;
      continue;
    }
    if (Array.isArray(v) && v.length === 0) {
      out[fieldId] = null;
      continue;
    }
    out[fieldId] = v;
  }
  return out;
};
