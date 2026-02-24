import { ssr } from "@valentinkolb/cloud/core/config";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import { AdminLayout } from "@valentinkolb/cloud/core/ssr";
import { Pagination } from "@valentinkolb/cloud/lib/ui";
import { SearchBar } from "@valentinkolb/cloud/lib/islands";
import AdminSpaceActions from "./_components/AdminSpaceActions.island";
import { spacesService } from "../service";

const PER_PAGE = 25;

export default ssr<AuthContext>(async (c) => {
  const search = (c.req.query("search") ?? "").trim();
  const pageRaw = Number.parseInt(c.req.query("page") ?? "1", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  const spaces = await spacesService.space.admin.list({
    pagination: { page, perPage: PER_PAGE },
    filter: { query: search || undefined },
  });

  const totalPages = Math.ceil(spaces.total / spaces.perPage);
  const baseUrl = search ? `/admin/spaces?search=${encodeURIComponent(search)}&page=` : "/admin/spaces?page=";

  return (
    <AdminLayout c={c} title="Spaces">
      <div class="max-w-6xl mx-auto flex flex-col gap-4">
        <div class="flex items-center justify-between gap-4" style="view-transition-name: page-header">
          <h1 class="text-xl font-bold text-primary">Space Settings</h1>
          <span class="text-xs text-dimmed">{spaces.total} total</span>
        </div>

        <SearchBar placeholder="Search spaces by name..." ariaLabel="Search spaces" />

        {spaces.items.length > 0 ? (
          <div class="paper overflow-hidden">
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
                    <th class="text-left px-4 py-3 font-medium text-dimmed">Space</th>
                    <th class="text-left px-4 py-3 font-medium text-dimmed">Description</th>
                    <th class="text-left px-4 py-3 font-medium text-dimmed">Permissions</th>
                    <th class="text-right px-4 py-3 font-medium text-dimmed">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {spaces.items.map((space) => (
                    <tr class="border-b border-zinc-100 dark:border-zinc-800 last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
                      <td class="px-4 py-3">
                        <div class="flex items-center gap-2 min-w-52">
                          <span
                            class="inline-flex h-5 w-5 items-center justify-center rounded-md text-white text-xs shrink-0"
                            style={`background-color: ${space.color}`}
                          >
                            <i class="ti ti-layout-kanban" />
                          </span>
                          <span class="font-medium truncate">{space.name}</span>
                        </div>
                      </td>
                      <td class="px-4 py-3 max-w-md">
                        <span class="text-dimmed truncate block" title={space.description ?? "No description"}>
                          {space.description || <span class="italic">No description</span>}
                        </span>
                      </td>
                      <td class="px-4 py-3 whitespace-nowrap">
                        <span class={space.permissionCount === 0 ? "text-red-500 font-medium" : "text-dimmed"}>
                          {space.permissionCount}
                        </span>
                      </td>
                      <td class="px-4 py-3 text-right">
                        <AdminSpaceActions spaceId={space.id} spaceName={space.name} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div class="paper p-6 text-center text-sm text-dimmed">{search ? `No spaces matching "${search}".` : "No spaces found."}</div>
        )}

        <Pagination currentPage={spaces.page} totalPages={totalPages} baseUrl={baseUrl} />
      </div>
    </AdminLayout>
  );
});
