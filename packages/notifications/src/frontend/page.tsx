import { ssr } from "../config";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { createPagination } from "@valentinkolb/cloud/contracts";
import { hasRole } from "@valentinkolb/cloud/contracts";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import { Pagination } from "@valentinkolb/cloud/ui";
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
              <div class="overflow-x-auto">
                <table class="w-full text-xs">
                  <thead>
                    <tr class="border-b border-zinc-100 dark:border-zinc-800">
                      <th class="px-3 py-2 text-left font-medium text-dimmed">Status</th>
                      <th class="px-3 py-2 text-left font-medium text-dimmed">Recipient</th>
                      <th class="px-3 py-2 text-left font-medium text-dimmed">Subject</th>
                      <th class="px-3 py-2 text-left font-medium text-dimmed">Sent by</th>
                      <th class="px-3 py-2 text-left font-medium text-dimmed">Created</th>
                      <th class="w-px px-3 py-2 text-right font-medium text-dimmed">
                        <span class="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {notifs.map((notification) => (
                      <tr class="border-b border-zinc-50 transition-colors hover:bg-zinc-50 dark:border-zinc-800/50 dark:hover:bg-zinc-800/30">
                        <td class="px-3 py-1.5">{getStatusBadge(notification.status)}</td>
                        <td class="px-3 py-1.5 font-mono text-[11px]">{notification.recipient}</td>
                        <td class="max-w-[28rem] truncate px-3 py-1.5 text-primary" title={notification.error ? `${notification.subject} · ${notification.error}` : notification.subject}>
                          {notification.subject}
                        </td>
                        <td class="px-3 py-1.5 text-dimmed">{notification.sentByName ?? <span class="italic">System</span>}</td>
                        <td class="px-3 py-1.5 whitespace-nowrap text-dimmed">{formatDate(notification.createdAt)}</td>
                        <td class="px-3 py-1.5 text-right">
                          <NotificationActions
                            id={notification.id}
                            status={notification.status}
                            subject={notification.subject}
                            content={notification.content}
                            recipient={notification.recipient}
                            isAdmin={hasRole(user, "admin")}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
