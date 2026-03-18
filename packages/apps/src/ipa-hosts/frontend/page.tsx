import { ssr } from "@valentinkolb/cloud/core/config";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import { AdminLayout } from "@valentinkolb/cloud/core/ssr";
import { Pagination } from "@valentinkolb/cloud/lib/ui";
import { SearchBar } from "@valentinkolb/cloud/lib/islands";
import NewHostgroup from "./NewHostgroup.island";
import HostgroupCard from "./HostgroupCard";
import HostsTable from "./HostsTable";
import HostSettings from "./HostSettings.island";
import SyncHosts from "./SyncHosts.island";
import { createPagination } from "../contracts";
import { ipaHostsService } from "../service";

export default ssr<AuthContext>(async (c) => {
  const rawPage = Number(c.req.query("page") ?? "1");
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const rawUngroupedPage = Number(c.req.query("ungrouped_page") ?? "1");
  const ungroupedPage = Number.isInteger(rawUngroupedPage) && rawUngroupedPage > 0 ? rawUngroupedPage : 1;
  const perPage = 20;
  const search = c.req.query("search") ?? "";

  const [hostgroupsPage, ungroupedHostsPage] = await Promise.all([
    ipaHostsService.hostgroup.listWithHosts({
      pagination: { page, perPage },
      filter: { query: search || undefined },
    }),
    ipaHostsService.host.listUngrouped({
      pagination: { page: ungroupedPage, perPage },
      filter: { query: search || undefined },
    }),
  ]);
  const hostgroups = hostgroupsPage.items;
  const total = hostgroupsPage.total;
  const pagination = createPagination({ page, perPage, offset: (page - 1) * perPage }, total);
  const ungroupedPagination = createPagination(
    { page: ungroupedPage, perPage, offset: (ungroupedPage - 1) * perPage },
    ungroupedHostsPage.total,
  );

  const buildBaseUrl = (pageParam: "page" | "ungrouped_page") => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (pageParam === "page" && ungroupedPage > 1) params.set("ungrouped_page", String(ungroupedPage));
    if (pageParam === "ungrouped_page" && page > 1) params.set("page", String(page));
    const prefix = params.toString();
    return prefix ? `/admin/ipa-hosts?${prefix}&${pageParam}=` : `/admin/ipa-hosts?${pageParam}=`;
  };

  return (
    <AdminLayout c={c} title="Hosts">
      <div class="max-w-6xl mx-auto flex flex-col gap-4">
        <div class="flex items-center justify-between gap-4">
          <div>
            <h1 class="text-lg font-semibold text-primary">Hosts</h1>
            <p class="text-xs text-dimmed">
              {total} {total === 1 ? "hostgroup" : "hostgroups"}
            </p>
          </div>
          <div class="flex items-center gap-2">
            <SyncHosts />
            <HostSettings />
            <NewHostgroup />
          </div>
        </div>

        <div class="info-block-info p-4 text-xs flex items-start gap-2">
          <i class="ti ti-info-circle shrink-0 mt-0.5" />
          <div class="flex flex-col gap-1">
            <p>FreeIPA is the source of truth for hosts and hostgroups. Local data is only a mirror used for the app.</p>
            <p>If this page is empty after deploy, run a sync or wait for the next scheduled sync to rebuild the mirror.</p>
          </div>
        </div>

        <SearchBar placeholder="Search hostgroups and hosts..." ariaLabel="Search hostgroups and hosts" />

        {(ungroupedHostsPage.total > 0 || search) && (
          <div class="paper overflow-hidden">
            <div class="border-b border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800/50">
              <div class="flex items-center gap-3">
                <i class="ti ti-server-off text-lg text-amber-500 shrink-0" />
                <div class="flex-1 min-w-0">
                  <div class="font-semibold text-sm text-primary">Ungrouped hosts</div>
                  <div class="text-xs text-dimmed">
                    {ungroupedHostsPage.total} {ungroupedHostsPage.total === 1 ? "host" : "hosts"} without any hostgroup membership
                  </div>
                </div>
              </div>
            </div>
            <HostsTable
              hosts={ungroupedHostsPage.items}
              emptyMessage={
                search
                  ? `No ungrouped hosts matching "${search}".`
                  : "No mirrored hosts without a hostgroup membership."
              }
            />
            {ungroupedPagination.total_pages > 1 && (
              <div class="border-t border-zinc-200 px-4 py-3 dark:border-zinc-700">
                <Pagination
                  currentPage={ungroupedPagination.page}
                  totalPages={ungroupedPagination.total_pages}
                  baseUrl={buildBaseUrl("ungrouped_page")}
                />
              </div>
            )}
          </div>
        )}

        {hostgroups.length > 0 ? (
          <>
            {hostgroups.map((hg) => (
              <HostgroupCard hostgroup={hg} hosts={hg.hostDetails} />
            ))}
            <Pagination currentPage={pagination.page} totalPages={pagination.total_pages} baseUrl={buildBaseUrl("page")} />
          </>
        ) : (
          <div class="paper p-6 text-center text-sm text-dimmed">
            {search ? `No hostgroups matching "${search}".` : "No mirrored hostgroups yet. Run a sync to load data from FreeIPA."}
          </div>
        )}
      </div>
    </AdminLayout>
  );
});
