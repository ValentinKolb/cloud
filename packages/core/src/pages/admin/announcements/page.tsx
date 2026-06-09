import type { AnnouncementEntry } from "@valentinkolb/cloud/contracts";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { announcements } from "@valentinkolb/cloud/services";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import { DataTable, type DataTableColumn, StatCell, StatGrid } from "@valentinkolb/cloud/ui";
import { ssr } from "../../../config";
import AnnouncementActions from "./AnnouncementActions.island";

const fmtDate = (value: string | null) => (value ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");

const stateLabel = (entry: AnnouncementEntry) => {
  const now = Date.now();
  const published = new Date(entry.publishedAt).getTime();
  const expires = entry.expiresAt ? new Date(entry.expiresAt).getTime() : null;
  if (published > now) return { label: "Scheduled", class: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" };
  if (expires && expires <= now) return { label: "Expired", class: "bg-zinc-100 text-dimmed dark:bg-zinc-800" };
  return { label: "Active", class: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" };
};

export default ssr<AuthContext>(async (c) => {
  const items = await announcements.admin.list();
  const active = items.filter((item) => stateLabel(item).label === "Active").length;
  const scheduled = items.filter((item) => stateLabel(item).label === "Scheduled").length;
  const banners = items.filter((item) => item.kind === "banner").length;

  const columns: DataTableColumn<AnnouncementEntry>[] = [
    { id: "title", header: "Title", value: (entry) => entry.title },
    { id: "kind", header: "Type", value: (entry) => entry.kind },
    { id: "version", header: "Version", value: (entry) => entry.version, headerClass: "text-right", cellClass: "text-right tabular-nums" },
    { id: "state", header: "State", value: (entry) => stateLabel(entry).label },
    { id: "published", header: "Published", value: (entry) => entry.publishedAt, cellClass: "whitespace-nowrap" },
    { id: "expires", header: "Expires", value: (entry) => entry.expiresAt, cellClass: "whitespace-nowrap" },
    {
      id: "actions",
      header: <span class="sr-only">Actions</span>,
      headerClass: "w-px text-right",
      cellClass: "text-right whitespace-nowrap",
    },
  ];

  return () => (
    <AdminLayout c={c} title="Announcements" stretch>
      <div class="flex-1 min-h-0 overflow-y-auto">
        <div class="flex flex-col gap-2">
          <div class="flex flex-wrap items-center justify-between gap-3" style="view-transition-name: admin-announcements-title">
            <div class="min-w-0">
              <h1 class="text-base font-semibold text-primary">Announcements</h1>
              <p class="mt-1 text-xs text-dimmed">Platform announcements and dismissible banners rendered through the shared layout.</p>
            </div>
            <AnnouncementActions mode="create" />
          </div>

          <StatGrid columns={4}>
            <StatCell label="Entries" value={items.length} sub="total" accent={{ tone: "blue", icon: "ti ti-speakerphone" }} />
            <StatCell label="Active" value={active} sub="visible now" accent={{ tone: "emerald", icon: "ti ti-circle-check" }} />
            <StatCell label="Scheduled" value={scheduled} sub="future publish" />
            <StatCell label="Banners" value={banners} sub="dismissible" />
          </StatGrid>

          {items.length > 0 ? (
            <section class="paper overflow-hidden" style="view-transition-name: admin-announcements-table">
              <DataTable
                rows={items}
                columns={columns}
                getRowId={(entry) => entry.id}
                hoverRows
                class="overflow-x-auto"
                renderCell={({ row: entry, col }) => {
                  if (col.id === "title") {
                    return (
                      <div class="flex min-w-56 items-center gap-2">
                        <i class={entry.kind === "banner" ? "ti ti-message text-dimmed" : "ti ti-speakerphone text-dimmed"} />
                        <div class="min-w-0">
                          <p class="truncate font-medium text-primary">{entry.title}</p>
                          <p class="truncate text-[10px] text-dimmed">{entry.body}</p>
                        </div>
                      </div>
                    );
                  }
                  if (col.id === "kind") return <span class="capitalize text-xs text-secondary">{entry.kind}</span>;
                  if (col.id === "version") return <span class="text-xs text-secondary">v{entry.version}</span>;
                  if (col.id === "state") {
                    const state = stateLabel(entry);
                    return <span class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${state.class}`}>{state.label}</span>;
                  }
                  if (col.id === "published") return <span class="text-xs text-dimmed">{fmtDate(entry.publishedAt)}</span>;
                  if (col.id === "expires") return <span class="text-xs text-dimmed">{fmtDate(entry.expiresAt)}</span>;
                  if (col.id === "actions") return <AnnouncementActions mode="row" entry={entry} />;
                  return "";
                }}
              />
            </section>
          ) : (
            <section class="paper p-6 text-center text-sm text-dimmed">
              No announcements yet. Create an announcement or banner to show it through the shared layout.
            </section>
          )}
        </div>
      </div>
    </AdminLayout>
  );
});
