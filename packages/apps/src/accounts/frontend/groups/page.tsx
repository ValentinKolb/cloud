import { ssr } from "@valentinkolb/cloud/core/config";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import { Layout } from "@valentinkolb/cloud/core/ssr";
import { Pagination } from "@valentinkolb/cloud/lib/ui";
import { SearchBar } from "@valentinkolb/cloud/lib/islands";
import { hasRole } from "@/accounts/contracts";
import NewGroup from "./NewGroup.island";
import { accountsService } from "../../service";
import {
  buildGroupDetailUrl,
  buildGroupsUrl,
  buildGroupsPageBaseUrl,
  parseGroupsListState,
} from "../lib/url-state";
import AccountsNavSidebar from "../AccountsNavSidebar";

/** Groups page - nav sidebar + full-page list. */
export default ssr<AuthContext>(async (c) => {
  const sessionUser = c.get("user");
  const isAdmin = hasRole(sessionUser, "admin");
  const perPage = 40;
  const listState = parseGroupsListState(
    { search: c.req.query("search"), page: c.req.query("page"), showAll: c.req.query("show_all") },
    { defaultShowAll: isAdmin },
  );
  const groupsPage = await accountsService.group.list({
    pagination: { page: listState.page, perPage },
    filter: { search: listState.search || undefined },
    scope: { userId: listState.showAll ? undefined : sessionUser.id },
  });
  const pendingRequestsPage = isAdmin
    ? await accountsService.accountRequest.list({
        access: { userId: sessionUser.id, isAdmin: true },
        filter: { status: "pending" },
      })
    : { total: 0 };
  const totalPages = Math.max(1, Math.ceil(groupsPage.total / perPage));
  const paginationBaseUrl = buildGroupsPageBaseUrl(
    { search: listState.search, showAll: listState.showAll },
    { defaultShowAll: isAdmin },
  );

  return (
    <Layout c={c} fullWidth title={[{ title: "Start", href: "/" }, { title: "Accounts", href: "/app/accounts" }, { title: "Groups" }]}>
      <div class="app-cols h-full">
        <AccountsNavSidebar active="groups" isAdmin={isAdmin} pendingRequests={pendingRequestsPage.total} />

        <div class="flex-1 min-w-0 min-h-0 overflow-y-auto p-4">
          <div class="flex flex-col gap-3">
            <div class="flex items-center gap-2">
              <div class="flex-1 min-w-0">
                <SearchBar action={buildGroupsUrl({ ...listState, page: 1 }, { defaultShowAll: isAdmin })} value={listState.search} />
              </div>
              <a
                href={buildGroupsUrl({ ...listState, page: 1, showAll: !listState.showAll }, { defaultShowAll: isAdmin })}
                class="btn-secondary btn-sm shrink-0"
                title={listState.showAll ? "Show my groups" : "Show all groups"}
              >
                <i class="ti ti-filter" />
                {listState.showAll ? "Mine" : "All"}
              </a>
              {isAdmin && (
                <div class="shrink-0 [&>button]:btn-sm">
                  <NewGroup />
                </div>
              )}
            </div>

            <p class="text-xs text-dimmed">
              {listState.search
                ? `${groupsPage.total} result${groupsPage.total !== 1 ? "s" : ""}`
                : `${groupsPage.total} groups`}
            </p>

            {groupsPage.items.length === 0 ? (
              <div class="paper p-6 text-center text-sm text-dimmed">No groups found.</div>
            ) : (
              <div class="flex flex-col gap-2">
                {groupsPage.items.map((group) => {
                  const isManaged = sessionUser.manages.includes(group.cn);
                  return (
                    <a href={buildGroupDetailUrl(group.cn, listState, { defaultShowAll: isAdmin })} class="sidebar-item sidebar-item-tall">
                      <i class={`ti text-sm ${isManaged ? "ti-user-edit text-blue-500" : "ti-users-group"}`} />
                      <div class="min-w-0 flex-1">
                        <p class="truncate text-xs font-medium text-primary">{group.cn}</p>
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
