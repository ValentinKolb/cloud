import { AppWorkspace } from "@valentinkolb/cloud/ui";
import { documentNavigate, type LinkNavigateEvent, navigate, refreshCurrentPath } from "@valentinkolb/ssr/nav";
import type { DateContext } from "@valentinkolb/stdlib";
import { batch, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "../api/client";
import type { MailboxPageData } from "../service/workspace";
import { openMailboxSettingsDialog } from "./_components/MailboxSettingsDialog";
import MailConversationList from "./_components/MailConversationList";
import MailConversationReader from "./_components/MailConversationReader";
import MailDetailsPanel from "./_components/MailDetailsPanel";
import MailSidebar from "./_components/MailSidebar";
import MailWorkspaceSplit from "./_components/MailWorkspaceSplit";
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
  const [listWidth, setListWidth] = createSignal(props.initialPreferences.listWidth);
  const [detailsOpen, setDetailsOpen] = createSignal(false);
  const [composerActive, setComposerActive] = createSignal(false);
  const [settingsOpening, setSettingsOpening] = createSignal(false);
  let preferenceTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshPending = false;
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
    preferenceTimer = setTimeout(() => writeMailWorkspacePreferences({ listCollapsed: listCollapsed(), listWidth: listWidth() }), 120);
  };

  const setCollapsed = (collapsed: boolean) => {
    setListCollapsed(collapsed);
    persistPreferences();
  };

  const updateListWidth = (width: number) => {
    setListWidth(width);
    persistPreferences();
  };

  const scheduleRefresh = () => {
    if (composerActive()) {
      refreshPending = true;
      return;
    }
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refreshCurrentPath(), 180);
  };

  const updateComposerActive = (active: boolean) => {
    setComposerActive(active);
    if (!active && refreshPending) {
      refreshPending = false;
      scheduleRefresh();
    }
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
    const source = new EventSource(`/api/mail/mailboxes/${data().mailbox.id}/events`);
    const handleEvent = (event: MessageEvent<string>) => {
      if (!data().selectedConversationId) return scheduleRefresh();
      try {
        const payload = JSON.parse(event.data) as { conversationId?: string | null };
        if (!payload.conversationId || payload.conversationId === data().selectedConversationId) scheduleRefresh();
      } catch {
        // Ignore malformed events. EventSource reconnects and later valid events refresh the snapshot.
      }
    };
    const handlePopState = () => {
      void replaceWorkspaceRoute(`${window.location.pathname}${window.location.search}`).then((result) => {
        if (result === "failed") documentNavigate(`${window.location.pathname}${window.location.search}`, { replace: true });
      });
    };
    source.addEventListener("conversation.changed", handleEvent as EventListener);
    window.addEventListener("popstate", handlePopState);
    onCleanup(() => {
      source.close();
      window.removeEventListener("popstate", handlePopState);
    });
  });

  onCleanup(() => {
    if (preferenceTimer) clearTimeout(preferenceTimer);
    if (refreshTimer) clearTimeout(refreshTimer);
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
        <AppWorkspace.Main class="relative p-0" aria-busy={routeLoading()}>
          <MailWorkspaceSplit
            collapsed={listCollapsed()}
            hasSelection={hasSelection()}
            listWidth={listWidth()}
            onListWidthChange={updateListWidth}
            list={
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
            }
            reader={
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
            }
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
