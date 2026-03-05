import { ssr } from "@valentinkolb/cloud/core/config";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import { Layout } from "@valentinkolb/cloud/core/ssr";
import { Pagination } from "@valentinkolb/cloud/lib/ui";
import { SearchBar } from "@valentinkolb/cloud/lib/islands";
import { accountsService } from "../../service";
import { buildUserDetailUrl, buildUsersPageBaseUrl, parseUsersListState } from "../lib/url-state";
import AccountsNavSidebar from "../AccountsNavSidebar";

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300",
  ipa: "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300",
  "ipa-limited": "bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300",
  "group-manager": "bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300",
  guest: "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300",
};

/** Admin users list page - nav sidebar + full-page list. */
export default ssr<AuthContext>(async (c) => {
  const perPage = 40;
  const user = c.get("user");
  const listState = parseUsersListState({ search: c.req.query("search"), page: c.req.query("page") });
  const [pendingRequestsPage, usersPage] = await Promise.all([
    accountsService.accountRequest.list({ access: { userId: user.id, isAdmin: true }, filter: { status: "pending" } }),
    accountsService.user.list({ pagination: { page: listState.page, perPage }, filter: { search: listState.search || undefined } }),
  ]);
  const totalPages = Math.max(1, Math.ceil(usersPage.total / perPage));
  const paginationBaseUrl = buildUsersPageBaseUrl({ search: listState.search });

  return (
    <Layout c={c} fullWidth title={[{ title: "Start", href: "/" }, { title: "Accounts", href: "/app/accounts" }, { title: "Users" }]}>
      <div class="app-cols h-full">
        <AccountsNavSidebar active="users" isAdmin={true} pendingRequests={pendingRequestsPage.total} />

        <div class="flex-1 min-w-0 min-h-0 overflow-y-auto p-4">
          <div class="flex flex-col gap-3">
            <div class="flex items-center justify-between gap-2">
              <div class="flex-1 min-w-0">
                <SearchBar action="/app/accounts/users" value={listState.search} />
              </div>
              <a href="/app/accounts/users/new" class="btn-secondary btn-sm shrink-0">
                <i class="ti ti-plus" />
                New User
              </a>
            </div>

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
                      {entry.roles.map((role) => (
                        <span class={`text-[9px] px-1 py-px rounded ${ROLE_COLORS[role] ?? ROLE_COLORS.guest}`}>{role}</span>
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
