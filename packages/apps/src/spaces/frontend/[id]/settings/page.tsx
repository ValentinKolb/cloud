import { ssr } from "@valentinkolb/cloud/core/config";
import { Layout } from "@valentinkolb/cloud/core/ssr";
import type { AuthContext } from "@valentinkolb/cloud/lib/server";
import { spacesService } from "@/spaces/service";
import { parseSpaceSettings } from "../_components/settings/SpaceSettingsStore";
import SpaceEditPanel from "../_components/edit/SpaceEditPanel.island";

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const spaceId = c.req.param("id");

  const space = await spacesService.space.getDetail({ id: spaceId });
  if (!space) {
    return (
      <Layout c={c} title="Not Found">
        <div class="max-w-md mx-auto mt-16">
          <div class="paper p-8 flex items-center justify-center text-dimmed text-xs gap-2">
            <i class="ti ti-alert-circle text-sm" />
            Space not found
          </div>
        </div>
      </Layout>
    );
  }

  const permission = await spacesService.space.permission.get({
    spaceId,
    userId: user.id,
    userGroups: user.memberofGroup,
  });

  if (permission === "none") {
    return (
      <Layout c={c} title="Access Denied">
        <div class="max-w-md mx-auto mt-16">
          <div class="paper p-8 flex items-center justify-center text-dimmed text-xs gap-2">
            <i class="ti ti-lock text-sm" />
            You don&apos;t have access to this space
          </div>
        </div>
      </Layout>
    );
  }

  const canWrite = permission === "write" || permission === "admin";
  if (!canWrite) {
    return c.redirect(`/app/spaces/${spaceId}`, 302);
  }

  const isAdmin = permission === "admin";
  const accessEntries = isAdmin ? (await spacesService.access.list({ spaceId })).items : [];
  const settings = parseSpaceSettings(c.req.header("Cookie"), spaceId);
  const requestUrl = new URL(c.req.url);
  const baseUrl = `${requestUrl.protocol}//${requestUrl.host}`;

  return (
    <Layout
      c={c}
      title={[
        { title: "Start", href: "/" },
        { title: "Spaces", href: "/app/spaces" },
        { title: space.name, href: `/app/spaces/${space.id}` },
        { title: "Settings" },
      ]}
    >
      <div class="max-w-xl mx-auto w-full py-6 px-4">
        <SpaceEditPanel space={space} baseUrl={baseUrl} initialSettings={settings} accessEntries={accessEntries} isAdmin={isAdmin} />
      </div>
    </Layout>
  );
});
