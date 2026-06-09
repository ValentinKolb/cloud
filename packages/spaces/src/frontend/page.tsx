import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { spacesService } from "@/service";
import { ssr } from "../config";
import SpacesLayoutHelp from "./_components/help/SpacesLayoutHelp.island";
import { parseLastSpaceId } from "./[id]/_components/settings/SpaceSettingsStore";
import SpacesOverview from "./SpacesOverview.island";

/**
 * Spaces list page - shows all spaces the user has access to
 */
export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const url = new URL(c.req.raw.url);
  const initialQuery = url.searchParams.get("q")?.trim() ?? "";

  const spacesPage = await spacesService.space.list({
    userId: user.id,
    groups: user.memberofGroupIds,
  });
  const userSpaces = spacesPage.items;

  // Redirect to last opened space if ?recent=true
  if (url.searchParams.get("recent") === "true" && userSpaces.length > 0) {
    const cookieHeader = c.req.raw.headers.get("Cookie") ?? undefined;
    const lastId = parseLastSpaceId(cookieHeader);
    if (lastId && userSpaces.some((s) => s.id === lastId)) {
      return c.redirect(`/app/spaces/${lastId}`);
    }
  }

  return () => (
    <Layout c={c} title={[{ title: "Start", href: "/" }, { title: "Spaces" }]}>
      <SpacesLayoutHelp />
      <SpacesOverview spaces={userSpaces} initialQuery={initialQuery} />
    </Layout>
  );
});
