import { listApps } from "@valentinkolb/cloud";
import { createPagination, hasRole, type NotificationDeliveryStatus } from "@valentinkolb/cloud/contracts";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import { DataTable, type DataTableColumn, Pagination, StatCell, StatGrid } from "@valentinkolb/cloud/ui";
import type { JSX } from "solid-js";
import { expectUserBackedActor } from "@/actor";
import { ssr } from "../../config";
import GatewayOpsLayoutHelp from "../../frontend/GatewayOpsLayoutHelp.island";
import DeliveryFilterBar from "./_components/DeliveryFilterBar.island";
import {
  buildDeliveryNotificationsUrl,
  buildLegacyNotificationsUrl,
  buildRegistryNotificationsUrl,
  type NotificationAppFilterOption,
  notificationChannelIcon,
  notificationChannelLabel,
  parseDeliveryStatus,
  parseFilterList,
  parseLegacyStatus,
  parseNotificationAdminView,
  parseRegistryStatus,
} from "./_components/filter-state";
import NotificationActions from "./_components/NotificationActions.island";
import NotificationFilterBar from "./_components/NotificationFilterBar.island";
import NotificationViewSwitch from "./_components/NotificationViewSwitch.island";
import RegistryFilterBar from "./_components/RegistryFilterBar.island";
import { notificationsService } from "./service";

type DeliveryItem = Awaited<ReturnType<typeof notificationsService.delivery.list>>["items"][number];
type RegistryItem = Awaited<ReturnType<typeof notificationsService.registry.list>>["items"][number];
type LegacyItem = Awaited<ReturnType<typeof notificationsService.notification.list>>["items"][number];

const numberFormat = new Intl.NumberFormat("de-DE");
const dateFormat = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const parsePage = (value: string | undefined): number => {
  const parsed = Number(value ?? "1");
  return Number.isFinite(parsed) ? Math.max(1, Math.trunc(parsed)) : 1;
};

const paginationBase = (url: string): string => `${url}${url.includes("?") ? "&" : "?"}page=`;

const channelChip = (channel: string): JSX.Element => {
  const tone =
    channel === "email"
      ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200"
      : channel === "browser"
        ? "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-200"
        : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200";
  return (
    <span class={`inline-flex h-6 items-center gap-1 rounded-full px-2 text-[10px] font-medium ${tone}`}>
      <i class={`${notificationChannelIcon(channel)} text-xs`} />
      {notificationChannelLabel(channel)}
    </span>
  );
};

const deliveryStatusBadge = (status: NotificationDeliveryStatus): JSX.Element => {
  const config = {
    deferred: { label: "Deferred", icon: "ti ti-player-pause", tone: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200" },
    pending: { label: "Pending", icon: "ti ti-clock", tone: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200" },
    sending: { label: "Sending", icon: "ti ti-send", tone: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200" },
    delivered: {
      label: "Delivered",
      icon: "ti ti-check",
      tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200",
    },
    suppressed: { label: "Suppressed", icon: "ti ti-bell-off", tone: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200" },
    failed: { label: "Failed", icon: "ti ti-alert-circle", tone: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200" },
  }[status];
  return (
    <span class={`inline-flex h-6 items-center gap-1 rounded-full px-2 text-[10px] font-medium ${config.tone}`}>
      <i class={`${config.icon} text-xs`} />
      {config.label}
    </span>
  );
};

const legacyStatusBadge = (status: LegacyItem["status"]): JSX.Element => {
  if (status === "sent") return deliveryStatusBadge("delivered");
  if (status === "error") return deliveryStatusBadge("failed");
  return deliveryStatusBadge("pending");
};

const buildAppOptions = (appIds: string[], liveApps: Awaited<ReturnType<typeof listApps>>): NotificationAppFilterOption[] => {
  const liveById = new Map(liveApps.map((app) => [app.id, app]));
  return appIds.map((id) => {
    const app = liveById.get(id);
    return { id, label: app?.name ?? id, icon: app?.icon ?? "ti ti-apps" };
  });
};

const appCell = (appId: string, appById: ReadonlyMap<string, NotificationAppFilterOption>): JSX.Element => {
  const app = appById.get(appId);
  return (
    <span class="inline-flex min-w-0 items-center gap-1.5" title={appId}>
      <i class={`${app?.icon ?? "ti ti-apps"} shrink-0 text-sm text-dimmed`} />
      <span class="truncate">{app?.label ?? appId}</span>
    </span>
  );
};

export default ssr<AuthContext>(async (c) => {
  const user = expectUserBackedActor(c);
  const isAdmin = hasRole(user, "admin");
  const view = parseNotificationAdminView(c.req.query("view") ?? undefined);
  const page = parsePage(c.req.query("page") ?? undefined);
  const perPage = 100;
  const search = (c.req.query("search") ?? "").trim();

  const renderPage = (description: string, content: JSX.Element) => () => (
    <AdminLayout c={c} title="Notifications" stretch>
      <GatewayOpsLayoutHelp />
      <div class="flex-1 min-h-0 overflow-y-auto" style="scrollbar-gutter: stable">
        <div class="flex flex-col gap-2">
          <div class="min-w-0" style="view-transition-name: admin-notifications-title">
            <h1 class="text-base font-semibold text-primary">Notifications</h1>
            <p class="mt-1 text-xs text-dimmed">{description}</p>
          </div>
          <div class="self-start">
            <NotificationViewSwitch view={view} />
          </div>
          {content}
        </div>
      </div>
    </AdminLayout>
  );

  if (view === "deliveries") {
    const status = parseDeliveryStatus(c.req.query("status") ?? undefined);
    const channels = parseFilterList(c.req.query("channels") ?? undefined);
    const appIds = parseFilterList(c.req.query("apps") ?? undefined);
    const [result, summary, facets, liveApps] = await Promise.all([
      notificationsService.delivery.list({
        page,
        perPage,
        filter: {
          search: search || undefined,
          statuses: status === "all" ? undefined : [status],
          channels,
          appIds,
        },
      }),
      notificationsService.delivery.summary({ days: 7 }),
      notificationsService.facets(),
      listApps().catch(() => []),
    ]);
    const appOptions = buildAppOptions(facets.appIds, liveApps);
    const appById = new Map(appOptions.map((app) => [app.id, app]));
    const pagination = createPagination({ page, perPage, offset: (page - 1) * perPage }, result.total);
    const baseUrl = paginationBase(buildDeliveryNotificationsUrl({ search, status, channels, appIds }));
    const columns: DataTableColumn<DeliveryItem>[] = [
      { id: "status", header: "Status", value: (item) => item.status },
      { id: "notification", header: "Notification", value: (item) => item.title, cellClass: "max-w-[24rem]" },
      { id: "app", header: "App", value: (item) => appById.get(item.appId)?.label ?? item.appId },
      { id: "recipient", header: "Recipient", value: (item) => item.recipientLabel, cellClass: "max-w-[18rem]" },
      { id: "channel", header: "Channel", value: (item) => item.channel },
      { id: "attempts", header: "Attempts", value: (item) => item.attemptCount, cellClass: "text-right tabular-nums" },
      { id: "created", header: "Created", value: (item) => item.createdAt, cellClass: "whitespace-nowrap" },
    ];

    return renderPage(
      "Durable, metadata-only delivery attempts across all registered notification channels.",
      <>
        <StatGrid columns={4}>
          <StatCell
            label="Failed 7d"
            value={numberFormat.format(summary.failed)}
            sub={summary.total > 0 ? `${numberFormat.format(summary.total)} total` : "none"}
            valueClass={summary.failed > 0 ? "text-red-500" : "text-primary"}
            accent={summary.failed > 0 ? { tone: "red", icon: "ti ti-alert-circle" } : undefined}
          />
          <StatCell
            label="Active 7d"
            value={numberFormat.format(summary.active)}
            sub="deferred, pending, sending"
            valueClass={summary.active > 0 ? "text-amber-600 dark:text-amber-400" : "text-primary"}
            accent={summary.active > 0 ? { tone: "amber", icon: "ti ti-clock" } : undefined}
          />
          <StatCell
            label="Delivered 7d"
            value={numberFormat.format(summary.delivered)}
            sub="provider accepted"
            accent={{ tone: "emerald", icon: "ti ti-check" }}
          />
          <StatCell label="Suppressed 7d" value={numberFormat.format(summary.suppressed)} sub="policy or fallback" />
        </StatGrid>

        <section class="paper overflow-hidden" style="view-transition-name: admin-notification-deliveries-table">
          <div class="flex flex-col gap-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800/60">
            <div>
              <h2 class="text-xs font-semibold text-primary">Delivery attempts</h2>
              <p class="text-[10px] text-dimmed">
                {result.items.length} of {result.total} attempts
              </p>
            </div>
            <DeliveryFilterBar
              search={search}
              status={status}
              channels={channels}
              appIds={appIds}
              channelOptions={facets.channels}
              appOptions={appOptions}
            />
          </div>
          <DataTable
            rows={result.items}
            columns={columns}
            getRowId={(item) => item.id}
            hoverRows
            class="overflow-x-auto"
            empty={search ? "No delivery attempts match this search." : "No delivery attempts found."}
            renderCell={({ row: item, col }) => {
              if (col.id === "status") return deliveryStatusBadge(item.status);
              if (col.id === "notification") {
                return (
                  <div class="min-w-0">
                    <p class="truncate font-medium text-primary" title={item.title}>
                      {item.title}
                    </p>
                    <p class="truncate text-[10px] text-dimmed" title={item.definitionId}>
                      {item.label}
                    </p>
                    {item.errorCode && (
                      <p class="truncate text-[10px] text-red-500" title={item.errorMessage ?? item.errorCode}>
                        {item.errorCode}
                      </p>
                    )}
                  </div>
                );
              }
              if (col.id === "app") return appCell(item.appId, appById);
              if (col.id === "recipient") {
                return (
                  <div class="min-w-0">
                    <p class="truncate text-primary" title={item.recipientLabel}>
                      {item.recipientLabel}
                    </p>
                    {item.recipientReference !== item.recipientLabel && (
                      <p class="truncate font-mono text-[10px] text-dimmed" title={item.recipientReference}>
                        {item.recipientReference}
                      </p>
                    )}
                  </div>
                );
              }
              if (col.id === "channel") {
                return (
                  <div class="flex flex-wrap items-center gap-1">
                    {channelChip(item.channel)}
                    {item.required && <span class="text-[9px] font-medium uppercase text-dimmed">required</span>}
                  </div>
                );
              }
              if (col.id === "attempts") return numberFormat.format(item.attemptCount);
              if (col.id === "created") return <span class="text-dimmed">{dateFormat.format(item.createdAt)}</span>;
              return "";
            }}
          />
        </section>
        <Pagination currentPage={pagination.page} totalPages={pagination.total_pages} baseUrl={baseUrl} />
      </>,
    );
  }

  if (view === "registry") {
    const status = parseRegistryStatus(c.req.query("status") ?? undefined);
    const appIds = parseFilterList(c.req.query("apps") ?? undefined);
    const [result, summary, facets, liveApps] = await Promise.all([
      notificationsService.registry.list({
        page,
        perPage,
        filter: { search: search || undefined, appIds, active: status === "all" ? undefined : status === "active" },
      }),
      notificationsService.registry.summary(),
      notificationsService.facets(),
      listApps().catch(() => []),
    ]);
    const appOptions = buildAppOptions(facets.appIds, liveApps);
    const appById = new Map(appOptions.map((app) => [app.id, app]));
    const pagination = createPagination({ page, perPage, offset: (page - 1) * perPage }, result.total);
    const baseUrl = paginationBase(buildRegistryNotificationsUrl({ search, status, appIds }));
    const columns: DataTableColumn<RegistryItem>[] = [
      { id: "app", header: "App", value: (item) => appById.get(item.appId)?.label ?? item.appId },
      { id: "notification", header: "Notification", value: (item) => item.label, cellClass: "max-w-[28rem]" },
      { id: "recipient", header: "Recipient", value: (item) => item.recipientKind },
      { id: "recommended", header: "Recommended", value: (item) => item.recommendedChannels.join(", ") },
      { id: "required", header: "Required", value: (item) => item.requiredChannels.join(", ") },
      { id: "events", header: "Events 7d", value: (item) => item.eventCount7d, cellClass: "text-right tabular-nums" },
      { id: "failures", header: "Failures 7d", value: (item) => item.failedDeliveryCount7d, cellClass: "text-right tabular-nums" },
      { id: "seen", header: "Last seen", value: (item) => item.lastSeenAt, cellClass: "whitespace-nowrap" },
      { id: "state", header: "State", value: (item) => item.active },
    ];

    return renderPage(
      "Durable registry of notification kinds declared by Cloud apps.",
      <>
        <StatGrid columns={4}>
          <StatCell label="Definitions" value={numberFormat.format(summary.total)} sub="durable catalog" />
          <StatCell
            label="Active"
            value={numberFormat.format(summary.active)}
            sub="latest app catalogs"
            accent={{ tone: "emerald", icon: "ti ti-check" }}
          />
          <StatCell label="Apps" value={numberFormat.format(summary.apps)} sub="registered catalogs" />
          <StatCell
            label="Required"
            value={numberFormat.format(summary.required)}
            sub="user-locked delivery"
            accent={{ tone: "amber", icon: "ti ti-lock" }}
          />
        </StatGrid>

        <section class="paper overflow-hidden" style="view-transition-name: admin-notification-registry-table">
          <div class="flex flex-col gap-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800/60">
            <div>
              <h2 class="text-xs font-semibold text-primary">Registered notification kinds</h2>
              <p class="text-[10px] text-dimmed">
                {result.items.length} of {result.total} definitions
              </p>
            </div>
            <RegistryFilterBar search={search} status={status} appIds={appIds} appOptions={appOptions} />
          </div>
          <DataTable
            rows={result.items}
            columns={columns}
            getRowId={(item) => item.id}
            hoverRows
            class="overflow-x-auto"
            empty={search ? "No registered notifications match this search." : "No notification definitions registered."}
            renderCell={({ row: item, col }) => {
              if (col.id === "app") return appCell(item.appId, appById);
              if (col.id === "notification") {
                return (
                  <div class="min-w-0">
                    <p class="truncate font-medium text-primary" title={item.label}>
                      {item.label}
                    </p>
                    <p class="truncate text-[10px] text-dimmed" title={item.description}>
                      {item.description}
                    </p>
                    <p class="truncate font-mono text-[9px] text-dimmed" title={item.id}>
                      {item.kind}
                    </p>
                  </div>
                );
              }
              if (col.id === "recipient") {
                return (
                  <span class="inline-flex items-center gap-1 text-xs capitalize text-secondary">
                    <i class={item.recipientKind === "email" ? "ti ti-mail" : "ti ti-user"} />
                    {item.recipientKind}
                  </span>
                );
              }
              if (col.id === "recommended") {
                return item.recommendedChannels.length > 0 ? (
                  <div class="flex flex-wrap gap-1">{item.recommendedChannels.map(channelChip)}</div>
                ) : (
                  <span class="text-dimmed">-</span>
                );
              }
              if (col.id === "required") {
                return item.requiredChannels.length > 0 ? (
                  <div class="flex flex-wrap gap-1">{item.requiredChannels.map(channelChip)}</div>
                ) : (
                  <span class="text-dimmed">-</span>
                );
              }
              if (col.id === "events") return numberFormat.format(item.eventCount7d);
              if (col.id === "failures") {
                return (
                  <span class={item.failedDeliveryCount7d > 0 ? "text-red-500" : "text-dimmed"}>
                    {numberFormat.format(item.failedDeliveryCount7d)}
                  </span>
                );
              }
              if (col.id === "seen") return <span class="text-dimmed">{dateFormat.format(item.lastSeenAt)}</span>;
              if (col.id === "state") {
                return item.active ? (
                  <span class="inline-flex h-6 items-center gap-1 rounded-full bg-emerald-100 px-2 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">
                    <i class="ti ti-check" />
                    Active
                  </span>
                ) : (
                  <span class="inline-flex h-6 items-center gap-1 rounded-full bg-zinc-100 px-2 text-[10px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                    <i class="ti ti-archive" />
                    Inactive
                  </span>
                );
              }
              return "";
            }}
          />
        </section>
        <Pagination currentPage={pagination.page} totalPages={pagination.total_pages} baseUrl={baseUrl} />
      </>,
    );
  }

  const status = parseLegacyStatus(c.req.query("status") ?? undefined);
  const [{ items, total }, summary, searchSummary] = await Promise.all([
    notificationsService.notification.list({
      pagination: { page, perPage },
      access: { isAdmin, sentBy: user.id, search: search || undefined, status: status === "all" ? undefined : status },
    }),
    notificationsService.notification.summary({ access: { isAdmin, sentBy: user.id }, days: 7 }),
    search ? notificationsService.notification.searchSummary({ access: { isAdmin, sentBy: user.id }, search }) : Promise.resolve(null),
  ]);
  const pagination = createPagination({ page, perPage, offset: (page - 1) * perPage }, total);
  const baseUrl = paginationBase(buildLegacyNotificationsUrl({ search, status }));
  const columns: DataTableColumn<LegacyItem>[] = [
    { id: "status", header: "Status", value: (item) => item.status },
    { id: "recipient", header: "Recipient", value: (item) => item.recipient, cellClass: "font-mono text-[11px]" },
    { id: "subject", header: "Subject", value: (item) => item.subject, cellClass: "max-w-[28rem]" },
    { id: "sentBy", header: "Sent by", value: (item) => item.sentByName },
    { id: "created", header: "Created", value: (item) => item.createdAt, cellClass: "whitespace-nowrap" },
    {
      id: "actions",
      header: <span class="sr-only">Actions</span>,
      headerClass: "w-px text-right",
      cellClass: "text-right whitespace-nowrap",
    },
  ];

  return renderPage(
    "Compatibility outbox for the deprecated email-only notification API.",
    <>
      <StatGrid columns={3}>
        <StatCell
          label="Errors 7d"
          value={numberFormat.format(summary.error)}
          sub={summary.error > 0 ? "last 7 days" : "none"}
          valueClass={summary.error > 0 ? "text-red-500" : "text-primary"}
          accent={summary.error > 0 ? { tone: "red", icon: "ti ti-alert-circle" } : undefined}
        />
        <StatCell
          label="Pending 7d"
          value={numberFormat.format(summary.pending)}
          sub={summary.pending > 0 ? "last 7 days" : "none"}
          valueClass={summary.pending > 0 ? "text-amber-600 dark:text-amber-400" : "text-primary"}
          accent={summary.pending > 0 ? { tone: "amber", icon: "ti ti-clock" } : undefined}
        />
        <StatCell
          label="Sent 7d"
          value={numberFormat.format(summary.sent)}
          sub="last 7 days"
          accent={{ tone: "emerald", icon: "ti ti-check" }}
        />
      </StatGrid>

      <section class="paper overflow-hidden" style="view-transition-name: admin-notification-legacy-table">
        <div class="flex flex-col gap-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800/60">
          <div>
            <h2 class="text-xs font-semibold text-primary">Legacy email entries</h2>
            <p class="text-[10px] text-dimmed">
              {items.length} of {total} entries
            </p>
          </div>
          <NotificationFilterBar search={search} status={status} />
          {searchSummary && (
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="inline-flex h-7 items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                <i class="ti ti-search text-sm" />
                {numberFormat.format(searchSummary.total)} matches
              </span>
              <span
                class={`inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ${searchSummary.error > 0 ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}
              >
                <i class="ti ti-alert-circle text-sm" />
                {numberFormat.format(searchSummary.error)} errors
              </span>
              <span class="inline-flex h-7 items-center gap-1.5 rounded-full bg-amber-100 px-2.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">
                <i class="ti ti-clock text-sm" />
                {numberFormat.format(searchSummary.pending)} pending
              </span>
            </div>
          )}
        </div>
        <DataTable
          rows={items}
          columns={columns}
          getRowId={(item) => item.id}
          hoverRows
          class="overflow-x-auto"
          empty={search ? "No legacy notifications match this search." : "No legacy notifications found."}
          renderCell={({ row: item, col }) => {
            if (col.id === "status") return legacyStatusBadge(item.status);
            if (col.id === "recipient") return item.recipient;
            if (col.id === "subject")
              return <span title={item.error ? `${item.subject} · ${item.error}` : item.subject}>{item.subject}</span>;
            if (col.id === "sentBy") return <span class="text-dimmed">{item.sentByName ?? <span class="italic">System</span>}</span>;
            if (col.id === "created") return <span class="text-dimmed">{dateFormat.format(item.createdAt)}</span>;
            if (col.id === "actions") {
              return (
                <NotificationActions
                  id={item.id}
                  status={item.status}
                  subject={item.subject}
                  content={item.content}
                  recipient={item.recipient}
                  error={item.error}
                  isAdmin={isAdmin}
                />
              );
            }
            return "";
          }}
        />
      </section>
      <Pagination currentPage={pagination.page} totalPages={pagination.total_pages} baseUrl={baseUrl} />
    </>,
  );
});
