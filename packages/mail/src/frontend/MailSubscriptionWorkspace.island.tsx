import { createLiveWebSocket } from "@valentinkolb/cloud/browser/live";
import { AppWorkspace, Placeholder, prompts, toast } from "@valentinkolb/cloud/ui";
import { documentNavigate } from "@k2b/ssr/nav";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "../api/client";
import type {
  MailingListDispositionResult,
  MailSubscriptionPage,
  MailSubscriptionSummary,
  UnsubscribeMailingListResult,
} from "../contracts";
import { MAIL_LIVE_WS_TYPE, type MailLiveClientMessage, type MailLiveServerMessage, parseMailLiveServerMessage } from "../live-events";
import type { MailSubscriptionWorkspaceData } from "../service/subscription-workspace";
import { readApiError } from "./_components/api-response";

const statusLabel = (status: MailSubscriptionSummary["status"]): string =>
  status === "requesting"
    ? "Requesting"
    : status === "unsubscribe_requested"
      ? "Unsubscribe requested"
      : status === "failed"
        ? "Request failed"
        : "Detected";

const statusClass = (status: MailSubscriptionSummary["status"]): string =>
  status === "failed"
    ? "badge-danger"
    : status === "unsubscribe_requested"
      ? "badge-success"
      : status === "requesting"
        ? "badge-warning"
        : "";

const formatDate = (value: string): string =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

const mergePages = (current: MailSubscriptionSummary[], page: MailSubscriptionPage): MailSubscriptionSummary[] => {
  const merged = new Map(current.map((item) => [item.listKey, item]));
  for (const item of page.items) merged.set(item.listKey, item);
  return [...merged.values()];
};

export default function MailSubscriptionWorkspace(props: { data: MailSubscriptionWorkspaceData; initialListKey: string | null }) {
  const initialItems = [...props.data.subscriptions.items].sort((left, right) =>
    left.listKey === props.initialListKey ? -1 : right.listKey === props.initialListKey ? 1 : 0,
  );
  const [items, setItems] = createSignal(initialItems);
  const [nextCursor, setNextCursor] = createSignal(props.data.subscriptions.nextCursor);
  const [pendingAction, setPendingAction] = createSignal<string | null>(null);
  const canWrite = createMemo(() => props.data.permission === "write" || props.data.permission === "admin");
  let markLiveApplied: (cursor: string) => void = () => undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingLiveCursor: string | null = null;
  let disposed = false;

  const refresh = mutations.create<MailSubscriptionPage, { liveCursor: string | null }, { liveCursor: string | null }>({
    onBefore: (input) => ({ liveCursor: input.liveCursor }),
    mutation: async (_input, { abortSignal }) => {
      const response = await apiClient.mailboxes[":mailboxId"].subscriptions.$get(
        {
          param: { mailboxId: props.data.mailbox.id },
          query: { limit: "50", listKey: props.initialListKey ?? undefined },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not refresh subscriptions"));
      return response.json();
    },
    onSuccess: (page, context) => {
      setItems(page.items);
      setNextCursor(page.nextCursor);
      if (context?.liveCursor) markLiveApplied(context.liveCursor);
    },
    onError: (error) => toast.error(error.message),
  });

  const loadMore = mutations.create<MailSubscriptionPage, string>({
    mutation: async (cursor, { abortSignal }) => {
      const response = await apiClient.mailboxes[":mailboxId"].subscriptions.$get(
        { param: { mailboxId: props.data.mailbox.id }, query: { limit: "50", cursor } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not load more subscriptions"));
      return response.json();
    },
    onSuccess: (page) => {
      setItems((current) => mergePages(current, page));
      setNextCursor(page.nextCursor);
    },
    onError: (error) => toast.error(error.message),
  });

  const scheduleRefresh = (liveCursor: string) => {
    pendingLiveCursor = liveCursor;
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      const cursor = pendingLiveCursor;
      pendingLiveCursor = null;
      void refresh.mutate({ liveCursor: cursor });
    }, 150);
  };

  const unsubscribe = mutations.create<{ item: MailSubscriptionSummary; result: UnsubscribeMailingListResult }, MailSubscriptionSummary>({
    mutation: async (item, { abortSignal }) => {
      if (item.unsubscribe?.kind !== "one_click") throw new Error("One-click unsubscribe is not available for this list");
      const response = await apiClient.mailboxes[":mailboxId"].subscriptions.unsubscribe.$post(
        {
          param: { mailboxId: props.data.mailbox.id },
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
      void refresh.mutate({ liveCursor: null });
    },
  });

  const dispose = mutations.create<
    { item: MailSubscriptionSummary; disposition: "archive" | "trash"; result: MailingListDispositionResult },
    { item: MailSubscriptionSummary; disposition: "archive" | "trash" }
  >({
    mutation: async ({ item, disposition }, { abortSignal }) => {
      const response = await apiClient.mailboxes[":mailboxId"].subscriptions.disposition.$post(
        {
          param: { mailboxId: props.data.mailbox.id },
          json: {
            listKey: item.listKey,
            disposition,
            idempotencyKey: crypto.randomUUID(),
          },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, `Could not ${disposition} messages`));
      return { item, disposition, result: await response.json() };
    },
    onSuccess: ({ item, disposition, result }) => {
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
    if (!item.unsubscribe || !canWrite() || pendingAction()) return;
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
      if (item.unsubscribe.kind === "one_click") {
        await unsubscribe.mutate(item);
        return;
      }
      if (item.unsubscribe.kind === "email") window.location.href = item.unsubscribe.href;
      else window.open(item.unsubscribe.href, "_blank", "noopener,noreferrer");
    } finally {
      if (!disposed && pendingAction() === reservation) setPendingAction(null);
    }
  };

  const requestDisposition = async (item: MailSubscriptionSummary, disposition: "archive" | "trash") => {
    if (!canWrite() || pendingAction()) return;
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

  onMount(() => {
    let readyReceived = false;
    const live = createLiveWebSocket<MailLiveServerMessage>({
      url: "/api/mail/ws",
      initialCursor: props.data.initialLiveCursor,
      activity: "visible",
      subscribe: (cursor) =>
        ({
          type: MAIL_LIVE_WS_TYPE.subscribe,
          payload: { mailboxId: props.data.mailbox.id, fromCursor: cursor },
        }) satisfies MailLiveClientMessage,
      parse: (raw) => {
        const message = parseMailLiveServerMessage(raw);
        if (!message) throw new Error("Invalid Mail live server message");
        return message;
      },
      onMessage: (message, controls) => {
        if (message.payload.mailboxId && message.payload.mailboxId !== props.data.mailbox.id) {
          controls.terminate({ code: "resource_mismatch", message: "Mail live subscription changed resources" });
          return;
        }
        if (message.type === MAIL_LIVE_WS_TYPE.ready) {
          if (props.data.initialLiveCursor === null || readyReceived) void refresh.mutate({ liveCursor: message.payload.cursor });
          else controls.markApplied(message.payload.cursor);
          readyReceived = true;
          return;
        }
        if (message.type === MAIL_LIVE_WS_TYPE.event) {
          scheduleRefresh(message.payload.cursor);
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
      disposed = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = null;
      pendingLiveCursor = null;
      live.dispose();
      markLiveApplied = () => undefined;
      refresh.abort();
      loadMore.abort();
      unsubscribe.abort();
      dispose.abort();
    });
  });

  return (
    <AppWorkspace>
      <AppWorkspace.Sidebar collapsible>
        <AppWorkspace.SidebarHeader
          title="Subscriptions"
          subtitle={props.data.mailbox.name}
          icon="ti ti-news"
          action={
            <a href={`/app/mail/${props.data.mailbox.id}`} class="icon-btn" aria-label="Back to mailbox" title="Back to mailbox">
              <i class="ti ti-arrow-left" aria-hidden="true" />
              <span class="sr-only">Back to mailbox</span>
            </a>
          }
        />
        <AppWorkspace.SidebarMobile>
          <AppWorkspace.SidebarMobileItems>
            <a href={`/app/mail/${props.data.mailbox.id}`} class="sidebar-item-mobile">
              <i class="ti ti-inbox" aria-hidden="true" /> Back to mailbox
            </a>
          </AppWorkspace.SidebarMobileItems>
          <AppWorkspace.SidebarMobileBody>
            <AppWorkspace.SidebarSection title="Mailbox tools">
              <AppWorkspace.SidebarItem icon="ti ti-news" active>
                Subscriptions
              </AppWorkspace.SidebarItem>
            </AppWorkspace.SidebarSection>
          </AppWorkspace.SidebarMobileBody>
        </AppWorkspace.SidebarMobile>
        <AppWorkspace.SidebarDesktop>
          <AppWorkspace.SidebarBody>
            <AppWorkspace.SidebarSection title="Mailbox tools">
              <AppWorkspace.SidebarItem icon="ti ti-news" active>
                Subscriptions
              </AppWorkspace.SidebarItem>
            </AppWorkspace.SidebarSection>
          </AppWorkspace.SidebarBody>
          <AppWorkspace.SidebarFooter>
            <a href={`/app/mail/${props.data.mailbox.id}`} class="sidebar-item">
              <i class="ti ti-inbox" aria-hidden="true" />
              <span>Back to mailbox</span>
            </a>
          </AppWorkspace.SidebarFooter>
        </AppWorkspace.SidebarDesktop>
      </AppWorkspace.Sidebar>

      <AppWorkspace.Content>
        <AppWorkspace.Main class="p-[var(--ui-space-shell)]">
          <div class="min-h-0 flex-1 overflow-y-auto" style="scrollbar-gutter: stable">
            <div class="mx-auto flex w-full max-w-5xl flex-col gap-2">
              <header>
                <h1 class="text-base font-semibold text-primary">Subscriptions</h1>
                <p class="mt-0.5 text-xs text-dimmed">
                  Mailing lists detected from their messages. Unsubscribing never deletes existing mail.
                </p>
              </header>

              <Show
                when={items().length > 0}
                fallback={
                  <Placeholder
                    variant="panel"
                    icon="ti ti-news-off"
                    title="No mailing lists detected"
                    description="Lists appear here when their messages include standard mailing-list information."
                  />
                }
              >
                <div class="flex flex-col gap-2">
                  <For each={items()}>
                    {(item) => (
                      <article
                        class={`paper flex flex-col gap-3 p-4 ${
                          item.listKey === props.initialListKey ? "ring-2 ring-[var(--ui-color-accent)]" : ""
                        }`}
                      >
                        <div class="flex items-start gap-3">
                          <span class="thumbnail flex h-9 w-9 shrink-0 items-center justify-center">
                            <i class="ti ti-news text-sm" aria-hidden="true" />
                          </span>
                          <div class="min-w-0 flex-1">
                            <div class="flex flex-wrap items-center gap-2">
                              <h2 class="truncate text-sm font-semibold text-primary">{item.name}</h2>
                              <span class={`badge badge-sm ${statusClass(item.status)}`}>{statusLabel(item.status)}</span>
                            </div>
                            <Show when={item.name.toLowerCase() !== item.address.toLowerCase()}>
                              <p class="mt-0.5 truncate text-xs text-dimmed">{item.address}</p>
                            </Show>
                            <p class="mt-2 text-xs text-secondary">
                              {item.recentMessageCount} in the last 30 days · {item.messageCount} total · {item.conversationCount}{" "}
                              conversations
                            </p>
                            <p class="mt-1 truncate text-xs text-dimmed">
                              Last message: {item.lastSubject || "No subject"} · {formatDate(item.lastMessageAt)}
                            </p>
                            <Show when={item.status === "failed"}>
                              <p class="mt-2 text-xs text-danger">The last unsubscribe request failed. You can try again.</p>
                            </Show>
                          </div>
                        </div>

                        <div class="flex flex-wrap items-center gap-2">
                          <Show when={canWrite() && item.unsubscribe && item.status !== "unsubscribe_requested"}>
                            <button
                              type="button"
                              class="btn-secondary btn-sm"
                              disabled={Boolean(pendingAction()) || unsubscribe.loading() || dispose.loading()}
                              onClick={() => void requestUnsubscribe(item)}
                            >
                              <i class="ti ti-mail-off" aria-hidden="true" />
                              Unsubscribe
                            </button>
                          </Show>
                          <Show when={item.postHref}>
                            <a class="btn-simple btn-sm" href={item.postHref!}>
                              <i class="ti ti-send" aria-hidden="true" />
                              Write to list
                            </a>
                          </Show>
                          <Show when={item.helpHref}>
                            <a class="btn-simple btn-sm" href={item.helpHref!} target="_blank" rel="noopener noreferrer">
                              <i class="ti ti-help" aria-hidden="true" />
                              List help
                            </a>
                          </Show>
                          <Show when={item.archiveHref}>
                            <a class="btn-simple btn-sm" href={item.archiveHref!} target="_blank" rel="noopener noreferrer">
                              <i class="ti ti-world" aria-hidden="true" />
                              List archive
                            </a>
                          </Show>
                          <Show when={canWrite() && item.status === "unsubscribe_requested"}>
                            <span class="ml-auto flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                class="btn-simple btn-sm"
                                disabled={Boolean(pendingAction()) || unsubscribe.loading() || dispose.loading()}
                                onClick={() => void requestDisposition(item, "archive")}
                              >
                                <i class="ti ti-archive" aria-hidden="true" />
                                Archive existing
                              </button>
                              <button
                                type="button"
                                class="btn-simple btn-sm"
                                disabled={Boolean(pendingAction()) || unsubscribe.loading() || dispose.loading()}
                                onClick={() => void requestDisposition(item, "trash")}
                              >
                                <i class="ti ti-trash" aria-hidden="true" />
                                Move existing to Trash
                              </button>
                            </span>
                          </Show>
                        </div>
                      </article>
                    )}
                  </For>
                </div>
                <Show when={nextCursor()}>
                  <div class="flex justify-center py-2">
                    <button
                      type="button"
                      class="btn-secondary btn-sm"
                      disabled={loadMore.loading()}
                      onClick={() => nextCursor() && void loadMore.mutate(nextCursor()!)}
                    >
                      <i class={`ti ${loadMore.loading() ? "ti-loader-2 animate-spin" : "ti-chevron-down"}`} aria-hidden="true" />
                      Load more
                    </button>
                  </div>
                </Show>
              </Show>
            </div>
          </div>
        </AppWorkspace.Main>
      </AppWorkspace.Content>
    </AppWorkspace>
  );
}
