import { createLiveWebSocket } from "@valentinkolb/cloud/browser/live";
import { AppWorkspace, toast } from "@valentinkolb/cloud/ui";
import { documentNavigate, type LinkNavigateEvent, navigate } from "@valentinkolb/ssr/nav";
import type { DateContext } from "@valentinkolb/stdlib";
import { batch, createEffect, createMemo, createSignal, onCleanup, onMount, Show, untrack } from "solid-js";
import { apiClient } from "../api/client";
import { MAIL_LIVE_WS_TYPE, type MailLiveClientMessage, type MailLiveServerMessage, parseMailLiveServerMessage } from "../live-events";
import type { ConversationPresenceSnapshot } from "../service/presence";
import type { MailboxPageData, MailListItem } from "../service/workspace";
import { readApiError } from "./_components/api-response";
import { openMailboxSettingsDialog } from "./_components/MailboxSettingsDialog";
import MailConversationList from "./_components/MailConversationList";
import MailConversationReader from "./_components/MailConversationReader";
import MailDetailsPanel from "./_components/MailDetailsPanel";
import MailScheduledView from "./_components/MailScheduledView";
import MailSidebar from "./_components/MailSidebar";
import { createMailLiveRefreshCoordinator } from "./_components/mail-live-refresh";
import { buildMailListHref } from "./_components/mail-navigation";
import { type MailWorkspacePreferences, writeMailWorkspacePreferences } from "./_components/mail-workspace-preferences";

const rank = (permission: string): number => (permission === "admin" ? 3 : permission === "write" ? 2 : permission === "read" ? 1 : 0);

export default function MailWorkspace(props: {
  data: MailboxPageData;
  requestUrl: string;
  currentUserId: string;
  currentUserEmail: string | null;
  dateConfig: DateContext;
  initialPreferences: MailWorkspacePreferences;
}) {
  const [data, setData] = createSignal(props.data);
  const [requestUrl, setRequestUrl] = createSignal(props.requestUrl);
  const [routeLoading, setRouteLoading] = createSignal(false);
  const [listCollapsed, setListCollapsed] = createSignal(props.initialPreferences.listCollapsed);
  const [detailsOpen, setDetailsOpen] = createSignal(false);
  const [composerActive, setComposerActive] = createSignal(false);
  const [presence, setPresence] = createSignal<ConversationPresenceSnapshot>({ participants: [] });
  const [settingsOpening, setSettingsOpening] = createSignal(false);
  const mailboxId = props.data.mailbox.id;
  let preferenceTimer: ReturnType<typeof setTimeout> | null = null;
  let markLiveApplied: (cursor: string | null | undefined) => void = () => undefined;
  let updatePresenceMode: (() => void) | null = null;
  let routeRequest = 0;
  const pendingReadConversationIds = new Set<string>();
  const selectedConversationId = createMemo(() => data().selectedConversationId);

  const replaceWorkspaceRoute = async (href: string): Promise<"applied" | "failed" | "stale"> => {
    const request = ++routeRequest;
    setRouteLoading(true);
    try {
      const target = new URL(href, window.location.origin);
      if (target.origin !== window.location.origin || target.pathname !== `/app/mail/${data().mailbox.id}`) return "failed";
      const response = await apiClient.mailboxes[":mailboxId"]["workspace-route"].$get({
        param: { mailboxId: data().mailbox.id },
        query: { href: `${target.pathname}${target.search}` },
      });
      if (!response.ok) return "failed";
      const next = await response.json();
      if (request !== routeRequest) return "stale";
      batch(() => {
        setRequestUrl(target.toString());
        setData(next);
        if (!next.collaborationState) setDetailsOpen(false);
      });
      return "applied";
    } catch {
      return "failed";
    } finally {
      if (request === routeRequest) setRouteLoading(false);
    }
  };

  const navigateWorkspace = async (nav: LinkNavigateEvent) => {
    const result = await replaceWorkspaceRoute(nav.href);
    if (result === "applied") nav.push(undefined, { scroll: "preserve" });
    else if (result === "failed") nav.fallback();
  };

  const openWorkspaceHref = async (href: string, replace = false) => {
    const result = await replaceWorkspaceRoute(href);
    if (result === "applied") navigate(href, { replace, scroll: "preserve" });
    else if (result === "failed") documentNavigate(href, { replace });
  };

  const loadMoreConversations = async (href: string) => {
    if (routeLoading()) return;
    const request = ++routeRequest;
    const sourceUrl = requestUrl();
    setRouteLoading(true);
    try {
      const target = new URL(href, window.location.origin);
      if (target.origin !== window.location.origin || target.pathname !== `/app/mail/${data().mailbox.id}`)
        throw new Error("Invalid mailbox page");
      const response = await apiClient.mailboxes[":mailboxId"]["workspace-route"].$get({
        param: { mailboxId: data().mailbox.id },
        query: { href: `${target.pathname}${target.search}` },
      });
      if (!response.ok) throw new Error(await readApiError(response, "Could not load more conversations"));
      const next = await response.json();
      if (request !== routeRequest || requestUrl() !== sourceUrl) return;
      setData((current) => {
        const known = new Set(current.listItems.map((item) => item.id));
        return {
          ...current,
          listItems: [...current.listItems, ...next.listItems.filter((item) => !known.has(item.id))],
          nextListCursor: next.nextListCursor,
          listError: next.listError,
        };
      });
    } catch (error) {
      if (request === routeRequest) toast.error(error instanceof Error ? error.message : "Could not load more conversations");
    } finally {
      if (request === routeRequest) setRouteLoading(false);
    }
  };

  const persistPreferences = () => {
    if (preferenceTimer) clearTimeout(preferenceTimer);
    preferenceTimer = setTimeout(() => writeMailWorkspacePreferences({ listCollapsed: listCollapsed() }), 120);
  };

  const setCollapsed = (collapsed: boolean) => {
    setListCollapsed(collapsed);
    persistPreferences();
  };

  createEffect(() => {
    const conversationId = selectedConversationId();
    if (!conversationId) {
      updatePresenceMode = null;
      setPresence({ participants: [] });
      return;
    }
    const peerId = crypto.randomUUID();
    let stopped = false;
    let requestQueue = Promise.resolve();
    const heartbeat = () => {
      if (document.visibilityState !== "visible") return;
      requestQueue = requestQueue.then(async () => {
        if (stopped) return;
        try {
          const response = await apiClient.mailboxes[":mailboxId"].conversations[":conversationId"].presence.$put({
            param: { mailboxId, conversationId },
            json: { peerId, mode: untrack(composerActive) ? "composing" : "viewing" },
          });
          if (response.ok && !stopped) setPresence(await response.json());
        } catch {
          // Presence is best-effort and must never interrupt mailbox work.
        }
      });
    };
    const updateMode = () => void heartbeat();
    updatePresenceMode = updateMode;
    void heartbeat();
    const timer = window.setInterval(() => void heartbeat(), 10_000);
    const onVisibility = () => void heartbeat();
    document.addEventListener("visibilitychange", onVisibility);
    onCleanup(() => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      if (updatePresenceMode === updateMode) updatePresenceMode = null;
      setPresence({ participants: [] });
      void requestQueue
        .then(() =>
          apiClient.mailboxes[":mailboxId"].conversations[":conversationId"].presence.$delete({
            param: { mailboxId, conversationId },
            json: { peerId },
          }),
        )
        .catch(() => undefined);
    });
  });

  createEffect(() => {
    composerActive();
    updatePresenceMode?.();
  });

  const liveRefresh = createMailLiveRefreshCoordinator({
    delayMs: 180,
    isBlocked: composerActive,
    refresh: () => replaceWorkspaceRoute(`${window.location.pathname}${window.location.search}`),
    onApplied: (cursor) => markLiveApplied(cursor),
    onFailed: () => documentNavigate(`${window.location.pathname}${window.location.search}`, { replace: true }),
  });

  const updateComposerActive = (active: boolean) => {
    setComposerActive(active);
    if (!active) liveRefresh.resume();
  };

  const openSettings = async () => {
    if (settingsOpening()) return;
    setSettingsOpening(true);
    try {
      const result = await openMailboxSettingsDialog({
        mailboxId: data().mailbox.id,
        currentUserId: props.currentUserId,
        currentUserEmail: props.currentUserEmail,
        dateConfig: props.dateConfig,
      });
      if (result.deleted) return documentNavigate("/app/mail");
      if (!result.workspaceChanged) return;
      const refreshResult = await replaceWorkspaceRoute(requestUrl());
      if (refreshResult === "failed") documentNavigate(requestUrl(), { replace: true });
    } finally {
      setSettingsOpening(false);
    }
  };

  onMount(() => {
    setRequestUrl(window.location.href);
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
        const messageMailboxId = message.payload.mailboxId;
        if (messageMailboxId && messageMailboxId !== props.data.mailbox.id) {
          controls.terminate({ code: "resource_mismatch", message: "Mail live subscription changed resources" });
          return;
        }
        if (message.type === MAIL_LIVE_WS_TYPE.ready) {
          if (props.data.initialLiveCursor === null || readyReceived) {
            liveRefresh.schedule(message.payload.cursor);
          } else controls.markApplied(message.payload.cursor);
          readyReceived = true;
          return;
        }
        if (message.type === MAIL_LIVE_WS_TYPE.event) {
          const selectedConversationId = data().selectedConversationId;
          if (
            !message.payload.event.conversationId ||
            !selectedConversationId ||
            message.payload.event.conversationId === selectedConversationId
          ) {
            liveRefresh.schedule(message.payload.cursor);
          } else controls.markApplied(message.payload.cursor);
          return;
        }
        if (message.type === MAIL_LIVE_WS_TYPE.revoked) {
          controls.terminate({ code: message.payload.code, message: message.payload.message });
        }
      },
      onFatal: () => window.location.reload(),
    });
    markLiveApplied = live.markApplied;
    const handlePopState = () => {
      void replaceWorkspaceRoute(`${window.location.pathname}${window.location.search}`).then((result) => {
        if (result === "failed") documentNavigate(`${window.location.pathname}${window.location.search}`, { replace: true });
      });
    };
    live.connect();
    window.addEventListener("popstate", handlePopState);
    onCleanup(() => {
      live.dispose();
      markLiveApplied = () => undefined;
      window.removeEventListener("popstate", handlePopState);
    });
  });

  onCleanup(() => {
    if (preferenceTimer) clearTimeout(preferenceTimer);
    liveRefresh.dispose();
  });

  const canWrite = createMemo(() => rank(data().permission) >= 2);
  const canAdmin = createMemo(() => rank(data().permission) >= 3);
  const hasSelection = createMemo(() => Boolean(data().selectedConversationId || data().selectedMessageId));
  const selectedListItem = createMemo(() => data().listItems.find((item) => item.conversationId === data().selectedConversationId));
  const selectedUnread = createMemo(
    () => selectedListItem()?.unread ?? data().detailMessages.some((message) => !message.flags.includes("\\Seen")),
  );
  const canShowDetails = createMemo(() =>
    Boolean(data().selectedConversationId && data().collaborationState && data().conversationLocalTags),
  );

  const setConversationUnread = (conversationId: string, unread: boolean) => {
    setData((current) => ({
      ...current,
      listItems: current.listItems.map((item) => (item.conversationId === conversationId ? { ...item, unread } : item)),
    }));
  };

  const persistConversationRead = async (item: MailListItem) => {
    const conversationId = item.conversationId;
    if (!canWrite() || !conversationId || !item.unread || pendingReadConversationIds.has(conversationId)) return;
    const sourceFolderIds = item.unreadFolderIds.length > 0 ? item.unreadFolderIds : item.sourceFolderId ? [item.sourceFolderId] : [];
    if (sourceFolderIds.length === 0) return;

    pendingReadConversationIds.add(conversationId);
    setConversationUnread(conversationId, false);
    try {
      const results = await Promise.allSettled(
        sourceFolderIds.map(async (sourceFolderId) => {
          const response = await apiClient.mailboxes[":mailboxId"].conversations[":conversationId"].actions.$post({
            param: { mailboxId: data().mailbox.id, conversationId },
            json: {
              kind: "change_state",
              sourceFolderId,
              change: {
                addFlags: ["seen"],
                removeFlags: [],
                addKeywords: [],
                removeKeywords: [],
              },
              idempotencyKey: crypto.randomUUID(),
            },
          });
          if (!response.ok) throw new Error(await readApiError(response, "Could not mark conversation as read"));
        }),
      );
      const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failure) throw failure.reason;
    } catch (error) {
      setConversationUnread(conversationId, true);
      toast.error(error instanceof Error ? error.message : "Could not mark conversation as read");
    } finally {
      pendingReadConversationIds.delete(conversationId);
    }
  };

  const navigateConversation = async (nav: LinkNavigateEvent, item: MailListItem) => {
    await persistConversationRead(item);
    await navigateWorkspace(nav);
  };

  const reconcileWorkspace = async () => {
    const result = await replaceWorkspaceRoute(requestUrl());
    if (result === "failed") documentNavigate(requestUrl(), { replace: true });
  };

  return (
    <AppWorkspace>
      <MailSidebar
        mailboxId={data().mailbox.id}
        mailboxName={data().mailbox.name}
        syncEnabled={data().mailbox.syncEnabled}
        folders={data().folders}
        savedViews={data().savedViews}
        scheduledMode={data().scheduledMode}
        scheduledCount={data().scheduledCount}
        activeFolderId={data().folderId}
        activeView={data().query ? null : data().activeView}
        activeSavedViewId={data().savedViewId}
        viewCounts={data().viewCounts}
        canWrite={canWrite()}
        canAdmin={canAdmin()}
        settingsOpening={settingsOpening()}
        onOpenSettings={() => void openSettings()}
        onNavigate={navigateWorkspace}
      />
      <AppWorkspace.Content>
        <AppWorkspace.Main class="p-0" aria-busy={routeLoading()} mobilePane={hasSelection() ? "main" : "conversations"}>
          <Show
            when={data().scheduledMode}
            fallback={
              <>
                <AppWorkspace.MainPane
                  id="conversations"
                  label="Conversation list"
                  open={!listCollapsed() || !hasSelection()}
                  defaultSize={430}
                  minSize={300}
                  maxSize={620}
                >
                  <MailConversationList
                    mailbox={data().mailbox}
                    mailboxId={data().mailbox.id}
                    requestUrl={requestUrl()}
                    query={data().query}
                    title={data().listTitle}
                    items={data().listItems}
                    error={data().listError}
                    selectedConversationId={data().selectedConversationId}
                    selectedMessageId={data().selectedMessageId}
                    nextCursor={data().nextListCursor}
                    dateConfig={props.dateConfig}
                    canWrite={canWrite()}
                    savedViews={data().savedViews}
                    activeSavedViewId={data().savedViewId}
                    loading={routeLoading()}
                    onCollapse={() => setCollapsed(true)}
                    onNavigate={navigateWorkspace}
                    onNavigateItem={navigateConversation}
                    onOpenHref={openWorkspaceHref}
                    onLoadMore={loadMoreConversations}
                  />
                </AppWorkspace.MainPane>
                <MailConversationReader
                  mailboxId={data().mailbox.id}
                  requestUrl={requestUrl()}
                  canWrite={canWrite()}
                  identities={data().identities}
                  selectionKey={data().selectedConversationId ?? data().selectedMessageId}
                  selectedConversationId={data().selectedConversationId}
                  unread={selectedUnread()}
                  sourceFolderId={
                    data().folderId ??
                    (data().activeView === "inbox" ? (data().folders.find((folder) => folder.role === "inbox")?.id ?? null) : null) ??
                    selectedListItem()?.sourceFolderId ??
                    null
                  }
                  unreadSourceFolderIds={selectedListItem()?.unreadFolderIds ?? []}
                  reference={data().selectedReference}
                  subject={data().selectedSubject}
                  messages={data().detailMessages}
                  totalMessageCount={selectedListItem()?.messageCount ?? data().detailMessages.length}
                  error={data().detailError}
                  dateConfig={props.dateConfig}
                  listCollapsed={listCollapsed()}
                  detailsOpen={detailsOpen()}
                  onRestoreList={() => setCollapsed(false)}
                  onToggleDetails={() => canShowDetails() && setDetailsOpen((open) => !open)}
                  onUnreadChange={setConversationUnread}
                  onReconcile={reconcileWorkspace}
                  onSelectionRemoved={() => openWorkspaceHref(buildMailListHref(new URL(requestUrl())), true)}
                  onComposerActiveChange={updateComposerActive}
                  onNavigate={navigateWorkspace}
                />
              </>
            }
          >
            <MailScheduledView
              mailboxId={data().mailbox.id}
              page={data().scheduledPage ?? { items: [], nextCursor: null, total: data().scheduledCount }}
              error={data().scheduledError}
              dateConfig={props.dateConfig}
              canWrite={canWrite()}
              loading={routeLoading()}
              onNavigate={navigateWorkspace}
              onRefresh={async () => {
                const result = await replaceWorkspaceRoute(requestUrl());
                if (result === "failed") documentNavigate(requestUrl(), { replace: true });
              }}
            />
          </Show>
        </AppWorkspace.Main>
        <AppWorkspace.Detail id="mail-context" open={detailsOpen() && canShowDetails()} width="lg" maxWidth={520}>
          <Show when={data().selectedConversationId && data().collaborationState && data().conversationLocalTags}>
            <MailDetailsPanel
              mailboxId={data().mailbox.id}
              conversationId={data().selectedConversationId!}
              currentUserId={props.currentUserId}
              canWrite={canWrite()}
              canAdmin={canAdmin()}
              initialState={data().collaborationState!}
              initialLocalTags={data().localTags}
              initialConversationLocalTags={data().conversationLocalTags!}
              initialComments={data().comments}
              assignableUsers={data().assignableUsers}
              mentionableUsers={data().mentionableUsers}
              presence={presence().participants}
              activity={data().activity}
              initialReminder={data().reminder}
              messages={data().detailMessages}
              subject={data().selectedSubject}
              dateConfig={props.dateConfig}
              onClose={() => setDetailsOpen(false)}
            />
          </Show>
        </AppWorkspace.Detail>
      </AppWorkspace.Content>
    </AppWorkspace>
  );
}
