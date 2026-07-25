import type { AuthContext } from "@valentinkolb/cloud/server";
import { get } from "@valentinkolb/cloud/services";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import { Pagination, Placeholder, StatCell, StatGrid } from "@valentinkolb/cloud/ui";
import { ssr } from "../../config";
import GatewayOpsLayoutHelp from "../../frontend/GatewayOpsLayoutHelp.island";
import { gatewayOpsHelp } from "../../help";
import LogTable from "./_components/LogTable.island";
import { buildLogFilterUrl, LOG_WINDOWS } from "./_components/types";

const LOGS_PAGE_PATH = "/admin/observability/logs";

const LOG_WINDOW_KEYS = Object.keys(LOG_WINDOWS) as (keyof typeof LOG_WINDOWS)[];

import { parseLogFilterFromUrl } from "./_components/types";
import { createPagination } from "./contracts";
import { loggingService } from "./service";

export default ssr<AuthContext>(async (c) => {
  const url = new URL(c.req.url);
  const filter = parseLogFilterFromUrl(url);

  const perPage = 100;
  const pagination = { page: filter.page, perPage, offset: (filter.page - 1) * perPage };

  // A logging backend that is down must degrade the page, not 500 it: the
  // operator still needs the rest of the console to diagnose why.
  const [listResult, sources, summary, sourceStats] = await Promise.all([
    loggingService.entry
      .list({
        pagination,
        filter: {
          sources: filter.sources.length > 0 ? filter.sources : undefined,
          level: filter.level !== "all" ? filter.level : undefined,
          search: filter.search || undefined,
        },
      })
      .then((result) => ({ result, error: null as string | null }))
      .catch((error) => ({ result: { items: [], total: 0 }, error: error instanceof Error ? error.message : String(error) })),
    loggingService.source.list().catch(() => []),
    loggingService.stats.summary().catch(() => null),
    loggingService.stats.by({ groupBy: "source", sinceHours: LOG_WINDOWS[filter.window], limit: 1 }).catch(() => []),
  ]);
  const { items: entries, total } = listResult.result;
  const loadError = listResult.error;
  const topSource = sourceStats[0] ?? null;

  const paginationResult = createPagination(pagination, total);
  const baseUrl = (() => {
    const withoutPage = buildLogFilterUrl(LOGS_PAGE_PATH, { page: 1 }, filter);
    return withoutPage.includes("?") ? `${withoutPage}&page=` : `${withoutPage}?page=`;
  })();

  const rawRetention = await get<unknown>("logs.retention_days");
  const retentionDays = typeof rawRetention === "number" ? rawRetention : 30;

  return () => (
    <AdminLayout c={c} title="Logs">
      <GatewayOpsLayoutHelp documents={gatewayOpsHelp.manifest} />
      <div class="app-rows">
        <div class="min-w-0" style="view-transition-name: admin-logs-title">
          <h1 class="text-base font-semibold text-primary">Logs</h1>
        </div>

        {loadError ? (
          <Placeholder
            state="error"
            surface="paper"
            icon="ti ti-database-off"
            title="Could not read the log store"
            description={loadError}
          />
        ) : null}

        <nav class="flex flex-wrap items-center gap-1" aria-label="Log window">
          <span class="mr-1 text-[10px] text-dimmed">Window</span>
          {LOG_WINDOW_KEYS.map((option) => (
            <a
              href={buildLogFilterUrl(LOGS_PAGE_PATH, { window: option, page: 1 }, filter)}
              class={`btn-input btn-input-sm ${option === filter.window ? "btn-input-active" : ""}`}
              aria-current={option === filter.window ? "true" : undefined}
            >
              {option}
            </a>
          ))}
        </nav>

        {/* Stat cards — see skills/cloud-app/references/frontend.md § Stats */}
        <StatGrid columns={5}>
          <StatCell
            label="Errors"
            value={summary ? summary.errors24h.toLocaleString() : "—"}
            sub={summary ? filter.window : "unavailable"}
            valueClass={summary && summary.errors24h > 0 ? "text-red-500" : "text-primary"}
            href={buildLogFilterUrl(LOGS_PAGE_PATH, { level: "error", page: 1 }, filter)}
            accent={summary && summary.errors24h > 0 ? { tone: "red", icon: "ti ti-alert-circle" } : undefined}
          />
          <StatCell
            label="Warnings"
            value={summary ? summary.warnings24h.toLocaleString() : "—"}
            sub={summary ? filter.window : "unavailable"}
            valueClass={summary && summary.warnings24h > 0 ? "text-amber-600 dark:text-amber-400" : "text-primary"}
            href={buildLogFilterUrl(LOGS_PAGE_PATH, { level: "warn", page: 1 }, filter)}
            accent={summary && summary.warnings24h > 0 ? { tone: "amber", icon: "ti ti-alert-triangle" } : undefined}
          />
          <StatCell label="Volume" value={summary ? summary.total24h.toLocaleString() : "—"} sub={`${filter.window} · all levels`} />
          <StatCell
            label="Noisiest source"
            value={topSource ? topSource.key : "—"}
            sub={topSource ? `${topSource.count.toLocaleString()} entries` : "no entries in window"}
            href={topSource ? buildLogFilterUrl(LOGS_PAGE_PATH, { sources: [topSource.key], page: 1 }, filter) : undefined}
            accent={{ tone: "blue", icon: "ti ti-stack-3" }}
          />
          <StatCell label="Retained" value={summary ? summary.total.toLocaleString() : "—"} sub={`${retentionDays}d auto-prune`} />
        </StatGrid>

        <LogTable entries={entries} total={total} filter={filter} sources={sources} retentionDays={retentionDays} />
        <Pagination currentPage={paginationResult.page} totalPages={paginationResult.total_pages} baseUrl={baseUrl} />
      </div>
    </AdminLayout>
  );
});
