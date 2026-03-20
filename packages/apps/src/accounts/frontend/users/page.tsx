import { ssr } from "@valentinkolb/cloud/core/config";
import { accountsAppService as accountsService } from "@valentinkolb/cloud/core/services";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import { Layout } from "@valentinkolb/cloud/core/ssr";
import { Pagination } from "@valentinkolb/cloud/lib/ui";
import { SearchBar } from "@valentinkolb/cloud/lib/islands";
import { buildUserDetailUrl, buildUsersPageBaseUrl, buildUsersUrl, parseUsersListState } from "../lib/url-state";
import AccountsNavSidebar from "../AccountsNavSidebar";
import { getManagementBadge, getPrimaryAccountBadge } from "../lib/account-badges";
import UsersFilters from "./UsersFilters.island";
import CreateUserForm from "./new/CreateUserForm.island";
import { getSync } from "@valentinkolb/cloud-core/services/settings";

/** Admin users list page - nav sidebar + full-page list. */
export default ssr<AuthContext>(async (c) => {
  const perPage = 100;
  const user = c.get("user");
  const freeIpaEnabled = Boolean(getSync<boolean>("freeipa.enable"));
  const listState = parseUsersListState({
    search: c.req.query("search"),
    page: c.req.query("page"),
    provider: c.req.query("provider"),
    profile: c.req.query("profile"),
  });
  const [pendingRequestsPage, usersPage] = await Promise.all([
    accountsService.accountRequest.list({ access: { userId: user.id, isAdmin: true }, filter: { status: "pending" } }),
    accountsService.user.list({
      pagination: { page: listState.page, perPage },
      filter: { search: listState.search || undefined },
      scope: {
        provider: listState.provider || undefined,
        profile: listState.profile || undefined,
      },
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(usersPage.total / perPage));
  const paginationBaseUrl = buildUsersPageBaseUrl({
    search: listState.search,
    provider: listState.provider,
    profile: listState.profile,
  });

  return (
    <Layout c={c} fullWidth title={[{ title: "Start", href: "/" }, { title: "Accounts", href: "/app/accounts" }, { title: "Users" }]}>
      <div class="app-cols h-full">
        <AccountsNavSidebar active="users" isAdmin={true} pendingRequests={pendingRequestsPage.total} />

        <div class="flex-1 min-w-0 min-h-0 overflow-y-auto">
          <div class="flex flex-col gap-2">
            <div class="min-w-0" style="view-transition-name: accounts-users-title">
              <h1 class="text-base font-semibold text-primary">Users</h1>
              <p class="mt-1 text-xs text-dimmed">{usersPage.total} {listState.search ? "results" : "users"}</p>
            </div>

            <div style="view-transition-name: accounts-users-search">
              <SearchBar
                action={buildUsersUrl({
                  ...listState,
                  search: "",
                  page: 1,
                })}
                value={listState.search}
              />
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <UsersFilters state={listState} />
              <div class="ml-auto">
                <CreateUserForm buttonClass="btn-input btn-input-sm shrink-0" freeIpaEnabled={freeIpaEnabled} />
              </div>
            </div>

            {usersPage.items.length === 0 ? (
              <div class="paper p-6 text-center text-sm text-dimmed">No users found.</div>
            ) : (
              <div class="paper overflow-hidden" style="view-transition-name: accounts-users-table">
                <div class="overflow-x-auto">
                  <table class="w-full text-xs">
                    <thead>
                      <tr class="border-b border-zinc-100 dark:border-zinc-800">
                        <th class="px-3 py-2 text-left font-medium text-dimmed">User</th>
                        <th class="px-3 py-2 text-left font-medium text-dimmed">Email</th>
                        <th class="px-3 py-2 text-left font-medium text-dimmed">Managed by</th>
                        <th class="px-3 py-2 text-left font-medium text-dimmed">Access</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usersPage.items.map((entry) => {
                        const primaryBadge = getPrimaryAccountBadge(entry);
                        const managementBadge = getManagementBadge(entry);
                        const href = buildUserDetailUrl(entry.id, listState);
                        return (
                          <tr class="group border-b border-zinc-50 transition-colors hover:bg-zinc-50 dark:border-zinc-800/50 dark:hover:bg-zinc-800/30">
                            <td class="p-0">
                              <a href={href} class="block truncate px-3 py-1.5 font-medium text-primary group-hover:underline">
                                {(entry.displayName || entry.mail || entry.uid) + ` (${entry.uid})`}
                              </a>
                            </td>
                            <td class="max-w-[18rem] p-0 text-dimmed">
                              <a href={href} class="block truncate px-3 py-1.5" title={entry.mail || "-"} tabindex={-1}>
                                {entry.mail || "-"}
                              </a>
                            </td>
                            <td class="p-0">
                              <a href={href} class="block px-3 py-1.5" tabindex={-1}>
                                <span class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${managementBadge.className}`}>{managementBadge.label}</span>
                              </a>
                            </td>
                            <td class="p-0">
                              <a href={href} class="block px-3 py-1.5" tabindex={-1}>
                                <span class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${primaryBadge.className}`}>{primaryBadge.label}</span>
                              </a>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
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
