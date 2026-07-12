import { listApps } from "@valentinkolb/cloud";
import type { AuthContext } from "@valentinkolb/cloud/server";
import type { NotificationDeliveryStatus, UserNotificationHistoryItem } from "@valentinkolb/cloud/contracts";
import { notifications } from "@valentinkolb/cloud/services";
import { Layout } from "@valentinkolb/cloud/ssr";
import { DataTable, type DataTableColumn, Pagination, Placeholder } from "@valentinkolb/cloud/ui";
import { dates } from "@valentinkolb/stdlib";
import { ssr } from "../../config";
import CoreLayoutHelp from "../CoreLayoutHelp.island";
import NotificationHistoryFilters from "./NotificationHistoryFilters.island";
import NotificationPreferences, { type NotificationAppMeta } from "./NotificationPreferences.island";
import { notificationChannelMeta, notificationStatusMeta } from "./notification-ui";

const HISTORY_STATUSES = new Set<NotificationDeliveryStatus>(["deferred", "pending", "sending", "delivered", "suppressed", "failed"]);

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const columns: DataTableColumn<UserNotificationHistoryItem>[] = [
  { id: "time", header: "Time", value: (item) => item.createdAt, cellClass: "whitespace-nowrap" },
  { id: "notification", header: "Notification", value: (item) => item.title, cellClass: "min-w-[13rem]" },
  { id: "channel", header: "Channel", value: (item) => item.channel, cellClass: "min-w-[9rem]" },
  { id: "status", header: "Status", value: (item) => item.status, cellClass: "min-w-[12rem]" },
];

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const page = parsePositiveInt(c.req.query("page"), 1);
  const rawStatus = c.req.query("status");
  const status =
    rawStatus && HISTORY_STATUSES.has(rawStatus as NotificationDeliveryStatus) ? (rawStatus as NotificationDeliveryStatus) : undefined;
  const [preferences, history, registeredApps] = await Promise.all([
    notifications.user.preferences.list(user.id),
    notifications.user.history.list({ userId: user.id, page, perPage: 25, status }),
    listApps(),
  ]);
  const apps: NotificationAppMeta[] = registeredApps.map((app) => ({ id: app.id, name: app.name, icon: app.icon }));
  const appNames = new Map(apps.map((app) => [app.id, app.name]));
  const baseUrl = status ? `/me/notifications?status=${encodeURIComponent(status)}&page=` : "/me/notifications?page=";

  return () => (
    <Layout c={c} title={[{ title: "Start", href: "/" }, { title: "Profile", href: "/me" }, { title: "Notifications" }]}>
      <CoreLayoutHelp />
      <div class="mx-auto flex max-w-6xl flex-col gap-2 px-2">
        <header class="px-1 py-2">
          <h1 class="flex items-center gap-2 text-xl font-semibold text-primary">
            <i class="ti ti-bell" />
            Notifications
          </h1>
          <p class="mt-1 text-sm text-dimmed">Delivery preferences and recent notification outcomes.</p>
        </header>

        <NotificationPreferences initial={preferences} apps={apps} />

        <section class="paper p-5 sm:p-6">
          <div class="mb-5 flex items-start justify-between gap-3">
            <div>
              <h2 class="flex items-center gap-1.5 text-sm font-semibold text-primary">
                <i class="ti ti-history text-sm" />
                Delivery history
              </h2>
              <p class="mt-1 text-xs text-dimmed">Metadata only; notification contents are not shown here.</p>
            </div>
            <NotificationHistoryFilters status={status} />
          </div>

          {history.items.length === 0 ? (
            <Placeholder>No notification deliveries found.</Placeholder>
          ) : (
            <DataTable
              rows={history.items}
              columns={columns}
              getRowId={(item) => item.id}
              density="compact"
              highlightColumns={false}
              class="max-h-[34rem] overflow-auto"
              tableClass="w-full min-w-[46rem] text-xs"
              renderCell={({ row: item, col, render }) => {
                if (col.id === "time") return <span class="text-dimmed">{dates.formatDateTime(item.createdAt)}</span>;
                if (col.id === "notification")
                  return (
                    <div class="min-w-0">
                      {item.targetHref ? (
                        <a href={item.targetHref} class="font-medium text-primary hover:underline">
                          {item.title}
                        </a>
                      ) : (
                        <span class="font-medium text-primary">{item.title}</span>
                      )}
                      <p class="mt-0.5 text-[11px] text-dimmed">
                        {appNames.get(item.appId) ?? item.appId} · {item.label}
                      </p>
                    </div>
                  );
                if (col.id === "channel") {
                  const channel = notificationChannelMeta(item.channel);
                  return (
                    <div>
                      <span class="inline-flex items-center gap-1.5 text-secondary">
                        <i class={channel.icon} />
                        {channel.label}
                      </span>
                      <p class="mt-0.5 text-[11px] text-dimmed">{item.destinationLabel}</p>
                    </div>
                  );
                }
                if (col.id === "status") {
                  const delivery = notificationStatusMeta(item.status);
                  return (
                    <div>
                      <span class={`tag ${delivery.class}`}>{delivery.label}</span>
                      {item.errorMessage && <p class="mt-1 max-w-xs text-[11px] leading-snug text-dimmed">{item.errorMessage}</p>}
                    </div>
                  );
                }
                return render(item);
              }}
            />
          )}
          <Pagination currentPage={history.page} totalPages={history.totalPages} baseUrl={baseUrl} />
        </section>
      </div>
    </Layout>
  );
});
