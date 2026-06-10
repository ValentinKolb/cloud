import { type AuthContext, getDateConfig } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { expectUserBackedActor } from "@/actor";
import { ssr } from "../../../config";
import SpacesLayoutHelp from "../../_components/help/SpacesLayoutHelp.island";
import SpacesWorkspace from "../_components/workspace/SpacesWorkspace.island";
import { loadSpacesWorkspaceState } from "../_components/workspace/workspace-state";

export default ssr<AuthContext>(async (c) => {
  const spaceId = c.req.param("id") ?? "";
  const dateConfig = getDateConfig(c);
  const state = await loadSpacesWorkspaceState({
    user: expectUserBackedActor(c),
    spaceId,
    href: c.req.url,
    cookieHeader: c.req.header("Cookie"),
    settings: true,
    dateConfig,
  });

  if (state.kind === "accessDenied" && state.redirectTo) {
    return c.redirect(state.redirectTo, 302);
  }

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
      <SpacesLayoutHelp />
      <SpacesWorkspace initialState={state} dateConfig={dateConfig} />
    </Layout>
  );
});
