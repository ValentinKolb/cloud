import type { WorkflowDiagnostic, WorkflowFieldSchema, WorkflowJsonValue, WorkflowSourceLocation } from "../contracts";
import { workflowPathKey } from "../contracts";

const isRecord = (value: unknown): value is Record<string, WorkflowJsonValue> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const locationForPath = (
  path: Array<string | number>,
  locations: Record<string, WorkflowSourceLocation>,
): WorkflowSourceLocation | undefined => {
  for (let length = path.length; length >= 0; length -= 1) {
    const location = locations[workflowPathKey(path.slice(0, length))];
    if (location) return location;
  }
  return undefined;
};

const addDiagnostic = (
  diagnostics: WorkflowDiagnostic[],
  code: string,
  message: string,
  path: Array<string | number>,
  locations: Record<string, WorkflowSourceLocation>,
): void => {
  const location = locationForPath(path, locations);
  diagnostics.push({ code, message, severity: "error", path, ...(location ? { location } : {}) });
};

const describeType = (schema: WorkflowFieldSchema): string => {
  if (schema.kind === "value") return "JSON value";
  if (schema.kind === "record") return "object";
  return schema.kind;
};

export const validateWorkflowField = (
  value: WorkflowJsonValue,
  schema: WorkflowFieldSchema,
  path: Array<string | number>,
  locations: Record<string, WorkflowSourceLocation>,
  diagnostics: WorkflowDiagnostic[],
): void => {
  const typeError = (): void => addDiagnostic(diagnostics, "schema.type", `Expected ${describeType(schema)}`, path, locations);

  if (schema.kind === "value") return;
  if (schema.kind === "string") {
    if (typeof value !== "string") return typeError();
    if (schema.enum && !schema.enum.includes(value))
      addDiagnostic(diagnostics, "schema.enum", `Expected one of: ${schema.enum.join(", ")}`, path, locations);
    if (schema.minLength !== undefined && value.length < schema.minLength)
      addDiagnostic(diagnostics, "schema.minimum", `Expected at least ${schema.minLength} characters`, path, locations);
    if (schema.maxLength !== undefined && value.length > schema.maxLength)
      addDiagnostic(diagnostics, "schema.maximum", `Expected at most ${schema.maxLength} characters`, path, locations);
    if (schema.format === "identifier" && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value))
      addDiagnostic(diagnostics, "schema.format", "Expected an identifier", path, locations);
    if (schema.format === "uri") {
      try {
        new URL(value);
      } catch {
        addDiagnostic(diagnostics, "schema.format", "Expected an absolute URI", path, locations);
      }
    }
    return;
  }
  if (schema.kind === "number") {
    if (typeof value !== "number") return typeError();
    if (schema.integer && !Number.isInteger(value)) addDiagnostic(diagnostics, "schema.integer", "Expected an integer", path, locations);
    if (schema.minimum !== undefined && value < schema.minimum)
      addDiagnostic(diagnostics, "schema.minimum", `Expected a value of at least ${schema.minimum}`, path, locations);
    if (schema.maximum !== undefined && value > schema.maximum)
      addDiagnostic(diagnostics, "schema.maximum", `Expected a value of at most ${schema.maximum}`, path, locations);
    return;
  }
  if (schema.kind === "boolean") {
    if (typeof value !== "boolean") typeError();
    return;
  }
  if (schema.kind === "array") {
    if (!Array.isArray(value)) return typeError();
    if (schema.minItems !== undefined && value.length < schema.minItems)
      addDiagnostic(diagnostics, "schema.minimum", `Expected at least ${schema.minItems} items`, path, locations);
    if (schema.maxItems !== undefined && value.length > schema.maxItems)
      addDiagnostic(diagnostics, "schema.maximum", `Expected at most ${schema.maxItems} items`, path, locations);
    value.forEach((item, index) => validateWorkflowField(item, schema.items, [...path, index], locations, diagnostics));
    return;
  }
  if (schema.kind === "record") {
    if (!isRecord(value)) return typeError();
    const keys = Object.keys(value);
    if (schema.minProperties !== undefined && keys.length < schema.minProperties)
      addDiagnostic(diagnostics, "schema.minimum", `Expected at least ${schema.minProperties} properties`, path, locations);
    if (schema.maxProperties !== undefined && keys.length > schema.maxProperties)
      addDiagnostic(diagnostics, "schema.maximum", `Expected at most ${schema.maxProperties} properties`, path, locations);
    keys.forEach((key) => validateWorkflowField(value[key]!, schema.values, [...path, key], locations, diagnostics));
    return;
  }
  if (schema.kind === "object") {
    if (!isRecord(value)) return typeError();
    for (const key of Object.keys(value)) {
      if (!schema.properties[key]) addDiagnostic(diagnostics, "schema.unknown", `Unknown property "${key}"`, [...path, key], locations);
    }
    for (const [key, propertySchema] of Object.entries(schema.properties)) {
      const property = value[key];
      if (property === undefined) {
        if (!propertySchema.optional)
          addDiagnostic(diagnostics, "schema.required", `Missing required property "${key}"`, [...path, key], locations);
      } else {
        validateWorkflowField(property, propertySchema, [...path, key], locations, diagnostics);
      }
    }
    return;
  }

  const variants = schema.variants.map((variant) => {
    const variantDiagnostics: WorkflowDiagnostic[] = [];
    validateWorkflowField(value, variant, path, locations, variantDiagnostics);
    return variantDiagnostics;
  });
  if (variants.some((variant) => variant.length === 0)) return;
  const best = variants.reduce((left, right) => (right.length < left.length ? right : left));
  diagnostics.push(...best);
};

export const workflowDiagnostic = (
  code: string,
  message: string,
  path: Array<string | number>,
  locations: Record<string, WorkflowSourceLocation>,
): WorkflowDiagnostic => {
  const diagnostics: WorkflowDiagnostic[] = [];
  addDiagnostic(diagnostics, code, message, path, locations);
  return diagnostics[0]!;
};

export const workflowRecord = isRecord;
