import type { AuthContext } from "@valentinkolb/cloud/server";
import {
  accounts,
  accountsAppService as accountsService,
  notificationBatches,
  type NotificationBatch,
  type NotificationBatchRecipient,
  type NotificationBatchRecipientStatus,
} from "@valentinkolb/cloud/services";
import { Layout } from "@valentinkolb/cloud/ssr";
import { DataTable, type DataTableColumn, MarkdownView, Pagination, Placeholder, StatCell, StatGrid } from "@valentinkolb/cloud/ui";
import { dates } from "@valentinkolb/stdlib";
import { expectUserBackedActor } from "@/shared/actor";
import { ssr } from "../../config";
import AccountsWorkspace from "../AccountsWorkspace";
import NotificationBatchActions from "./NotificationBatchActions.island";
import NotificationRecipientActions from "./NotificationRecipientActions.island";
import NotificationRecipientStatusFilters from "./NotificationRecipientStatusFilters.island";

const MAX_PAGE = 10_000;
const AUDIENCE_PREVIEW_LIMIT = 50;

const parsePage = (value: string | undefined): number => {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, MAX_PAGE) : 1;
};

const validRecipientStatus = (value: string | undefined): NotificationBatchRecipientStatus | undefined => {
  if (value === "pending" || value === "sending" || value === "sent" || value === "skipped" || value === "error") return value;
  return undefined;
};

const statusClass = (status: NotificationBatch["status"] | NotificationBatchRecipient["status"]) => {
  if (status === "completed" || status === "sent") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300";
  if (status === "completed_with_errors" || status === "failed" || status === "error")
    return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
  if (status === "running" || status === "ready" || status === "pending" || status === "sending")
    return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";
  return "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
};

const statusLabel = (status: NotificationBatch["status"] | NotificationBatchRecipient["status"]) =>
  status
    .split("_")
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");

const formatCount = new Intl.NumberFormat("en");

const RULE_LABELS: Record<string, { label: string; icon: string }> = {
  account_manager: { label: "Account managers", icon: "ti ti-shield-check" },
  local: { label: "Local accounts", icon: "ti ti-device-desktop" },
  ipa: { label: "FreeIPA accounts", icon: "ti ti-server" },
  guest: { label: "Guests", icon: "ti ti-user-question" },
  user: { label: "Full users", icon: "ti ti-user" },
};

const recipientBaseUrl = (batchId: string, status?: string) => {
  const query = new URLSearchParams();
  if (status) query.set("recipient_status", status);
  const search = query.toString();
  return search ? `/app/accounts/notifications/${batchId}?${search}&page=` : `/app/accounts/notifications/${batchId}?page=`;
};

export default ssr<AuthContext>(async (c) => {
  const user = expectUserBackedActor(c);
  const batchId = c.req.param("id");
  if (!batchId) return c.notFound();
  const page = parsePage(c.req.query("page"));
  const perPage = 100;
  const recipientStatus = validRecipientStatus(c.req.query("recipient_status"));

  const [pendingRequestsPage, batch] = await Promise.all([
    accountsService.accountRequest.list({ access: { userId: user.id, isAdmin: true }, filter: { status: "pending" } }),
    notificationBatches.get(batchId),
  ]);

  if (!batch) {
    return c.notFound();
  }

  const recipientsPage =
    batch.status === "draft"
      ? { items: [] as NotificationBatchRecipient[], total: 0 }
      : await notificationBatches.listRecipients({ batchId, page, perPage, status: recipientStatus });
  const totalPages = Math.max(1, Math.ceil(recipientsPage.total / perPage));
  const selectionUserIds = batch.selection.userIds ?? [];
  const selectionGroupIds = batch.selection.groupIds ?? [];
  const previewSelectionUserIds = selectionUserIds.slice(0, AUDIENCE_PREVIEW_LIMIT);
  const previewSelectionGroupIds = selectionGroupIds.slice(0, AUDIENCE_PREVIEW_LIMIT);
  const [selectionUsers, selectionGroups] = await Promise.all([
    previewSelectionUserIds.length > 0
      ? accounts.users.list({ ids: previewSelectionUserIds, perPage: Math.max(previewSelectionUserIds.length, 1) }).then((result) => result.users)
      : [],
    previewSelectionGroupIds.length > 0
      ? accounts.groups.list({ ids: previewSelectionGroupIds, perPage: Math.max(previewSelectionGroupIds.length, 1) }).then((result) => result.groups)
      : [],
  ]);
  const selectionRules = batch.selection.rules ?? [];
  const legacySources = [
    batch.selection.all ? { label: "All users", icon: "ti ti-users" } : null,
    batch.selection.accountManagers?.mode === "all" ? { label: "All account managers", icon: "ti ti-shield-check" } : null,
    batch.selection.providers?.includes("local") ? { label: "Local accounts", icon: "ti ti-device-desktop" } : null,
    batch.selection.providers?.includes("ipa") ? { label: "FreeIPA accounts", icon: "ti ti-server" } : null,
    batch.selection.profiles?.includes("guest") ? { label: "Guests", icon: "ti ti-user-question" } : null,
    batch.selection.profiles?.includes("user") ? { label: "Full users", icon: "ti ti-user" } : null,
  ].filter((entry): entry is { label: string; icon: string } => Boolean(entry));

  const columns: DataTableColumn<NotificationBatchRecipient>[] = [
    { id: "user", header: "User", value: (entry) => entry.displayName || entry.uid, cellClass: "min-w-[14rem]" },
    { id: "recipient", header: "Email", value: (entry) => entry.recipient, cellClass: "max-w-[18rem]" },
    { id: "provider", header: "Provider", value: (entry) => entry.provider },
    { id: "profile", header: "Profile", value: (entry) => entry.profile },
    { id: "status", header: "Status", value: (entry) => entry.status },
    { id: "attempts", header: "Attempts", value: (entry) => entry.attemptCount },
    { id: "sent", header: "Sent", value: (entry) => entry.sentAt, cellClass: "whitespace-nowrap" },
    { id: "actions", header: "", value: () => "", cellClass: "w-0 whitespace-nowrap text-right" },
  ];

  return () => (
    <Layout
      c={c}
      fullWidth
      title={[
        { title: "Start", href: "/" },
        { title: "Accounts", href: "/app/accounts" },
        { title: "Notifications", href: "/app/accounts/notifications" },
        { title: batch.subject },
      ]}
    >
      <AccountsWorkspace active="notifications" isAdmin pendingRequests={pendingRequestsPage.total} scrollPreserveKey="accounts-notification-detail">
        <div class="flex flex-col gap-2">
          <div class="flex items-start gap-2">
            <div class="min-w-0 flex-1">
              <h1 class="truncate text-base font-semibold text-primary">{batch.subject}</h1>
              <p class="mt-1 text-xs text-dimmed">Created {dates.formatDateTime(batch.createdAt)}</p>
            </div>
            <NotificationBatchActions
              batchId={batch.id}
              status={batch.status}
              selection={batch.selection}
              selectionHash={batch.selectionHash}
              errorCount={batch.errorCount}
            />
          </div>

          <StatGrid columns={5}>
            <StatCell
              label="Status"
              value={<span class={`inline-flex w-fit rounded px-1.5 py-0.5 text-[10px] font-medium ${statusClass(batch.status)}`}>{statusLabel(batch.status)}</span>}
            />
            <StatCell label="Matched" value={formatCount.format(batch.targetCount)} />
            <StatCell label="Deliverable" value={formatCount.format(batch.deliverableCount)} sub={`${formatCount.format(batch.skippedCount)} skipped`} />
            <StatCell label="Sent" value={formatCount.format(batch.sentCount)} />
            <StatCell
              label="Errors"
              value={formatCount.format(batch.errorCount)}
              valueClass={batch.errorCount > 0 ? "text-red-600 dark:text-red-400" : undefined}
              accent={batch.errorCount > 0 ? { tone: "red", icon: "ti ti-alert-circle" } : undefined}
            />
          </StatGrid>

          <div class="paper p-4">
            <div class="flex items-start gap-2">
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-dimmed dark:bg-zinc-800">
                <i class={batch.selection.mode === "specific" ? "ti ti-user-plus" : "ti ti-filter"} />
              </span>
              <div class="min-w-0 flex-1">
                <h2 class="text-sm font-semibold text-primary">Audience</h2>
                <p class="mt-1 text-xs text-dimmed">
                  {batch.selection.mode === "specific"
                    ? "This batch targets the explicitly selected users below."
                    : batch.selection.mode === "rules"
                      ? "This batch resolves users from the selected rules. Categories are combined; values inside one category are alternatives."
                      : "This batch uses the previous audience selection format."}
                </p>
              </div>
            </div>

            <div class="mt-2 grid gap-2 lg:grid-cols-2">
              <div>
                <p class="text-[11px] font-semibold uppercase tracking-wide text-dimmed">
                  {batch.selection.mode === "specific" ? "Users" : "Rule filters"}
                </p>
                <div class="mt-2 flex flex-wrap gap-2">
                  {batch.selection.mode === "specific" ? (
                    selectionUsers.length > 0 ? (
                      <>
                        {selectionUsers.map((user) => (
                          <span class="chip max-w-full" title={user.uid}>
                            <i class="ti ti-user" />
                            <span class="truncate">{user.displayName || user.uid}</span>
                          </span>
                        ))}
                        {selectionUserIds.length > previewSelectionUserIds.length ? (
                          <span class="chip max-w-full">
                            <i class="ti ti-dots" />
                            <span>{formatCount.format(selectionUserIds.length - previewSelectionUserIds.length)} more</span>
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span class="text-xs text-dimmed">No users selected.</span>
                    )
                  ) : batch.selection.mode === "rules" ? (
                    selectionRules.length > 0 ? (
                      selectionRules.map((rule) => {
                        const item = RULE_LABELS[rule] ?? { label: rule, icon: "ti ti-filter" };
                        return (
                          <span class="chip max-w-full">
                            <i class={item.icon} />
                            <span class="truncate">{item.label}</span>
                          </span>
                        );
                      })
                    ) : (
                      <span class="text-xs text-dimmed">No required user properties. All users in scope are included.</span>
                    )
                  ) : legacySources.length > 0 ? (
                    legacySources.map((source) => (
                      <span class="chip max-w-full">
                        <i class={source.icon} />
                        <span class="truncate">{source.label}</span>
                      </span>
                    ))
                  ) : (
                    <span class="text-xs text-dimmed">No audience sources stored.</span>
                  )}
                </div>
              </div>

              <div>
                <p class="text-[11px] font-semibold uppercase tracking-wide text-dimmed">Group scope</p>
                <div class="mt-2 flex flex-wrap gap-2">
                  {selectionGroups.length > 0 ? (
                    <>
                      {selectionGroups.map((group) => (
                        <span class="chip max-w-full" title={group.name}>
                          <i class="ti ti-users-group" />
                          <span class="truncate">{group.name}</span>
                        </span>
                      ))}
                      {selectionGroupIds.length > previewSelectionGroupIds.length ? (
                        <span class="chip max-w-full">
                          <i class="ti ti-dots" />
                          <span>{formatCount.format(selectionGroupIds.length - previewSelectionGroupIds.length)} more</span>
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span class="text-xs text-dimmed">
                      {batch.selection.mode === "rules" ? "No group scope. Rules apply to all accounts." : "No group scope."}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div class="paper p-4">
            <h2 class="text-sm font-semibold text-primary">Message preview</h2>
            <div class="mt-2 rounded-lg bg-muted/30 p-4">
              <MarkdownView html={batch.bodyHtml} smallHeadings />
            </div>
          </div>

          <div class="flex flex-col gap-2">
            <div class="flex items-end gap-2">
              <div class="min-w-0 flex-1">
                <h2 class="text-sm font-semibold text-primary">Recipients</h2>
                <p class="mt-1 text-xs text-dimmed">
                  {batch.status === "draft" ? "Recipients are snapshotted when the batch is finalized." : `${formatCount.format(recipientsPage.total)} recipients`}
                </p>
              </div>
            </div>
            {batch.status !== "draft" ? (
              <NotificationRecipientStatusFilters batchId={batch.id} status={recipientStatus ?? ""} />
            ) : null}

            {batch.status === "draft" ? (
              <Placeholder surface="paper">Finalize this draft to create the recipient snapshot.</Placeholder>
            ) : recipientsPage.items.length === 0 ? (
              <Placeholder surface="paper">No recipients found.</Placeholder>
            ) : (
              <div class="paper overflow-hidden">
                <DataTable
                  rows={recipientsPage.items}
                  columns={columns}
                  getRowId={(entry) => entry.userId}
                  hoverRows
                  class="overflow-x-auto"
                  scrollPreserveKey="accounts-notification-recipients"
                  renderCell={({ row: entry, col }) => {
                    if (col.id === "user") {
                      return (
                        <a href={`/app/accounts/users/${entry.userId}`} class="block min-w-0">
                          <span class="block truncate font-medium text-primary hover:underline">{entry.displayName || entry.uid}</span>
                          <span class="block truncate text-[11px] text-dimmed">{entry.uid}</span>
                        </a>
                      );
                    }
                    if (col.id === "recipient") return <span class="block truncate text-dimmed">{entry.recipient ?? "-"}</span>;
                    if (col.id === "provider") return <span class="text-dimmed">{entry.provider}</span>;
                    if (col.id === "profile") return <span class="text-dimmed">{entry.profile}</span>;
                    if (col.id === "status")
                      return <span class={`w-fit rounded px-1.5 py-0.5 text-[10px] font-medium ${statusClass(entry.status)}`}>{statusLabel(entry.status)}</span>;
                    if (col.id === "attempts") return <span class="text-dimmed">{formatCount.format(entry.attemptCount)}</span>;
                    if (col.id === "sent") return <span class="text-dimmed">{entry.sentAt ? dates.formatDateTime(entry.sentAt) : "-"}</span>;
                    if (col.id === "actions")
                      return <NotificationRecipientActions batchId={batch.id} userId={entry.userId} status={entry.status} error={entry.error} />;
                    return "";
                  }}
                />
              </div>
            )}

            {batch.status !== "draft" ? (
              <div class="pt-1">
                <Pagination currentPage={page} totalPages={totalPages} baseUrl={recipientBaseUrl(batch.id, recipientStatus)} />
              </div>
            ) : null}
          </div>
        </div>
      </AccountsWorkspace>
    </Layout>
  );
});
