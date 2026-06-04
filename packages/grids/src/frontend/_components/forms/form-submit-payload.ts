import type { Field } from "../../../service";
import { sanitizeFieldValues } from "../fields/field-render";

export type InlineCreateDraft = {
  tempId: string;
  data: Record<string, unknown>;
};

export type InlineCreateState = Record<string, InlineCreateDraft[]>;

export const buildFormSubmitPayload = (
  fields: Field[],
  values: Record<string, unknown>,
  inlineCreates: InlineCreateState = {},
  options: { omitEmpty?: boolean } = { omitEmpty: true },
): Record<string, unknown> => {
  const data = sanitizeFieldValues(fields, values, { omitEmpty: options.omitEmpty ?? true });
  const cleanInlineCreates = Object.fromEntries(
    Object.entries(inlineCreates)
      .map(([fieldId, drafts]) => [
        fieldId,
        drafts
          .map((draft) => ({
            tempId: draft.tempId,
            data: Object.fromEntries(
              Object.entries(draft.data).filter(([, value]) => {
                if (value === "" || value === undefined || value === null) return false;
                if (Array.isArray(value) && value.length === 0) return false;
                return true;
              }),
            ),
          }))
          .filter((draft) => Object.keys(draft.data).length > 0),
      ])
      .filter(([, drafts]) => (drafts as InlineCreateDraft[]).length > 0),
  ) as InlineCreateState;
  for (const [fieldId] of Object.entries(inlineCreates)) {
    const allowedTempIds = new Set((cleanInlineCreates[fieldId] ?? []).map((draft) => draft.tempId));
    const value = data[fieldId];
    if (Array.isArray(value)) {
      const cleaned = value.filter((id) => typeof id !== "string" || !id.startsWith("tmp_") || allowedTempIds.has(id));
      if (cleaned.length > 0) data[fieldId] = cleaned;
      else delete data[fieldId];
    } else if (typeof value === "string" && value.startsWith("tmp_") && !allowedTempIds.has(value)) {
      delete data[fieldId];
    }
  }
  return Object.keys(cleanInlineCreates).length > 0 ? { data, inlineCreates: cleanInlineCreates } : data;
};
