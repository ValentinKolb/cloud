import { ssr } from "../config";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import { Pagination, StatCell } from "@valentinkolb/cloud/ui";
import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
import { gridsService } from "../service";

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

  return () => (
    <AdminLayout c={c} title="Grids" stretch>
      <div class="flex-1 min-h-0 overflow-y-auto">
        <div class="flex flex-col gap-2">
          <div class="min-w-0" style="view-transition-name: admin-grids-title">
            <h1 class="text-base font-semibold text-primary">Grids</h1>
          </div>

          <div class="paper overflow-hidden">
            <div class="grid grid-cols-4 gap-px p-px bg-zinc-100 dark:bg-zinc-800">
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
              <StatCell
                label="Records"
                value={summary.totalRecords}
                sub="non-deleted"
                accent={{ tone: "emerald", icon: "ti ti-list" }}
              />
              <StatCell
                label="Orphaned bases"
                value={summary.orphanedBases}
                sub={summary.orphanedBases > 0 ? "no access entries" : "all reachable"}
                valueClass={summary.orphanedBases > 0 ? "text-red-500" : "text-primary"}
                accent={summary.orphanedBases > 0 ? { tone: "red", icon: "ti ti-alert-circle" } : undefined}
              />
            </div>
          </div>

          <SearchBar action="/admin/grids" value={search} placeholder="Search bases by name or description..." ariaLabel="Search bases" />

          {list.items.length > 0 ? (
            <section class="paper overflow-hidden" style="view-transition-name: admin-grids-table">
              <div class="overflow-x-auto">
                <table class="w-full text-xs">
                  <thead>
                    <tr class="border-b border-zinc-100 dark:border-zinc-800">
                      <th class="px-3 py-2 text-left font-medium text-dimmed">Base</th>
                      <th class="px-3 py-2 text-left font-medium text-dimmed">Description</th>
                      <th class="px-3 py-2 text-right font-medium text-dimmed">Tables</th>
                      <th class="px-3 py-2 text-right font-medium text-dimmed">Records</th>
                      <th class="px-3 py-2 text-right font-medium text-dimmed">Access</th>
                      <th class="w-px px-3 py-2 text-right font-medium text-dimmed">
                        <span class="sr-only">Open</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.items.map((base) => (
                      <tr class="border-b border-zinc-50 transition-colors hover:bg-zinc-50 dark:border-zinc-800/50 dark:hover:bg-zinc-800/30">
                        <td class="px-3 py-1.5">
                          <div class="flex min-w-52 items-center gap-2">
                            <span class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-blue-500 text-[10px] text-white">
                              <i class="ti ti-database" />
                            </span>
                            <span class="truncate font-medium text-primary">{base.name}</span>
                          </div>
                        </td>
                        <td class="max-w-xl px-3 py-1.5 text-dimmed">
                          <span class="block truncate" title={base.description ?? "No description"}>
                            {base.description || <span class="italic">No description</span>}
                          </span>
                        </td>
                        <td class="px-3 py-1.5 text-right tabular-nums text-secondary">{base.tableCount}</td>
                        <td class="px-3 py-1.5 text-right tabular-nums text-secondary">{base.recordCount}</td>
                        <td class="px-3 py-1.5 text-right whitespace-nowrap">
                          <span
                            class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              base.accessCount === 0
                                ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                            }`}
                          >
                            {base.accessCount} {base.accessCount === 1 ? "entry" : "entries"}
                          </span>
                        </td>
                        <td class="px-3 py-1.5 text-right">
                          <a
                            href={`/app/grids/${base.shortId}`}
                            class="text-dimmed hover:text-primary"
                            title="Open base"
                          >
                            <i class="ti ti-arrow-right" />
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <section class="paper p-6 text-center text-sm text-dimmed">
              {search ? `No bases matching "${search}".` : "No bases found."}
            </section>
          )}

          <Pagination currentPage={list.page} totalPages={totalPages} baseUrl={baseUrl} />
        </div>
      </div>
    </AdminLayout>
  );
});
