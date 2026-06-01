import { getDateConfig, type AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { ssr } from "../../config";
import GridsWorkspace from "../_components/workspace/GridsWorkspace.island";
import { loadGridsWorkspaceState } from "../_components/workspace/workspace-state";

export default ssr<AuthContext>(async (c) => {
  const baseShortId = c.req.param("baseId")!;
  const state = await loadGridsWorkspaceState({
    user: c.get("user"),
    baseShortId,
    href: c.req.url,
    activeTableSlug: c.req.param("tableId") ?? null,
    activeViewSlug: c.req.param("viewId") ?? null,
    activeDashboardSlug: c.req.param("dashboardId") ?? null,
    dateConfig: await getDateConfig(c),
  });

  if (state.kind !== "ok") {
    return () => (
      <Layout c={c} title={state.title}>
        <div class="paper p-8 max-w-md mx-auto mt-16 text-center text-dimmed">
          <i class={`ti ${state.kind === "accessDenied" ? "ti-lock" : "ti-alert-circle"} text-sm`} /> {state.message}
        </div>
      </Layout>
    );
  }

  return () => (
    <Layout c={c} fullWidth title={state.title}>
      <GridsWorkspace initialState={state} />
    </Layout>
  );
});
