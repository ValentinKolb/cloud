import { gridsService } from "../../../service";
import { loadDashboardState, resolveActiveDashboard } from "./workspace-dashboard-state";
import { loadDocumentTemplateState } from "./workspace-document-state";
import { loadQueryState } from "./workspace-query-state";
import { loadRecordsState } from "./workspace-records-state";
import type { WorkspaceRequestContext } from "./workspace-request-state";
import { okState } from "./workspace-state-helpers";
import type { GridsWorkspaceState } from "./workspace-state-model";
import { loadWorkflowState } from "./workspace-workflow-state";

export const loadWorkspaceRoute = async (request: WorkspaceRequestContext): Promise<GridsWorkspaceState> => {
  const { common } = request;
  const queryWorkspaceRequested = common.chrome.url.pathname.endsWith("/query");
  const workflowWorkspaceRequested = common.chrome.url.pathname.includes("/workflows");
  const activeDashboard =
    queryWorkspaceRequested || workflowWorkspaceRequested
      ? null
      : await resolveActiveDashboard(common.params, common.base, common.catalog.dashboards);
  const renderDashboard = activeDashboard
    ? (common.catalog.dashboards.find((dashboard) => dashboard.id === activeDashboard.id) ?? null)
    : null;
  const activeTableFromSlug =
    request.requestedViewTable ??
    (common.params.activeTableSlug ? await gridsService.table.getByIdOrShortId(common.base.id, common.params.activeTableSlug) : null);

  if (queryWorkspaceRequested) return loadQueryState(common, activeTableFromSlug, common.params.activeViewSlug);
  if (workflowWorkspaceRequested) {
    return loadWorkflowState(common, request.requestedWorkflow, common.params.activeWorkflowSlug);
  }
  if (common.params.activeDocumentTableSlug && common.params.activeDocumentTemplateSlug) {
    if (!request.requestedDocumentTable || !request.requestedDocumentTemplate) {
      return { kind: "notFound", title: "Not found", message: "Document template not found" };
    }
    return loadDocumentTemplateState(common, request.requestedDocumentTable, request.requestedDocumentTemplate);
  }

  const activeTableId = activeTableFromSlug?.id ?? null;
  const activeTable = activeTableId
    ? (common.catalog.tables.find((table) => table.id === activeTableId) ?? (common.params.activeViewSlug ? activeTableFromSlug : null))
    : activeDashboard
      ? null
      : (common.catalog.tables[0] ?? null);
  if (renderDashboard) return loadDashboardState(common, renderDashboard);
  if (!activeTable) return okState(common, { kind: "empty" });
  return loadRecordsState(common, activeTable, common.params.activeViewSlug);
};
