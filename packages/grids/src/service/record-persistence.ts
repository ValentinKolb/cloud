import { isRecordWritableFieldType } from "../field-types";
import { parseJsonbRow } from "./jsonb";
import type { Field, GridRecord } from "./types";

type DbRecordRow = Record<string, unknown>;

export const mapRecordRow = (row: DbRecordRow): GridRecord => ({
  id: row.id as string,
  tableId: row.table_id as string,
  data: parseJsonbRow<Record<string, unknown>>(row.data, {}),
  version: row.version as number,
  deletedAt: row.deleted_at ? (row.deleted_at as Date).toISOString() : null,
  createdBy: (row.created_by as string | null) ?? null,
  updatedBy: (row.updated_by as string | null) ?? null,
  createdAt: (row.created_at as Date).toISOString(),
  updatedAt: (row.updated_at as Date).toISOString(),
});

export const splitRelationsFromData = (
  data: Record<string, unknown>,
  fields: Field[],
): { data: Record<string, unknown>; relations: Map<string, string[]> } => {
  const relationFieldIds = new Set(fields.filter((field) => field.type === "relation" && !field.deletedAt).map((field) => field.id));
  const persistableData: Record<string, unknown> = {};
  const relations = new Map<string, string[]>();

  for (const [fieldId, value] of Object.entries(data)) {
    if (!relationFieldIds.has(fieldId)) {
      persistableData[fieldId] = value;
      continue;
    }

    const ids = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : typeof value === "string"
        ? [value]
        : [];
    relations.set(fieldId, ids);
  }

  return { data: persistableData, relations };
};

export const buildPersistedUpdateData = (
  existingData: Record<string, unknown>,
  validatedData: Record<string, unknown>,
  fields: Field[],
): Record<string, unknown> => {
  const persistableFieldIds = new Set(
    fields
      .filter((field) => isRecordWritableFieldType(field.type) && field.type !== "relation" && !field.deletedAt)
      .map((field) => field.id),
  );
  const merged = {
    ...Object.fromEntries(Object.entries(existingData).filter(([fieldId]) => persistableFieldIds.has(fieldId))),
    ...validatedData,
  };

  for (const [fieldId, value] of Object.entries(merged)) {
    if (value === null) delete merged[fieldId];
  }
  return merged;
};

export const buildRecordDiff = (
  existingData: Record<string, unknown>,
  validatedData: Record<string, unknown>,
): Record<string, { old: unknown; new: unknown }> => {
  const diff: Record<string, { old: unknown; new: unknown }> = {};
  for (const [fieldId, value] of Object.entries(validatedData)) {
    const oldValue = existingData[fieldId] ?? null;
    const newValue = value ?? null;
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      diff[fieldId] = { old: oldValue, new: newValue };
    }
  }
  return diff;
};
