import type { WorkflowDefinition } from "../contracts";
import { getWorkflowCatalogRef, type WorkflowCatalog, workflowRefDiagnostic } from "./workflow-catalog";
import { validateWorkflowSteps } from "./workflow-reference-step-validator";
import { validateSchedule } from "./workflow-validators";

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
  validateWorkflowSteps(definition, catalog, diagnostics);
  return diagnostics;
};
