import { createLiveWebSocket } from "@valentinkolb/cloud/browser/live";
import { AppWorkspace } from "@valentinkolb/cloud/ui";
import { documentNavigate, type LinkNavigateEvent, navigate } from "@valentinkolb/ssr/nav";
import type { DateContext } from "@valentinkolb/stdlib";
import { batch, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "../api/client";
import { MAIL_LIVE_WS_TYPE, type MailLiveClientMessage, type MailLiveServerMessage, parseMailLiveServerMessage } from "../live-events";
import type { MailboxPageData } from "../service/workspace";
import { openMailboxSettingsDialog } from "./_components/MailboxSettingsDialog";
import MailConversationList from "./_components/MailConversationList";
import MailConversationReader from "./_components/MailConversationReader";
import MailDetailsPanel from "./_components/MailDetailsPanel";
import MailSidebar from "./_components/MailSidebar";
import { createMailLiveRefreshCoordinator } from "./_components/mail-live-refresh";
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
  const [settingsOpening, setSettingsOpening] = createSignal(false);
  let preferenceTimer: ReturnType<typeof setTimeout> | null = null;
  let markLiveApplied: (cursor: string | null | undefined) => void = () => undefined;
  let routeRequest = 0;

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

  const persistPreferences = () => {
    if (preferenceTimer) clearTimeout(preferenceTimer);
    preferenceTimer = setTimeout(() => writeMailWorkspacePreferences({ listCollapsed: listCollapsed() }), 120);
  };

  const setCollapsed = (collapsed: boolean) => {
    setListCollapsed(collapsed);
    persistPreferences();
  };

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
    let reconcileAfterReady = props.data.initialLiveCursor === null;
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
          if (reconcileAfterReady) {
            reconcileAfterReady = false;
            liveRefresh.schedule(message.payload.cursor);
          } else controls.markApplied(message.payload.cursor);
          return;
        }
        if (message.type === MAIL_LIVE_WS_TYPE.event) {
          const selectedConversationId = data().selectedConversationId;
          if (!selectedConversationId || message.payload.event.conversationId === selectedConversationId) {
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
  const hasSelection = createMemo(() => data().detailMessages.length > 0);
  const canShowDetails = createMemo(() => Boolean(data().selectedConversationId && data().collaborationState));

  return (
    <AppWorkspace>
      <MailSidebar
        mailboxId={data().mailbox.id}
        mailboxName={data().mailbox.name}
        folders={data().folders}
        savedViews={data().savedViews}
        drafts={data().drafts}
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
              loading={routeLoading()}
              onCollapse={() => setCollapsed(true)}
              onNavigate={navigateWorkspace}
              onOpenHref={openWorkspaceHref}
            />
          </AppWorkspace.MainPane>
          <MailConversationReader
            mailboxId={data().mailbox.id}
            requestUrl={requestUrl()}
            canWrite={canWrite()}
            identities={data().identities}
            selectionKey={data().selectedConversationId ?? data().selectedMessageId}
            selectedConversationId={data().selectedConversationId}
            subject={data().selectedSubject}
            messages={data().detailMessages}
            dateConfig={props.dateConfig}
            listCollapsed={listCollapsed()}
            detailsOpen={detailsOpen()}
            onRestoreList={() => setCollapsed(false)}
            onToggleDetails={() => canShowDetails() && setDetailsOpen((open) => !open)}
            onComposerActiveChange={updateComposerActive}
            onNavigate={navigateWorkspace}
          />
        </AppWorkspace.Main>
        <AppWorkspace.Detail id="mail-context" open={detailsOpen() && canShowDetails()} width="lg" maxWidth={520}>
          <Show when={data().selectedConversationId && data().collaborationState}>
            <MailDetailsPanel
              mailboxId={data().mailbox.id}
              conversationId={data().selectedConversationId!}
              currentUserId={props.currentUserId}
              canWrite={canWrite()}
              initialState={data().collaborationState!}
              initialComments={data().comments}
              assignableUsers={data().assignableUsers}
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
