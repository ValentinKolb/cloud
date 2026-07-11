import type { WorkflowDefinition } from "../contracts";
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
    } else if ("createRecord" in item) {
      const action = item.createRecord as { table?: unknown; values?: Record<string, unknown> };
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
    } else if ("generateDocument" in item) {
      const action = item.generateDocument as { template?: unknown; record?: unknown };
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
    } else if ("sendEmail" in item) {
      const action = item.sendEmail as { template?: unknown };
      const template = typeof action.template === "string" ? getWorkflowCatalogRef(catalog.emailTemplates, action.template) : null;
      if (!template) {
        diagnostics.push(
          workflowRefDiagnostic(catalog.emailTemplates, String(action.template ?? ""), "sendEmail.template") ??
            "sendEmail.template: unknown email template",
        );
      }
    } else if ("forEach" in item) {
      const tableId = tableForRecordListRef(item.forEach, definition, catalog);
      const nextLocals = new Map(locals);
      if (tableId && typeof item.as === "string") nextLocals.set(item.as, tableId);
      if (Array.isArray(item.do)) validateStepReferences(item.do, definition, catalog, diagnostics, nextLocals);
    } else if ("if" in item) {
      if (Array.isArray(item.then)) validateStepReferences(item.then, definition, catalog, diagnostics, locals);
      if (Array.isArray(item.else)) validateStepReferences(item.else, definition, catalog, diagnostics, locals);
    } else if ("switch" in item) {
      if (Array.isArray(item.cases)) {
        for (const caseItem of item.cases) {
          if (caseItem && typeof caseItem === "object" && Array.isArray((caseItem as { do?: unknown }).do)) {
            validateStepReferences((caseItem as { do: unknown[] }).do, definition, catalog, diagnostics, locals);
          }
        }
      }
      if (Array.isArray(item.default)) validateStepReferences(item.default, definition, catalog, diagnostics, locals);
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
