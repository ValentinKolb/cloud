import { createPagination, hasRole } from "@valentinkolb/cloud/contracts";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import { DataTable, type DataTableColumn, Pagination, StatCell, StatGrid } from "@valentinkolb/cloud/ui";
import { expectUserBackedActor } from "@/actor";
import { ssr } from "../../config";
import NotificationActions from "./_components/NotificationActions.island";
import NotificationFilterBar, { type NotificationStatusFilter } from "./_components/NotificationFilterBar.island";
import { notificationsService } from "./service";

const notificationStatusFilters = new Set<NotificationStatusFilter>(["all", "sent", "pending", "error"]);

const parseStatusFilter = (value: string | undefined): NotificationStatusFilter => {
  if (value && notificationStatusFilters.has(value as NotificationStatusFilter)) return value as NotificationStatusFilter;
  return "all";
};

/** Admin notifications list page with pagination and search. */
export default ssr<AuthContext>(async (c) => {
  const user = expectUserBackedActor(c);

  const page = Number(c.req.query("page") ?? "1");
  const perPage = 100;
  const search = (c.req.query("search") ?? "").trim();
  const status = parseStatusFilter(c.req.query("status") ?? undefined);
  const isAdmin = hasRole(user, "admin");

  const [{ items: notifs, total }, summary, searchSummary] = await Promise.all([
    notificationsService.notification.list({
      pagination: { page, perPage },
      access: {
        isAdmin,
        sentBy: user.id,
        search: search || undefined,
        status: status === "all" ? undefined : status,
      },
    }),
    notificationsService.notification.summary({
      access: {
        isAdmin,
        sentBy: user.id,
      },
      days: 7,
    }),
    search
      ? notificationsService.notification.searchSummary({
          access: {
            isAdmin,
            sentBy: user.id,
          },
          search,
        })
      : Promise.resolve(null),
  ]);

  const pagination = createPagination({ page, perPage, offset: (page - 1) * perPage }, total);
  const baseUrl = (() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (status !== "all") params.set("status", status);
    const query = params.toString();
    return query ? `/admin/observability/notifications?${query}&page=` : "/admin/observability/notifications?page=";
  })();

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  };
  const formatPercent = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);

  const getSearchStats = () => {
    if (!searchSummary) return null;
    const errorRate = searchSummary.total > 0 ? (searchSummary.error / searchSummary.total) * 100 : 0;
    return [
      {
        icon: "ti ti-search",
        label: `${searchSummary.total.toLocaleString()} matches`,
        class: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
      },
      {
        icon: "ti ti-alert-circle",
        label: `${searchSummary.error.toLocaleString()} errors`,
        class:
          searchSummary.error > 0
            ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200"
            : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
      },
      {
        icon: "ti ti-percentage",
        label: `${formatPercent(errorRate)}% error rate`,
        class:
          searchSummary.error > 0
            ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200"
            : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
      },
      {
        icon: "ti ti-clock",
        label: `${searchSummary.pending.toLocaleString()} pending`,
        class:
          searchSummary.pending > 0
            ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200"
            : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
      },
      {
        icon: "ti ti-check",
        label: `${searchSummary.sent.toLocaleString()} sent`,
        class: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200",
      },
      ...(searchSummary.system > 0
        ? [
            {
              icon: "ti ti-settings",
              label: `${searchSummary.system.toLocaleString()} system`,
              class: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200",
            },
          ]
        : []),
      ...(searchSummary.latestCreatedAt
        ? [
            {
              icon: "ti ti-calendar-time",
              label: `latest ${formatDate(searchSummary.latestCreatedAt)}`,
              class: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
            },
          ]
        : []),
    ];
  };

  const getStatusBadge = (status: "sent" | "pending" | "error") => {
    switch (status) {
      case "sent":
        return (
          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
            <i class="ti ti-check text-xs" />
            Sent
          </span>
        );
      case "pending":
        return (
          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
            <i class="ti ti-clock text-xs" />
            Pending
          </span>
        );
      case "error":
        return (
          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
            <i class="ti ti-alert-circle text-xs" />
            Error
          </span>
        );
    }
  };
  type NotificationRow = (typeof notifs)[number];
  const columns: DataTableColumn<NotificationRow>[] = [
    { id: "status", header: "Status", value: (notification) => notification.status },
    { id: "recipient", header: "Recipient", value: (notification) => notification.recipient, cellClass: "font-mono text-[11px]" },
    { id: "subject", header: "Subject", value: (notification) => notification.subject, cellClass: "max-w-[28rem]" },
    { id: "sentBy", header: "Sent by", value: (notification) => notification.sentByName },
    { id: "created", header: "Created", value: (notification) => notification.createdAt, cellClass: "whitespace-nowrap" },
    {
      id: "actions",
      header: <span class="sr-only">Actions</span>,
      headerClass: "w-px text-right",
      cellClass: "text-right whitespace-nowrap",
    },
  ];

  return () => (
    <AdminLayout c={c} title="Notifications" stretch>
      <div class="flex-1 min-h-0 overflow-y-auto">
        <div class="flex flex-col gap-2">
          <div class="min-w-0" style="view-transition-name: admin-notifications-title">
            <h1 class="text-base font-semibold text-primary">Notifications</h1>
            <p class="mt-1 text-xs text-dimmed">{total} entries</p>
          </div>

          <StatGrid columns={3}>
            <StatCell
              label="Errors 7d"
              value={summary.error.toLocaleString()}
              sub={summary.error > 0 ? "last 7 days" : "none"}
              valueClass={summary.error > 0 ? "text-red-500" : "text-primary"}
              accent={summary.error > 0 ? { tone: "red", icon: "ti ti-alert-circle" } : undefined}
            />
            <StatCell
              label="Pending 7d"
              value={summary.pending.toLocaleString()}
              sub={summary.pending > 0 ? "last 7 days" : "none"}
              valueClass={summary.pending > 0 ? "text-amber-600 dark:text-amber-400" : "text-primary"}
              accent={summary.pending > 0 ? { tone: "amber", icon: "ti ti-clock" } : undefined}
            />
            <StatCell
              label="Sent 7d"
              value={summary.sent.toLocaleString()}
              sub="last 7 days"
              accent={{ tone: "emerald", icon: "ti ti-check" }}
            />
          </StatGrid>

          <section class="paper overflow-hidden" style="view-transition-name: admin-notifications-table">
            <div class="flex flex-col gap-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800/60">
              <div>
                <h2 class="text-xs font-semibold text-primary">Entries</h2>
                <p class="text-[10px] text-dimmed">
                  {notifs.length} of {total} entries
                </p>
              </div>
              <NotificationFilterBar search={search} status={status} />
              {searchSummary && (
                <div class="flex flex-wrap items-center gap-1.5">
                  {getSearchStats()?.map((stat) => (
                    <span class={`inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ${stat.class}`}>
                      <i class={`${stat.icon} text-sm`} />
                      <span>{stat.label}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <DataTable
              rows={notifs}
              columns={columns}
              getRowId={(notification) => String(notification.id)}
              hoverRows
              class="overflow-x-auto"
              empty={search ? "No notifications found matching your search." : "No notifications found."}
              renderCell={({ row: notification, col }) => {
                if (col.id === "status") return getStatusBadge(notification.status);
                if (col.id === "recipient") return notification.recipient;
                if (col.id === "subject") {
                  return (
                    <span title={notification.error ? `${notification.subject} · ${notification.error}` : notification.subject}>
                      {notification.subject}
                    </span>
                  );
                }
                if (col.id === "sentBy")
                  return <span class="text-dimmed">{notification.sentByName ?? <span class="italic">System</span>}</span>;
                if (col.id === "created") return <span class="text-dimmed">{formatDate(notification.createdAt)}</span>;
                if (col.id === "actions") {
                  return (
                    <NotificationActions
                      id={notification.id}
                      status={notification.status}
                      subject={notification.subject}
                      content={notification.content}
                      recipient={notification.recipient}
                      error={notification.error}
                      isAdmin={isAdmin}
                    />
                  );
                }
                return "";
              }}
            />
          </section>

          <Pagination currentPage={pagination.page} totalPages={pagination.total_pages} baseUrl={baseUrl} />
        </div>
      </div>
    </AdminLayout>
  );
});
