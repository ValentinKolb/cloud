import type { AuthContext } from "@valentinkolb/cloud/server";
import { accountsAppService as accountsService, coreSettings } from "@valentinkolb/cloud/services";
import { getDefaultGroupScope, isAdminUser } from "@valentinkolb/cloud/shared";
import { Layout } from "@valentinkolb/cloud/ssr";
import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
import { DataTable, type DataTableColumn, Pagination } from "@valentinkolb/cloud/ui";
import { ssr } from "../../config";
import AccountsWorkspace from "../AccountsWorkspace";
import { getProviderBadge } from "../lib/account-badges";
import { buildGroupDetailUrl, buildGroupsPageBaseUrl, buildGroupsUrl, parseGroupsListState } from "../lib/url-state";
import GroupsScopeFilter from "./GroupsScopeFilter.island";
import NewGroup from "./NewGroup.island";

/** Groups page - nav sidebar + full-page list. */
export default ssr<AuthContext>(async (c) => {
  const sessionUser = c.get("user");
  const isAdmin = isAdminUser(sessionUser);
  const freeIpaEnabled = Boolean(await coreSettings.get<boolean>("freeipa.enable"));
  const perPage = 100;
  const defaultScope = getDefaultGroupScope(sessionUser);
  const listState = parseGroupsListState(
    {
      search: c.req.query("search"),
      page: c.req.query("page"),
      provider: c.req.query("provider"),
      scope: c.req.query("scope"),
    },
    { defaultScope },
  );
  const groupsPage = await accountsService.group.list({
    pagination: { page: listState.page, perPage },
    filter: { search: listState.search || undefined },
    scope: {
      userId: listState.scope === "all" ? undefined : sessionUser.id,
      mode: listState.scope,
      provider: listState.provider || undefined,
    },
  });
  const pendingRequestsPage = isAdmin
    ? await accountsService.accountRequest.list({
        access: { userId: sessionUser.id, isAdmin: true },
        filter: { status: "pending" },
      })
    : { total: 0 };
  const totalPages = Math.max(1, Math.ceil(groupsPage.total / perPage));
  const paginationBaseUrl = buildGroupsPageBaseUrl(
    { search: listState.search, provider: listState.provider, scope: listState.scope },
    { defaultScope },
  );
  type GroupRow = (typeof groupsPage.items)[number];
  const columns: DataTableColumn<GroupRow>[] = [
    { id: "group", header: "Group", value: (group) => group.name },
    { id: "description", header: "Description", value: (group) => group.description, cellClass: "max-w-[22rem]" },
    { id: "managedBy", header: "Managed by", value: (group) => getProviderBadge(group.provider).label },
    { id: "flags", header: "Flags", value: (group) => group.gidnumber },
  ];

  return () => (
    <Layout c={c} fullWidth title={[{ title: "Start", href: "/" }, { title: "Accounts", href: "/app/accounts" }, { title: "Groups" }]}>
      <AccountsWorkspace active="groups" isAdmin={isAdmin} pendingRequests={pendingRequestsPage.total} scrollPreserveKey="accounts-groups">
        <div class="flex flex-col gap-2">
          <div class="min-w-0" style="view-transition-name: accounts-groups-title">
            <h1 class="text-base font-semibold text-primary">Groups</h1>
            <p class="mt-1 text-xs text-dimmed">
              {groupsPage.total} {listState.search ? "results" : "groups"}
            </p>
          </div>

          <div style="view-transition-name: accounts-groups-search">
            <SearchBar action={buildGroupsUrl({ ...listState, page: 1 }, { defaultScope })} value={listState.search} />
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <GroupsScopeFilter state={listState} defaultScope={defaultScope} />
            {isAdmin ? (
              <div class="ml-auto shrink-0 [&>button]:btn-input [&>button]:btn-input-sm">
                <NewGroup freeIpaEnabled={freeIpaEnabled} />
              </div>
            ) : null}
          </div>

          {groupsPage.items.length === 0 ? (
            <div class="paper p-6 text-center text-sm text-dimmed">
              {listState.scope === "managed" && !listState.search
                ? "You do not manage any groups yet."
                : listState.search
                  ? "No groups found."
                  : "No groups available in this view."}
            </div>
          ) : (
            <div class="paper overflow-hidden" style="view-transition-name: accounts-groups-table">
              <DataTable
                rows={groupsPage.items}
                columns={columns}
                getRowId={(group) => group.id}
                hoverRows
                class="overflow-x-auto"
                scrollPreserveKey="accounts-groups-table"
                renderCell={({ row: group, col }) => {
                  const isManaged = sessionUser.managesGroupIds.includes(group.id);
                  const href = buildGroupDetailUrl(group.id, listState, { defaultScope });
                  if (col.id === "group") {
                    return (
                      <a href={href} class="flex items-center gap-2 truncate font-medium text-primary hover:underline">
                        <i class={`ti shrink-0 text-sm ${isManaged ? "ti-user-edit text-blue-500" : "ti-users-group text-dimmed"}`} />
                        <span class="truncate">{group.name}</span>
                      </a>
                    );
                  }
                  if (col.id === "description") {
                    return (
                      <a href={href} class="block truncate text-dimmed" title={group.description || "No description"} tabindex={-1}>
                        {group.description || <span class="italic">No description</span>}
                      </a>
                    );
                  }
                  if (col.id === "managedBy") {
                    const providerBadge = getProviderBadge(group.provider);
                    return (
                      <a href={href} class="block" tabindex={-1}>
                        <span class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${providerBadge.className}`}>
                          {providerBadge.label}
                        </span>
                      </a>
                    );
                  }
                  if (col.id === "flags") {
                    return (
                      <a href={href} class="block" tabindex={-1}>
                        <div class="flex flex-wrap gap-1">
                          {isManaged ? (
                            <span class="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                              Managed
                            </span>
                          ) : null}
                          {group.gidnumber ? (
                            <span class="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                              POSIX
                            </span>
                          ) : null}
                          {!isManaged && !group.gidnumber ? <span class="text-dimmed">-</span> : null}
                        </div>
                      </a>
                    );
                  }
                  return "";
                }}
              />
            </div>
          )}

          <div class="pt-1">
            <Pagination currentPage={listState.page} totalPages={totalPages} baseUrl={paginationBaseUrl} />
          </div>
        </div>
      </AccountsWorkspace>
    </Layout>
  );
});
