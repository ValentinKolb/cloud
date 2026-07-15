import type { Base, Dashboard, Workflow } from "../../../service";
import { gridsService } from "../../../service";
import { resolveWidgetData } from "../../../service/dashboard-widget-data";
import { buildViewer, okState } from "./workspace-state-helpers";
import type { LoadWorkspaceParams, OkWorkspaceState, WorkspaceCommon } from "./workspace-state-model";

export const resolveActiveDashboard = async (params: LoadWorkspaceParams, base: Base, dashboards: Dashboard[]) => {
  const explicit = params.activeDashboardSlug ? await gridsService.dashboard.getByIdOrShortId(base.id, params.activeDashboardSlug) : null;
  if (params.activeTableSlug || explicit || !base.defaultDashboardId) return explicit;

  const defaultDashboard = await gridsService.dashboard.get(base.defaultDashboardId);
  if (defaultDashboard && defaultDashboard.deletedAt === null) return defaultDashboard;
  return null;
};

export const loadDashboardState = async (common: WorkspaceCommon, dashboard: Dashboard): Promise<OkWorkspaceState> => {
  const widgets = dashboard.config.rows.flatMap((row) => row.cells);
  const results = await Promise.all(
    widgets.map((widget) =>
      resolveWidgetData(widget, buildViewer(common.params.user), { dateConfig: common.params.dateConfig }).then(
        (data) => [widget.id, data] as const,
      ),
    ),
  );
  const canEditActiveDashboard =
    dashboard.ownerUserId === common.params.user.id || (dashboard.ownerUserId === null && common.canManageBase);
  const dashboardWorkflows: Array<
    Workflow & { dashboardLauncher: { id: string; name: string; kind: "dashboard" | "scanner"; enabled: boolean } }
  > = [];
  if (common.canManageBase && common.chrome.adminModeRequested) {
    const workflows = await gridsService.workflow.listForBase(common.base.id);
    const launchersByWorkflow = await Promise.all(
      workflows.map(async (workflow) => ({ workflow, launchers: await gridsService.workflow.launcher.list(workflow.id) })),
    );
    for (const { workflow, launchers } of launchersByWorkflow) {
      for (const launcher of launchers) {
        if (launcher.config.kind !== "dashboard" && launcher.config.kind !== "scanner") continue;
        dashboardWorkflows.push({
          ...workflow,
          dashboardLauncher: {
            id: launcher.id,
            name: launcher.name,
            kind: launcher.config.kind,
            enabled:
              workflow.enabled &&
              launcher.enabled &&
              launcher.validatedRevision === workflow.revision &&
              !launcher.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
          },
        });
      }
    }
  }

  return okState(common, {
    kind: "dashboard",
    dashboard,
    widgetData: Object.fromEntries(results),
    recordLiveTableIds: await gridsService.dashboard.sourceTableIds(dashboard),
    activeDashboardAccessEntries: canEditActiveDashboard ? await gridsService.access.listForDashboard(dashboard.id) : [],
    canEditActiveDashboard,
    isBaseDefault: common.base.defaultDashboardId === dashboard.id,
    dashboardWorkflows,
  });
};
