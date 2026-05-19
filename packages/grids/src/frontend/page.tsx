import { ssr } from "../config";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { hasRole } from "@valentinkolb/cloud/contracts";
import { gridsService } from "../service";
import BasesOverview from "./_components/BasesOverview.island";

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
  const templates = gridsService.template.list();

  return () => (
    <Layout c={c} title={[{ title: "Start", href: "/" }, { title: "Grids" }]}>
      <div class="max-w-6xl mx-auto p-3 sm:p-4">
        <header class="mb-5">
          <div class="flex items-center gap-3">
            <div class="w-11 h-11 thumbnail bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0">
              <i class="ti ti-table text-xl text-zinc-600 dark:text-zinc-400" />
            </div>
            <div class="min-w-0">
              <h1 class="text-xl font-semibold text-primary">Grids</h1>
              <p class="text-sm text-dimmed">Structured bases for records, views, forms, and dashboards.</p>
            </div>
          </div>
        </header>

        <BasesOverview
          bases={visible.items}
          total={visible.total}
          limit={limit}
          offset={offset}
          templates={templates}
          initialQuery={initialQuery}
        />
      </div>
    </Layout>
  );
});
