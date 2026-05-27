import { ssr } from "../config";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { createPagination } from "@valentinkolb/cloud/contracts";
import { hasRole } from "@valentinkolb/cloud/contracts";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import { DataTable, Pagination, type DataTableColumn } from "@valentinkolb/cloud/ui";
import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
import NotificationActions from "./_components/NotificationActions.island";
import SendAllPending from "./_components/SendAllPending.island";
import { notificationsService } from "../service";

/** Admin notifications list page with pagination and search. */
export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");

  const page = Number(c.req.query("page") ?? "1");
  const perPage = 100;
  const search = c.req.query("search") ?? "";

  const { items: notifs, total } = await notificationsService.notification.list({
    pagination: { page, perPage },
    access: {
      isAdmin: hasRole(user, "admin"),
      sentBy: user.id,
      search: search || undefined,
    },
  });

  const pagination = createPagination({ page, perPage, offset: (page - 1) * perPage }, total);
  const baseUrl = search ? `/admin/notifications?search=${encodeURIComponent(search)}&page=` : "/admin/notifications?page=";

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
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

          <SearchBar action="/admin/notifications" value={search} placeholder="Search notifications..." ariaLabel="Search notifications" />

          <div class="flex flex-wrap items-center gap-2">
            <div class="ml-auto">
              <SendAllPending />
            </div>
          </div>

          {notifs.length > 0 ? (
            <section class="paper overflow-hidden" style="view-transition-name: admin-notifications-table">
              <DataTable
                rows={notifs}
                columns={columns}
                getRowId={(notification) => String(notification.id)}
                hoverRows
                class="overflow-x-auto"
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
                        isAdmin={hasRole(user, "admin")}
                      />
                    );
                  }
                  return "";
                }}
              />
            </section>
          ) : (
            <section class="paper p-6 text-center text-sm text-dimmed">
              {search ? "No notifications found matching your search." : "No notifications found."}
            </section>
          )}

          <Pagination currentPage={pagination.page} totalPages={pagination.total_pages} baseUrl={baseUrl} />
        </div>
      </div>
    </AdminLayout>
  );
});
