import { ssr } from "@valentinkolb/cloud/core/config";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import { AdminLayout } from "@valentinkolb/cloud/core/ssr";
import { Pagination, LogEntriesTable } from "@valentinkolb/cloud/lib/ui";
import { createPagination } from "@/logging/contracts";
import LogFilterBar from "./_components/LogFilterBar.island";
import LogCleanup from "./_components/LogCleanup.island";
import LogRetention from "./_components/LogRetention.island";
import { parseLogFilterFromUrl } from "./_components/types";
import { loggingService } from "../service";

export default ssr<AuthContext>(async (c) => {
  const url = new URL(c.req.url);
  const filter = parseLogFilterFromUrl(url);

  const perPage = 50;
  const pagination = {
    page: filter.page,
    perPage,
    offset: (filter.page - 1) * perPage,
  };

  const [{ items: entries, total }, sources] = await Promise.all([
    loggingService.entry.list({
      pagination,
      filter: {
        sources: filter.sources.length > 0 ? filter.sources : undefined,
        level: filter.level !== "all" ? filter.level : undefined,
        search: filter.search || undefined,
      },
    }),
    loggingService.source.list(),
  ]);

  const paginationResult = createPagination(pagination, total);
  const baseUrl = (() => {
    const params = new URLSearchParams();
    if (filter.level !== "all") params.set("level", filter.level);
    for (const source of filter.sources) params.append("source", source);
    if (filter.search) params.set("search", filter.search);
    const qs = params.toString();
    return qs ? `/admin/logs?${qs}&page=` : "/admin/logs?page=";
  })();

  return (
    <AdminLayout c={c} title="Logs">
      <div class="max-w-6xl mx-auto flex flex-col gap-4">
        <div class="flex items-center justify-between gap-4" style="view-transition-name: page-header">
          <h1 class="text-xl font-bold text-primary">Logs</h1>
          <div class="flex items-center gap-3">
            <span class="text-xs text-dimmed">{total} total</span>
            <LogRetention />
            <LogCleanup />
          </div>
        </div>

        <LogFilterBar filter={filter} sources={sources} total={total} />

        <LogEntriesTable entries={entries} emptyMessage={filter.search ? "No log entries found matching your search." : "No log entries found."} />

        <Pagination currentPage={paginationResult.page} totalPages={paginationResult.total_pages} baseUrl={baseUrl} />
      </div>
    </AdminLayout>
  );
});
