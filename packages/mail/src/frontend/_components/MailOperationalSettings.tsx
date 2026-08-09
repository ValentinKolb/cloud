import { type DateContext, dates, text } from "@k2b/stdlib";
import { mutation as mutations } from "@k2b/stdlib/solid";
import {
  Button,
  DataTable,
  type DataTableColumn,
  IconButton,
  NoticeCard,
  Placeholder,
  ProgressBar,
  prompts,
  StatusBadge,
  type StatusTone,
  toast,
} from "@k2b/ui";
import { createResource, createSignal, For, onCleanup, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type {
  Mailbox,
  MailboxOperationalHealth,
  MailboxOperatorOperations,
  OperatorActionEligibility,
  ProviderBinding,
  ProviderConnection,
  RedactedOperatorCommand,
} from "../../contracts";
import { PROVIDER_LIMIT_MAX_AGE_MS } from "../../contracts";
import { readApiError } from "./api-response";
import { formatHealthEventAge, mailboxHealthPresentation, mailboxOperationalHealthSummary } from "./mail-health-presentation";

const healthTone = (health: Mailbox["health"]): StatusTone => (health === "active" ? "ok" : health === "paused" ? "neutral" : "warning");

const providerLimitCheckedLabel = (checkedAt: string, dateConfig: DateContext): string =>
  Date.parse(checkedAt) <= 0
    ? "Not checked yet"
    : Date.now() - Date.parse(checkedAt) > PROVIDER_LIMIT_MAX_AGE_MS
      ? `Outdated · checked ${dates.formatDateTimeRelative(checkedAt, dateConfig)}`
      : `Checked ${dates.formatDateTimeRelative(checkedAt, dateConfig)}`;

const actionLabel = (kind: OperatorActionEligibility["kind"]): string =>
  ({
    sync_mailbox: "Sync mailbox",
    sync_folder: "Sync folder",
    discover_folders: "Rediscover folders",
    verify_binding: "Verify connection",
    rebuild_folder: "Rebuild folder",
    hydrate_missing: "Hydrate missing bodies",
    rebuild_search: "Rebuild search",
    rebuild_threads: "Repair thread projection",
    reconcile_effect: "Reconcile effect",
    retry_command: "Retry work",
    cancel_command: "Cancel work",
  })[kind];

const activityLabel = (kind: RedactedOperatorCommand["kind"]): string =>
  ({
    sync_mailbox: "Mailbox synchronization",
    sync_folder: "Folder synchronization",
    discover_folders: "Folder discovery",
    verify_binding: "Connection verification",
    rebuild_folder: "Folder rebuild",
    hydrate_missing: "Message hydration repair",
    rebuild_search: "Search index rebuild",
    rebuild_threads: "Conversation repair",
    reconcile_effect: "Provider reconciliation",
    retry_command: "Maintenance retry",
    cancel_command: "Maintenance cancellation",
    set_flags: "Message flag update",
    change_message_state: "Message state update",
    move: "Message move",
    copy: "Message copy",
    delete: "Message deletion",
    create_folder: "Folder creation",
    rename_folder: "Folder rename",
    delete_folder: "Folder deletion",
    set_folder_subscription: "Folder subscription",
    send: "Message delivery",
  })[kind];

const activityState = (state: RedactedOperatorCommand["state"]): { label: string; icon: string; tone: StatusTone } => {
  if (state === "confirmed" || state === "reconciled") {
    return { label: "Completed", icon: "ti-circle-check", tone: "ok" };
  }
  if (state === "failed") {
    return { label: "Failed", icon: "ti-alert-circle", tone: "error" };
  }
  if (state === "ambiguous" || state === "needs_attention") {
    return { label: "Needs attention", icon: "ti-alert-triangle", tone: "warning" };
  }
  if (state === "executing") {
    return { label: "In progress", icon: "ti-loader-2 animate-spin", tone: "running" };
  }
  if (state === "queued") {
    return { label: "Queued", icon: "ti-clock", tone: "neutral" };
  }
  return { label: "Cancelled", icon: "ti-circle-minus", tone: "neutral" };
};

const errorLabel = (code: string): string => {
  const label = code.toLowerCase().replaceAll("_", " ");
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
};

const recentActivityColumns: DataTableColumn<RedactedOperatorCommand>[] = [
  { id: "activity", header: "Activity", value: (row) => activityLabel(row.kind) },
  {
    id: "detail",
    header: "Details",
    value: (row) => (row.errorCode ? `Error ${row.errorCode}` : row.attempt > 1 ? `Attempt ${row.attempt}` : ""),
  },
  { id: "updatedAt", header: "Updated", value: "updatedAt", class: "w-36" },
];

export default function MailOperationalSettings(props: {
  mailbox: Mailbox;
  health: MailboxOperationalHealth;
  bindings: ProviderBinding[];
  connections: ProviderConnection[];
  dateConfig: DateContext;
  reloading: boolean;
  onReload: () => Promise<void>;
  onWorkspaceChange: () => void;
}) {
  let disposed = false;
  const [refreshingConnectionId, setRefreshingConnectionId] = createSignal<string | null>(null);
  type OperationalCommand =
    | { kind: "sync_mailbox" }
    | { kind: "discover_folders"; bindingId?: string }
    | { kind: "verify_binding"; bindingId: string };
  const [lastCommand, setLastCommand] = createSignal<OperationalCommand["kind"]>("sync_mailbox");
  const actionKeys = new Map<string, string>();
  const [operatorStatus, operatorStatusActions] = createResource(
    () => props.mailbox.id,
    async (mailboxId): Promise<MailboxOperatorOperations> => {
      const response = await apiClient.mailboxes[":mailboxId"].operations.$get({ param: { mailboxId }, query: {} });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to load mailbox operator status"));
      return response.json();
    },
  );
  const loadMoreAttention = mutations.create<MailboxOperatorOperations, string>({
    mutation: async (attentionCursor, { abortSignal }) => {
      const response = await apiClient.mailboxes[":mailboxId"].operations.$get(
        {
          param: { mailboxId: props.mailbox.id },
          query: { attentionCursor, attentionLimit: "100" },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Failed to load more operator attention items"));
      return response.json();
    },
    onSuccess: (page) => {
      const current = operatorStatus();
      if (!current) return;
      const existing = new Set(current.attentionCommands.map((item) => item.id));
      operatorStatusActions.mutate({
        ...current,
        attentionCommands: [...current.attentionCommands, ...page.attentionCommands.filter((item) => !existing.has(item.id))],
        nextAttentionCursor: page.nextAttentionCursor,
      });
    },
    onError: (error) => prompts.error(error.message),
  });
  const updateSync = mutations.create<Mailbox, boolean>({
    mutation: async (syncEnabled, { abortSignal }) => {
      const response = await apiClient.mailboxes[":mailboxId"].$patch(
        {
          param: { mailboxId: props.mailbox.id },
          json: { syncEnabled },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, syncEnabled ? "Failed to resume mailbox" : "Failed to pause mailbox"));
      return response.json();
    },
    onSuccess: async (mailbox) => {
      toast.success(mailbox.syncEnabled ? "Mailbox resumed" : "Mailbox paused");
      props.onWorkspaceChange();
      await props.onReload();
    },
    onError: (error) => prompts.error(error.message),
  });

  const command = mutations.create<void, OperationalCommand>({
    mutation: async (input, { abortSignal }) => {
      setLastCommand(input.kind);
      const response = await apiClient.mailboxes[":mailboxId"].commands.$post(
        {
          param: { mailboxId: props.mailbox.id },
          json: { ...input, idempotencyKey: crypto.randomUUID() },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Failed to start mailbox maintenance"));
    },
    onSuccess: async () => {
      toast.success(
        lastCommand() === "sync_mailbox"
          ? "Mailbox synchronization started"
          : lastCommand() === "verify_binding"
            ? "Provider verification started"
            : "Folder discovery started",
      );
      props.onWorkspaceChange();
      await operatorStatusActions.refetch();
      await props.onReload();
    },
    onError: (error) => prompts.error(error.message),
  });
  const refreshLimits = mutations.create<ProviderConnection, string>({
    mutation: async (connectionId, { abortSignal }) => {
      const response = await apiClient.mailboxes[":mailboxId"].connections[":connectionId"].limits.refresh.$post(
        {
          param: { mailboxId: props.mailbox.id, connectionId },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) {
        throw new Error(await readApiError(response, "Failed to refresh provider limits"));
      }
      return response.json();
    },
    onSuccess: async () => {
      toast.success("Provider limits refreshed");
      setRefreshingConnectionId(null);
      await props.onReload();
    },
    onError: (error) => {
      setRefreshingConnectionId(null);
      prompts.error(error.message);
    },
  });
  const operatorCommand = mutations.create<void, OperatorActionEligibility>({
    mutation: async (action, { abortSignal }) => {
      const key = `${action.kind}:${JSON.stringify(action.target)}`;
      const idempotencyKey = actionKeys.get(key) ?? crypto.randomUUID();
      actionKeys.set(key, idempotencyKey);
      const response = await apiClient.mailboxes[":mailboxId"]["operator-actions"].$post(
        {
          param: { mailboxId: props.mailbox.id },
          json: { kind: action.kind, ...action.target, idempotencyKey } as never,
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Failed to queue Mail operator action"));
      actionKeys.delete(key);
    },
    onSuccess: async () => {
      toast.success("Mail operator action queued");
      await operatorStatusActions.refetch();
      props.onWorkspaceChange();
    },
    onError: (error) => prompts.error(error.message),
  });
  onCleanup(() => {
    disposed = true;
    loadMoreAttention.abort();
    updateSync.abort();
    command.abort();
    refreshLimits.abort();
    operatorCommand.abort();
  });

  const pause = async () => {
    const confirmed = await prompts.confirm(
      "Incoming synchronization, queued provider changes, scheduled delivery, and automatic replies stop until the mailbox is resumed.",
      { title: "Pause mailbox?", confirmText: "Pause mailbox" },
    );
    if (!disposed && confirmed) updateSync.mutate(false);
  };

  const busy = () => props.reloading || updateSync.loading() || command.loading() || operatorCommand.loading() || refreshLimits.loading();
  const syncLoading = () => command.loading() && lastCommand() === "sync_mailbox";

  const connectedBinding = () =>
    props.bindings.find((binding) => binding.state === "active") ?? props.bindings.find((binding) => binding.state !== "revoked");
  const discoveryNeedsAttention = () => props.health.discovery.missingFolders + props.health.discovery.ambiguousFolders;
  const healthPresentation = () => mailboxHealthPresentation({ health: props.health.health, healthReason: props.health.healthReason });
  const healthSummary = () => mailboxOperationalHealthSummary(props.health);

  return (
    <div class="flex flex-col gap-5">
      <section class="flex flex-wrap items-start gap-4 rounded-[var(--ui-radius-surface)] bg-[var(--ui-surface-subtle)] p-4">
        <span class="thumbnail flex h-10 w-10 shrink-0 items-center justify-center app-accent-text">
          <i class={`ti ${props.health.health === "active" ? "ti-heartbeat" : "ti-alert-circle"}`} aria-hidden="true" />
        </span>
        <div class="min-w-64 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="text-base font-semibold text-primary">Mailbox status</h3>
            <StatusBadge tone={healthTone(props.health.health)} label={props.health.health.replaceAll("_", " ")} />
          </div>
          <p class="mt-1 text-sm text-secondary">
            {healthPresentation()?.message ||
              (props.health.health === "active"
                ? "Provider access and background synchronization are operational."
                : "Review provider access before relying on delivery or synchronization.")}
          </p>
          <p class="mt-2 text-xs text-dimmed">
            {connectedBinding()?.authenticatedPrincipal || "No connected account"}
            {" · "}
            <Show when={props.health.sync.lastAt} fallback="No successful synchronization yet">
              {(lastAt) => (
                <time datetime={lastAt()} title={dates.formatDateTime(lastAt(), props.dateConfig)}>
                  Last successful sync {dates.formatDateTimeRelative(lastAt(), props.dateConfig)}
                </time>
              )}
            </Show>
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            type="button"
            disabled={busy() || !props.mailbox.syncEnabled}
            aria-busy={syncLoading()}
            onClick={() => command.mutate({ kind: "sync_mailbox" })}
          >
            <i class={`ti ${syncLoading() ? "ti-loader-2 animate-spin" : "ti-refresh"}`} aria-hidden="true" />
            Sync now
          </Button>
          <Show
            when={props.mailbox.syncEnabled}
            fallback={
              <Button variant="secondary" size="sm" type="button" disabled={busy()} onClick={() => updateSync.mutate(true)}>
                <i class="ti ti-player-play" aria-hidden="true" /> Resume mailbox
              </Button>
            }
          >
            <Button variant="secondary" size="sm" type="button" disabled={busy()} onClick={() => void pause()}>
              <i class="ti ti-player-pause" aria-hidden="true" /> Pause mailbox
            </Button>
          </Show>
        </div>
      </section>

      <div class="flex flex-wrap gap-x-5 gap-y-2 rounded-[var(--ui-radius-control)] bg-[var(--ui-surface)] px-3 py-2.5 text-xs text-secondary">
        <span class="flex items-center gap-1.5">
          <i class="ti ti-server app-accent-text" aria-hidden="true" />
          {healthSummary().accounts}
        </span>
        <span class="flex items-center gap-1.5">
          <i class={`ti ${discoveryNeedsAttention() > 0 ? "ti-alert-triangle" : "ti-folders"} app-accent-text`} aria-hidden="true" />
          {healthSummary().discovery}
        </span>
        <span class="flex items-center gap-1.5">
          <i class="ti ti-refresh app-accent-text" aria-hidden="true" />
          {healthSummary().synchronization}
        </span>
        <span class="flex items-center gap-1.5">
          <i class="ti ti-search app-accent-text" aria-hidden="true" />
          {healthSummary().search}
        </span>
      </div>

      <section class="flex flex-col gap-3">
        <div>
          <h3 class="text-sm font-semibold text-primary">Provider limits</h3>
          <p class="mt-1 text-xs text-dimmed">Mailbox usage reported by IMAP and outgoing message limits advertised by SMTP.</p>
        </div>
        <Show
          when={props.connections.some((connection) => connection.status !== "revoked")}
          fallback={<p class="text-xs text-secondary">Connect a mail provider to inspect its published limits.</p>}
        >
          <div class="flex flex-col gap-2">
            <For each={props.connections.filter((connection) => connection.status !== "revoked")}>
              {(connection) => {
                const storage = () => connection.limits.imap.storage;
                const storagePercent = () => {
                  const value = storage();
                  if (!value) return 0;
                  if (value.limit === 0) return value.used === 0 ? 0 : 100;
                  return Math.min(100, (value.used / value.limit) * 100);
                };
                return (
                  <div class="flex flex-col gap-2 rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)] px-3 py-2.5">
                    <div class="flex min-w-0 items-center gap-3">
                      <i class="ti ti-server shrink-0 text-secondary" aria-hidden="true" />
                      <div class="min-w-0 flex-1">
                        <p class="truncate text-sm font-medium text-primary">{connection.name}</p>
                        <p class="truncate text-xs text-dimmed">{connection.email}</p>
                      </div>
                      <span class="shrink-0 text-xs text-dimmed">
                        {providerLimitCheckedLabel(connection.limits.checkedAt, props.dateConfig)}
                      </span>
                      <IconButton
                        type="button"
                        size="sm"
                        title="Refresh provider limits"
                        label={`Refresh limits for ${connection.name}`}
                        disabled={busy()}
                        onClick={() => {
                          setRefreshingConnectionId(connection.id);
                          refreshLimits.mutate(connection.id);
                        }}
                      >
                        <i
                          class={`ti ${refreshingConnectionId() === connection.id ? "ti-loader-2 animate-spin" : "ti-refresh"}`}
                          aria-hidden="true"
                        />
                      </IconButton>
                    </div>
                    <Show
                      when={storage()}
                      fallback={
                        <p class="text-xs text-secondary">
                          {connection.limits.imap.status === "unsupported"
                            ? "This IMAP server does not publish mailbox storage limits."
                            : connection.limits.imap.status === "supported"
                              ? "No mailbox storage quota was reported."
                              : "Mailbox storage usage is currently unavailable."}
                        </p>
                      }
                    >
                      {(quota) => (
                        <div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
                          <ProgressBar
                            value={storagePercent()}
                            size="xs"
                            tone={storagePercent() >= 90 ? "danger" : "info"}
                            label={`${connection.name} mailbox storage`}
                          />
                          <span class="text-xs tabular-nums text-secondary">
                            {text.pprintBytes(quota().used)} of {text.pprintBytes(quota().limit)}
                          </span>
                        </div>
                      )}
                    </Show>
                    <Show when={connection.limits.imap.messages}>
                      {(quota) => (
                        <p class="text-xs tabular-nums text-secondary">
                          {quota().used} of {quota().limit} messages
                        </p>
                      )}
                    </Show>
                    <p class="text-xs text-secondary">
                      {connection.limits.smtp.maxMessageBytes
                        ? `Maximum outgoing message: ${text.pprintBytes(connection.limits.smtp.maxMessageBytes)} including encoded attachments.`
                        : connection.limits.smtp.status === "unsupported"
                          ? "This SMTP server does not publish an outgoing message limit."
                          : connection.limits.smtp.status === "supported"
                            ? "SMTP size declarations are supported, but no maximum was published."
                            : "The outgoing message limit is currently unavailable."}
                    </p>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </section>

      <Show when={operatorStatus.loading && !operatorStatus()}>
        <Placeholder state="loading" variant="panel" title="Loading mailbox activity" />
      </Show>
      <Show when={operatorStatus.error}>
        <Placeholder
          state="error"
          variant="panel"
          title="Could not load mailbox activity"
          description={operatorStatus.error instanceof Error ? operatorStatus.error.message : "Try loading the mailbox status again."}
          action={
            <Button variant="secondary" size="sm" type="button" onClick={() => void operatorStatusActions.refetch()}>
              <i class="ti ti-refresh" aria-hidden="true" />
              Retry
            </Button>
          }
        />
      </Show>
      <Show when={operatorStatus()}>
        {(status) => (
          <section class="flex flex-col gap-3">
            <div>
              <h3 class="text-sm font-semibold text-primary">Recent activity</h3>
              <p class="mt-1 text-xs text-dimmed">Synchronization, discovery, and repair work for this mailbox.</p>
            </div>
            <DataTable
              rows={status().recentCommands}
              columns={recentActivityColumns}
              getRowId={(row) => row.id}
              density="compact"
              surface="paper"
              stickyHeader={false}
              ariaLabel="Recent mailbox activity"
              empty={
                status().sync.lastAt ? (
                  <span class="inline-flex items-center gap-2">
                    <i class="ti ti-circle-check" aria-hidden="true" />
                    Mailbox synchronized
                    <time class="text-dimmed" datetime={status().sync.lastAt!}>
                      {dates.formatDateTimeRelative(status().sync.lastAt!, props.dateConfig)}
                    </time>
                  </span>
                ) : (
                  "No maintenance activity yet."
                )
              }
              renderCell={({ row, col, render }) => {
                if (col.id === "activity") {
                  const state = activityState(row.state);
                  const completed = row.state === "confirmed" || row.state === "reconciled";
                  return (
                    <span class="flex min-w-0 items-center gap-2">
                      <i class={`ti ${state.icon} shrink-0`} aria-hidden="true" />
                      <span class="truncate font-medium text-primary">{activityLabel(row.kind)}</span>
                      <Show when={!completed}>
                        <StatusBadge tone={state.tone} label={state.label} />
                      </Show>
                    </span>
                  );
                }
                if (col.id === "detail") {
                  const detail = row.errorCode ? `Error ${row.errorCode}` : row.attempt > 1 ? `Attempt ${row.attempt}` : null;
                  return detail ? <span class="text-secondary">{detail}</span> : <span class="text-dimmed">—</span>;
                }
                if (col.id === "updatedAt") {
                  return (
                    <time class="whitespace-nowrap text-dimmed" datetime={row.updatedAt}>
                      {dates.formatDateTimeRelative(row.updatedAt, props.dateConfig)}
                    </time>
                  );
                }
                return render(row.updatedAt);
              }}
            />
          </section>
        )}
      </Show>

      <details class="group rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)]">
        <summary class="focus-ui flex cursor-pointer list-none items-center justify-between gap-3 rounded-[var(--ui-radius-control)] px-3 py-2.5 text-sm font-medium text-primary">
          <span class="flex items-center gap-2">
            <i class="ti ti-tool" aria-hidden="true" />
            Advanced diagnostics and repairs
          </span>
          <i class="ti ti-chevron-down transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <section class="flex flex-col gap-5 px-3 pb-3">
          <Show when={operatorStatus()}>
            {(status) => (
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p class="text-xs font-semibold text-primary">Repair and projection coverage</p>
                  <p class="mt-1 text-xs text-dimmed">
                    Hydration {status().coverage.hydration.covered}/{status().coverage.hydration.total}; search{" "}
                    {status().coverage.search.covered}/{status().coverage.search.total}; threads {status().coverage.threads.covered}/
                    {status().coverage.threads.total}
                  </p>
                </div>
                <div class="flex flex-wrap gap-2">
                  <For
                    each={status().actions.filter((action) =>
                      ["hydrate_missing", "rebuild_search", "rebuild_threads"].includes(action.kind),
                    )}
                  >
                    {(action) => (
                      <Button
                        variant="secondary"
                        size="sm"
                        type="button"
                        disabled={busy() || !action.eligible}
                        title={action.reason ?? actionLabel(action.kind)}
                        onClick={() => operatorCommand.mutate(action)}
                      >
                        <i class="ti ti-tool" aria-hidden="true" /> {actionLabel(action.kind)}
                      </Button>
                    )}
                  </For>
                </div>
              </div>
            )}
          </Show>

          <div class="flex flex-col gap-2">
            <p class="text-xs font-semibold text-primary">Connected accounts</p>
            <Show
              when={props.bindings.some((binding) => binding.state !== "revoked")}
              fallback={<p class="text-xs text-dimmed">No connected account. Connect a provider before running discovery.</p>}
            >
              <For each={props.bindings.filter((binding) => binding.state !== "revoked")}>
                {(binding) => (
                  <div class="flex flex-wrap items-center gap-3 rounded-[var(--ui-radius-control)] bg-[var(--ui-surface)] px-3 py-2.5">
                    <i class="ti ti-server text-lg text-dimmed" aria-hidden="true" />
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-sm font-medium text-primary">
                        {binding.authenticatedPrincipal || "Remote mailbox"}
                      </span>
                      <span class="block text-xs text-dimmed">
                        {binding.state.replaceAll("_", " ")}
                        {binding.lastError ? ` · ${binding.lastError}` : ""}
                      </span>
                    </span>
                    <Show
                      when={binding.state === "pending"}
                      fallback={
                        <Button
                          variant="secondary"
                          size="sm"
                          type="button"
                          disabled={busy()}
                          onClick={() => command.mutate({ kind: "discover_folders", bindingId: binding.id })}
                        >
                          <i class="ti ti-folders" aria-hidden="true" /> Rediscover
                        </Button>
                      }
                    >
                      <Button
                        size="sm"
                        type="button"
                        disabled={busy()}
                        onClick={() => command.mutate({ kind: "verify_binding", bindingId: binding.id })}
                      >
                        <i class="ti ti-shield-check" aria-hidden="true" /> Verify connection
                      </Button>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </div>

          <Show when={operatorStatus()}>
            {(status) => (
              <>
                <Show when={status().folders.length > 0}>
                  <div class="flex flex-col gap-2">
                    <p class="text-xs font-semibold text-primary">Folder maintenance</p>
                    <NoticeCard tone="neutral" icon={false} bodyClass="flex items-start gap-2">
                      <i class="ti ti-info-circle mt-0.5 shrink-0" aria-hidden="true" />
                      <p>
                        <strong>Sync folder</strong> fetches new and changed messages. <strong>Rebuild folder</strong> downloads the folder
                        again from your mail provider. Try Sync first; use Rebuild when messages stay missing or outdated.
                      </p>
                    </NoticeCard>
                    <For each={status().folders}>
                      {(folder) => (
                        <div class="flex flex-wrap items-center gap-2 rounded-[var(--ui-radius-control)] bg-[var(--ui-surface)] px-3 py-2">
                          <span class="min-w-0 flex-1 text-xs text-secondary">
                            <span class="block truncate font-medium text-primary">{folder.name}</span>
                            <span>
                              {folder.discoveryState.replaceAll("_", " ")} · {folder.syncStatus.replaceAll("_", " ")}
                            </span>
                          </span>
                          <For each={folder.actions}>
                            {(action) => (
                              <Button
                                variant="secondary"
                                size="sm"
                                type="button"
                                disabled={busy() || !action.eligible}
                                title={action.reason ?? actionLabel(action.kind)}
                                onClick={() => operatorCommand.mutate(action)}
                              >
                                <i class="ti ti-tool" aria-hidden="true" /> {actionLabel(action.kind)}
                              </Button>
                            )}
                          </For>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>

                <Show when={status().attentionCommands.length > 0}>
                  <div class="flex flex-col gap-2">
                    <p class="text-xs font-semibold text-primary">Needs attention</p>
                    <For each={status().attentionCommands}>
                      {(item) => {
                        const state = activityState(item.state);
                        return (
                          <div class="flex flex-wrap items-center gap-3 rounded-[var(--ui-radius-control)] bg-[var(--ui-surface)] px-3 py-2.5">
                            <span class="min-w-64 flex-1">
                              <span class="flex flex-wrap items-center gap-2">
                                <span class="text-sm font-medium text-primary">{activityLabel(item.kind)}</span>
                                <StatusBadge tone={state.tone} label={state.label} />
                              </span>
                              <span class="mt-0.5 block text-xs text-secondary">
                                <time datetime={item.updatedAt} title={dates.formatDateTime(item.updatedAt, props.dateConfig)}>
                                  Updated {formatHealthEventAge(item.updatedAt)}
                                </time>
                                {item.errorCode ? ` · ${errorLabel(item.errorCode)}` : ""}
                              </span>
                              <span class="block truncate text-[11px] text-dimmed" title={item.id}>
                                Command {item.id}
                              </span>
                            </span>
                            <div class="flex flex-wrap gap-2">
                              <For each={item.actions.filter((action) => action.eligible)}>
                                {(action) => (
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    type="button"
                                    disabled={busy()}
                                    onClick={() => operatorCommand.mutate(action)}
                                  >
                                    {actionLabel(action.kind)}
                                  </Button>
                                )}
                              </For>
                            </div>
                          </div>
                        );
                      }}
                    </For>
                    <Show when={status().nextAttentionCursor}>
                      {(cursor) => (
                        <Button
                          variant="ghost"
                          size="sm"
                          type="button"
                          class="self-center"
                          disabled={loadMoreAttention.loading()}
                          onClick={() => loadMoreAttention.mutate(cursor())}
                        >
                          <i
                            class={loadMoreAttention.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-chevron-down"}
                            aria-hidden="true"
                          />
                          Load more attention items
                        </Button>
                      )}
                    </Show>
                  </div>
                </Show>
              </>
            )}
          </Show>
        </section>
      </details>
    </div>
  );
}
