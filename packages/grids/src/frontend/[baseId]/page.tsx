import { type AuthContext, getDateConfig } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { withInitialQueryPreview } from "../../api/workspace-query-preview";
import { ssr } from "../../config";
import GridsWorkspace from "../_components/workspace/GridsWorkspace.island";
import { loadGridsWorkspaceState } from "../_components/workspace/workspace-state";

export default ssr<AuthContext>(async (c) => {
  const baseShortId = c.req.param("baseId")!;
  const loadedState = await loadGridsWorkspaceState({
    user: c.get("user"),
    baseShortId,
    href: c.req.url,
    activeTableSlug: c.req.param("tableId") ?? null,
    activeViewSlug: c.req.param("viewId") ?? null,
    activeDashboardSlug: c.req.param("dashboardId") ?? null,
    activeDocumentTableSlug: c.req.param("documentTableId") ?? null,
    activeDocumentTemplateSlug: c.req.param("documentTemplateId") ?? null,
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
