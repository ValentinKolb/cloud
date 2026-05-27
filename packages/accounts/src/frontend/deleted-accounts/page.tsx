import { ssr } from "../../config";
import { accountsAppService as accountsService } from "@valentinkolb/cloud/services";
import { Layout } from "@valentinkolb/cloud/ssr";
import { dates } from "@valentinkolb/stdlib";
import { DataTable, Pagination, type DataTableColumn } from "@valentinkolb/cloud/ui";
import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
import type { AuthContext } from "@valentinkolb/cloud/server";
import AccountsNavSidebar from "../AccountsNavSidebar";
import DeletedAccountsFilters from "./DeletedAccountsFilters.island";
import DeletedAccountDetails from "./DeletedAccountDetails.island";

const formatReason = (reason: string): string => {
  switch (reason) {
    case "ipa_expired_demoted":
      return "IPA expired demotion";
    case "ipa_expired_deleted":
      return "IPA expired deletion";
    case "sync_out_of_scope_demoted":
      return "Sync out-of-scope demotion";
    case "sync_out_of_scope_deleted":
      return "Sync out-of-scope deletion";
    case "guest_expired_deleted":
      return "Expired guest cleanup";
    case "local_user_expired_deleted":
      return "Expired local user cleanup";
    case "manual_demote":
      return "Manual demotion";
    case "manual_delete":
      return "Manual deletion";
    default:
      return reason;
  }
};

const parsePage = (value: string | undefined): number => {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const buildUrl = (params: { search?: string; reason?: string; page?: number }) => {
  const query = new URLSearchParams();
  if (params.search?.trim()) query.set("search", params.search.trim());
  if (params.reason?.trim()) query.set("reason", params.reason.trim());
  if (params.page && params.page > 1) query.set("page", String(params.page));
  const search = query.toString();
  return search ? `/app/accounts/deleted-accounts?${search}` : "/app/accounts/deleted-accounts";
};

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const page = parsePage(c.req.query("page"));
  const perPage = 100;
  const search = (c.req.query("search") ?? "").trim();
  const reason = (c.req.query("reason") ?? "").trim();

  const [pendingRequestsPage, deletedAccountsPage] = await Promise.all([
    accountsService.accountRequest.list({ access: { userId: user.id, isAdmin: true }, filter: { status: "pending" } }),
    accountsService.lifecycle.deletedAccounts.list({
      page,
      perPage,
      search: search || undefined,
      reason: reason || undefined,
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(deletedAccountsPage.total / perPage));
  const baseUrl = (() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (reason) params.set("reason", reason);
    const query = params.toString();
    return query ? `/app/accounts/deleted-accounts?${query}&page=` : "/app/accounts/deleted-accounts?page=";
  })();
  type DeletedAccountRow = (typeof deletedAccountsPage.items)[number];
  const columns: DataTableColumn<DeletedAccountRow>[] = [
    { id: "account", header: "Account", value: (entry) => entry.displayName || entry.uid },
    { id: "email", header: "Email", value: (entry) => entry.mail, cellClass: "max-w-[18rem]" },
    { id: "provider", header: "Provider", value: (entry) => entry.previousProvider },
    { id: "profile", header: "Profile", value: (entry) => entry.previousProfile },
    { id: "reason", header: "Reason", value: (entry) => formatReason(entry.reason) },
    { id: "deleted", header: "Deleted", value: (entry) => entry.deletedAt, cellClass: "whitespace-nowrap" },
    { id: "details", header: "Details", headerClass: "text-right", cellClass: "text-right whitespace-nowrap max-w-none" },
  ];

  return () => (
    <Layout
      c={c}
      fullWidth
      title={[{ title: "Start", href: "/" }, { title: "Accounts", href: "/app/accounts" }, { title: "Deleted Accounts" }]}
    >
      <div class="app-cols h-full">
        <AccountsNavSidebar active="deleted-accounts" isAdmin pendingRequests={pendingRequestsPage.total} />

        <div class="flex-1 min-w-0 min-h-0 overflow-y-auto">
          <div class="flex flex-col gap-2">
            <div class="min-w-0" style="view-transition-name: accounts-deleted-title">
              <h1 class="text-base font-semibold text-primary">Deleted Accounts</h1>
              <p class="mt-1 text-xs text-dimmed">
                {deletedAccountsPage.total} {deletedAccountsPage.total === 1 ? "deleted account" : "deleted accounts"}
              </p>
            </div>

            <div style="view-transition-name: accounts-deleted-search">
              <SearchBar
                action={buildUrl({ reason, page: 1 })}
                value={search}
                placeholder="Search deleted accounts..."
                ariaLabel="Search deleted accounts"
              />
            </div>

            <div class="flex flex-wrap items-center gap-2" style="view-transition-name: accounts-deleted-filters">
              <DeletedAccountsFilters search={search} reason={reason} />
            </div>

            {deletedAccountsPage.items.length === 0 ? (
              <div class="paper p-6 text-center text-sm text-dimmed">No deleted accounts found.</div>
            ) : (
              <div class="paper overflow-hidden" style="view-transition-name: accounts-deleted-table">
                <DataTable
                  rows={deletedAccountsPage.items}
                  columns={columns}
                  getRowId={(entry) => entry.id}
                  hoverRows
                  class="overflow-x-auto"
                  renderCell={({ row: entry, col }) => {
                    if (col.id === "account") return <span class="font-medium text-primary">{entry.displayName || entry.uid}</span>;
                    if (col.id === "email")
                      return (
                        <span class="truncate text-dimmed" title={entry.mail || "-"}>
                          {entry.mail || "-"}
                        </span>
                      );
                    if (col.id === "provider") return <span class="text-dimmed">{entry.previousProvider || "-"}</span>;
                    if (col.id === "profile") return <span class="text-dimmed">{entry.previousProfile || "-"}</span>;
                    if (col.id === "reason") return <span class="text-dimmed">{formatReason(entry.reason)}</span>;
                    if (col.id === "deleted") return <span class="text-dimmed">{dates.formatDateTime(entry.deletedAt)}</span>;
                    if (col.id === "details") {
                      return (
                        <DeletedAccountDetails
                          displayName={entry.displayName || entry.uid}
                          uid={entry.uid}
                          mail={entry.mail}
                          previousProvider={entry.previousProvider}
                          previousProfile={entry.previousProfile}
                          reason={formatReason(entry.reason)}
                          deletedAt={dates.formatDateTime(entry.deletedAt)}
                          metadata={entry.meta}
                        />
                      );
                    }
                    return "";
                  }}
                />
              </div>
            )}

            <div class="pt-1">
              <Pagination currentPage={page} totalPages={totalPages} baseUrl={baseUrl} />
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
});
