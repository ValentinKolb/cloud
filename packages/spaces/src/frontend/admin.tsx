import { DataTable, type DataTableColumn, Pagination, StatCell, StatGrid, StatusBadge } from "@k2b/ui";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
import { ssr } from "../config";
import { spacesService } from "../service";
import { spacesPublicResources } from "../service/public-resources";
import AdminSpaceActions from "./_components/AdminSpaceActions.island";

const PER_PAGE = 100;

export default ssr<AuthContext>(async (c) => {
  const search = (c.req.query("search") ?? "").trim();
  const pageRaw = Number.parseInt(c.req.query("page") ?? "1", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  // List + summary in parallel — summary is a single SQL aggregation across the
  // full filtered set, NOT just the visible page.
  const [spaces, summary] = await Promise.all([
    spacesService.space.admin.list({
      pagination: { page, perPage: PER_PAGE },
      filter: { query: search || undefined },
    }),
    spacesService.space.admin.summary({ filter: { query: search || undefined } }),
  ]);
  spaces.items = await spacesPublicResources.projectSpaces(spaces.items);

  const totalPages = Math.ceil(spaces.total / spaces.perPage);
  const baseUrl = search ? `/admin/spaces?search=${encodeURIComponent(search)}&page=` : "/admin/spaces?page=";

  const orphanedCount = summary.orphaned;
  const totalPermissions = summary.totalPermissions;
  type SpaceRow = (typeof spaces.items)[number];
  const columns: DataTableColumn<SpaceRow>[] = [
    { id: "space", header: "Space", value: (space) => space.name },
    { id: "description", header: "Description", value: (space) => space.description, cellClass: "max-w-xl" },
    { id: "permissions", header: "Permissions", value: (space) => space.permissionCount, cellClass: "whitespace-nowrap" },
    {
      id: "actions",
      header: "Settings",
      headerClass: "w-px text-right",
      cellClass: "text-right whitespace-nowrap",
    },
  ];

  return () => (
    <AdminLayout c={c} title="Spaces">
      <div class="app-rows" data-scroll-preserve="spaces-admin">
        <div class="min-w-0" style="view-transition-name: admin-spaces-title">
          <h1 class="text-base font-semibold text-primary">Spaces</h1>
        </div>

        {/* Stat cards — see skills/cloud-app/references/frontend.md § Stats */}
        <StatGrid columns={3}>
          <StatCell
            label="Spaces"
            value={spaces.total}
            sub={search ? "filtered" : "total"}
            accent={{ tone: "blue", icon: "ti ti-layout-kanban" }}
          />
          <StatCell
            label="Orphaned"
            value={orphanedCount}
            sub={orphanedCount > 0 ? "no access" : "all reachable"}
            valueClass={orphanedCount > 0 ? "text-red-500" : "text-primary"}
            accent={orphanedCount > 0 ? { tone: "red", icon: "ti ti-alert-circle" } : undefined}
          />
          <StatCell label="Access entries" value={totalPermissions} sub={search ? "in search" : "across all spaces"} />
        </StatGrid>

        <DataTable.Panel class="min-w-0 [view-transition-name:admin-spaces-table]">
          <DataTable.Header title="Spaces" subtitle={`${spaces.items.length} of ${spaces.total} spaces`} />
          <DataTable.Controls>
            <SearchBar action="/admin/spaces" value={search} placeholder="Search spaces by name..." ariaLabel="Search spaces" />
          </DataTable.Controls>
          <DataTable
            rows={spaces.items}
            columns={columns}
            getRowId={(space) => space.id}
            hoverRows
            class="overflow-x-auto"
            scrollPreserveKey="spaces-admin-table"
            empty={search ? `No spaces matching "${search}".` : "No spaces found."}
            renderCell={({ row: space, col }) => {
              if (col.id === "space") {
                return (
                  <div class="flex min-w-52 items-center gap-2">
                    <span
                      class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] text-white"
                      style={`background-color: ${space.color}`}
                    >
                      <i class="ti ti-layout-kanban" />
                    </span>
                    <span class="truncate font-medium text-primary">{space.name}</span>
                  </div>
                );
              }
              if (col.id === "description") {
                return (
                  <span class="block truncate" title={space.description ?? "No description"}>
                    {space.description || <span class="italic">No description</span>}
                  </span>
                );
              }
              if (col.id === "permissions") {
                return (
                  <StatusBadge
                    tone={space.permissionCount === 0 ? "error" : "neutral"}
                    variant="chip"
                    icon={space.permissionCount === 0 ? "ti ti-lock-off" : "ti ti-users"}
                    label={`${space.permissionCount} access ${space.permissionCount === 1 ? "entry" : "entries"}`}
                  />
                );
              }
              if (col.id === "actions") return <AdminSpaceActions spaceId={space.id} spaceName={space.name} />;
              return "";
            }}
          />
          {totalPages > 1 ? (
            <DataTable.Footer>
              <Pagination currentPage={spaces.page} totalPages={totalPages} baseUrl={baseUrl} />
            </DataTable.Footer>
          ) : null}
        </DataTable.Panel>
      </div>
    </AdminLayout>
  );
});
