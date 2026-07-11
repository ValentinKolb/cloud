import type { WorkflowDefinition } from "../contracts";
import { parseWorkflowValueString, workflowMessageExpressions } from "../workflows/value-expression";
import {
  getWorkflowCatalogRef,
  type WorkflowCatalog,
  type WorkflowCatalogEntry,
  type WorkflowCatalogIndex,
  workflowRefDiagnostic,
} from "./workflow-catalog";
import { validateSchedule } from "./workflow-validators";

const tableForRecordRef = (
  ref: unknown,
  definition: WorkflowDefinition,
  locals: Map<string, string>,
  catalog: WorkflowCatalog,
): string | null => {
  if (typeof ref !== "string") return null;
  const [root, name] = ref.split(".");
  if (root === "inputs" && name) {
    const input = definition.inputs?.[name];
    if (!input || input.type !== "record" || !input.table) return null;
    return getWorkflowCatalogRef(catalog.tables, input.table)?.id ?? null;
  }
  return locals.get(root ?? "") ?? null;
};

const tableForRecordListRef = (ref: unknown, definition: WorkflowDefinition, catalog: WorkflowCatalog): string | null => {
  if (typeof ref !== "string") return null;
  const [root, name] = ref.split(".");
  if (root !== "inputs" || !name) return null;
  const input = definition.inputs?.[name];
  if (!input || input.type !== "recordList" || !input.table) return null;
  return getWorkflowCatalogRef(catalog.tables, input.table)?.id ?? null;
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

const validateValueFieldRefs = (
  value: unknown,
  definition: WorkflowDefinition,
  catalog: WorkflowCatalog,
  diagnostics: string[],
  locals: Map<string, string>,
  label: string,
): void => {
  if (typeof value === "string") {
    const parsed = parseWorkflowValueString(value);
    if (parsed.kind !== "expression" || parsed.expression.kind !== "reference") return;
    const reference = parsed.expression.reference;
    const parts = reference.split(".");
    const fieldStart = parts[0] === "inputs" ? 2 : 1;
    if (parts.length <= fieldStart) return;
    const tableId = tableForRecordRef(reference, definition, locals, catalog);
    if (!tableId) return;
    validateFieldRefs({
      fields: catalog.fieldsByTable.get(tableId),
      keys: [parts.slice(fieldStart).join(".")],
      label,
      diagnostics,
    });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateValueFieldRefs(item, definition, catalog, diagnostics, locals, `${label}.${index}`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      validateValueFieldRefs(item, definition, catalog, diagnostics, locals, `${label}.${key}`);
    }
  }
};

const recordTableForValue = (
  value: unknown,
  definition: WorkflowDefinition,
  catalog: WorkflowCatalog,
  locals: Map<string, string>,
): string | null => {
  if (typeof value !== "string") return null;
  const parsed = parseWorkflowValueString(value);
  if (parsed.kind !== "expression" || parsed.expression.kind !== "reference") return null;
  const parts = parsed.expression.reference.split(".");
  const fieldStart = parts[0] === "inputs" ? 2 : 1;
  return parts.length === fieldStart ? tableForRecordRef(parsed.expression.reference, definition, locals, catalog) : null;
};

const validateMessageFieldRefs = (
  value: unknown,
  definition: WorkflowDefinition,
  catalog: WorkflowCatalog,
  diagnostics: string[],
  locals: Map<string, string>,
  label: string,
): void => {
  if (typeof value !== "string") return;
  for (const item of workflowMessageExpressions(value)) {
    validateValueFieldRefs(item.raw, definition, catalog, diagnostics, locals, label);
  }
};

const validateStepReferences = (
  steps: unknown[],
  definition: WorkflowDefinition,
  catalog: WorkflowCatalog,
  diagnostics: string[],
  locals = new Map<string, string>(),
): void => {
  for (const step of steps) {
    if (!step || typeof step !== "object" || Array.isArray(step)) continue;
    const item = step as Record<string, unknown>;
    if ("updateRecord" in item) {
      const action = item.updateRecord as { record?: unknown; set?: Record<string, unknown> };
      const tableId = tableForRecordRef(action.record, definition, locals, catalog);
      validateFieldRefs({
        fields: tableId ? catalog.fieldsByTable.get(tableId) : undefined,
        keys: Object.keys(action.set ?? {}),
        label: "updateRecord.set",
        diagnostics,
      });
      validateValueFieldRefs(action.set, definition, catalog, diagnostics, locals, "updateRecord.set");
    } else if ("createRecord" in item) {
      const action = item.createRecord as { table?: unknown; values?: Record<string, unknown>; saveAs?: unknown };
      const table = typeof action.table === "string" ? getWorkflowCatalogRef(catalog.tables, action.table) : null;
      if (!table) {
        diagnostics.push(
          workflowRefDiagnostic(catalog.tables, String(action.table ?? ""), "createRecord.table") ?? "createRecord.table: unknown table",
        );
      }
      validateFieldRefs({
        fields: table ? catalog.fieldsByTable.get(table.id) : undefined,
        keys: Object.keys(action.values ?? {}),
        label: "createRecord.values",
        diagnostics,
      });
      validateValueFieldRefs(action.values, definition, catalog, diagnostics, locals, "createRecord.values");
      if (table && typeof action.saveAs === "string") locals.set(action.saveAs, table.id);
    } else if ("generateDocument" in item) {
      const action = item.generateDocument as { template?: unknown; record?: unknown; filename?: unknown; tags?: unknown };
      const template = typeof action.template === "string" ? getWorkflowCatalogRef(catalog.templates, action.template) : null;
      if (!template) {
        diagnostics.push(
          workflowRefDiagnostic(catalog.templates, String(action.template ?? ""), "generateDocument.template") ??
            "generateDocument.template: unknown document template",
        );
      }
      const tableId = tableForRecordRef(action.record, definition, locals, catalog);
      if (template && tableId && template.tableId !== tableId) {
        diagnostics.push("generateDocument.record: record table must match the document template table");
      }
      validateValueFieldRefs(action.filename, definition, catalog, diagnostics, locals, "generateDocument.filename");
      validateValueFieldRefs(action.tags, definition, catalog, diagnostics, locals, "generateDocument.tags");
    } else if ("createDocumentLink" in item) {
      const action = item.createDocumentLink as { comment?: unknown };
      validateValueFieldRefs(action.comment, definition, catalog, diagnostics, locals, "createDocumentLink.comment");
    } else if ("sendEmail" in item) {
      const action = item.sendEmail as { template?: unknown; to?: unknown[]; data?: unknown };
      const template = typeof action.template === "string" ? getWorkflowCatalogRef(catalog.emailTemplates, action.template) : null;
      if (!template) {
        diagnostics.push(
          workflowRefDiagnostic(catalog.emailTemplates, String(action.template ?? ""), "sendEmail.template") ??
            "sendEmail.template: unknown email template",
        );
      }
      validateValueFieldRefs(action.to, definition, catalog, diagnostics, locals, "sendEmail.to");
      validateValueFieldRefs(action.data, definition, catalog, diagnostics, locals, "sendEmail.data");
    } else if ("httpRequest" in item) {
      const action = item.httpRequest as { json?: unknown };
      validateValueFieldRefs(action.json, definition, catalog, diagnostics, locals, "httpRequest.json");
    } else if ("setVariable" in item) {
      const action = item.setVariable as { name?: unknown; value?: unknown };
      validateValueFieldRefs(action.value, definition, catalog, diagnostics, locals, "setVariable.value");
      const tableId = recordTableForValue(action.value, definition, catalog, locals);
      if (tableId && typeof action.name === "string") locals.set(action.name, tableId);
    } else if ("fail" in item || "succeed" in item) {
      const kind = "fail" in item ? "fail" : "succeed";
      const action = item[kind] as { message?: unknown };
      validateMessageFieldRefs(action.message, definition, catalog, diagnostics, locals, `${kind}.message`);
    } else if ("forEach" in item) {
      const tableId = tableForRecordListRef(item.forEach, definition, catalog);
      const nextLocals = new Map(locals);
      if (tableId && typeof item.as === "string") nextLocals.set(item.as, tableId);
      if (Array.isArray(item.do)) validateStepReferences(item.do, definition, catalog, diagnostics, nextLocals);
    } else if ("if" in item) {
      validateValueFieldRefs(item.if, definition, catalog, diagnostics, locals, "if");
      if (Array.isArray(item.then)) validateStepReferences(item.then, definition, catalog, diagnostics, new Map(locals));
      if (Array.isArray(item.else)) validateStepReferences(item.else, definition, catalog, diagnostics, new Map(locals));
    } else if ("switch" in item) {
      validateValueFieldRefs(item.switch, definition, catalog, diagnostics, locals, "switch");
      if (Array.isArray(item.cases)) {
        for (const [caseIndex, caseItem] of item.cases.entries()) {
          if (caseItem && typeof caseItem === "object" && Array.isArray((caseItem as { do?: unknown }).do)) {
            validateValueFieldRefs(
              (caseItem as { when?: unknown }).when,
              definition,
              catalog,
              diagnostics,
              locals,
              `switch.cases.${caseIndex}.when`,
            );
            validateStepReferences((caseItem as { do: unknown[] }).do, definition, catalog, diagnostics, new Map(locals));
          }
        }
      }
      if (Array.isArray(item.default)) validateStepReferences(item.default, definition, catalog, diagnostics, new Map(locals));
    }
  }
};

export const validateWorkflowReferences = (definition: WorkflowDefinition, catalog: WorkflowCatalog): string[] => {
  const diagnostics: string[] = [];
  for (const [name, input] of Object.entries(definition.inputs ?? {})) {
    if ((input.type === "record" || input.type === "recordList") && input.table) {
      const diagnostic = workflowRefDiagnostic(catalog.tables, input.table, `inputs.${name}.table`);
      if (diagnostic) diagnostics.push(diagnostic.replace("reference", "table"));
    }
  }
  const scanner = definition.triggers.scanner;
  if (scanner?.resolve?.by === "field") {
    const input = definition.inputs?.[scanner.input];
    const table = input?.table ? getWorkflowCatalogRef(catalog.tables, input.table) : null;
    const fields = table ? catalog.fieldsByTable.get(table.id) : undefined;
    if (!scanner.resolve.field) {
      diagnostics.push("triggers.scanner.resolve.field: unknown field");
    } else if (!fields) {
      diagnostics.push("triggers.scanner.resolve.field: unknown table");
    } else {
      const diagnostic = workflowRefDiagnostic(fields, scanner.resolve.field, "triggers.scanner.resolve.field");
      if (diagnostic) diagnostics.push(diagnostic.replace("reference", "field"));
    }
  }
  const schedule = definition.triggers.schedule;
  if (schedule) {
    const validation = validateSchedule({ kind: "schedule", cron: schedule.cron, timezone: schedule.timezone });
    if (!validation.ok) diagnostics.push(`triggers.schedule: ${validation.error.message}`);
  }
  const recordEvent = definition.triggers.recordEvent;
  const recordEventTable = recordEvent?.table;
  if (recordEventTable) {
    const diagnostic = workflowRefDiagnostic(catalog.tables, recordEventTable, "triggers.recordEvent.table");
    if (diagnostic) diagnostics.push(diagnostic.replace("reference", "table"));
  }
  if (recordEvent?.filter && !recordEventTable && !recordEvent.input) {
    diagnostics.push("triggers.recordEvent.filter: filters require either table or input");
  }
  if (recordEvent?.input) {
    const input = definition.inputs?.[recordEvent.input];
    if (!input || input.type !== "record" || !input.table) {
      diagnostics.push("triggers.recordEvent.input: input must reference a record input with a table");
    } else {
      const inputTable = getWorkflowCatalogRef(catalog.tables, input.table);
      const triggerTable = recordEventTable ? getWorkflowCatalogRef(catalog.tables, recordEventTable) : null;
      if (recordEventTable && inputTable && triggerTable && inputTable.id !== triggerTable.id) {
        diagnostics.push("triggers.recordEvent.input: input table must match triggers.recordEvent.table");
      }
    }
  }
  validateStepReferences(definition.steps, definition, catalog, diagnostics);
  return diagnostics;
};
