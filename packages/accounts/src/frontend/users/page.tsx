import type { AuthContext } from "@valentinkolb/cloud/server";
import { accountsAppService as accountsService, coreSettings } from "@valentinkolb/cloud/services";
import { Layout } from "@valentinkolb/cloud/ssr";
import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
import { DataTable, type DataTableColumn, Pagination, Placeholder } from "@valentinkolb/cloud/ui";
import { expectUserBackedActor } from "@/shared/actor";
import { ssr } from "../../config";
import AccountsWorkspace from "../AccountsWorkspace";
import { getManagementBadge, getPrimaryAccountBadge } from "../lib/account-badges";
import { buildUserDetailUrl, buildUsersPageBaseUrl, buildUsersUrl, parseUsersListState } from "../lib/url-state";
import CreateUserForm from "./new/CreateUserForm.island";
import UsersFilters from "./UsersFilters.island";

/** Admin users list page - nav sidebar + full-page list. */
export default ssr<AuthContext>(async (c) => {
  const perPage = 100;
  const user = expectUserBackedActor(c);
  const freeIpaEnabled = Boolean(await coreSettings.get<boolean>("freeipa.enable"));
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
  type UserRow = (typeof usersPage.items)[number];
  const columns: DataTableColumn<UserRow>[] = [
    { id: "user", header: "User", value: (entry) => entry.displayName || entry.mail || entry.uid },
    { id: "email", header: "Email", value: (entry) => entry.mail, cellClass: "max-w-[18rem]" },
    { id: "managedBy", header: "Managed by", value: (entry) => getManagementBadge(entry).label },
    { id: "access", header: "Access", value: (entry) => getPrimaryAccountBadge(entry).label },
  ];

  return () => (
    <Layout c={c} fullWidth title={[{ title: "Start", href: "/" }, { title: "Accounts", href: "/app/accounts" }, { title: "Users" }]}>
      <AccountsWorkspace active="users" isAdmin={true} pendingRequests={pendingRequestsPage.total} scrollPreserveKey="accounts-users">
        <div class="flex flex-col gap-2">
          <div class="min-w-0" style="view-transition-name: accounts-users-title">
            <h1 class="text-base font-semibold text-primary">Users</h1>
            <p class="mt-1 text-xs text-dimmed">
              {usersPage.total} {listState.search ? "results" : "users"}
            </p>
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
            <Placeholder surface="paper">No users found.</Placeholder>
          ) : (
            <div class="paper overflow-hidden" style="view-transition-name: accounts-users-table">
              <DataTable
                rows={usersPage.items}
                columns={columns}
                getRowId={(entry) => entry.id}
                hoverRows
                class="overflow-x-auto"
                scrollPreserveKey="accounts-users-table"
                renderCell={({ row: entry, col }) => {
                  const href = buildUserDetailUrl(entry.id, listState);
                  if (col.id === "user") {
                    return (
                      <a href={href} class="block truncate font-medium text-primary hover:underline">
                        {(entry.displayName || entry.mail || entry.uid) + ` (${entry.uid})`}
                      </a>
                    );
                  }
                  if (col.id === "email") {
                    return (
                      <a href={href} class="block truncate text-dimmed" title={entry.mail || "-"} tabindex={-1}>
                        {entry.mail || "-"}
                      </a>
                    );
                  }
                  if (col.id === "managedBy") {
                    const managementBadge = getManagementBadge(entry);
                    return (
                      <a href={href} class="block" tabindex={-1}>
                        <span class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${managementBadge.className}`}>
                          {managementBadge.label}
                        </span>
                      </a>
                    );
                  }
                  if (col.id === "access") {
                    const primaryBadge = getPrimaryAccountBadge(entry);
                    return (
                      <a href={href} class="block" tabindex={-1}>
                        <span class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${primaryBadge.className}`}>{primaryBadge.label}</span>
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
