import { Placeholder, prompts, toast } from "@valentinkolb/cloud/ui";
import { type DateContext, dates } from "@valentinkolb/stdlib";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createResource, createSignal, For, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type {
  Mailbox,
  MailboxOperationalHealth,
  MailboxOperatorOperations,
  OperatorActionEligibility,
  ProviderBinding,
} from "../../contracts";
import { readApiError } from "./api-response";

const healthTone = (health: Mailbox["health"]): string =>
  health === "active" ? "badge-success" : health === "paused" ? "" : "badge-warning";

const countLabel = (values: Record<string, number>): string => {
  const entries = Object.entries(values).filter(([, count]) => count > 0);
  return entries.length > 0 ? entries.map(([state, count]) => `${count} ${state.replaceAll("_", " ")}`).join(", ") : "None";
};

const actionLabel = (kind: OperatorActionEligibility["kind"]): string =>
  ({
    sync_mailbox: "Sync mailbox",
    sync_folder: "Sync folder",
    discover_folders: "Rediscover folders",
    verify_binding: "Verify binding",
    rebuild_folder: "Rebuild folder",
    hydrate_missing: "Hydrate missing bodies",
    rebuild_search: "Rebuild search",
    rebuild_threads: "Repair thread projection",
    reconcile_effect: "Reconcile effect",
    retry_command: "Retry work",
    cancel_command: "Cancel work",
  })[kind];

export default function MailOperationalSettings(props: {
  mailbox: Mailbox;
  health: MailboxOperationalHealth;
  bindings: ProviderBinding[];
  dateConfig: DateContext;
  reloading: boolean;
  onReload: () => Promise<void>;
  onWorkspaceChange: () => void;
}) {
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
    mutation: async (attentionCursor) => {
      const response = await apiClient.mailboxes[":mailboxId"].operations.$get({
        param: { mailboxId: props.mailbox.id },
        query: { attentionCursor, attentionLimit: "100" },
      });
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
    mutation: async (syncEnabled) => {
      const response = await apiClient.mailboxes[":mailboxId"].$patch({
        param: { mailboxId: props.mailbox.id },
        json: { syncEnabled },
      });
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
    mutation: async (input) => {
      setLastCommand(input.kind);
      const response = await apiClient.mailboxes[":mailboxId"].commands.$post({
        param: { mailboxId: props.mailbox.id },
        json: { ...input, idempotencyKey: crypto.randomUUID() },
      });
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
      await props.onReload();
    },
    onError: (error) => prompts.error(error.message),
  });
  const operatorCommand = mutations.create<void, OperatorActionEligibility>({
    mutation: async (action) => {
      const key = `${action.kind}:${JSON.stringify(action.target)}`;
      const idempotencyKey = actionKeys.get(key) ?? crypto.randomUUID();
      actionKeys.set(key, idempotencyKey);
      const response = await apiClient.mailboxes[":mailboxId"]["operator-actions"].$post({
        param: { mailboxId: props.mailbox.id },
        json: { kind: action.kind, ...action.target, idempotencyKey } as never,
      });
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

  const pause = async () => {
    const confirmed = await prompts.confirm(
      "Incoming synchronization, queued provider changes, scheduled delivery, and automatic replies stop until the mailbox is resumed.",
      { title: "Pause mailbox?", confirmText: "Pause mailbox" },
    );
    if (confirmed) updateSync.mutate(false);
  };

  const busy = () => props.reloading || updateSync.loading() || command.loading() || operatorCommand.loading();

  return (
    <div class="flex flex-col gap-2">
      <div class="paper flex flex-wrap items-start gap-3 p-3">
        <span class="thumbnail flex h-9 w-9 shrink-0 items-center justify-center">
          <i class={`ti ${props.health.health === "active" ? "ti-circle-check" : "ti-alert-circle"}`} aria-hidden="true" />
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <p class="text-sm font-semibold text-primary">Mailbox transport</p>
            <span class={`badge ${healthTone(props.health.health)}`}>{props.health.health.replaceAll("_", " ")}</span>
          </div>
          <p class="mt-1 text-xs text-dimmed">
            {props.health.healthReason ||
              (props.health.health === "active"
                ? "Provider access and background synchronization are operational."
                : "Review provider access before relying on delivery or synchronization.")}
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="btn-secondary btn-sm"
            disabled={busy() || !props.mailbox.syncEnabled}
            onClick={() => command.mutate({ kind: "sync_mailbox" })}
          >
            <i class={`ti ${command.loading() ? "ti-loader-2 animate-spin" : "ti-refresh"}`} aria-hidden="true" />
            Sync now
          </button>
          <Show
            when={props.mailbox.syncEnabled}
            fallback={
              <button type="button" class="btn-primary btn-sm" disabled={busy()} onClick={() => updateSync.mutate(true)}>
                <i class="ti ti-player-play" aria-hidden="true" /> Resume mailbox
              </button>
            }
          >
            <button type="button" class="btn-secondary btn-sm" disabled={busy()} onClick={() => void pause()}>
              <i class="ti ti-player-pause" aria-hidden="true" /> Pause mailbox
            </button>
          </Show>
        </div>
      </div>

      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div class="paper p-3">
          <p class="text-xs font-semibold text-primary">Provider bindings</p>
          <p class="mt-1 text-sm text-secondary">
            {props.health.bindings.active} active of {props.health.bindings.total}
          </p>
          <p class="mt-1 text-xs text-dimmed">
            Last verified{" "}
            {props.health.bindings.lastVerifiedAt
              ? dates.formatDateTimeRelative(props.health.bindings.lastVerifiedAt, props.dateConfig)
              : "never"}
          </p>
        </div>
        <div class="paper p-3">
          <p class="text-xs font-semibold text-primary">Folder discovery</p>
          <p class="mt-1 text-sm text-secondary">{props.health.discovery.activeFolders} active folders</p>
          <p class="mt-1 text-xs text-dimmed">
            {props.health.discovery.missingFolders} missing, {props.health.discovery.ambiguousFolders} need review
          </p>
        </div>
        <div class="paper p-3">
          <p class="text-xs font-semibold text-primary">Synchronization</p>
          <p class="mt-1 text-sm text-secondary">
            {props.health.sync.runningRuns > 0 ? `${props.health.sync.runningRuns} running` : "Idle"}
          </p>
          <p class="mt-1 text-xs text-dimmed">{countLabel(props.health.sync.folderStates)}</p>
        </div>
        <div class="paper p-3">
          <p class="text-xs font-semibold text-primary">Search index</p>
          <p class="mt-1 text-sm text-secondary">{props.health.search.configuredBackend.replaceAll("_", " ")}</p>
          <p class="mt-1 text-xs text-dimmed">{props.health.search.bm25Ready ? "BM25 ranking ready" : "PostgreSQL search available"}</p>
        </div>
      </div>

      <Show when={operatorStatus()}>
        {(status) => (
          <section class="paper flex flex-col gap-3 p-3">
            <div class="flex flex-wrap items-start justify-between gap-2">
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
                  each={status().actions.filter((action) => ["hydrate_missing", "rebuild_search", "rebuild_threads"].includes(action.kind))}
                >
                  {(action) => (
                    <button
                      type="button"
                      class="btn-secondary btn-sm"
                      disabled={busy() || !action.eligible}
                      title={action.reason ?? actionLabel(action.kind)}
                      onClick={() => operatorCommand.mutate(action)}
                    >
                      <i class="ti ti-tool" aria-hidden="true" /> {actionLabel(action.kind)}
                    </button>
                  )}
                </For>
              </div>
            </div>
            <Show when={status().folders.length > 0}>
              <div class="mt-3 flex flex-col gap-2">
                <p class="pb-1 text-xs font-semibold text-primary">Folder maintenance</p>
                <For each={status().folders}>
                  {(folder) => (
                    <div class="flex flex-wrap items-center gap-2 py-1">
                      <span class="min-w-0 flex-1 break-all text-xs text-secondary">
                        <span class="font-medium text-primary">{folder.id}</span> · {folder.discoveryState.replaceAll("_", " ")} ·{" "}
                        {folder.syncStatus.replaceAll("_", " ")}
                      </span>
                      <For each={folder.actions}>
                        {(action) => (
                          <button
                            type="button"
                            class="btn-secondary btn-sm"
                            disabled={busy() || !action.eligible}
                            title={action.reason ?? actionLabel(action.kind)}
                            onClick={() => operatorCommand.mutate(action)}
                          >
                            <i class="ti ti-tool" aria-hidden="true" /> {actionLabel(action.kind)}
                          </button>
                        )}
                      </For>
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <Show when={status().attentionCommands.length > 0}>
              <div class="mt-3 flex flex-col gap-2">
                <For each={status().attentionCommands}>
                  {(item) => (
                    <div class="flex flex-wrap items-center gap-2 py-2">
                      <span class="min-w-0 flex-1 text-xs text-secondary">
                        <span class="font-medium text-primary">{item.kind.replaceAll("_", " ")}</span> {item.state.replaceAll("_", " ")} ·{" "}
                        {item.id}
                        {item.errorCode ? ` · ${item.errorCode}` : ""}
                      </span>
                      <For each={item.actions.filter((action) => action.eligible)}>
                        {(action) => (
                          <button
                            type="button"
                            class="btn-secondary btn-sm"
                            disabled={busy()}
                            onClick={() => operatorCommand.mutate(action)}
                          >
                            {actionLabel(action.kind)}
                          </button>
                        )}
                      </For>
                    </div>
                  )}
                </For>
                <Show when={status().nextAttentionCursor}>
                  {(cursor) => (
                    <button
                      type="button"
                      class="btn-simple btn-sm self-center"
                      disabled={loadMoreAttention.loading()}
                      onClick={() => loadMoreAttention.mutate(cursor())}
                    >
                      <i class={loadMoreAttention.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-chevron-down"} aria-hidden="true" />
                      Load more attention items
                    </button>
                  )}
                </Show>
              </div>
            </Show>
          </section>
        )}
      </Show>

      <Show
        when={props.bindings.some((binding) => binding.state !== "revoked")}
        fallback={
          <Placeholder icon="ti ti-plug-off" title="No provider binding" description="Connect a provider before running discovery." />
        }
      >
        <div class="flex flex-col gap-2">
          <For each={props.bindings.filter((binding) => binding.state !== "revoked")}>
            {(binding) => (
              <div class="paper flex items-center gap-3 p-3">
                <i class="ti ti-server text-lg text-dimmed" aria-hidden="true" />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-medium text-primary">{binding.authenticatedPrincipal || "Remote mailbox"}</span>
                  <span class="block text-xs text-dimmed">
                    {binding.state.replaceAll("_", " ")}
                    {binding.lastError ? ` · ${binding.lastError}` : ""}
                  </span>
                </span>
                <Show
                  when={binding.state === "pending"}
                  fallback={
                    <button
                      type="button"
                      class="btn-secondary btn-sm"
                      disabled={busy()}
                      onClick={() => command.mutate({ kind: "discover_folders", bindingId: binding.id })}
                    >
                      <i class="ti ti-folders" aria-hidden="true" /> Rediscover
                    </button>
                  }
                >
                  <button
                    type="button"
                    class="btn-primary btn-sm"
                    disabled={busy()}
                    onClick={() => command.mutate({ kind: "verify_binding", bindingId: binding.id })}
                  >
                    <i class="ti ti-shield-check" aria-hidden="true" /> Verify binding
                  </button>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
