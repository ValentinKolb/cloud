import { ButtonLink, Placeholder } from "@k2b/ui";
import { type AuthContext, expectUserBackedActor, getDateConfig } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { ssr } from "../../config";
import { ResourceShortIdSchema } from "../../contracts";
import { isMailInvitationIntegrationAvailable } from "../../service/mail-integration";
import { spacesPublicResources } from "../../service/public-resources";
import SpacesWorkspace from "./_components/workspace/SpacesWorkspace";
import { loadSpacesWorkspaceState } from "./_components/workspace/workspace-state";

export default ssr<AuthContext>(async (c) => {
  const spaceShortId = c.req.param("id") ?? "";
  const spaceId = ResourceShortIdSchema.safeParse(spaceShortId).success
    ? await spacesPublicResources.resolvePublicId("spaces", spaceShortId)
    : null;
  const dateConfig = getDateConfig(c);
  if (!spaceId) {
    return () => (
      <Layout c={c} title="Not found">
        <Placeholder
          state="error"
          variant="panel"
          icon="ti ti-alert-circle"
          title="Not found"
          description="Space not found"
          class="mx-auto max-w-md"
          action={
            <ButtonLink href="/app/spaces" size="sm">
              Back to Spaces
            </ButtonLink>
          }
        />
      </Layout>
    );
  }
  const [state, mailIntegrationAvailable] = await Promise.all([
    loadSpacesWorkspaceState({
      user: expectUserBackedActor(c),
      spaceId,
      spaceShortId,
      href: c.req.url,
      cookieHeader: c.req.header("Cookie"),
      dateConfig,
    }),
    isMailInvitationIntegrationAvailable(),
  ]);

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
          action={
            <ButtonLink href="/app/spaces" size="sm">
              Back to Spaces
            </ButtonLink>
          }
        />
      </Layout>
    );
  }

  return () => (
    <Layout c={c} fullWidth title={state.title}>
      <SpacesWorkspace state={state} dateConfig={dateConfig} mailIntegrationAvailable={mailIntegrationAvailable} />
    </Layout>
  );
});
