import { ssr } from "@valentinkolb/cloud/core/config";
import { accountsAppService as accountsService } from "@valentinkolb/cloud/core/services";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import { Layout } from "@valentinkolb/cloud/core/ssr";
import { Pagination } from "@valentinkolb/cloud/lib/ui";
import { SearchBar } from "@valentinkolb/cloud/lib/islands";
import { buildUserDetailUrl, buildUsersPageBaseUrl, buildUsersUrl, parseUsersListState } from "../lib/url-state";
import AccountsNavSidebar from "../AccountsNavSidebar";
import { getManagementBadge, getPrimaryAccountBadge, getSupplementalRoleColor, getSupplementalRoles } from "../lib/account-badges";
import UsersFilters from "./UsersFilters.island";
import CreateUserForm from "./new/CreateUserForm.island";
import { getSync } from "@valentinkolb/cloud-core/services/settings";

/** Admin users list page - nav sidebar + full-page list. */
export default ssr<AuthContext>(async (c) => {
  const perPage = 40;
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

        <div class="flex-1 min-w-0 min-h-0 overflow-y-auto p-4">
          <div class="flex flex-col gap-3">
            <div class="flex items-center justify-between gap-2">
              <div class="flex-1 min-w-0">
                <SearchBar
                  action={buildUsersUrl({
                    ...listState,
                    search: "",
                    page: 1,
                  })}
                  value={listState.search}
                />
              </div>
              <CreateUserForm buttonClass="btn-input btn-input-sm shrink-0" freeIpaEnabled={freeIpaEnabled} />
            </div>

            <UsersFilters state={listState} />

            <p class="text-xs text-dimmed">
              {listState.search ? `${usersPage.total} result${usersPage.total !== 1 ? "s" : ""}` : `${usersPage.total} users`}
            </p>

            {usersPage.items.length === 0 ? (
              <div class="paper p-6 text-center text-sm text-dimmed">No users found.</div>
            ) : (
              <div class="flex flex-col gap-2">
                {usersPage.items.map((entry) => (
                  <a href={buildUserDetailUrl(entry.id, listState)} class="sidebar-item sidebar-item-tall">
                    <div class="min-w-0 flex-1">
                      <p class="truncate text-xs font-medium text-primary">
                        {(entry.displayName || entry.mail || entry.uid) + ` (${entry.uid})`}
                      </p>
                      {entry.mail && <p class="sidebar-item-meta truncate">{entry.mail}</p>}
                    </div>
                    <div class="flex items-center gap-1 shrink-0">
                      {(() => {
                        const badge = getPrimaryAccountBadge(entry);
                        return <span class={`text-[9px] px-1 py-px rounded ${badge.className}`}>{badge.label}</span>;
                      })()}
                      {(() => {
                        const badge = getManagementBadge(entry);
                        return <span class={`text-[9px] px-1 py-px rounded ${badge.className}`}>{badge.label}</span>;
                      })()}
                      {getSupplementalRoles(entry).map((role) => (
                        <span class={`text-[9px] px-1 py-px rounded ${getSupplementalRoleColor(role)}`}>{role}</span>
                      ))}
                    </div>
                  </a>
                ))}
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
