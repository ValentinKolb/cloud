import { ssr } from "@valentinkolb/cloud/core/config";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import { AdminLayout } from "@valentinkolb/cloud/core/ssr";
import { Pagination } from "@valentinkolb/cloud/lib/ui";
import { SearchBar } from "@valentinkolb/cloud/lib/islands";
import AdminNotebookActions from "./_components/AdminNotebookActions.island";
import { notebooksService } from "../service";

const PER_PAGE = 25;

export default ssr<AuthContext>(async (c) => {
  const search = (c.req.query("search") ?? "").trim();
  const pageRaw = Number.parseInt(c.req.query("page") ?? "1", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  const notebooks = await notebooksService.notebook.admin.list({
    pagination: { page, perPage: PER_PAGE },
    filter: { query: search || undefined },
  });

  const totalPages = Math.ceil(notebooks.total / notebooks.perPage);
  const baseUrl = search ? `/admin/notebooks?search=${encodeURIComponent(search)}&page=` : "/admin/notebooks?page=";

  return (
    <AdminLayout c={c} title="Notebooks">
      <div class="max-w-6xl mx-auto flex flex-col gap-4">
        <div class="flex items-center justify-between gap-4" style="view-transition-name: page-header">
          <h1 class="text-xl font-bold text-primary">Notebook Settings</h1>
          <span class="text-xs text-dimmed">{notebooks.total} total</span>
        </div>

        <SearchBar placeholder="Search notebooks by name..." ariaLabel="Search notebooks" />

        {notebooks.items.length > 0 ? (
          <div class="paper overflow-hidden">
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
                    <th class="text-left px-4 py-3 font-medium text-dimmed">Notebook</th>
                    <th class="text-left px-4 py-3 font-medium text-dimmed">Description</th>
                    <th class="text-left px-4 py-3 font-medium text-dimmed">Permissions</th>
                    <th class="text-right px-4 py-3 font-medium text-dimmed">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {notebooks.items.map((notebook) => (
                    <tr class="border-b border-zinc-100 dark:border-zinc-800 last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
                      <td class="px-4 py-3">
                        <div class="flex items-center gap-2 min-w-52">
                          <i class={`${notebook.icon ?? "ti ti-notebook"} text-dimmed`} />
                          <span class="font-medium truncate">{notebook.name}</span>
                        </div>
                      </td>
                      <td class="px-4 py-3 max-w-md">
                        <span class="text-dimmed truncate block" title={notebook.description ?? "No description"}>
                          {notebook.description || <span class="italic">No description</span>}
                        </span>
                      </td>
                      <td class="px-4 py-3 whitespace-nowrap">
                        <span class={notebook.permissionCount === 0 ? "text-red-500 font-medium" : "text-dimmed"}>
                          {notebook.permissionCount}
                        </span>
                      </td>
                      <td class="px-4 py-3 text-right">
                        <AdminNotebookActions notebookId={notebook.id} notebookName={notebook.name} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div class="paper p-6 text-center text-sm text-dimmed">
            {search ? `No notebooks matching "${search}".` : "No notebooks found."}
          </div>
        )}

        <Pagination currentPage={notebooks.page} totalPages={totalPages} baseUrl={baseUrl} />
      </div>
    </AdminLayout>
  );
});
