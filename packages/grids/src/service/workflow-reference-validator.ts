import type { WorkflowDefinition } from "../contracts";
import { getWorkflowCatalogRef, type WorkflowCatalog, workflowRefDiagnostic } from "./workflow-catalog";
import { validateWorkflowSteps } from "./workflow-reference-step-validator";
import { validateSchedule } from "./workflow-validators";

const appendRefDiagnostic = (diagnostics: string[], diagnostic: string | null, kind: "field" | "table"): void => {
  if (diagnostic) diagnostics.push(diagnostic.replace("reference", kind));
};

const validateInputTables = (definition: WorkflowDefinition, catalog: WorkflowCatalog, diagnostics: string[]): void => {
  for (const [name, input] of Object.entries(definition.inputs ?? {})) {
    if ((input.type === "record" || input.type === "recordList") && input.table) {
      appendRefDiagnostic(diagnostics, workflowRefDiagnostic(catalog.tables, input.table, `inputs.${name}.table`), "table");
    }
  }
};

const validateScannerTrigger = (definition: WorkflowDefinition, catalog: WorkflowCatalog, diagnostics: string[]): void => {
  const scanner = definition.triggers.scanner;
  if (scanner?.resolve?.by !== "field") return;

  const input = definition.inputs?.[scanner.input];
  const table = input?.table ? getWorkflowCatalogRef(catalog.tables, input.table) : null;
  const fields = table ? catalog.fieldsByTable.get(table.id) : undefined;
  if (!scanner.resolve.field) {
    diagnostics.push("triggers.scanner.resolve.field: unknown field");
  } else if (!fields) {
    diagnostics.push("triggers.scanner.resolve.field: unknown table");
  } else {
    appendRefDiagnostic(diagnostics, workflowRefDiagnostic(fields, scanner.resolve.field, "triggers.scanner.resolve.field"), "field");
  }
};

const validateScheduleTrigger = (definition: WorkflowDefinition, diagnostics: string[]): void => {
  const schedule = definition.triggers.schedule;
  if (!schedule) return;
  const validation = validateSchedule({ kind: "schedule", cron: schedule.cron, timezone: schedule.timezone });
  if (!validation.ok) diagnostics.push(`triggers.schedule: ${validation.error.message}`);
};

const validateRecordEventTrigger = (definition: WorkflowDefinition, catalog: WorkflowCatalog, diagnostics: string[]): void => {
  const recordEvent = definition.triggers.recordEvent;
  if (!recordEvent) return;
  const recordEventTable = recordEvent?.table;
  if (recordEventTable) {
    appendRefDiagnostic(diagnostics, workflowRefDiagnostic(catalog.tables, recordEventTable, "triggers.recordEvent.table"), "table");
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
};

export const validateWorkflowReferences = (definition: WorkflowDefinition, catalog: WorkflowCatalog): string[] => {
  const diagnostics: string[] = [];
  validateInputTables(definition, catalog, diagnostics);
  validateScannerTrigger(definition, catalog, diagnostics);
  validateScheduleTrigger(definition, diagnostics);
  validateRecordEventTrigger(definition, catalog, diagnostics);
  validateWorkflowSteps(definition, catalog, diagnostics);
  return diagnostics;
};
