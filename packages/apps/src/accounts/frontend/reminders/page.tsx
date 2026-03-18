import { ssr } from "@valentinkolb/cloud/core/config";
import { accountsAppService as accountsService } from "@valentinkolb/cloud/core/services";
import { Layout } from "@valentinkolb/cloud/core/ssr";
import { dates } from "@valentinkolb/cloud/lib/shared";
import { Pagination } from "@valentinkolb/cloud/lib/ui";
import { SearchBar } from "@valentinkolb/cloud/lib/islands";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
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
  const perPage = 30;
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

  return (
    <Layout c={c} fullWidth title={[{ title: "Start", href: "/" }, { title: "Accounts", href: "/app/accounts" }, { title: "Reminder History" }]}>
      <div class="app-cols h-full">
        <AccountsNavSidebar active="reminders" isAdmin pendingRequests={pendingRequestsPage.total} />

        <div class="flex-1 min-w-0 min-h-0 overflow-y-auto p-4">
          <div class="flex flex-col gap-3">
            <div class="flex flex-col gap-2 md:flex-row md:items-center">
              <div class="min-w-0 flex-1">
                <SearchBar
                  action={buildUrl({ status, kind, page: 1 })}
                  value={search}
                  placeholder="Search reminder history..."
                  ariaLabel="Search reminder history"
                />
              </div>
              <ReminderFilters search={search} status={status} kind={kind} />
            </div>

            <p class="text-xs text-dimmed">{remindersPage.total === 1 ? "1 reminder history entry" : `${remindersPage.total} reminder history entries`}</p>

            {remindersPage.items.length === 0 ? (
              <div class="paper p-6 text-center text-sm text-dimmed">No reminder history entries found.</div>
            ) : (
              <div class="paper overflow-hidden">
                <div class="overflow-x-auto">
                  <table class="w-full text-sm">
                    <thead>
                      <tr class="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/50">
                        <th class="px-4 py-3 text-left font-medium text-dimmed">User</th>
                        <th class="px-4 py-3 text-left font-medium text-dimmed">Kind</th>
                        <th class="px-4 py-3 text-left font-medium text-dimmed">Target Expiry</th>
                        <th class="px-4 py-3 text-left font-medium text-dimmed">Status</th>
                        <th class="px-4 py-3 text-left font-medium text-dimmed">Attempts</th>
                        <th class="px-4 py-3 text-left font-medium text-dimmed">Last Attempt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {remindersPage.items.map((entry) => (
                        <tr class="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-800">
                          <td class="px-4 py-3">
                            <div class="flex flex-col gap-0.5">
                              <span class="text-primary">{entry.displayName || entry.uid || "(deleted user)"}</span>
                              {entry.uid ? <span class="text-xs text-dimmed">{entry.uid}</span> : null}
                              {entry.mail ? <span class="text-xs text-dimmed">{entry.mail}</span> : null}
                              {entry.lastError ? <p class="mt-2 text-xs text-red-500">{entry.lastError}</p> : null}
                            </div>
                          </td>
                          <td class="px-4 py-3 text-dimmed">Account expiry</td>
                          <td class="px-4 py-3 text-dimmed whitespace-nowrap">
                            {dates.formatDateTime(entry.targetExpiryAt)}
                            <div class="text-[11px]">Threshold: {entry.thresholdDays}d</div>
                          </td>
                          <td class="px-4 py-3 text-dimmed">{entry.status}</td>
                          <td class="px-4 py-3 text-dimmed">{entry.attemptCount}</td>
                          <td class="px-4 py-3 text-dimmed whitespace-nowrap">{entry.lastAttemptAt ? dates.formatDateTime(entry.lastAttemptAt) : "-"}</td>
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
