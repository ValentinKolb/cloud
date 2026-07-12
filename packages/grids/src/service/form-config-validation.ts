import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { FormConfigSchema } from "../contracts";
import { isRecordWritableFieldType } from "../field-types";
import { listByTable as listFields, validateDefaultValue } from "./fields";
import type { FormConfig, FormFieldEntry } from "./forms";
import type { Field } from "./types";

type UserInputEntry = Extract<FormFieldEntry, { kind: "user_input" }>;
type InlineCreateConfig = NonNullable<UserInputEntry["inlineCreate"]>;
type InlineCreateField = NonNullable<InlineCreateConfig["fields"]>[number];

const normalizeConfiguredValue = (field: Field, entry: FormFieldEntry): Result<FormFieldEntry> => {
  const raw = entry.kind === "form_value" ? entry.value : entry.defaultValue;
  const validated = validateDefaultValue(field.type, field.config, raw);
  if (!validated.ok) return fail(err.badInput(`invalid form value for "${field.name}": ${validated.error.message}`));
  if (entry.kind === "form_value") return ok({ ...entry, value: validated.data });
  return ok(entry.defaultValue !== undefined ? { ...entry, defaultValue: validated.data } : entry);
};

const normalizeInlineFields = async (parentField: Field, fields: InlineCreateField[]): Promise<Result<InlineCreateField[]>> => {
  const targetTableId = (parentField.config as { targetTableId?: unknown }).targetTableId;
  if (typeof targetTableId !== "string") {
    return fail(err.badInput(`field "${parentField.name}" cannot create related records because it has no target table`));
  }
  if (fields.length === 0) {
    return fail(err.badInput(`field "${parentField.name}" inline creation needs at least one target field`));
  }

  const targetFields = await listFields(targetTableId);
  const targetById = new Map(targetFields.filter((field) => !field.deletedAt).map((field) => [field.id, field]));
  const seen = new Set<string>();
  const normalized: InlineCreateField[] = [];
  for (const entry of fields) {
    const targetField = targetById.get(entry.fieldId);
    if (!targetField) return fail(err.badInput(`field "${parentField.name}" inline creation references an unknown target field`));
    if (seen.has(entry.fieldId)) {
      return fail(err.badInput(`field "${parentField.name}" inline creation references "${targetField.name}" more than once`));
    }
    seen.add(entry.fieldId);
    if (!isRecordWritableFieldType(targetField.type) || targetField.type === "relation") {
      return fail(err.badInput(`field "${parentField.name}" inline creation cannot edit target field "${targetField.name}"`));
    }
    const defaultValue = validateDefaultValue(targetField.type, targetField.config, entry.defaultValue);
    if (!defaultValue.ok) {
      return fail(err.badInput(`invalid inline form value for "${targetField.name}": ${defaultValue.error.message}`));
    }
    normalized.push(entry.defaultValue !== undefined ? { ...entry, defaultValue: defaultValue.data } : entry);
  }
  return ok(normalized);
};

const normalizeInlineCreate = async (field: Field, entry: UserInputEntry): Promise<Result<UserInputEntry>> => {
  if (!entry.inlineCreate?.enabled) {
    return ok(entry.inlineCreate ? { ...entry, inlineCreate: undefined } : entry);
  }
  if (field.type !== "relation") {
    return fail(err.badInput(`field "${field.name}" cannot create related records because it is not a relation`));
  }
  const fields = await normalizeInlineFields(field, entry.inlineCreate.fields ?? []);
  if (!fields.ok) return fields;
  return ok({ ...entry, inlineCreate: { enabled: true, fields: fields.data } });
};

export const validateFormConfig = async (tableId: string, config: unknown): Promise<Result<FormConfig>> => {
  const parsed = FormConfigSchema.safeParse(config);
  if (!parsed.success) {
    const detail = parsed.error.issues[0]?.message ?? "invalid form config";
    return fail(err.badInput(`invalid form config: ${detail}`));
  }

  const fields = await listFields(tableId);
  const byId = new Map(fields.filter((field) => !field.deletedAt).map((field) => [field.id, field]));
  const seen = new Set<string>();
  const normalizedFields: FormFieldEntry[] = [];
  for (const entry of parsed.data.fields as FormFieldEntry[]) {
    const field = byId.get(entry.fieldId);
    if (!field) return fail(err.badInput("form references an unknown field"));
    if (seen.has(entry.fieldId)) return fail(err.badInput(`form references field "${field.name}" more than once`));
    seen.add(entry.fieldId);
    if (!isRecordWritableFieldType(field.type)) return fail(err.badInput(`field "${field.name}" cannot be used in a form`));

    const configuredValue = normalizeConfiguredValue(field, entry);
    if (!configuredValue.ok) return configuredValue;
    if (configuredValue.data.kind !== "user_input") {
      normalizedFields.push(configuredValue.data);
      continue;
    }
    const inlineCreate = await normalizeInlineCreate(field, configuredValue.data);
    if (!inlineCreate.ok) return inlineCreate;
    normalizedFields.push(inlineCreate.data);
  }

  return ok({ ...(parsed.data as FormConfig), fields: normalizedFields });
};
