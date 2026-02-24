import { ssr } from "@valentinkolb/cloud/core/config";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import { createPagination } from "@valentinkolb/cloud/contracts/shared";
import { hasRole } from "@valentinkolb/cloud/contracts/shared";
import { AdminLayout } from "@valentinkolb/cloud/core/ssr";
import { Pagination } from "@valentinkolb/cloud/lib/ui";
import { SearchBar } from "@valentinkolb/cloud/lib/islands";
import NotificationActions from "./_components/NotificationActions.island";
import SendAllPending from "./_components/SendAllPending.island";
import { notificationsService } from "../service";

/** Admin notifications list page with pagination and search. */
export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");

  const page = Number(c.req.query("page") ?? "1");
  const perPage = 20;
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

  return (
    <AdminLayout c={c} title="Notifications">
      <div class="max-w-6xl mx-auto flex flex-col gap-4">
        <div class="flex items-center justify-between gap-4" style="view-transition-name: page-header">
          <h1 class="text-xl font-bold text-primary">Notifications</h1>
          <div class="flex items-center gap-3">
            <span class="text-xs text-dimmed">{total} total</span>
            <SendAllPending />
          </div>
        </div>

        <SearchBar />

        {notifs.length > 0 ? (
          <div class="paper overflow-hidden">
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
                    <th class="text-left px-4 py-3 font-medium text-dimmed">Status</th>
                    <th class="text-left px-4 py-3 font-medium text-dimmed">Recipient</th>
                    <th class="text-left px-4 py-3 font-medium text-dimmed">Subject</th>
                    <th class="text-left px-4 py-3 font-medium text-dimmed">Sent By</th>
                    <th class="text-left px-4 py-3 font-medium text-dimmed">Created</th>
                    <th class="text-right px-4 py-3 font-medium text-dimmed">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {notifs.map((n) => (
                    <tr class="border-b border-zinc-100 dark:border-zinc-800 last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
                      <td class="px-4 py-3">{getStatusBadge(n.status)}</td>
                      <td class="px-4 py-3">
                        <span class="font-mono text-xs">{n.recipient}</span>
                      </td>
                      <td class="px-4 py-3">
                        <span class="line-clamp-1 max-w-xs" title={n.subject}>
                          {n.subject}
                        </span>
                        {n.error && (
                          <span class="block text-xs text-red-500 line-clamp-1" title={n.error}>
                            {n.error}
                          </span>
                        )}
                      </td>
                      <td class="px-4 py-3 text-dimmed">{n.sentByName ?? <span class="italic">System</span>}</td>
                      <td class="px-4 py-3 text-dimmed whitespace-nowrap">{formatDate(n.createdAt)}</td>
                      <td class="px-4 py-3 text-right">
                        <NotificationActions
                          id={n.id}
                          status={n.status}
                          subject={n.subject}
                          content={n.content}
                          recipient={n.recipient}
                          isAdmin={hasRole(user, "admin")}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div class="paper p-6 text-center text-sm text-dimmed">
            {search ? "No notifications found matching your search." : "No notifications found."}
          </div>
        )}

        <Pagination currentPage={pagination.page} totalPages={pagination.total_pages} baseUrl={baseUrl} />
      </div>
    </AdminLayout>
  );
});
