import { ssr } from "../config";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import { Pagination, StatCell } from "@valentinkolb/cloud/ui";
import { get } from "@valentinkolb/cloud/services";
import { createPagination } from "@/contracts";
import LogFilterBar from "./_components/LogFilterBar.island";
import LogTable from "./_components/LogTable.island";
import { parseLogFilterFromUrl } from "./_components/types";
import { loggingService } from "../service";

export default ssr<AuthContext>(async (c) => {
  const url = new URL(c.req.url);
  const filter = parseLogFilterFromUrl(url);

  const perPage = 100;
  const pagination = { page: filter.page, perPage, offset: (filter.page - 1) * perPage };

  const [{ items: entries, total }, sources, summary] = await Promise.all([
    loggingService.entry.list({
      pagination,
      filter: {
        sources: filter.sources.length > 0 ? filter.sources : undefined,
        level: filter.level !== "all" ? filter.level : undefined,
        search: filter.search || undefined,
      },
    }),
    loggingService.source.list(),
    loggingService.stats.summary(),
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

  const rawRetention = await get<unknown>("logs.retention_days");
  const retentionDays = typeof rawRetention === "number" ? rawRetention : 30;

  return () => (
    <AdminLayout c={c} title="Logs" stretch>
      <div class="flex-1 min-h-0 overflow-y-auto">
        <div class="flex flex-col gap-2">
          <div class="min-w-0" style="view-transition-name: admin-logs-title">
            <h1 class="text-base font-semibold text-primary">Logs</h1>
          </div>

          {/* Stat cards — see skills/cloud-app/references/frontend.md § Stats */}
          <div class="paper overflow-hidden">
            <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-px p-px bg-zinc-100 dark:bg-zinc-800">
              <StatCell
                label="Errors 24h"
                value={summary.errors24h.toLocaleString()}
                sub={summary.errors24h > 0 ? "last 24h" : "none"}
                valueClass={summary.errors24h > 0 ? "text-red-500" : "text-primary"}
                accent={summary.errors24h > 0 ? { tone: "red", icon: "ti ti-alert-circle" } : undefined}
              />
              <StatCell
                label="Warnings 24h"
                value={summary.warnings24h.toLocaleString()}
                sub={summary.warnings24h > 0 ? "last 24h" : "none"}
                valueClass={summary.warnings24h > 0 ? "text-amber-600 dark:text-amber-400" : "text-primary"}
                accent={summary.warnings24h > 0 ? { tone: "amber", icon: "ti ti-alert-triangle" } : undefined}
              />
              <StatCell label="Volume 24h" value={summary.total24h.toLocaleString()} sub="all levels" />
              <StatCell
                label="Sources"
                value={summary.sources}
                sub="distinct"
                accent={{ tone: "blue", icon: "ti ti-stack-3" }}
              />
              <StatCell
                label="Total · Retention"
                value={summary.total.toLocaleString()}
                sub={`${retentionDays}d auto-prune`}
              />
            </div>
          </div>

          <LogFilterBar filter={filter} sources={sources} retentionDays={retentionDays} />
          <LogTable entries={entries} />
          <Pagination currentPage={paginationResult.page} totalPages={paginationResult.total_pages} baseUrl={baseUrl} />
        </div>
      </div>
    </AdminLayout>
  );
});
