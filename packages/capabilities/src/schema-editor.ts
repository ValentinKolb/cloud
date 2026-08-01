type JsonSchema = Record<string, unknown>;

export type EditorValue = string | number | boolean | null;

type BaseField = {
  key: string;
  label: string;
  description?: string;
  required: boolean;
};

export type EditorField =
  | (BaseField & {
      kind: "string";
      format?: string;
      minLength?: number;
      maxLength?: number;
      pattern?: string;
    })
  | (BaseField & {
      kind: "number" | "integer";
      minimum?: number;
      maximum?: number;
    })
  | (BaseField & {
      kind: "boolean";
    })
  | (BaseField & {
      kind: "enum";
      options: Array<{ value: string; label: string; data: string | number | boolean }>;
    })
  | (BaseField & {
      kind: "array";
      itemKind: "string" | "number" | "integer" | "boolean";
      minItems?: number;
      maxItems?: number;
    });

export type SchemaEditorModel = { mode: "form"; fields: EditorField[] } | { mode: "json"; initialSource: string; reason: string };

export type SchemaEditorState = {
  values: Record<string, EditorValue>;
  source: string;
};

export type InputBuildResult =
  | { ok: true; input: Record<string, unknown> }
  | { ok: false; errors: Record<string, string>; formError?: string };

type FieldBuildResult = { include: false; error?: string } | { include: true; value: unknown };

const isRecord = (value: unknown): value is JsonSchema => typeof value === "object" && value !== null && !Array.isArray(value);

const stringValue = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
const numberValue = (value: unknown): number | undefined => (typeof value === "number" ? value : undefined);

const humanize = (key: string): string => {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .trim();
  return spaced ? `${spaced[0]!.toUpperCase()}${spaced.slice(1)}` : key;
};

const scalarType = (schema: JsonSchema): "string" | "number" | "integer" | "boolean" | undefined => {
  const type = schema.type;
  return type === "string" || type === "number" || type === "integer" || type === "boolean" ? type : undefined;
};

const enumField = (base: BaseField, schema: JsonSchema): EditorField | undefined => {
  if (!Array.isArray(schema.enum) || schema.enum.length === 0) return undefined;
  if (!schema.enum.every((value) => typeof value === "string" || typeof value === "number" || typeof value === "boolean")) {
    return undefined;
  }
  return {
    ...base,
    kind: "enum",
    options: schema.enum.map((data) => ({ value: JSON.stringify(data), label: String(data), data })),
  };
};

const fieldFromSchema = (key: string, schema: JsonSchema, required: boolean): EditorField | undefined => {
  const base: BaseField = {
    key,
    label: stringValue(schema.title) ?? humanize(key),
    description: stringValue(schema.description),
    required,
  };
  const enumerated = enumField(base, schema);
  if (enumerated) return enumerated;

  const type = scalarType(schema);
  if (type === "string") {
    return {
      ...base,
      kind: "string",
      format: stringValue(schema.format),
      minLength: numberValue(schema.minLength),
      maxLength: numberValue(schema.maxLength),
      pattern: stringValue(schema.pattern),
    };
  }
  if (type === "number" || type === "integer") {
    return {
      ...base,
      kind: type,
      minimum: numberValue(schema.minimum),
      maximum: numberValue(schema.maximum),
    };
  }
  if (type === "boolean") return { ...base, kind: "boolean" };
  if (schema.type === "array" && isRecord(schema.items)) {
    const itemKind = scalarType(schema.items);
    if (!itemKind) return undefined;
    return {
      ...base,
      kind: "array",
      itemKind,
      minItems: numberValue(schema.minItems),
      maxItems: numberValue(schema.maxItems),
    };
  }
  return undefined;
};

export function createSchemaEditorModel(schema: JsonSchema): SchemaEditorModel {
  if (schema.type !== "object" || schema.additionalProperties !== false || !isRecord(schema.properties)) {
    return {
      mode: "json",
      initialSource: JSON.stringify(isRecord(schema.default) ? schema.default : {}, null, 2),
      reason: "This schema uses a complex shape. Enter the request as JSON.",
    };
  }
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === "string") : []);
  const fields: EditorField[] = [];
  for (const [key, value] of Object.entries(schema.properties)) {
    if (!isRecord(value)) {
      return { mode: "json", initialSource: "{}", reason: "This schema uses a complex shape. Enter the request as JSON." };
    }
    const field = fieldFromSchema(key, value, required.has(key));
    if (!field) {
      return { mode: "json", initialSource: "{}", reason: "This schema uses a complex field. Enter the request as JSON." };
    }
    fields.push(field);
  }
  return { mode: "form", fields };
}

const initialFieldValue = (field: EditorField, schema: JsonSchema): EditorValue => {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const candidate = properties[field.key];
  const property: JsonSchema = isRecord(candidate) ? candidate : {};
  const fallback = property.default;
  switch (field.kind) {
    case "boolean":
      return typeof fallback === "boolean" ? fallback : field.required ? false : null;
    case "number":
    case "integer":
      return typeof fallback === "number" ? fallback : null;
    case "enum":
      return field.options.find((candidate) => Object.is(candidate.data, fallback))?.value ?? null;
    case "array":
      return Array.isArray(fallback) ? fallback.map(String).join("\n") : "";
    case "string":
      return typeof fallback === "string" ? fallback : "";
  }
};

export function createSchemaEditorState(model: SchemaEditorModel, schema: JsonSchema): SchemaEditorState {
  if (model.mode === "json") return { values: {}, source: model.initialSource };
  return {
    values: Object.fromEntries(model.fields.map((field) => [field.key, initialFieldValue(field, schema)])),
    source: "{}",
  };
}

const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const isUri = (value: string) => {
  try {
    return Boolean(new URL(value));
  } catch {
    return false;
  }
};

const validateString = (field: Extract<EditorField, { kind: "string" }>, value: string): string | undefined => {
  if (!value && !field.required) return undefined;
  if (field.minLength !== undefined && value.length < field.minLength) {
    return `${field.label} must contain at least ${field.minLength} ${field.minLength === 1 ? "character" : "characters"}.`;
  }
  if (field.maxLength !== undefined && value.length > field.maxLength) {
    return `${field.label} must contain at most ${field.maxLength} ${field.maxLength === 1 ? "character" : "characters"}.`;
  }
  if (field.pattern) {
    try {
      if (!new RegExp(field.pattern).test(value)) return `${field.label} has an invalid format.`;
    } catch {
      return `${field.label} cannot be validated in this form. Use JSON input instead.`;
    }
  }
  if (field.format === "email" && !isEmail(value)) return `${field.label} must be an email address.`;
  if (field.format === "uuid" && !isUuid(value)) return `${field.label} must be a UUID.`;
  if ((field.format === "uri" || field.format === "url") && !isUri(value)) return `${field.label} must be a URL.`;
  return undefined;
};

const parseArray = (field: Extract<EditorField, { kind: "array" }>, source: string): { value?: unknown[]; error?: string } => {
  const lines = source
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (field.minItems !== undefined && lines.length < field.minItems)
    return { error: `${field.label} needs at least ${field.minItems} values.` };
  if (field.maxItems !== undefined && lines.length > field.maxItems)
    return { error: `${field.label} accepts at most ${field.maxItems} values.` };
  if (field.itemKind === "string") return { value: lines };
  if (field.itemKind === "boolean") {
    if (lines.some((value) => value !== "true" && value !== "false")) return { error: `${field.label} accepts only true or false.` };
    return { value: lines.map((value) => value === "true") };
  }
  const numbers = lines.map(Number);
  if (numbers.some((value) => !Number.isFinite(value))) return { error: `${field.label} accepts only numbers.` };
  if (field.itemKind === "integer" && numbers.some((value) => !Number.isInteger(value)))
    return { error: `${field.label} accepts only integers.` };
  return { value: numbers };
};

const buildJsonInput = (source: string): InputBuildResult => {
  try {
    const input: unknown = JSON.parse(source);
    return isRecord(input) ? { ok: true, input } : { ok: false, errors: {}, formError: "The request must be a JSON object." };
  } catch {
    return { ok: false, errors: {}, formError: "Enter valid JSON before running the capability." };
  }
};

const buildNumberField = (field: Extract<EditorField, { kind: "number" | "integer" }>, value: EditorValue): FieldBuildResult => {
  if (value === null || typeof value !== "number") {
    return { include: false, error: field.required ? `${field.label} is required.` : undefined };
  }
  if (field.kind === "integer" && !Number.isInteger(value)) return { include: false, error: `${field.label} must be an integer.` };
  if (field.minimum !== undefined && value < field.minimum)
    return { include: false, error: `${field.label} must be at least ${field.minimum}.` };
  if (field.maximum !== undefined && value > field.maximum)
    return { include: false, error: `${field.label} must be at most ${field.maximum}.` };
  return { include: true, value };
};

const buildStringField = (field: Extract<EditorField, { kind: "string" }>, value: EditorValue): FieldBuildResult => {
  const source = typeof value === "string" ? value : "";
  const error = validateString(field, source);
  if (error) return { include: false, error };
  return field.required || source !== "" ? { include: true, value: source } : { include: false };
};

const buildBooleanField = (field: Extract<EditorField, { kind: "boolean" }>, value: EditorValue): FieldBuildResult => {
  if (typeof value === "boolean") return { include: true, value };
  return field.required ? { include: true, value: false } : { include: false };
};

const buildEnumField = (field: Extract<EditorField, { kind: "enum" }>, value: EditorValue): FieldBuildResult => {
  const option = field.options.find((candidate) => candidate.value === value);
  return option
    ? { include: true, value: option.data }
    : { include: false, error: field.required ? `${field.label} is required.` : undefined };
};

const buildArrayField = (field: Extract<EditorField, { kind: "array" }>, value: EditorValue): FieldBuildResult => {
  const parsed = parseArray(field, typeof value === "string" ? value : "");
  if (parsed.error) return { include: false, error: parsed.error };
  return field.required || parsed.value?.length ? { include: true, value: parsed.value } : { include: false };
};

const buildFieldInput = (field: EditorField, value: EditorValue): FieldBuildResult => {
  switch (field.kind) {
    case "string":
      return buildStringField(field, value);
    case "number":
    case "integer":
      return buildNumberField(field, value);
    case "boolean":
      return buildBooleanField(field, value);
    case "enum":
      return buildEnumField(field, value);
    case "array":
      return buildArrayField(field, value);
  }
};

export function buildCapabilityInput(model: SchemaEditorModel, state: SchemaEditorState): InputBuildResult {
  if (model.mode === "json") return buildJsonInput(state.source);

  const input: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const field of model.fields) {
    const result = buildFieldInput(field, state.values[field.key] ?? null);
    if (result.include) input[field.key] = result.value;
    else if (result.error) errors[field.key] = result.error;
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, input };
}
