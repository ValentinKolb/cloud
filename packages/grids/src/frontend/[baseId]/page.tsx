import { type AuthContext, getDateConfig } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { currentActorUser } from "../../api/permissions";
import { withInitialQueryPreview } from "../../api/workspace-query-preview";
import { ssr } from "../../config";
import { parseDocumentViewMode } from "../_components/sidebar/GridsSettingsStore";
import GridsWorkspace from "../_components/workspace/GridsWorkspace.island";
import { loadGridsWorkspaceState } from "../_components/workspace/workspace-state";

export default ssr<AuthContext>(async (c) => {
  const user = currentActorUser(c);
  if (!user) {
    return () => (
      <Layout c={c} title={[{ title: "Grids", href: "/app/grids" }]}>
        <div class="paper p-8 max-w-md mx-auto mt-16 text-center text-dimmed">
          <i class="ti ti-lock text-sm" /> Sign in to open Grids.
        </div>
      </Layout>
    );
  }
  const baseShortId = c.req.param("baseId")!;
  const loadedState = await loadGridsWorkspaceState({
    user,
    baseShortId,
    href: c.req.url,
    activeTableSlug: c.req.param("tableId") ?? null,
    activeViewSlug: c.req.param("viewId") ?? null,
    activeDashboardSlug: c.req.param("dashboardId") ?? null,
    activeWorkflowSlug: c.req.param("workflowId") ?? null,
    activeDocumentTableSlug: c.req.param("documentTableId") ?? null,
    activeDocumentTemplateSlug: c.req.param("documentTemplateId") ?? null,
    initialDocumentViewMode: parseDocumentViewMode(c.req.header("Cookie")),
    dateConfig: await getDateConfig(c),
  });

  if (loadedState.kind !== "ok") {
    return () => (
      <Layout c={c} title={loadedState.title}>
        <div class="paper p-8 max-w-md mx-auto mt-16 text-center text-dimmed">
          <i class={`ti ${loadedState.kind === "accessDenied" ? "ti-lock" : "ti-alert-circle"} text-sm`} /> {loadedState.message}
        </div>
      </Layout>
    );
  }

  const state = await withInitialQueryPreview(c, loadedState);

  return () => (
    <Layout c={c} fullWidth title={state.title}>
      <GridsWorkspace initialState={state} />
    </Layout>
  );
});
