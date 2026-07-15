import { type AuthContext, getDateConfig } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { Placeholder } from "@valentinkolb/cloud/ui";
import { expectUserBackedActor } from "@/actor";
import { ssr } from "../../../config";
import SpacesLayoutHelp from "../../_components/help/SpacesLayoutHelp.island";
import SpacesWorkspace from "../_components/workspace/SpacesWorkspace";
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
        <Placeholder
          state="error"
          variant="panel"
          icon={state.kind === "accessDenied" ? "ti ti-lock" : "ti ti-alert-circle"}
          title={state.title}
          description={state.message}
          class="mx-auto max-w-md"
        />
      </Layout>
    );
  }

  return () => (
    <Layout c={c} fullWidth title={state.title}>
      <SpacesLayoutHelp />
      <SpacesWorkspace state={state} dateConfig={dateConfig} />
    </Layout>
  );
});
