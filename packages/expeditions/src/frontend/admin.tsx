import { ssr } from "../config";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import { StatCell, Pagination } from "@valentinkolb/cloud/ui";
import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
import { expeditionsService } from "@/service";
import AdminExpeditionActions from "./_components/AdminExpeditionActions.island";

const PER_PAGE = 50;

/**
 * Admin page for the expeditions app — listed under /admin/expeditions.
 *
 * Sysadmins see every expedition regardless of access. The page provides:
 *   - Stat cards (total / completed / orphaned)
 *   - Searchable table
 *   - A per-row dropdown that surfaces the destructive admin actions
 *     (re-using the same APIs the detail page uses, just with the global
 *     admin override).
 *
 * The summary numbers come from a single SQL aggregate over the filtered
 * set, NOT the visible page — so the cards stay accurate while paginating.
 */
export default ssr<AuthContext>(async (c) => {
  const search = (c.req.query("search") ?? "").trim();
  const pageRaw = Number.parseInt(c.req.query("page") ?? "1", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  const [expeditions, summary] = await Promise.all([
    expeditionsService.expedition.admin.list({
      pagination: { page, perPage: PER_PAGE },
      filter: { query: search || undefined },
    }),
    expeditionsService.expedition.admin.summary({ filter: { query: search || undefined } }),
  ]);

  const totalPages = Math.ceil(expeditions.total / expeditions.perPage);
  const baseUrl = search
    ? `/admin/expeditions?search=${encodeURIComponent(search)}&page=`
    : "/admin/expeditions?page=";

  return () => (
    <AdminLayout c={c} title="Expeditions" stretch>
      <div class="flex-1 min-h-0 overflow-y-auto">
        <div class="flex flex-col gap-2">
          <h1 class="text-base font-semibold text-primary">Expeditions</h1>

          {/* Stat cards. `valueClass` colours the orphaned cell red when
              non-zero so it pops as something needing attention. */}
          <div class="paper overflow-hidden">
            <div class="grid grid-cols-3 gap-px p-px bg-zinc-100 dark:bg-zinc-800">
              <StatCell
                label="Expeditions"
                value={expeditions.total}
                sub={search ? "filtered" : "total"}
                accent={{ tone: "blue", icon: "ti ti-map-2" }}
              />
              <StatCell
                label="Completed"
                value={summary.completed}
                sub={summary.total === 0 ? "—" : `${Math.round((summary.completed / Math.max(summary.total, 1)) * 100)}%`}
                accent={{ tone: "emerald", icon: "ti ti-flag-check" }}
              />
              <StatCell
                label="Orphaned"
                value={summary.orphaned}
                sub={summary.orphaned > 0 ? "no access entries" : "all reachable"}
                valueClass={summary.orphaned > 0 ? "text-red-500" : "text-primary"}
                accent={
                  summary.orphaned > 0
                    ? { tone: "red", icon: "ti ti-alert-circle" }
                    : undefined
                }
              />
            </div>
          </div>

          <SearchBar
            action="/admin/expeditions"
            value={search}
            placeholder="Search expeditions by title..."
            ariaLabel="Search expeditions"
          />

          {expeditions.items.length > 0 ? (
            <section class="paper overflow-hidden">
              <div class="overflow-x-auto">
                <table class="w-full text-xs">
                  <thead>
                    <tr class="border-b border-zinc-100 dark:border-zinc-800">
                      <th class="px-3 py-2 text-left font-medium text-dimmed">Expedition</th>
                      <th class="px-3 py-2 text-left font-medium text-dimmed">Progress</th>
                      <th class="px-3 py-2 text-left font-medium text-dimmed">Status</th>
                      <th class="px-3 py-2 text-left font-medium text-dimmed">Access</th>
                      <th class="w-px px-3 py-2 text-right font-medium text-dimmed">
                        <span class="sr-only">Actions</span>
                        <i class="ti ti-settings text-sm" aria-hidden="true" />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {expeditions.items.map((e) => (
                      <tr class="border-b border-zinc-100 dark:border-zinc-800 last:border-b-0">
                        <td class="px-3 py-2">
                          <a
                            href={`/app/expeditions/${e.id}`}
                            class="flex items-center gap-2 hover:underline"
                          >
                            <i class={`${e.icon || "ti ti-map-2"} text-dimmed`} />
                            <span class="font-medium text-primary">{e.title}</span>
                          </a>
                        </td>
                        <td class="px-3 py-2 text-dimmed">
                          {e.doneWaypoints}/{e.totalWaypoints}
                        </td>
                        <td class="px-3 py-2">
                          {e.completedAt ? (
                            <span class="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                              <i class="ti ti-flag-check" /> Completed
                            </span>
                          ) : (
                            <span class="text-dimmed">In progress</span>
                          )}
                        </td>
                        <td class="px-3 py-2 text-dimmed">
                          {e.permissionCount === 0 ? (
                            <span class="text-red-500">orphaned</span>
                          ) : (
                            `${e.permissionCount} entries`
                          )}
                        </td>
                        <td class="px-3 py-2 text-right">
                          <AdminExpeditionActions expeditionId={e.id} expeditionTitle={e.title} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <p class="paper p-8 text-center text-xs text-dimmed">
              {search
                ? `No expeditions match "${search}".`
                : "No expeditions yet."}
            </p>
          )}

          {totalPages > 1 ? (
            <Pagination currentPage={page} totalPages={totalPages} baseUrl={baseUrl} />
          ) : null}
        </div>
      </div>
    </AdminLayout>
  );
});
