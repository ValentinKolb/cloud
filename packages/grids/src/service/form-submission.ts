import { type DateContext, err, fail, isServiceError, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { listByTable as listFields, materializeFieldDefault } from "./fields";
import type { Form } from "./forms";
import { notifyRecordEventOutbox } from "./record-event-outbox";
import { createInTransaction } from "./record-write";

type InlineCreateDraft = {
  tempId: string;
  data: Record<string, unknown>;
};

export type FormSubmission = {
  data: Record<string, unknown>;
  inlineCreates: Record<string, InlineCreateDraft[]>;
};

export const submitForm = async (params: {
  form: Form;
  submission: FormSubmission;
  actorId: string | null;
  dateConfig: DateContext;
}): Promise<Result<{ recordId: string }>> => {
  const formFields = params.form.config.fields ?? [];
  const fields = await listFields(params.form.tableId);
  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const entriesById = new Map(formFields.map((entry) => [entry.fieldId, entry]));
  const fieldName = (fieldId: string) => {
    const entry = entriesById.get(fieldId);
    if (entry?.kind === "user_input" && entry.label?.trim()) return entry.label.trim();
    return fieldsById.get(fieldId)?.name ?? "Unknown field";
  };

  const userInputIds = new Set<string>();
  const formValueIds = new Set<string>();
  for (const entry of formFields) {
    if (entry.kind === "user_input") userInputIds.add(entry.fieldId);
    else formValueIds.add(entry.fieldId);
  }
  for (const key of Object.keys(params.submission.data)) {
    if (formValueIds.has(key)) return fail(err.badInput(`Field "${fieldName(key)}" is server-managed and cannot be set via the form`));
    if (!userInputIds.has(key)) return fail(err.badInput(`Field "${fieldName(key)}" is not part of this form`));
  }

  const payload: Record<string, unknown> = { ...params.submission.data };
  for (const entry of formFields) {
    if (entry.kind !== "user_input") continue;
    if (payload[entry.fieldId] === undefined && entry.defaultValue !== undefined && entry.defaultValue !== null) {
      const field = fieldsById.get(entry.fieldId);
      payload[entry.fieldId] = field
        ? materializeFieldDefault({ ...field, defaultValue: entry.defaultValue }, { dateConfig: params.dateConfig })
        : entry.defaultValue;
    }
    if (entry.required && (payload[entry.fieldId] === undefined || payload[entry.fieldId] === null || payload[entry.fieldId] === "")) {
      return fail(err.badInput(`Field "${fieldName(entry.fieldId)}" is required`));
    }
  }
  for (const entry of formFields) {
    if (entry.kind !== "form_value") continue;
    const field = fieldsById.get(entry.fieldId);
    payload[entry.fieldId] = field
      ? materializeFieldDefault({ ...field, defaultValue: entry.value }, { dateConfig: params.dateConfig })
      : entry.value;
  }

  const outboxIds: string[] = [];
  try {
    const recordId = await sql.begin(async (tx) => {
      for (const [relationFieldId, drafts] of Object.entries(params.submission.inlineCreates)) {
        if (drafts.length === 0) continue;
        const entry = entriesById.get(relationFieldId);
        const relationField = fieldsById.get(relationFieldId);
        if (entry?.kind !== "user_input" || !entry.inlineCreate?.enabled || !relationField || relationField.type !== "relation") {
          throw err.badInput(`Field "${fieldName(relationFieldId)}" does not allow creating related records`);
        }
        const targetTableId = (relationField.config as { targetTableId?: unknown }).targetTableId;
        if (typeof targetTableId !== "string") throw err.badInput(`Field "${fieldName(relationFieldId)}" has no target table`);
        const cardinality = (relationField.config as { cardinality?: "single" | "multiple" }).cardinality ?? "multiple";
        const inlineEntries = entry.inlineCreate.fields ?? [];
        const allowedFieldIds = new Set(inlineEntries.map((inlineEntry) => inlineEntry.fieldId));
        const targetFields = await listFields(targetTableId);
        const targetFieldsById = new Map(targetFields.map((field) => [field.id, field]));

        for (const draft of drafts) {
          if (!draft.tempId.startsWith("tmp_")) throw err.badInput(`Field "${fieldName(relationFieldId)}" has an invalid inline draft id`);
          for (const key of Object.keys(draft.data)) {
            if (!allowedFieldIds.has(key)) {
              throw err.badInput(`Field "${fieldName(relationFieldId)}" contains a field that cannot be created inline`);
            }
          }
        }

        const currentIds = Array.isArray(payload[relationFieldId])
          ? (payload[relationFieldId] as unknown[]).filter((id): id is string => typeof id === "string")
          : typeof payload[relationFieldId] === "string"
            ? [payload[relationFieldId]]
            : [];
        const draftIds = drafts.map((draft) => draft.tempId);
        const existingIds = currentIds.filter((id) => !draftIds.includes(id));
        if (cardinality === "single" && (drafts.length > 1 || (drafts.length > 0 && existingIds.length > 0))) {
          throw err.badInput(`Field "${fieldName(relationFieldId)}" can link either one existing record or one new record`);
        }

        const replacements = new Map<string, string>();
        for (const draft of drafts) {
          const draftPayload: Record<string, unknown> = { ...draft.data };
          for (const inlineEntry of inlineEntries) {
            const targetField = targetFieldsById.get(inlineEntry.fieldId);
            if (!targetField) throw err.badInput(`Field "${fieldName(relationFieldId)}" inline configuration is stale`);
            if (
              draftPayload[inlineEntry.fieldId] === undefined &&
              inlineEntry.defaultValue !== undefined &&
              inlineEntry.defaultValue !== null
            ) {
              draftPayload[inlineEntry.fieldId] = materializeFieldDefault(
                { ...targetField, defaultValue: inlineEntry.defaultValue },
                { dateConfig: params.dateConfig },
              );
            }
            if (
              (inlineEntry.required || targetField.required) &&
              (draftPayload[inlineEntry.fieldId] === undefined ||
                draftPayload[inlineEntry.fieldId] === null ||
                draftPayload[inlineEntry.fieldId] === "")
            ) {
              throw err.badInput(`Field "${inlineEntry.label?.trim() || targetField.name}" is required`);
            }
          }
          const created = await createInTransaction(tx, targetTableId, draftPayload, params.actorId, {
            bypassDirectInsertCheck: true,
            dateConfig: params.dateConfig,
          });
          if (!created.ok) throw created.error;
          replacements.set(draft.tempId, created.data.record.id);
          outboxIds.push(created.data.outboxId);
        }

        const sourceIds = currentIds.length > 0 ? [...currentIds] : [...draftIds];
        if (cardinality !== "single") {
          for (const draftId of draftIds) {
            if (!sourceIds.includes(draftId)) sourceIds.push(draftId);
          }
        }
        payload[relationFieldId] = sourceIds.map((id) => replacements.get(id) ?? id);
      }

      const created = await createInTransaction(tx, params.form.tableId, payload, params.actorId, {
        bypassDirectInsertCheck: true,
        dateConfig: params.dateConfig,
      });
      if (!created.ok) throw created.error;
      outboxIds.push(created.data.outboxId);
      return created.data.record.id;
    });

    for (const outboxId of outboxIds) notifyRecordEventOutbox(outboxId);
    return { ok: true, data: { recordId } };
  } catch (error) {
    if (isServiceError(error)) return fail(error);
    throw error;
  }
};
