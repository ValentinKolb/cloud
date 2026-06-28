import type { Field } from "../../../service";

const SYSTEM_OR_COMPUTED_FIELD_TYPES = new Set([
  "id",
  "formula",
  "lookup",
  "rollup",
  "created_at",
  "created_by",
  "updated_at",
  "updated_by",
]);

export const USER_EDITABLE_FIELD_TYPES = new Set([
  "text",
  "longtext",
  "number",
  "boolean",
  "date",
  "select",
  "percent",
  "duration",
  "json",
]);
export const RECORD_INPUT_FIELD_TYPES = new Set([...USER_EDITABLE_FIELD_TYPES, "relation"]);

export const isSystemOrComputedField = (type: string): boolean => SYSTEM_OR_COMPUTED_FIELD_TYPES.has(type);
export const isUserEditable = (type: string): boolean => USER_EDITABLE_FIELD_TYPES.has(type);
export const isRecordInputField = (type: string): boolean => RECORD_INPUT_FIELD_TYPES.has(type) && !isSystemOrComputedField(type);

const isNowDefault = (value: unknown): boolean =>
  typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "now";

const isEmptyValue = (value: unknown): boolean =>
  value === "" || value === undefined || value === null || (Array.isArray(value) && value.length === 0);

const stringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return typeof value === "string" && value.length > 0 ? [value] : [];
};

export const initialFieldInputValue = (field: Field, current?: unknown): unknown => {
  if (current !== undefined && current !== null) {
    if (field.type === "relation" || field.type === "select") return stringArray(current);
    return current;
  }
  if (field.type === "relation" || field.type === "select") return [];
  if (field.type === "boolean") return false;
  if (field.type === "date" && isNowDefault(field.defaultValue)) return "";
  return field.defaultValue !== null && field.defaultValue !== undefined ? field.defaultValue : "";
};

export const sanitizeFieldValue = (field: Field, raw: unknown): unknown => {
  if (field.type === "relation") return stringArray(raw);
  if (field.type === "select") {
    const values = stringArray(raw);
    const multiple = Boolean((field.config as { multiple?: boolean }).multiple);
    return multiple ? values : values.slice(0, 1);
  }
  return raw;
};

export const sanitizeFieldValues = (
  fields: Field[],
  values: Record<string, unknown>,
  options: { omitEmpty?: boolean } = {},
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const value = sanitizeFieldValue(field, values[field.id]);
    if (isEmptyValue(value)) {
      if (!options.omitEmpty) out[field.id] = null;
      continue;
    }
    out[field.id] = value;
  }
  return out;
};
