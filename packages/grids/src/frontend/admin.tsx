import type { AuthContext } from "@valentinkolb/cloud/server";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
import { DataTable, type DataTableColumn, Pagination, StatCell, StatGrid } from "@valentinkolb/cloud/ui";
import { ssr } from "../config";
import { gridsService } from "../service";
import AdminGridsSettings from "./_components/settings/AdminGridsSettings.island";

const PER_PAGE = 100;

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

  const [list, summary] = await Promise.all([
    gridsService.base.admin.list({
      pagination: { perPage: PER_PAGE, offset },
      filter: { query: search || undefined },
    }),
    gridsService.base.admin.summary({ filter: { query: search || undefined } }),
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
    { id: "open", header: "Open", headerClass: "w-px text-right", cellClass: "text-right whitespace-nowrap" },
  ];

  return () => (
    <AdminLayout c={c} title="Grids" stretch>
      <div class="flex-1 min-h-0 overflow-y-auto" data-scroll-preserve="grids-admin">
        <div class="flex flex-col gap-2">
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
            <StatCell label="Records" value={summary.totalRecords} sub="non-deleted" accent={{ tone: "emerald", icon: "ti ti-list" }} />
            <StatCell
              label="Orphaned bases"
              value={summary.orphanedBases}
              sub={summary.orphanedBases > 0 ? "no access entries" : "all reachable"}
              valueClass={summary.orphanedBases > 0 ? "text-red-500" : "text-primary"}
              accent={summary.orphanedBases > 0 ? { tone: "red", icon: "ti ti-alert-circle" } : undefined}
            />
          </StatGrid>

          <section class="paper overflow-hidden" style="view-transition-name: admin-grids-table">
            <div class="flex flex-col gap-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800/60">
              <div>
                <h2 class="text-xs font-semibold text-primary">Bases</h2>
                <p class="text-[10px] text-dimmed">
                  {list.items.length} of {list.total} bases
                </p>
              </div>
              <SearchBar
                action="/admin/grids"
                value={search}
                placeholder="Search bases by name or description..."
                ariaLabel="Search bases"
              />
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
                      <span class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-blue-500 text-[10px] text-white">
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
                if (col.id === "open") {
                  return (
                    <a href={`/app/grids/${base.shortId}`} class="text-dimmed hover:text-primary" title="Open base">
                      <i class="ti ti-arrow-right" />
                    </a>
                  );
                }
                return "";
              }}
            />
          </section>

          <Pagination currentPage={list.page} totalPages={totalPages} baseUrl={baseUrl} />
        </div>
      </div>
    </AdminLayout>
  );
});
