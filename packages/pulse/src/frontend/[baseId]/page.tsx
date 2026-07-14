import { Layout } from "@valentinkolb/cloud/ssr";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { ssr } from "../../config";
import PulseWorkspace from "../PulseWorkspace.island";
import { loadPulseWorkspacePageData } from "./page-data";

export default ssr<AuthContext>(async (c) => {
  const data = await loadPulseWorkspacePageData(c);

  if (data.kind === "not_found") {
    return () => (
      <Layout c={c} title={[{ title: "Start", href: "/" }, { title: "Pulse", href: "/app/pulse" }, { title: "Base not found" }]}>
        <div class="mx-auto flex max-w-4xl flex-col items-center gap-4 py-12">
          <p class="flex items-center gap-1.5 text-xs text-dimmed">
            <i class="ti ti-alert-circle text-sm" />
            {data.errorMessage}
          </p>
          <a href="/app/pulse" class="btn-primary btn-sm">
            Back to Pulse
          </a>
        </div>
      </Layout>
    );
  }

  const workspaceProps = data.workspaceProps;

  return () => (
    <Layout c={c} fullWidth title={[{ title: "Start", href: "/" }, { title: "Pulse", href: "/app/pulse" }, { title: data.baseName }]}>
      <PulseWorkspace
        initialBases={workspaceProps.initialBases}
        initialCapabilities={workspaceProps.initialCapabilities}
        initialBaseId={workspaceProps.initialBaseId}
        initialPath={workspaceProps.initialPath}
        initialSearch={workspaceProps.initialSearch}
        initialRouteState={workspaceProps.initialRouteState}
        initialActivityQuery={workspaceProps.initialActivityQuery}
        initialResourceQuery={workspaceProps.initialResourceQuery}
        initialSources={workspaceProps.initialSources}
        initialSourceScrapes={workspaceProps.initialSourceScrapes}
        initialSourceApiKeys={workspaceProps.initialSourceApiKeys}
        initialMetrics={workspaceProps.initialMetrics}
        initialInventory={workspaceProps.initialInventory}
        initialActivityMetrics={workspaceProps.initialActivityMetrics}
        initialSeries={workspaceProps.initialSeries}
        initialRecentEvents={workspaceProps.initialRecentEvents}
        initialCurrentStates={workspaceProps.initialCurrentStates}
        initialFocusedMetricSeries={workspaceProps.initialFocusedMetricSeries}
        initialFocusedEvents={workspaceProps.initialFocusedEvents}
        initialFocusedStates={workspaceProps.initialFocusedStates}
        initialFocusedHasMore={workspaceProps.initialFocusedHasMore}
        initialDashboards={workspaceProps.initialDashboards}
        initialDashboardControlValues={workspaceProps.initialDashboardControlValues}
        initialSavedQueries={workspaceProps.initialSavedQueries}
        initialMetricWidgetPoints={workspaceProps.initialMetricWidgetPoints}
        initialDashboardEvents={workspaceProps.initialDashboardEvents}
        initialDashboardStates={workspaceProps.initialDashboardStates}
        initialExplorerPanesValue={workspaceProps.initialExplorerPanesValue}
        initialDashboardEditorPanesValue={workspaceProps.initialDashboardEditorPanesValue}
        initialDateConfig={workspaceProps.initialDateConfig}
        initialNow={workspaceProps.initialNow}
        initialOrigin={workspaceProps.initialOrigin}
      />
    </Layout>
  );
});
