import type { AuthContext } from "@valentinkolb/cloud/server";
import { accountsAppService as accountsService } from "@valentinkolb/cloud/services";
import { Layout } from "@valentinkolb/cloud/ssr";
import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
import { DataTable, type DataTableColumn, Pagination } from "@valentinkolb/cloud/ui";
import { dates } from "@valentinkolb/stdlib";
import { ssr } from "../../config";
import AccountsWorkspace from "../AccountsWorkspace";
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
  type ReminderRow = (typeof remindersPage.items)[number];
  const columns: DataTableColumn<ReminderRow>[] = [
    { id: "user", header: "User", value: (entry) => entry.displayName || entry.uid || "(deleted user)" },
    { id: "kind", header: "Kind", value: () => "Account expiry" },
    { id: "target", header: "Target expiry", value: (entry) => entry.targetExpiryAt, cellClass: "whitespace-nowrap" },
    { id: "status", header: "Status", value: (entry) => entry.status },
    { id: "attempts", header: "Attempts", value: (entry) => entry.attemptCount },
    { id: "lastAttempt", header: "Last attempt", value: (entry) => entry.lastAttemptAt, cellClass: "whitespace-nowrap" },
  ];

  return () => (
    <Layout
      c={c}
      fullWidth
      title={[{ title: "Start", href: "/" }, { title: "Accounts", href: "/app/accounts" }, { title: "Reminder History" }]}
    >
      <AccountsWorkspace active="reminders" isAdmin pendingRequests={pendingRequestsPage.total} scrollPreserveKey="accounts-reminders">
        <div class="flex flex-col gap-2">
          <div class="min-w-0" style="view-transition-name: accounts-reminders-title">
            <h1 class="text-base font-semibold text-primary">Reminder History</h1>
            <p class="mt-1 text-xs text-dimmed">
              {remindersPage.total} {remindersPage.total === 1 ? "entry" : "entries"}
            </p>
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
              <DataTable
                rows={remindersPage.items}
                columns={columns}
                getRowId={(entry) => entry.id}
                hoverRows
                class="overflow-x-auto"
                scrollPreserveKey="accounts-reminders-table"
                renderCell={({ row: entry, col }) => {
                  if (col.id === "user") {
                    return (
                      <div>
                        <div class="truncate font-medium text-primary">{entry.displayName || entry.uid || "(deleted user)"}</div>
                        {entry.lastError ? (
                          <div class="truncate text-[11px] text-red-500" title={entry.lastError}>
                            {entry.lastError}
                          </div>
                        ) : null}
                      </div>
                    );
                  }
                  if (col.id === "kind") return <span class="text-dimmed">Account expiry</span>;
                  if (col.id === "target")
                    return (
                      <span class="text-dimmed">
                        {dates.formatDateTime(entry.targetExpiryAt)} · {entry.thresholdDays}d
                      </span>
                    );
                  if (col.id === "status") return <span class="text-dimmed">{entry.status}</span>;
                  if (col.id === "attempts") return <span class="text-dimmed">{entry.attemptCount}</span>;
                  if (col.id === "lastAttempt")
                    return <span class="text-dimmed">{entry.lastAttemptAt ? dates.formatDateTime(entry.lastAttemptAt) : "-"}</span>;
                  return "";
                }}
              />
            </div>
          )}

          <div class="pt-1">
            <Pagination currentPage={page} totalPages={totalPages} baseUrl={baseUrl} />
          </div>
        </div>
      </AccountsWorkspace>
    </Layout>
  );
});
