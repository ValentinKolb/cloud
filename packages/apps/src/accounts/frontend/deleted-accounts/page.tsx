import { ssr } from "@valentinkolb/cloud/core/config";
import { accountsAppService as accountsService } from "@valentinkolb/cloud/core/services";
import { Layout } from "@valentinkolb/cloud/core/ssr";
import { dates } from "@valentinkolb/cloud/lib/shared";
import { Pagination } from "@valentinkolb/cloud/lib/ui";
import { SearchBar } from "@valentinkolb/cloud/lib/islands";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import AccountsNavSidebar from "../AccountsNavSidebar";
import DeletedAccountsFilters from "./DeletedAccountsFilters.island";

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
  const perPage = 30;
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

  return (
    <Layout c={c} fullWidth title={[{ title: "Start", href: "/" }, { title: "Accounts", href: "/app/accounts" }, { title: "Deleted Accounts" }]}>
      <div class="app-cols h-full">
        <AccountsNavSidebar active="deleted-accounts" isAdmin pendingRequests={pendingRequestsPage.total} />

        <div class="flex-1 min-w-0 min-h-0 overflow-y-auto p-4">
          <div class="flex flex-col gap-3">
            <div class="flex flex-col gap-2 md:flex-row md:items-center">
              <div class="min-w-0 flex-1">
                <SearchBar
                  action={buildUrl({ reason, page: 1 })}
                  value={search}
                  placeholder="Search deleted accounts..."
                  ariaLabel="Search deleted accounts"
                />
              </div>
              <DeletedAccountsFilters search={search} reason={reason} />
            </div>

            <p class="text-xs text-dimmed">{deletedAccountsPage.total === 1 ? "1 deleted account" : `${deletedAccountsPage.total} deleted accounts`}</p>

            {deletedAccountsPage.items.length === 0 ? (
              <div class="paper p-6 text-center text-sm text-dimmed">No deleted accounts found.</div>
            ) : (
              <div class="paper overflow-hidden">
                <div class="overflow-x-auto">
                  <table class="w-full text-sm">
                    <thead>
                      <tr class="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/50">
                        <th class="px-4 py-3 text-left font-medium text-dimmed">Account</th>
                        <th class="px-4 py-3 text-left font-medium text-dimmed">Previous Realm</th>
                        <th class="px-4 py-3 text-left font-medium text-dimmed">Reason</th>
                        <th class="px-4 py-3 text-left font-medium text-dimmed">Deleted</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deletedAccountsPage.items.map((entry) => (
                        <tr class="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-800">
                          <td class="px-4 py-3">
                            <div class="flex flex-col gap-0.5">
                              <span class="text-primary">{entry.displayName || entry.uid}</span>
                              <span class="text-xs text-dimmed">{entry.uid}</span>
                              {entry.mail ? <span class="text-xs text-dimmed">{entry.mail}</span> : null}
                              {Object.keys(entry.meta).length > 0 ? (
                                <details class="mt-2 text-xs text-dimmed">
                                  <summary class="cursor-pointer select-none text-primary">Details</summary>
                                  <pre class="mt-2 whitespace-pre-wrap break-words rounded-xl bg-zinc-50 p-2 text-[11px] dark:bg-zinc-900">{JSON.stringify(entry.meta, null, 2)}</pre>
                                </details>
                              ) : null}
                            </div>
                          </td>
                          <td class="px-4 py-3 text-dimmed">{entry.previousRealm || "-"}</td>
                          <td class="px-4 py-3 text-dimmed">{formatReason(entry.reason)}</td>
                          <td class="px-4 py-3 text-dimmed whitespace-nowrap">{dates.formatDateTime(entry.deletedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
