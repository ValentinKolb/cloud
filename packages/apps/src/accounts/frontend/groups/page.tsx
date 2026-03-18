import { ssr } from "@valentinkolb/cloud/core/config";
import { accountsAppService as accountsService } from "@valentinkolb/cloud/core/services";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import { Layout } from "@valentinkolb/cloud/core/ssr";
import { getSync } from "@valentinkolb/cloud-core/services/settings";
import { getDefaultGroupScope, isAdminUser } from "@valentinkolb/cloud/lib/shared";
import { Pagination } from "@valentinkolb/cloud/lib/ui";
import { SearchBar } from "@valentinkolb/cloud/lib/islands";
import NewGroup from "./NewGroup.island";
import GroupsScopeFilter from "./GroupsScopeFilter.island";
import {
  buildGroupDetailUrl,
  buildGroupsUrl,
  buildGroupsPageBaseUrl,
  parseGroupsListState,
} from "../lib/url-state";
import AccountsNavSidebar from "../AccountsNavSidebar";
import { getProviderBadge } from "../lib/account-badges";

/** Groups page - nav sidebar + full-page list. */
export default ssr<AuthContext>(async (c) => {
  const sessionUser = c.get("user");
  const isAdmin = isAdminUser(sessionUser);
  const freeIpaEnabled = Boolean(getSync<boolean>("freeipa.enable"));
  const perPage = 40;
  const defaultScope = getDefaultGroupScope(sessionUser);
  const listState = parseGroupsListState(
    {
      search: c.req.query("search"),
      page: c.req.query("page"),
      provider: c.req.query("provider"),
      scope: c.req.query("scope"),
      showAll: c.req.query("show_all"),
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

  return (
    <Layout c={c} fullWidth title={[{ title: "Start", href: "/" }, { title: "Accounts", href: "/app/accounts" }, { title: "Groups" }]}>
      <div class="app-cols h-full">
        <AccountsNavSidebar active="groups" isAdmin={isAdmin} pendingRequests={pendingRequestsPage.total} />

        <div class="flex-1 min-w-0 min-h-0 overflow-y-auto p-4">
          <div class="flex flex-col gap-3">
            <div class="flex items-center gap-2">
              <div class="flex-1 min-w-0">
                <SearchBar action={buildGroupsUrl({ ...listState, page: 1 }, { defaultScope })} value={listState.search} />
              </div>
              <GroupsScopeFilter state={listState} defaultScope={defaultScope} />
              {isAdmin && (
                <div class="shrink-0 [&>button]:btn-sm">
                  <NewGroup freeIpaEnabled={freeIpaEnabled} />
                </div>
              )}
            </div>

            <p class="text-xs text-dimmed">
              {listState.search
                ? `${groupsPage.total} result${groupsPage.total !== 1 ? "s" : ""}`
                : `${groupsPage.total} groups`}
            </p>

            {groupsPage.items.length === 0 ? (
              <div class="paper p-6 text-center text-sm text-dimmed">
                {listState.scope === "managed" && !listState.search
                  ? "You do not manage any groups yet."
                  : listState.search
                    ? "No groups found."
                    : "No groups available in this view."}
              </div>
            ) : (
              <div class="flex flex-col gap-2">
                {groupsPage.items.map((group) => {
                  const isManaged = sessionUser.managesGroupIds.includes(group.id);
                  const providerBadge = getProviderBadge(group.provider);
                  return (
                    <a href={buildGroupDetailUrl(group.id, listState, { defaultScope })} class="sidebar-item sidebar-item-tall">
                      <i class={`ti text-sm ${isManaged ? "ti-user-edit text-blue-500" : "ti-users-group"}`} />
                      <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-1.5">
                          <p class="truncate text-xs font-medium text-primary">{group.name}</p>
                          <span class={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${providerBadge.className}`}>
                            {providerBadge.label}
                          </span>
                        </div>
                        <p class="sidebar-item-meta truncate">{group.description || "No description"}</p>
                      </div>
                      {group.gidnumber ? (
                        <span class="text-[9px] px-1 py-px rounded shrink-0 bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300">
                          POSIX
                        </span>
                      ) : null}
                    </a>
                  );
                })}
              </div>
            )}

            <div class="pt-1">
              <Pagination currentPage={listState.page} totalPages={totalPages} baseUrl={paginationBaseUrl} />
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
});
