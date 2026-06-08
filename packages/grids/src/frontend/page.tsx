import { hasRole } from "@valentinkolb/cloud/contracts";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { ssr } from "../config";
import { gridsService } from "../service";
import GridsLayoutHelp from "./_components/help/GridsLayoutHelp";
import BasesOverview from "./_components/overview/BasesOverview.island";
import { parseLastGridsPath } from "./_components/sidebar/GridsSettingsStore";

/**
 * Bases list page — shows every base the user has access to.
 * Layout matches the spaces / notebooks index pages: hero + info-block
 * with the create button + paper-card grid.
 */
export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const isAdmin = hasRole(user, "admin");
  const url = new URL(c.req.url);
  const initialQuery = url.searchParams.get("q")?.trim() ?? "";
  const pageRaw = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const limit = 100;
  const offset = (page - 1) * limit;

  const visible = await gridsService.base.listVisible({
    userId: user.id,
    userGroups: user.memberofGroupIds,
    isAdmin,
    query: initialQuery,
    limit,
    offset,
  });

  if (url.searchParams.get("recent") === "true" && visible.items.length > 0) {
    const lastPath = parseLastGridsPath(c.req.header("Cookie"));
    if (lastPath) {
      const lastUrl = new URL(lastPath, "http://grids.local");
      const baseSegment = lastUrl.pathname.split("/")[3] ?? "";
      if (visible.items.some((base) => base.id === baseSegment || base.shortId === baseSegment)) {
        return c.redirect(`${lastUrl.pathname}${lastUrl.search}`, 302);
      }
    }
  }

  const templates = gridsService.template.list();

  return () => (
    <Layout c={c} title={[{ title: "Start", href: "/" }, { title: "Grids" }]}>
      <GridsLayoutHelp />
      <BasesOverview
        bases={visible.items}
        total={visible.total}
        limit={limit}
        offset={offset}
        templates={templates}
        initialQuery={initialQuery}
      />
    </Layout>
  );
});
