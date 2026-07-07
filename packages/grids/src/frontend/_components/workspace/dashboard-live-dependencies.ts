import type { Widget } from "../../../service";
import type { GridsWorkspaceState } from "./workspace-state";

const widgetTableDependency = (widget: Widget, viewToTable: Map<string, string>, formToTable: Map<string, string>): string | null => {
  switch (widget.kind) {
    case "stat":
      return viewToTable.get(widget.viewId) ?? null;
    case "chart":
    case "view-stats":
      return viewToTable.get(widget.viewId) ?? null;
    case "view":
      return viewToTable.get(widget.viewId) ?? null;
    case "form":
      return formToTable.get(widget.formId) ?? null;
    case "link":
    case "workflow-button":
    case "markdown":
      return null;
  }
};

export const dashboardRecordTableIds = (s: Extract<GridsWorkspaceState, { kind: "ok" }>): string[] => {
  if (s.route.kind !== "dashboard") return [];
  if (s.route.recordLiveTableIds) return [...new Set(s.route.recordLiveTableIds)].sort();

  const viewToTable = new Map<string, string>();
  for (const [tableId, views] of Object.entries(s.catalog.viewsByTable)) {
    for (const view of views) viewToTable.set(view.id, tableId);
  }

  const formToTable = new Map<string, string>();
  for (const [tableId, forms] of Object.entries(s.catalog.formsByTable)) {
    for (const form of forms) formToTable.set(form.id, tableId);
  }

  const tableIds = new Set<string>();
  for (const widget of s.route.dashboard.config.rows.flatMap((row) => row.cells)) {
    const tableId = widgetTableDependency(widget, viewToTable, formToTable);
    if (tableId) tableIds.add(tableId);
  }
  return [...tableIds].sort();
};
