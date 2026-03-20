import { ssr } from "@valentinkolb/cloud/core/config";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import { AdminLayout } from "@valentinkolb/cloud/core/ssr";
import { Pagination } from "@valentinkolb/cloud/lib/ui";
import { SearchBar } from "@valentinkolb/cloud/lib/islands";
import AdminSpaceActions from "./_components/AdminSpaceActions.island";
import { spacesService } from "../service";

const PER_PAGE = 100;

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
    <AdminLayout c={c} title="Spaces" fullHeight>
      <div class="flex-1 min-h-0 overflow-y-auto">
        <div class="flex flex-col gap-2">
          <div class="min-w-0" style="view-transition-name: admin-spaces-title">
            <h1 class="text-base font-semibold text-primary">Spaces</h1>
            <p class="mt-1 text-xs text-dimmed">{spaces.total} spaces</p>
          </div>

          <SearchBar action="/admin/spaces" value={search} placeholder="Search spaces by name..." ariaLabel="Search spaces" />

          {spaces.items.length > 0 ? (
            <section class="paper overflow-hidden" style="view-transition-name: admin-spaces-table">
              <div class="overflow-x-auto">
                <table class="w-full text-xs">
                  <thead>
                    <tr class="border-b border-zinc-100 dark:border-zinc-800">
                      <th class="px-3 py-2 text-left font-medium text-dimmed">Space</th>
                      <th class="px-3 py-2 text-left font-medium text-dimmed">Description</th>
                      <th class="px-3 py-2 text-left font-medium text-dimmed">Permissions</th>
                      <th class="w-px px-3 py-2 text-right font-medium text-dimmed">
                        <span class="sr-only">Actions</span>
                        <i class="ti ti-settings text-sm" aria-hidden="true" />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {spaces.items.map((space) => (
                      <tr class="border-b border-zinc-50 transition-colors hover:bg-zinc-50 dark:border-zinc-800/50 dark:hover:bg-zinc-800/30">
                        <td class="px-3 py-1.5">
                          <div class="flex min-w-52 items-center gap-2">
                            <span
                              class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] text-white"
                              style={`background-color: ${space.color}`}
                            >
                              <i class="ti ti-layout-kanban" />
                            </span>
                            <span class="truncate font-medium text-primary">{space.name}</span>
                          </div>
                        </td>
                        <td class="max-w-xl px-3 py-1.5 text-dimmed">
                          <span class="block truncate" title={space.description ?? "No description"}>
                            {space.description || <span class="italic">No description</span>}
                          </span>
                        </td>
                        <td class="px-3 py-1.5 whitespace-nowrap">
                          <span
                            class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              space.permissionCount === 0
                                ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                            }`}
                          >
                            {space.permissionCount} access {space.permissionCount === 1 ? "entry" : "entries"}
                          </span>
                        </td>
                        <td class="px-3 py-1.5 text-right">
                          <AdminSpaceActions spaceId={space.id} spaceName={space.name} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <section class="paper p-6 text-center text-sm text-dimmed">{search ? `No spaces matching "${search}".` : "No spaces found."}</section>
          )}

          <Pagination currentPage={spaces.page} totalPages={totalPages} baseUrl={baseUrl} />
        </div>
      </div>
    </AdminLayout>
  );
});
