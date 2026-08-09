import { documentNavigate } from "@k2b/ssr/nav";
import { mutation as mutations } from "@k2b/stdlib/solid";
import {
  Button,
  DataTable,
  type DataTableColumn,
  Dropdown,
  type DropdownItem,
  dialogCore,
  PanelDialog,
  Placeholder,
  panelDialogFixedOptions,
  panelDialogWidePanelClass,
  prompts,
  StatusBadge,
  toast,
} from "@k2b/ui";
import { createLiveWebSocket } from "@valentinkolb/cloud/browser/live";
import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type {
  MailingListDispositionResult,
  MailSubscriptionPage,
  MailSubscriptionSummary,
  UnsubscribeMailingListResult,
} from "../../contracts";
import { MAIL_LIVE_WS_TYPE, type MailLiveClientMessage, type MailLiveServerMessage, parseMailLiveServerMessage } from "../../live-events";
import { readApiError } from "./api-response";
import { createMailLiveRefreshCoordinator } from "./mail-live-refresh";

const statusLabel = (status: MailSubscriptionSummary["status"]): string | null =>
  status === "active"
    ? null
    : status === "requesting"
      ? "Requesting"
      : status === "unsubscribe_requested"
        ? "Unsubscribe requested"
        : "Request failed";

const statusTone = (status: MailSubscriptionSummary["status"]): "error" | "ok" | "warning" | "neutral" =>
  status === "failed" ? "error" : status === "unsubscribe_requested" ? "ok" : status === "requesting" ? "warning" : "neutral";

const formatDate = (value: string): string =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

const isAbortError = (error: unknown): boolean => error instanceof Error && error.name === "AbortError";

const mergePages = (current: MailSubscriptionSummary[], page: MailSubscriptionPage): MailSubscriptionSummary[] => {
  const merged = new Map(current.map((item) => [item.listKey, item]));
  for (const item of page.items) merged.set(item.listKey, item);
  return [...merged.values()];
};

const columns: DataTableColumn<MailSubscriptionSummary>[] = [
  { id: "list", header: "Mailing list", value: "name", cellClass: "min-w-52" },
  { id: "messages", header: "Messages", value: "messageCount", cellClass: "w-28" },
  { id: "latest", header: "Latest message", value: "lastMessageAt", cellClass: "min-w-56" },
  { id: "actions", header: <span class="sr-only">Actions</span>, value: "listKey", cellClass: "w-44", headerClass: "w-44" },
];

const mailingListDialogOptions = {
  panelClassName: `${panelDialogWidePanelClass} is-fixed`,
  contentClassName: panelDialogFixedOptions.contentClassName,
};

function MailSubscriptionDialog(props: { mailboxId: string; canWrite: boolean; initialListKey: string | null; close: () => void }) {
  const [items, setItems] = createSignal<MailSubscriptionSummary[]>([]);
  const [nextCursor, setNextCursor] = createSignal<string | null>(null);
  const [loaded, setLoaded] = createSignal(false);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [pendingAction, setPendingAction] = createSignal<string | null>(null);
  const [liveTransportDegraded, setLiveTransportDegraded] = createSignal(false);
  const [liveSnapshotDegraded, setLiveSnapshotDegraded] = createSignal(false);
  const liveDegraded = createMemo(() => liveTransportDegraded() || liveSnapshotDegraded());
  let markLiveApplied: (cursor: string | null | undefined) => void = () => undefined;
  let liveTransportTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshController: AbortController | null = null;
  let refreshRequest = 0;
  let disposed = false;

  const refreshSubscriptions = async (): Promise<"applied" | "failed" | "stale"> => {
    const request = ++refreshRequest;
    refreshController?.abort();
    const controller = new AbortController();
    refreshController = controller;
    try {
      const response = await apiClient.mailboxes[":mailboxId"].subscriptions.$get(
        {
          param: { mailboxId: props.mailboxId },
          query: { limit: "50", listKey: props.initialListKey ?? undefined },
        },
        { init: { signal: controller.signal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not load mailing lists"));
      const page = await response.json();
      if (disposed || request !== refreshRequest) return "stale";
      setItems(page.items);
      setNextCursor(page.nextCursor);
      setLoaded(true);
      setLoadError(null);
      return "applied";
    } catch (error) {
      if (isAbortError(error)) return "stale";
      if (!loaded()) setLoadError(error instanceof Error ? error.message : "Could not load mailing lists");
      return "failed";
    } finally {
      if (refreshController === controller) refreshController = null;
    }
  };

  const liveRefresh = createMailLiveRefreshCoordinator({
    delayMs: 150,
    isBlocked: () => false,
    refresh: refreshSubscriptions,
    onApplied: (cursor) => {
      setLiveSnapshotDegraded(false);
      markLiveApplied(cursor);
    },
    onFailed: () => setLiveSnapshotDegraded(true),
  });

  const loadMore = mutations.create<MailSubscriptionPage, string>({
    mutation: async (cursor, { abortSignal }) => {
      const response = await apiClient.mailboxes[":mailboxId"].subscriptions.$get(
        { param: { mailboxId: props.mailboxId }, query: { limit: "50", cursor } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not load more mailing lists"));
      return response.json();
    },
    onSuccess: (page) => {
      setItems((current) => mergePages(current, page));
      setNextCursor(page.nextCursor);
    },
    onError: (error) => toast.error(error.message),
  });

  const unsubscribe = mutations.create<{ item: MailSubscriptionSummary; result: UnsubscribeMailingListResult }, MailSubscriptionSummary>({
    mutation: async (item, { abortSignal }) => {
      if (item.unsubscribe?.kind !== "one_click") throw new Error("One-click unsubscribe is not available for this list");
      const response = await apiClient.mailboxes[":mailboxId"].subscriptions.unsubscribe.$post(
        {
          param: { mailboxId: props.mailboxId },
          json: { listKey: item.listKey, href: item.unsubscribe.href },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not unsubscribe"));
      return { item, result: await response.json() };
    },
    onSuccess: ({ item, result }) => {
      setItems((current) =>
        current.map((entry) =>
          entry.listKey === item.listKey
            ? {
                ...entry,
                status: result.status,
                unsubscribeRequestedAt: result.requestedAt,
                unsubscribeErrorCode: null,
              }
            : entry,
        ),
      );
      toast.success(`Unsubscribe requested for ${item.name}`);
    },
    onError: (error) => {
      toast.error(error.message);
      liveRefresh.schedule();
    },
  });

  const dispose = mutations.create<
    { item: MailSubscriptionSummary; disposition: "archive" | "trash"; result: MailingListDispositionResult },
    { item: MailSubscriptionSummary; disposition: "archive" | "trash" }
  >({
    mutation: async ({ item, disposition }, { abortSignal }) => {
      const response = await apiClient.mailboxes[":mailboxId"].subscriptions.disposition.$post(
        {
          param: { mailboxId: props.mailboxId },
          json: { listKey: item.listKey, disposition, idempotencyKey: crypto.randomUUID() },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, `Could not ${disposition} messages`));
      return { item, disposition, result: await response.json() };
    },
    onSuccess: ({ item, result }) => {
      toast.success(
        result.commandCount === 0
          ? `No ${item.name} messages needed moving`
          : `${result.commandCount} message move${result.commandCount === 1 ? "" : "s"} queued`,
      );
      if (result.truncated) toast("More messages remain. Repeat after the current moves finish.", { title: "First 500 queued" });
    },
    onError: (error) => toast.error(error.message),
  });

  const requestUnsubscribe = async (item: MailSubscriptionSummary) => {
    if (!item.unsubscribe || !props.canWrite || pendingAction()) return;
    const reservation = `unsubscribe:${item.listKey}`;
    setPendingAction(reservation);
    try {
      const confirmed = await prompts.confirm(
        item.unsubscribe.kind === "one_click"
          ? `Ask ${item.name} to stop sending messages to this mailbox? Existing messages will remain in Mail.`
          : item.unsubscribe.kind === "web"
            ? `Open ${item.name}'s unsubscribe page in a new tab?`
            : `Open a new email using ${item.name}'s advertised unsubscribe address?`,
        {
          title: `Unsubscribe from ${item.name}?`,
          icon: "ti ti-mail-off",
          confirmText: item.unsubscribe.kind === "one_click" ? "Unsubscribe" : "Continue",
        },
      );
      if (!confirmed || disposed) return;
      if (item.unsubscribe.kind === "one_click") await unsubscribe.mutate(item);
      else if (item.unsubscribe.kind === "email") window.location.href = item.unsubscribe.href;
      else window.open(item.unsubscribe.href, "_blank", "noopener,noreferrer");
    } finally {
      if (!disposed && pendingAction() === reservation) setPendingAction(null);
    }
  };

  const requestDisposition = async (item: MailSubscriptionSummary, disposition: "archive" | "trash") => {
    if (!props.canWrite || pendingAction()) return;
    const reservation = `${disposition}:${item.listKey}`;
    setPendingAction(reservation);
    try {
      const confirmed = await prompts.confirm(
        `${disposition === "archive" ? "Archive" : "Move to Trash"} up to 500 existing messages identified as ${item.name}?`,
        {
          title: `${disposition === "archive" ? "Archive" : "Trash"} existing messages?`,
          icon: disposition === "archive" ? "ti ti-archive" : "ti ti-trash",
          variant: disposition === "trash" ? "danger" : undefined,
          confirmText: disposition === "archive" ? "Archive messages" : "Move to Trash",
        },
      );
      if (!disposed && confirmed) await dispose.mutate({ item, disposition });
    } finally {
      if (!disposed && pendingAction() === reservation) setPendingAction(null);
    }
  };

  const rowActions = (item: MailSubscriptionSummary): DropdownItem[] => {
    const actions: DropdownItem[] = [];
    if (item.postHref) actions.push({ label: "Write to list", icon: "ti ti-send", href: item.postHref });
    if (item.archiveHref) actions.push({ label: "List archive", icon: "ti ti-world", href: item.archiveHref, external: true });
    if (props.canWrite && item.status === "unsubscribe_requested") {
      actions.push({ label: "Archive existing", icon: "ti ti-archive", action: () => void requestDisposition(item, "archive") });
      actions.push({
        label: "Move existing to Trash",
        icon: "ti ti-trash",
        variant: "danger",
        action: () => void requestDisposition(item, "trash"),
      });
    }
    return actions;
  };

  const reload = async () => {
    setLoadError(null);
    await refreshSubscriptions();
  };

  onMount(() => {
    void reload();
    const live = createLiveWebSocket<MailLiveServerMessage>({
      url: "/api/mail/ws",
      initialCursor: null,
      activity: "visible",
      subscribe: (cursor) =>
        ({
          type: MAIL_LIVE_WS_TYPE.subscribe,
          payload: { mailboxId: props.mailboxId, fromCursor: cursor },
        }) satisfies MailLiveClientMessage,
      parse: (raw) => {
        const message = parseMailLiveServerMessage(raw);
        if (!message) throw new Error("Invalid Mail live server message");
        return message;
      },
      onStatus: (status) => {
        if (liveTransportTimer) clearTimeout(liveTransportTimer);
        liveTransportTimer = null;
        if (status === "reconnecting") {
          if (!liveTransportDegraded()) {
            liveTransportTimer = setTimeout(() => {
              liveTransportTimer = null;
              if (!disposed) setLiveTransportDegraded(true);
            }, 2_000);
          }
          return;
        }
        if (status === "open" || status === "paused" || status === "closed") setLiveTransportDegraded(false);
      },
      onMessage: (message, controls) => {
        if (message.payload.mailboxId && message.payload.mailboxId !== props.mailboxId) {
          controls.terminate({ code: "resource_mismatch", message: "Mail live subscription changed resources" });
          return;
        }
        if (message.type === MAIL_LIVE_WS_TYPE.ready || message.type === MAIL_LIVE_WS_TYPE.event) {
          liveRefresh.schedule(message.payload.cursor);
          return;
        }
        if (message.type === MAIL_LIVE_WS_TYPE.revoked) {
          controls.terminate({ code: message.payload.code, message: message.payload.message });
        }
      },
      classifyClose: ({ code, reason }) =>
        code === 1008 ? { code: reason || "access_denied", message: "Mailbox access changed or expired." } : null,
      onFatal: (error) => {
        if (error.code === "login_required") {
          const current = `${window.location.pathname}${window.location.search}`;
          documentNavigate(`/auth/login?redirectTo=${encodeURIComponent(current)}`, { replace: true });
        } else documentNavigate("/app/mail", { replace: true });
      },
    });
    markLiveApplied = live.markApplied;
    live.connect();
    onCleanup(() => {
      live.dispose();
      markLiveApplied = () => undefined;
    });
  });

  onCleanup(() => {
    disposed = true;
    refreshRequest += 1;
    if (liveTransportTimer) clearTimeout(liveTransportTimer);
    refreshController?.abort();
    refreshController = null;
    liveRefresh.dispose();
    loadMore.abort();
    unsubscribe.abort();
    dispose.abort();
  });

  return (
    <PanelDialog>
      <PanelDialog.Header
        title="Mailing lists"
        subtitle="Found in this mailbox; unsubscribing keeps existing mail"
        icon="ti ti-news"
        actions={
          <Show when={liveDegraded()}>
            <span class="inline-flex items-center gap-1 text-xs text-dimmed" title="Live updates paused">
              <i class="ti ti-cloud-off" aria-hidden="true" /> Updates paused
            </span>
          </Show>
        }
        close={props.close}
      />
      <PanelDialog.Body scrollPreserveKey={`mailing-lists:${props.mailboxId}`}>
        <Show
          when={loaded()}
          fallback={
            <Show when={loadError()} fallback={<Placeholder state="loading" variant="panel" title="Loading mailing lists" />}>
              {(error) => (
                <Placeholder
                  state="error"
                  variant="panel"
                  title="Could not load mailing lists"
                  description={error()}
                  action={
                    <Button variant="secondary" size="sm" type="button" onClick={() => void reload()}>
                      <i class="ti ti-refresh" aria-hidden="true" /> Retry
                    </Button>
                  }
                />
              )}
            </Show>
          }
        >
          <div class="flex flex-col gap-2">
            <DataTable
              rows={items()}
              columns={columns}
              getRowId={(item) => item.listKey}
              selectedRowId={props.initialListKey}
              density="compact"
              surface="paper"
              stickyHeader={false}
              ariaLabel="Mailing lists"
              class="overflow-x-auto"
              tableClass={items().length > 0 ? "w-full min-w-[44rem] text-xs" : "w-full text-xs"}
              empty={
                <Placeholder
                  icon="ti ti-news-off"
                  title="No mailing lists found"
                  description="Lists appear here when their messages include standard mailing-list information."
                />
              }
              renderCell={({ row, col, render }) => {
                if (col.id === "list") {
                  return (
                    <span class="block min-w-0">
                      <span class="flex min-w-0 items-center gap-2">
                        <span class="truncate font-medium text-primary">{row.name}</span>
                        <Show when={statusLabel(row.status)}>
                          {(label) => (
                            <StatusBadge tone={statusTone(row.status)} label={label()} title={row.unsubscribeErrorCode ?? undefined} />
                          )}
                        </Show>
                      </span>
                      <Show when={row.name.toLowerCase() !== row.address.toLowerCase()}>
                        <span class="block truncate text-dimmed">{row.address}</span>
                      </Show>
                    </span>
                  );
                }
                if (col.id === "messages") {
                  return (
                    <span class="block whitespace-nowrap">
                      <span class="block text-primary">{row.recentMessageCount} recent</span>
                      <span class="block text-dimmed">
                        {row.messageCount} total · {row.conversationCount} conversation{row.conversationCount === 1 ? "" : "s"}
                      </span>
                    </span>
                  );
                }
                if (col.id === "latest") {
                  return (
                    <span class="block min-w-0">
                      <span class="block truncate text-primary">{row.lastSubject || "No subject"}</span>
                      <time class="block whitespace-nowrap text-dimmed" datetime={row.lastMessageAt}>
                        {formatDate(row.lastMessageAt)}
                      </time>
                    </span>
                  );
                }
                if (col.id === "actions") {
                  const actions = rowActions(row);
                  const canUnsubscribe = props.canWrite && row.unsubscribe && row.status !== "unsubscribe_requested";
                  return (
                    <span class="flex items-center justify-end gap-1">
                      <Show when={canUnsubscribe}>
                        <Button
                          variant="secondary"
                          size="sm"
                          type="button"
                          disabled={Boolean(pendingAction())}
                          onClick={() => void requestUnsubscribe(row)}
                        >
                          {row.status === "failed" ? "Retry" : "Unsubscribe"}
                        </Button>
                      </Show>
                      <Show when={actions.length > 0} fallback={!canUnsubscribe ? <span class="text-dimmed">—</span> : undefined}>
                        <Dropdown.Root position="bottom-left" items={actions} disabled={Boolean(pendingAction())}>
                          <Dropdown.Trigger iconOnly size="sm" type="button" variant="ghost" label={`More actions for ${row.name}`}>
                            <i class="ti ti-dots" aria-hidden="true" />
                          </Dropdown.Trigger>
                        </Dropdown.Root>
                      </Show>
                    </span>
                  );
                }
                return render(col.value instanceof Function ? col.value(row) : col.value ? row[col.value] : undefined);
              }}
            />
            <Show when={nextCursor()}>
              <div class="flex justify-center">
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  disabled={loadMore.loading()}
                  onClick={() => nextCursor() && void loadMore.mutate(nextCursor()!)}
                >
                  <i class={`ti ${loadMore.loading() ? "ti-loader-2 animate-spin" : "ti-chevron-down"}`} aria-hidden="true" />
                  Load more
                </Button>
              </div>
            </Show>
          </div>
        </Show>
      </PanelDialog.Body>
    </PanelDialog>
  );
}

export const openMailSubscriptionDialog = (params: { mailboxId: string; canWrite: boolean; initialListKey?: string | null }) =>
  dialogCore.open<void>(
    (close) => (
      <MailSubscriptionDialog
        mailboxId={params.mailboxId}
        canWrite={params.canWrite}
        initialListKey={params.initialListKey ?? null}
        close={() => close()}
      />
    ),
    mailingListDialogOptions,
  );
