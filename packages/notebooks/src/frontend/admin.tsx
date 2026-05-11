import { ssr } from "../config";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import { Pagination, StatCell, StatGrid } from "@valentinkolb/cloud/ui";
import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
import AdminNotebookActions from "./_components/AdminNotebookActions.island";
import AdminNotebooksAppSettings from "./_components/AdminNotebooksAppSettings.island";
import { notebooksService } from "../service";

const PER_PAGE = 100;

export default ssr<AuthContext>(async (c) => {
  const search = (c.req.query("search") ?? "").trim();
  const pageRaw = Number.parseInt(c.req.query("page") ?? "1", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  // List + summary in parallel — summary is a single SQL aggregation across the
  // full filtered set, NOT just the visible page.
  const [notebooks, summary] = await Promise.all([
    notebooksService.notebook.admin.list({
      pagination: { page, perPage: PER_PAGE },
      filter: { query: search || undefined },
    }),
    notebooksService.notebook.admin.summary({ filter: { query: search || undefined } }),
  ]);

  const totalPages = Math.ceil(notebooks.total / notebooks.perPage);
  const baseUrl = search ? `/admin/notebooks?search=${encodeURIComponent(search)}&page=` : "/admin/notebooks?page=";

  const orphanedCount = summary.orphaned;
  const totalPermissions = summary.totalPermissions;

  return () => (
    <AdminLayout c={c} title="Notebooks" stretch>
      <div class="flex-1 min-h-0 overflow-y-auto">
        <div class="flex flex-col gap-2">
          <div class="min-w-0" style="view-transition-name: admin-notebooks-title">
            <h1 class="text-base font-semibold text-primary">Notebooks</h1>
          </div>

          {/* Stat cards — see skills/cloud-app/references/frontend.md § Stats */}
          <StatGrid columns={3}>
            <StatCell
              label="Notebooks"
              value={notebooks.total}
              sub={search ? "filtered" : "total"}
              accent={{ tone: "blue", icon: "ti ti-notebook" }}
            />
            <StatCell
              label="Orphaned"
              value={orphanedCount}
              sub={orphanedCount > 0 ? "no access" : "all reachable"}
              valueClass={orphanedCount > 0 ? "text-red-500" : "text-primary"}
              accent={orphanedCount > 0 ? { tone: "red", icon: "ti ti-alert-circle" } : undefined}
            />
            <StatCell
              label="Access entries"
              value={totalPermissions}
              sub={search ? "in search" : "across all notebooks"}
            />
          </StatGrid>

          <div class="flex items-stretch gap-2">
            <div class="flex-1 min-w-0">
              <SearchBar action="/admin/notebooks" value={search} placeholder="Search notebooks by name..." ariaLabel="Search notebooks" />
            </div>
            <AdminNotebooksAppSettings />
          </div>

          {notebooks.items.length > 0 ? (
            <section class="paper overflow-hidden" style="view-transition-name: admin-notebooks-table">
              <div class="overflow-x-auto">
                <table class="w-full text-xs">
                  <thead>
                    <tr class="border-b border-zinc-100 dark:border-zinc-800">
                      <th class="px-3 py-2 text-left font-medium text-dimmed">Notebook</th>
                      <th class="px-3 py-2 text-left font-medium text-dimmed">Description</th>
                      <th class="px-3 py-2 text-left font-medium text-dimmed">Permissions</th>
                      <th class="w-px px-3 py-2 text-right font-medium text-dimmed">
                        <span class="sr-only">Actions</span>
                        <i class="ti ti-settings text-sm" aria-hidden="true" />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {notebooks.items.map((notebook) => (
                      <tr class="border-b border-zinc-50 transition-colors hover:bg-zinc-50 dark:border-zinc-800/50 dark:hover:bg-zinc-800/30">
                        <td class="px-3 py-1.5">
                          <div class="flex min-w-52 items-center gap-2">
                            <i class={`${notebook.icon ?? "ti ti-notebook"} text-dimmed`} />
                            <span class="truncate font-medium text-primary">{notebook.name}</span>
                          </div>
                        </td>
                        <td class="max-w-xl px-3 py-1.5 text-dimmed">
                          <span class="block truncate" title={notebook.description ?? "No description"}>
                            {notebook.description || <span class="italic">No description</span>}
                          </span>
                        </td>
                        <td class="px-3 py-1.5 whitespace-nowrap">
                          <span
                            class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              notebook.permissionCount === 0
                                ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                            }`}
                          >
                            {notebook.permissionCount} access {notebook.permissionCount === 1 ? "entry" : "entries"}
                          </span>
                        </td>
                        <td class="px-3 py-1.5 text-right">
                          <AdminNotebookActions notebookId={notebook.id} notebookName={notebook.name} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <section class="paper p-6 text-center text-sm text-dimmed">{search ? `No notebooks matching "${search}".` : "No notebooks found."}</section>
          )}

          <Pagination currentPage={notebooks.page} totalPages={totalPages} baseUrl={baseUrl} />
        </div>
      </div>
    </AdminLayout>
  );
});
