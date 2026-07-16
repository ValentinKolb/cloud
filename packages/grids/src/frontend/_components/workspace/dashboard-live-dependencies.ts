import type { Widget } from "../../../service";
import type { GridsWorkspaceState } from "./workspace-state";

const widgetTableDependencies = (widget: Widget, viewToTable: Map<string, string>, formToTable: Map<string, string>): string[] => {
  switch (widget.kind) {
    case "stat": {
      const tableIds = new Set<string>();
      if (widget.source.kind === "view") {
        const tableId = viewToTable.get(widget.source.viewId);
        if (tableId) tableIds.add(tableId);
      }
      if (widget.trend?.source.kind === "view") {
        const tableId = viewToTable.get(widget.trend.source.viewId);
        if (tableId) tableIds.add(tableId);
      }
      return [...tableIds];
    }
    case "chart":
    case "view-stats":
      return widget.source.kind === "view" ? [viewToTable.get(widget.source.viewId)].filter((id): id is string => Boolean(id)) : [];
    case "view":
      return widget.source.kind === "view" ? [viewToTable.get(widget.source.viewId)].filter((id): id is string => Boolean(id)) : [];
    case "form":
      return [formToTable.get(widget.formId)].filter((id): id is string => Boolean(id));
    case "link":
    case "workflow-button":
    case "markdown":
      return [];
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
    for (const tableId of widgetTableDependencies(widget, viewToTable, formToTable)) tableIds.add(tableId);
  }
  return [...tableIds].sort();
};
