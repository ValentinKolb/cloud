import { ssr } from "@valentinkolb/cloud/core/config";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import { createPagination } from "@/logging/contracts";
import { AdminLayout } from "@valentinkolb/cloud/core/ssr";
import { Pagination } from "@valentinkolb/cloud/lib/ui";
import LogFilterBar from "./_components/LogFilterBar.island";
import LogCleanup from "./_components/LogCleanup.island";
import LogRetention from "./_components/LogRetention.island";
import { parseLogFilterFromUrl } from "./_components/types";
import MetadataPreview from "./_components/MetadataPreview.island";
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
        source: filter.source !== "all" ? filter.source : undefined,
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
    if (filter.source !== "all") params.set("source", filter.source);
    if (filter.search) params.set("search", filter.search);
    const qs = params.toString();
    return qs ? `/admin/logs?${qs}&page=` : "/admin/logs?page=";
  })();

  const formatDate = (dateStr: string) =>
    new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(dateStr));

  const getLevelBadge = (level: string) => {
    switch (level) {
      case "debug":
        return (
          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            <i class="ti ti-bug text-xs" />
            debug
          </span>
        );
      case "info":
        return (
          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
            <i class="ti ti-info-circle text-xs" />
            info
          </span>
        );
      case "warn":
        return (
          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
            <i class="ti ti-alert-triangle text-xs" />
            warn
          </span>
        );
      case "error":
        return (
          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
            <i class="ti ti-alert-circle text-xs" />
            error
          </span>
        );
      default:
        return <span class="text-xs text-dimmed">{level}</span>;
    }
  };

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

        {entries.length > 0 ? (
          <div class="paper overflow-hidden">
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
                    <th class="text-left px-4 py-3 font-medium text-dimmed">Level</th>
                    <th class="text-left px-4 py-3 font-medium text-dimmed">Source</th>
                    <th class="text-left px-4 py-3 font-medium text-dimmed">Message</th>
                    <th class="text-left px-4 py-3 font-medium text-dimmed">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr class="border-b border-zinc-100 dark:border-zinc-800 last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
                      <td class="px-4 py-3">{getLevelBadge(entry.level)}</td>
                      <td class="px-4 py-3">
                        <span class="font-mono text-xs">{entry.source}</span>
                      </td>
                      <td class="px-4 py-3">
                        <span class="line-clamp-1 max-w-md" title={entry.message}>
                          {entry.message}
                        </span>
                        {entry.metadata && <MetadataPreview data={entry.metadata} />}
                      </td>
                      <td class="px-4 py-3 text-dimmed whitespace-nowrap">{formatDate(entry.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div class="paper p-6 text-center text-sm text-dimmed">
            {filter.search ? "No log entries found matching your search." : "No log entries found."}
          </div>
        )}

        <Pagination currentPage={paginationResult.page} totalPages={paginationResult.total_pages} baseUrl={baseUrl} />
      </div>
    </AdminLayout>
  );
});
