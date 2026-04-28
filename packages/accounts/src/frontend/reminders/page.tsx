import { ssr } from "../../config";
import { accountsAppService as accountsService } from "@valentinkolb/cloud/services";
import { Layout } from "@valentinkolb/cloud/ssr";
import { dates } from "@valentinkolb/stdlib";
import { Pagination } from "@valentinkolb/cloud/ui";
import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
import type { AuthContext } from "@valentinkolb/cloud/server";
import AccountsNavSidebar from "../AccountsNavSidebar";
import ReminderFilters from "./ReminderFilters.island";

const parsePage = (value: string | undefined): number => {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const buildUrl = (params: { search?: string; kind?: string; status?: string; page?: number }) => {
  const query = new URLSearchParams();
  if (params.search?.trim()) query.set("search", params.search.trim());
  if (params.kind?.trim()) query.set("kind", params.kind.trim());
  if (params.status?.trim()) query.set("status", params.status.trim());
  if (params.page && params.page > 1) query.set("page", String(params.page));
  const search = query.toString();
  return search ? `/app/accounts/reminders?${search}` : "/app/accounts/reminders";
};

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const page = parsePage(c.req.query("page"));
  const perPage = 100;
  const search = (c.req.query("search") ?? "").trim();
  const kind = (c.req.query("kind") ?? "").trim();
  const status = (c.req.query("status") ?? "").trim();

  const [pendingRequestsPage, remindersPage] = await Promise.all([
    accountsService.accountRequest.list({ access: { userId: user.id, isAdmin: true }, filter: { status: "pending" } }),
    accountsService.lifecycle.reminders.list({
      page,
      perPage,
      search: search || undefined,
      kind: (kind || undefined) as "account_expiry" | undefined,
      status: status || undefined,
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(remindersPage.total / perPage));
  const baseUrl = (() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (kind) params.set("kind", kind);
    if (status) params.set("status", status);
    const query = params.toString();
    return query ? `/app/accounts/reminders?${query}&page=` : "/app/accounts/reminders?page=";
  })();

  return () => (
    <Layout c={c} fullWidth title={[{ title: "Start", href: "/" }, { title: "Accounts", href: "/app/accounts" }, { title: "Reminder History" }]}>
      <div class="app-cols h-full">
        <AccountsNavSidebar active="reminders" isAdmin pendingRequests={pendingRequestsPage.total} />

        <div class="flex-1 min-w-0 min-h-0 overflow-y-auto">
          <div class="flex flex-col gap-2">
            <div class="min-w-0" style="view-transition-name: accounts-reminders-title">
              <h1 class="text-base font-semibold text-primary">Reminder History</h1>
              <p class="mt-1 text-xs text-dimmed">{remindersPage.total} {remindersPage.total === 1 ? "entry" : "entries"}</p>
            </div>

            <div style="view-transition-name: accounts-reminders-search">
              <SearchBar
                action={buildUrl({ status, kind, page: 1 })}
                value={search}
                placeholder="Search reminder history..."
                ariaLabel="Search reminder history"
              />
            </div>

            <div class="flex flex-wrap items-center gap-2" style="view-transition-name: accounts-reminders-filters">
              <ReminderFilters search={search} status={status} kind={kind} />
            </div>

            {remindersPage.items.length === 0 ? (
              <div class="paper p-6 text-center text-sm text-dimmed">No reminder history entries found.</div>
            ) : (
              <div class="paper overflow-hidden" style="view-transition-name: accounts-reminders-table">
                <div class="overflow-x-auto">
                  <table class="w-full text-xs">
                    <thead>
                      <tr class="border-b border-zinc-100 dark:border-zinc-800">
                        <th class="px-3 py-2 text-left font-medium text-dimmed">User</th>
                        <th class="px-3 py-2 text-left font-medium text-dimmed">Kind</th>
                        <th class="px-3 py-2 text-left font-medium text-dimmed">Target expiry</th>
                        <th class="px-3 py-2 text-left font-medium text-dimmed">Status</th>
                        <th class="px-3 py-2 text-left font-medium text-dimmed">Attempts</th>
                        <th class="px-3 py-2 text-left font-medium text-dimmed">Last attempt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {remindersPage.items.map((entry) => (
                        <tr class="border-b border-zinc-50 transition-colors hover:bg-zinc-50 dark:border-zinc-800/50 dark:hover:bg-zinc-800/30">
                          <td class="px-3 py-1.5">
                            <div class="truncate font-medium text-primary">{entry.displayName || entry.uid || "(deleted user)"}</div>
                            {entry.lastError ? <div class="truncate text-[11px] text-red-500" title={entry.lastError}>{entry.lastError}</div> : null}
                          </td>
                          <td class="px-3 py-1.5 text-dimmed">Account expiry</td>
                          <td class="px-3 py-1.5 whitespace-nowrap text-dimmed">{dates.formatDateTime(entry.targetExpiryAt)} · {entry.thresholdDays}d</td>
                          <td class="px-3 py-1.5 text-dimmed">{entry.status}</td>
                          <td class="px-3 py-1.5 text-dimmed">{entry.attemptCount}</td>
                          <td class="px-3 py-1.5 whitespace-nowrap text-dimmed">{entry.lastAttemptAt ? dates.formatDateTime(entry.lastAttemptAt) : "-"}</td>
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
