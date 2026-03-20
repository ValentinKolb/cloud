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
  const perPage = 100;
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
    <AdminLayout c={c} title="Hosts" fullHeight>
      <div class="flex-1 min-h-0 overflow-y-auto">
        <div class="flex flex-col gap-2">
          <div class="min-w-0" style="view-transition-name: admin-hosts-title">
            <h1 class="text-base font-semibold text-primary">Hosts</h1>
            <p class="mt-1 text-xs text-dimmed">
              {total} {total === 1 ? "hostgroup" : "hostgroups"}
            </p>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <div class="min-w-0 flex-1">
              <SearchBar action="/admin/ipa-hosts" value={search} placeholder="Search hostgroups and hosts..." ariaLabel="Search hostgroups and hosts" />
            </div>
            <SyncHosts />
            <HostSettings />
            <NewHostgroup />
          </div>

          {ungroupedHostsPage.total > 0 || search ? (
            <section class="paper overflow-hidden" style="view-transition-name: admin-hosts-ungrouped">
              <div class="border-b border-zinc-200 bg-zinc-50/80 px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-800/40">
                <div class="flex items-center gap-3">
                  <i class="ti ti-server-off shrink-0 text-lg text-amber-500" />
                  <div class="min-w-0 flex-1">
                    <div class="text-sm font-semibold text-primary">Ungrouped hosts</div>
                    <div class="text-xs text-dimmed">
                      {ungroupedHostsPage.total} {ungroupedHostsPage.total === 1 ? "host" : "hosts"} without any hostgroup membership
                    </div>
                  </div>
                </div>
              </div>
              <HostsTable
                hosts={ungroupedHostsPage.items}
                emptyMessage={search ? `No ungrouped hosts matching "${search}".` : "No mirrored hosts without a hostgroup membership."}
              />
              {ungroupedPagination.total_pages > 1 ? (
                <div class="border-t border-zinc-200 px-3 py-3 dark:border-zinc-700">
                  <Pagination currentPage={ungroupedPagination.page} totalPages={ungroupedPagination.total_pages} baseUrl={buildBaseUrl("ungrouped_page")} />
                </div>
              ) : null}
            </section>
          ) : null}

          {hostgroups.length > 0 ? (
            <>
              {hostgroups.map((hostgroup) => (
                <HostgroupCard hostgroup={hostgroup} hosts={hostgroup.hostDetails} />
              ))}
              <Pagination currentPage={pagination.page} totalPages={pagination.total_pages} baseUrl={buildBaseUrl("page")} />
            </>
          ) : (
            <section class="paper p-6 text-center text-sm text-dimmed">
              {search ? `No hostgroups matching "${search}".` : "No mirrored hostgroups yet. Run a sync to load data from FreeIPA."}
            </section>
          )}
        </div>
      </div>
    </AdminLayout>
  );
});
