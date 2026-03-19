import { ssr } from "@valentinkolb/cloud/core/config";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import { AdminLayout } from "@valentinkolb/cloud/core/ssr";
import { Pagination } from "@valentinkolb/cloud/lib/ui";
import { createPagination } from "@/logging/contracts";
import LogFilterBar from "./_components/LogFilterBar.island";
import LogTable from "./_components/LogTable.island";
import { parseLogFilterFromUrl } from "./_components/types";
import { loggingService } from "../service";

export default ssr<AuthContext>(async (c) => {
  const url = new URL(c.req.url);
  const filter = parseLogFilterFromUrl(url);

  const perPage = 100;
  const pagination = { page: filter.page, perPage, offset: (filter.page - 1) * perPage };

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
    <AdminLayout c={c} title="Logs" fullHeight>
      <div class="flex-1 min-h-0 overflow-y-auto">
        <div class="flex flex-col gap-2 p-4">
          <div class="min-w-0" style="view-transition-name: admin-logs-title">
            <h1 class="text-base font-semibold text-primary">Logs</h1>
            <p class="mt-1 text-xs text-dimmed">{total} entries</p>
          </div>
          <LogFilterBar filter={filter} sources={sources} />
          <LogTable entries={entries} />
          <Pagination currentPage={paginationResult.page} totalPages={paginationResult.total_pages} baseUrl={baseUrl} />
        </div>
      </div>
    </AdminLayout>
  );
});
