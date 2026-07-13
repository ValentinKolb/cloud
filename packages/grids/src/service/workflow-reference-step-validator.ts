import type { WorkflowDefinition } from "../contracts";
import { parseWorkflowValueString, workflowMessageExpressions } from "../workflows/value-expression";
import {
  getWorkflowCatalogRef,
  type WorkflowCatalog,
  type WorkflowCatalogEntry,
  type WorkflowCatalogIndex,
  workflowRefDiagnostic,
} from "./workflow-catalog";

type ValidationContext = {
  definition: WorkflowDefinition;
  catalog: WorkflowCatalog;
  diagnostics: string[];
  locals: Map<string, string>;
};

const tableForRecordRef = (ref: unknown, context: ValidationContext): string | null => {
  if (typeof ref !== "string") return null;
  const [root, name] = ref.split(".");
  if (root === "inputs" && name) {
    const input = context.definition.inputs?.[name];
    if (!input || input.type !== "record" || !input.table) return null;
    return getWorkflowCatalogRef(context.catalog.tables, input.table)?.id ?? null;
  }
  return context.locals.get(root ?? "") ?? null;
};

const tableForRecordListRef = (ref: unknown, context: ValidationContext): string | null => {
  if (typeof ref !== "string") return null;
  const [root, name] = ref.split(".");
  if (root !== "inputs" || !name) return null;
  const input = context.definition.inputs?.[name];
  if (!input || input.type !== "recordList" || !input.table) return null;
  return getWorkflowCatalogRef(context.catalog.tables, input.table)?.id ?? null;
};

const validateFieldRefs = (params: {
  fields: WorkflowCatalogIndex<WorkflowCatalogEntry> | undefined;
  keys: string[];
  label: string;
  diagnostics: string[];
}): void => {
  if (!params.fields) {
    params.diagnostics.push(`${params.label}: unknown table`);
    return;
  }
  for (const key of params.keys) {
    const diagnostic = workflowRefDiagnostic(params.fields, key, params.label);
    if (diagnostic) params.diagnostics.push(diagnostic.replace("reference", "field"));
  }
};

const validateValueFieldRefs = (value: unknown, context: ValidationContext, label: string): void => {
  if (typeof value === "string") {
    const parsed = parseWorkflowValueString(value);
    if (parsed.kind !== "expression" || parsed.expression.kind !== "reference") return;
    const reference = parsed.expression.reference;
    const parts = reference.split(".");
    const fieldStart = parts[0] === "inputs" ? 2 : 1;
    if (parts.length <= fieldStart) return;
    const tableId = tableForRecordRef(reference, context);
    if (!tableId) return;
    validateFieldRefs({
      fields: context.catalog.fieldsByTable.get(tableId),
      keys: [parts.slice(fieldStart).join(".")],
      label,
      diagnostics: context.diagnostics,
    });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateValueFieldRefs(item, context, `${label}.${index}`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) validateValueFieldRefs(item, context, `${label}.${key}`);
  }
};

const recordTableForValue = (value: unknown, context: ValidationContext): string | null => {
  if (typeof value !== "string") return null;
  const parsed = parseWorkflowValueString(value);
  if (parsed.kind !== "expression" || parsed.expression.kind !== "reference") return null;
  const parts = parsed.expression.reference.split(".");
  const fieldStart = parts[0] === "inputs" ? 2 : 1;
  return parts.length === fieldStart ? tableForRecordRef(parsed.expression.reference, context) : null;
};

const validateMessageFieldRefs = (value: unknown, context: ValidationContext, label: string): void => {
  if (typeof value !== "string") return;
  for (const item of workflowMessageExpressions(value)) validateValueFieldRefs(item.raw, context, label);
};

const childContext = (context: ValidationContext, locals = new Map(context.locals)): ValidationContext => ({
  ...context,
  locals,
});

const validateUpdateRecord = (action: unknown, context: ValidationContext): void => {
  const update = action as { record?: unknown; set?: Record<string, unknown> };
  const tableId = tableForRecordRef(update.record, context);
  validateFieldRefs({
    fields: tableId ? context.catalog.fieldsByTable.get(tableId) : undefined,
    keys: Object.keys(update.set ?? {}),
    label: "updateRecord.set",
    diagnostics: context.diagnostics,
  });
  validateValueFieldRefs(update.set, context, "updateRecord.set");
};

const validateCreateRecord = (action: unknown, context: ValidationContext): void => {
  const create = action as { table?: unknown; values?: Record<string, unknown>; saveAs?: unknown };
  const table = typeof create.table === "string" ? getWorkflowCatalogRef(context.catalog.tables, create.table) : null;
  if (!table) {
    context.diagnostics.push(
      workflowRefDiagnostic(context.catalog.tables, String(create.table ?? ""), "createRecord.table") ??
        "createRecord.table: unknown table",
    );
  }
  validateFieldRefs({
    fields: table ? context.catalog.fieldsByTable.get(table.id) : undefined,
    keys: Object.keys(create.values ?? {}),
    label: "createRecord.values",
    diagnostics: context.diagnostics,
  });
  validateValueFieldRefs(create.values, context, "createRecord.values");
  if (table && typeof create.saveAs === "string") context.locals.set(create.saveAs, table.id);
};

const validateGenerateDocument = (action: unknown, context: ValidationContext): void => {
  const generate = action as { template?: unknown; record?: unknown; filename?: unknown; tags?: unknown };
  const template = typeof generate.template === "string" ? getWorkflowCatalogRef(context.catalog.templates, generate.template) : null;
  if (!template) {
    context.diagnostics.push(
      workflowRefDiagnostic(context.catalog.templates, String(generate.template ?? ""), "generateDocument.template") ??
        "generateDocument.template: unknown document template",
    );
  }
  const tableId = tableForRecordRef(generate.record, context);
  if (template && tableId && template.tableId !== tableId) {
    context.diagnostics.push("generateDocument.record: record table must match the document template table");
  }
  validateValueFieldRefs(generate.filename, context, "generateDocument.filename");
  validateValueFieldRefs(generate.tags, context, "generateDocument.tags");
};

const validateSendEmail = (action: unknown, context: ValidationContext): void => {
  const send = action as { template?: unknown; to?: unknown[]; data?: unknown };
  const template = typeof send.template === "string" ? getWorkflowCatalogRef(context.catalog.emailTemplates, send.template) : null;
  if (!template) {
    context.diagnostics.push(
      workflowRefDiagnostic(context.catalog.emailTemplates, String(send.template ?? ""), "sendEmail.template") ??
        "sendEmail.template: unknown email template",
    );
  }
  validateValueFieldRefs(send.to, context, "sendEmail.to");
  validateValueFieldRefs(send.data, context, "sendEmail.data");
};

const validateActionStep = (item: Record<string, unknown>, context: ValidationContext): boolean => {
  if ("updateRecord" in item) validateUpdateRecord(item.updateRecord, context);
  else if ("createRecord" in item) validateCreateRecord(item.createRecord, context);
  else if ("generateDocument" in item) validateGenerateDocument(item.generateDocument, context);
  else if ("createDocumentLink" in item) {
    validateValueFieldRefs((item.createDocumentLink as { comment?: unknown }).comment, context, "createDocumentLink.comment");
  } else if ("sendEmail" in item) validateSendEmail(item.sendEmail, context);
  else if ("httpRequest" in item) {
    validateValueFieldRefs((item.httpRequest as { json?: unknown }).json, context, "httpRequest.json");
  } else if ("setVariable" in item) {
    const action = item.setVariable as { name?: unknown; value?: unknown };
    validateValueFieldRefs(action.value, context, "setVariable.value");
    const tableId = recordTableForValue(action.value, context);
    if (tableId && typeof action.name === "string") context.locals.set(action.name, tableId);
  } else if ("fail" in item || "succeed" in item) {
    const kind = "fail" in item ? "fail" : "succeed";
    validateMessageFieldRefs((item[kind] as { message?: unknown }).message, context, `${kind}.message`);
  } else return false;
  return true;
};

const validateControlFlowStep = (item: Record<string, unknown>, context: ValidationContext): void => {
  if ("forEach" in item) {
    const locals = new Map(context.locals);
    const tableId = tableForRecordListRef(item.forEach, context);
    if (tableId && typeof item.as === "string") locals.set(item.as, tableId);
    if (Array.isArray(item.do)) validateWorkflowStepReferences(item.do, childContext(context, locals));
    return;
  }
  if ("if" in item) {
    validateValueFieldRefs(item.if, context, "if");
    if (Array.isArray(item.then)) validateWorkflowStepReferences(item.then, childContext(context));
    if (Array.isArray(item.else)) validateWorkflowStepReferences(item.else, childContext(context));
    return;
  }
  if (!("switch" in item)) return;
  validateValueFieldRefs(item.switch, context, "switch");
  if (Array.isArray(item.cases)) {
    for (const [caseIndex, caseItem] of item.cases.entries()) {
      if (!caseItem || typeof caseItem !== "object" || !Array.isArray((caseItem as { do?: unknown }).do)) continue;
      validateValueFieldRefs((caseItem as { when?: unknown }).when, context, `switch.cases.${caseIndex}.when`);
      validateWorkflowStepReferences((caseItem as { do: unknown[] }).do, childContext(context));
    }
  }
  if (Array.isArray(item.default)) validateWorkflowStepReferences(item.default, childContext(context));
};

const validateWorkflowStepReferences = (steps: unknown[], context: ValidationContext): void => {
  for (const step of steps) {
    if (!step || typeof step !== "object" || Array.isArray(step)) continue;
    const item = step as Record<string, unknown>;
    if (!validateActionStep(item, context)) validateControlFlowStep(item, context);
  }
};

export const validateWorkflowSteps = (definition: WorkflowDefinition, catalog: WorkflowCatalog, diagnostics: string[]): void =>
  validateWorkflowStepReferences(definition.steps, { definition, catalog, diagnostics, locals: new Map() });
