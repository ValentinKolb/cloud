import type { AuthContext } from "@valentinkolb/cloud/server";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
import { DataTable, type DataTableColumn, Pagination, StatCell, StatGrid, ButtonLink } from "@k2b/ui";
import { ssr } from "../config";
import { gridsService } from "../service";
import AdminGridsActions from "./_components/AdminGridsActions.island";
import AdminGridsSettings from "./_components/settings/AdminGridsSettings.island";

const PER_PAGE = 100;

const formatDuration = (seconds: number): string => {
  if (seconds < 1) return "current";
  if (seconds < 60) return `${Math.round(seconds)}s old`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m old`;
  return `${Math.round(seconds / 3600)}h old`;
};

/**
 * /admin/grids — platform-admin overview of every base in the system.
 * Mirrors the spaces admin page: stat cards (totals + orphaned),
 * search bar, paginated table with per-row counts. Bypasses per-base
 * ACLs by living under auth.requireRole("admin") in the route map.
 */
export default ssr<AuthContext>(async (c) => {
  const search = (c.req.query("search") ?? "").trim();
  const pageRaw = Number.parseInt(c.req.query("page") ?? "1", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const offset = (page - 1) * PER_PAGE;

  const [list, summary, operations] = await Promise.all([
    gridsService.base.admin.list({
      pagination: { perPage: PER_PAGE, offset },
      filter: { query: search || undefined },
    }),
    gridsService.base.admin.summary({ filter: { query: search || undefined } }),
    gridsService.operations.health(),
  ]);

  const totalPages = Math.ceil(list.total / list.perPage);
  const baseUrl = search ? `/admin/grids?search=${encodeURIComponent(search)}&page=` : "/admin/grids?page=";
  type BaseRow = (typeof list.items)[number];
  const columns: DataTableColumn<BaseRow>[] = [
    { id: "base", header: "Base", value: (base) => base.name },
    { id: "description", header: "Description", value: (base) => base.description, cellClass: "max-w-xl" },
    { id: "tables", header: "Tables", value: (base) => base.tableCount, headerClass: "text-right", cellClass: "text-right tabular-nums" },
    {
      id: "records",
      header: "Records",
      value: (base) => base.recordCount,
      headerClass: "text-right",
      cellClass: "text-right tabular-nums",
    },
    {
      id: "access",
      header: "Access",
      value: (base) => base.accessCount,
      headerClass: "text-right",
      cellClass: "text-right whitespace-nowrap",
    },
    { id: "actions", header: "Settings", headerClass: "w-px text-right", cellClass: "text-right whitespace-nowrap" },
  ];

  return () => (
    <AdminLayout c={c} title="Grids">
      <div class="app-rows" data-scroll-preserve="grids-admin">
        <div class="flex items-center justify-between gap-3" style="view-transition-name: admin-grids-title">
          <div class="min-w-0">
            <h1 class="text-base font-semibold text-primary">Grids</h1>
          </div>
        </div>

        <StatGrid columns={4}>
          <StatCell
            label="Bases"
            value={summary.totalBases}
            sub={search ? "filtered" : "total"}
            accent={{ tone: "blue", icon: "ti ti-database" }}
          />
          <StatCell
            label="Tables"
            value={summary.totalTables}
            sub={search ? "in filtered bases" : "total"}
            accent={{ tone: "zinc", icon: "ti ti-table" }}
          />
          <StatCell label="Records" value={summary.totalRecords} sub="non-deleted" accent={{ tone: "zinc", icon: "ti ti-list" }} />
          <StatCell
            label="Orphaned bases"
            value={summary.orphanedBases}
            sub={summary.orphanedBases > 0 ? "no access entries" : "all reachable"}
            valueClass={summary.orphanedBases > 0 ? "text-red-500" : "text-primary"}
            accent={summary.orphanedBases > 0 ? { tone: "red", icon: "ti ti-alert-circle" } : undefined}
          />
        </StatGrid>

        <section class="paper flex flex-col gap-2 p-3" aria-labelledby="grids-operations-title">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="min-w-0">
              <h2 id="grids-operations-title" class="text-xs font-semibold text-primary">
                Operations
              </h2>
              <p class="text-[10px] text-dimmed">Current processing health. Request history and traces stay in Observability.</p>
            </div>
            <nav class="flex flex-wrap items-center gap-1" aria-label="Grids observability links">
              <ButtonLink variant="secondary" size="sm" href="/admin/observability/telemetry?app=grids">
                <i class="ti ti-activity" aria-hidden="true" /> Requests
              </ButtonLink>
              <ButtonLink variant="secondary" size="sm" href="/admin/observability/jobs?search=grids">
                <i class="ti ti-route" aria-hidden="true" /> Traces
              </ButtonLink>
              <ButtonLink variant="secondary" size="sm" href="/admin/observability/logs?search=grids">
                <i class="ti ti-list-details" aria-hidden="true" /> Logs
              </ButtonLink>
              <ButtonLink variant="secondary" size="sm" href="/admin/observability/metrics">
                <i class="ti ti-chart-histogram" aria-hidden="true" /> Metrics
              </ButtonLink>
              <ButtonLink variant="secondary" size="sm" href="/admin/observability/alerts">
                <i class="ti ti-bell-ringing" aria-hidden="true" /> Alerts
              </ButtonLink>
            </nav>
          </div>

          <StatGrid columns={4} size="sm">
            <StatCell
              label="State"
              value={operations.status === "ok" ? "Healthy" : operations.status === "warn" ? "Delayed" : "Action needed"}
              sub={`observed ${new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(operations.observedAt))}`}
              valueClass={
                operations.status === "ok"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : operations.status === "warn"
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-red-500"
              }
              accent={{
                tone: operations.status === "ok" ? "emerald" : operations.status === "warn" ? "amber" : "red",
                icon: operations.status === "ok" ? "ti ti-check" : "ti ti-alert-triangle",
              }}
            />
            <StatCell
              label="Record events"
              value={operations.outbox.pending + operations.outbox.failed}
              sub={
                operations.outbox.pending + operations.outbox.failed > 0
                  ? formatDuration(operations.outbox.oldestActiveAgeSeconds)
                  : "queue clear"
              }
              accent={operations.outbox.dead > 0 ? { tone: "red", icon: "ti ti-alert-circle" } : undefined}
            />
            <StatCell
              label="Workflow attention"
              value={operations.workflows.needsAttention + operations.effects.needsAttention + operations.workflows.staleRunning}
              sub={`${operations.workflows.queued} queued · ${operations.workflows.running} running`}
              accent={
                operations.workflows.needsAttention + operations.effects.needsAttention + operations.workflows.staleRunning > 0
                  ? { tone: "red", icon: "ti ti-alert-circle" }
                  : undefined
              }
            />
            <StatCell
              label="GQL"
              value={operations.gql.total24h.toLocaleString()}
              sub={`${operations.gql.errors24h.toLocaleString()} diagnostics · p99 ${Math.round(operations.gql.p99DurationMs24h)}ms`}
            />
          </StatGrid>

          {operations.issues.length > 0 ? (
            <div class="grid gap-1 lg:grid-cols-2">
              {operations.issues.map((issue) => (
                <article
                  class={`rounded-md p-2 ${
                    issue.severity === "error"
                      ? "bg-red-50 text-red-800 dark:bg-red-950/25 dark:text-red-300"
                      : "bg-amber-50 text-amber-900 dark:bg-amber-950/25 dark:text-amber-200"
                  }`}
                >
                  <div class="flex items-start gap-2">
                    <i
                      class={`ti ${issue.severity === "error" ? "ti-alert-circle" : "ti-clock-exclamation"} mt-0.5 shrink-0`}
                      aria-hidden="true"
                    />
                    <div class="min-w-0">
                      <h3 class="text-xs font-semibold">{issue.title}</h3>
                      <p class="text-[11px] opacity-80">{issue.detail}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </section>

        <section class="paper flex flex-col gap-1 overflow-hidden" style="view-transition-name: admin-grids-table">
          <div class="flex flex-col gap-2 p-3">
            <div>
              <h2 class="text-xs font-semibold text-primary">Bases</h2>
              <p class="text-[10px] text-dimmed">
                {list.items.length} of {list.total} bases
              </p>
            </div>
            <SearchBar action="/admin/grids" value={search} placeholder="Search bases by name or description..." ariaLabel="Search bases" />
            <div class="flex flex-wrap items-center gap-2">
              <div class="ml-auto">
                <AdminGridsSettings />
              </div>
            </div>
          </div>
          <DataTable
            rows={list.items}
            columns={columns}
            getRowId={(base) => base.id}
            hoverRows
            class="overflow-x-auto"
            scrollPreserveKey="grids-admin-table"
            empty={search ? `No bases matching "${search}".` : "No bases found."}
            renderCell={({ row: base, col }) => {
              if (col.id === "base") {
                return (
                  <div class="flex min-w-52 items-center gap-2">
                    <span class="app-accent-text inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[var(--ui-selected)] text-[10px]">
                      <i class="ti ti-database" />
                    </span>
                    <span class="truncate font-medium text-primary">{base.name}</span>
                  </div>
                );
              }
              if (col.id === "description") {
                return (
                  <span class="block truncate" title={base.description ?? "No description"}>
                    {base.description || <span class="italic">No description</span>}
                  </span>
                );
              }
              if (col.id === "tables") return <span class="text-secondary">{base.tableCount}</span>;
              if (col.id === "records") return <span class="text-secondary">{base.recordCount}</span>;
              if (col.id === "access") {
                return (
                  <span
                    class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      base.accessCount === 0
                        ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                        : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                    }`}
                  >
                    {base.accessCount} {base.accessCount === 1 ? "entry" : "entries"}
                  </span>
                );
              }
              if (col.id === "actions") return <AdminGridsActions baseId={base.id} baseName={base.name} />;
              return "";
            }}
          />
        </section>

        <Pagination currentPage={list.page} totalPages={totalPages} baseUrl={baseUrl} />
      </div>
    </AdminLayout>
  );
});
