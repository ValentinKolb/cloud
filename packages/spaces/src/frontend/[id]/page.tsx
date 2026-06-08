import { ssr } from "../../config";
import { getDateConfig, type AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import SpacesLayoutHelp from "../_components/help/SpacesLayoutHelp";
import SpacesWorkspace from "./_components/workspace/SpacesWorkspace.island";
import { loadSpacesWorkspaceState } from "./_components/workspace/workspace-state";

export default ssr<AuthContext>(async (c) => {
  const spaceId = c.req.param("id") ?? "";
  const dateConfig = getDateConfig(c);
  const state = await loadSpacesWorkspaceState({
    user: c.get("user"),
    spaceId,
    href: c.req.url,
    cookieHeader: c.req.header("Cookie"),
    dateConfig,
  });

  if (state.kind !== "ok") {
    return () => (
      <Layout c={c} title={state.title}>
        <div class="max-w-4xl mx-auto flex flex-col items-center gap-4 py-12">
          <p class="flex items-center gap-1.5 text-xs text-dimmed">
            <i class={`ti ${state.kind === "accessDenied" ? "ti-lock" : "ti-alert-circle"} text-sm`} />
            {state.message}
          </p>
          <a href="/app/spaces" class="btn-primary btn-sm">
            Back to Spaces
          </a>
        </div>
      </Layout>
    );
  }

  return () => (
    <Layout c={c} fullWidth title={state.title}>
      <SpacesLayoutHelp />
      <SpacesWorkspace initialState={state} dateConfig={dateConfig} />
    </Layout>
  );
});
