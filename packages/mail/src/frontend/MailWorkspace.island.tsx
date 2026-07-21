import { createLiveWebSocket } from "@valentinkolb/cloud/browser/live";
import { AppWorkspace, openSpotlightSearch, prompts, toast } from "@valentinkolb/cloud/ui";
import { documentNavigate, type LinkNavigateEvent, navigate } from "@valentinkolb/ssr/nav";
import type { DateContext } from "@valentinkolb/stdlib";
import { hotkeys } from "@valentinkolb/stdlib/solid";
import { batch, createEffect, createMemo, createSignal, onCleanup, onMount, Show, untrack } from "solid-js";
import { apiClient } from "../api/client";
import { MAIL_LIVE_WS_TYPE, type MailLiveClientMessage, type MailLiveServerMessage, parseMailLiveServerMessage } from "../live-events";
import type { ConversationPresenceSnapshot } from "../service/presence";
import type { MailboxPageData, MailConversationDetailData, MailListItem } from "../service/workspace";
import { readApiError } from "./_components/api-response";
import { openMailboxSettingsDialog } from "./_components/MailboxSettingsDialog";
import MailConversationList from "./_components/MailConversationList";
import MailConversationReader from "./_components/MailConversationReader";
import MailDetailsPanel from "./_components/MailDetailsPanel";
import MailScheduledView from "./_components/MailScheduledView";
import { openMailShortcutSettings, resolveMailShortcut } from "./_components/MailShortcutSettings";
import MailSidebar from "./_components/MailSidebar";
import { executeMailBulkAction, type MailBulkTarget } from "./_components/mail-bulk-actions";
import {
  buildMailTriageInput,
  getMailCommand,
  isMailTriageCommand,
  MAIL_COMMANDS,
  type MailProductivityCommandId,
  type MailTriageCommandId,
} from "./_components/mail-command-registry";
import {
  emptyMailConversationSelection,
  findMailFocusAfterRemoval,
  pruneMailConversationSelection,
  selectVisibleMailConversations,
  toggleMailConversationSelection,
} from "./_components/mail-conversation-selection";
import { createMailDetailPrefetchCache } from "./_components/mail-detail-prefetch";
import { createMailLiveRefreshCoordinator } from "./_components/mail-live-refresh";
import { buildMailListHref, buildMailSelectionHref } from "./_components/mail-navigation";
import { type MailWorkspacePreferences, writeMailWorkspacePreferences } from "./_components/mail-workspace-preferences";

const rank = (permission: string): number => (permission === "admin" ? 3 : permission === "write" ? 2 : permission === "read" ? 1 : 0);
const isAbortError = (error: unknown): boolean => error instanceof DOMException && error.name === "AbortError";
const isMailHotkeyBlocked = (): boolean => {
  const target = document.activeElement;
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "input, textarea, select, [contenteditable='true'], [role='dialog'], [role='alertdialog'], [data-mail-hotkeys-disabled]",
    ),
  );
};

const mailListScope = (href: string): string => {
  const url = new URL(href, "http://mail.local");
  url.searchParams.delete("conversation");
  url.searchParams.delete("message");
  url.searchParams.delete("cursor");
  return `${url.pathname}${url.search}`;
};

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
  const [selectionLoading, setSelectionLoading] = createSignal(false);
  const [listCollapsed, setListCollapsed] = createSignal(props.initialPreferences.listCollapsed);
  const [detailsOpen, setDetailsOpen] = createSignal(false);
  const [composerActive, setComposerActive] = createSignal(false);
  const [presence, setPresence] = createSignal<ConversationPresenceSnapshot>({
    participants: [],
  });
  const [settingsOpening, setSettingsOpening] = createSignal(false);
  const [conversationSelection, setConversationSelection] = createSignal(emptyMailConversationSelection());
  const [commandPending, setCommandPending] = createSignal(false);
  const mailboxId = props.data.mailbox.id;
  let preferenceTimer: ReturnType<typeof setTimeout> | null = null;
  let markLiveApplied: (cursor: string | null | undefined) => void = () => undefined;
  let updatePresenceMode: (() => void) | null = null;
  let routeRequest = 0;
  let selectionRequest = 0;
  let routeController: AbortController | null = null;
  const pendingReadConversationIds = new Set<string>();
  const detailCache = createMailDetailPrefetchCache<MailConversationDetailData>(4);
  const selectedConversationId = createMemo(() => data().selectedConversationId);
  const selectedConversationIds = createMemo(() => conversationSelection().ids);

  const replaceWorkspaceRoute = async (href: string): Promise<"applied" | "failed" | "stale"> => {
    selectionRequest += 1;
    setSelectionLoading(false);
    const request = ++routeRequest;
    routeController?.abort();
    const controller = new AbortController();
    routeController = controller;
    setRouteLoading(true);
    try {
      const target = new URL(href, window.location.origin);
      if (target.origin !== window.location.origin || target.pathname !== `/app/mail/${data().mailbox.id}`) return "failed";
      const response = await apiClient.mailboxes[":mailboxId"]["workspace-route"].$get(
        {
          param: { mailboxId: data().mailbox.id },
          query: { href: `${target.pathname}${target.search}` },
        },
        { init: { signal: controller.signal } },
      );
      if (!response.ok) return "failed";
      const next = await response.json();
      if (request !== routeRequest) return "stale";
      const scopeChanged = mailListScope(requestUrl()) !== mailListScope(target.toString());
      batch(() => {
        setRequestUrl(target.toString());
        setData(next);
        setConversationSelection((current) =>
          scopeChanged
            ? emptyMailConversationSelection()
            : pruneMailConversationSelection(
                current,
                new Set(next.listItems.flatMap((item) => (item.conversationId ? [item.conversationId] : []))),
              ),
        );
        if (!next.collaborationState) setDetailsOpen(false);
      });
      if (scopeChanged) detailCache.clear();
      return "applied";
    } catch (error) {
      return isAbortError(error) ? "stale" : "failed";
    } finally {
      if (routeController === controller) routeController = null;
      if (request === routeRequest) setRouteLoading(false);
    }
  };

  const navigateWorkspace = async (nav: LinkNavigateEvent) => {
    const result = await replaceWorkspaceRoute(nav.href);
    if (result === "applied") nav.push(undefined, { scroll: "preserve" });
    else if (result === "failed") nav.fallback();
  };

  const closeConversation = async (nav: LinkNavigateEvent) => {
    const previousConversationId = data().selectedConversationId;
    const result = await replaceWorkspaceRoute(nav.href);
    if (result === "applied") {
      nav.push(undefined, { scroll: "preserve" });
      if (previousConversationId) focusConversation(previousConversationId, "row");
    } else if (result === "failed") nav.fallback();
  };

  const openWorkspaceHref = async (href: string, replace = false) => {
    const result = await replaceWorkspaceRoute(href);
    if (result === "applied") navigate(href, { replace, scroll: "preserve" });
    else if (result === "failed") documentNavigate(href, { replace });
  };

  const loadMoreConversations = async (href: string) => {
    if (routeLoading()) return;
    const request = ++routeRequest;
    routeController?.abort();
    const controller = new AbortController();
    routeController = controller;
    const sourceUrl = requestUrl();
    setRouteLoading(true);
    try {
      const target = new URL(href, window.location.origin);
      if (target.origin !== window.location.origin || target.pathname !== `/app/mail/${data().mailbox.id}`)
        throw new Error("Invalid mailbox page");
      const response = await apiClient.mailboxes[":mailboxId"]["workspace-route"].$get(
        {
          param: { mailboxId: data().mailbox.id },
          query: { href: `${target.pathname}${target.search}` },
        },
        { init: { signal: controller.signal } },
      );
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
      if (request === routeRequest && !isAbortError(error))
        toast.error(error instanceof Error ? error.message : "Could not load more conversations");
    } finally {
      if (routeController === controller) routeController = null;
      if (request === routeRequest) setRouteLoading(false);
    }
  };

  const persistPreferences = () => {
    if (preferenceTimer) clearTimeout(preferenceTimer);
    preferenceTimer = setTimeout(
      () =>
        writeMailWorkspacePreferences({
          ...props.initialPreferences,
          listCollapsed: listCollapsed(),
        }),
      120,
    );
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
            json: {
              peerId,
              mode: untrack(composerActive) ? "composing" : "viewing",
            },
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
    isBlocked: () => composerActive() || routeLoading() || selectionLoading(),
    refresh: () => replaceWorkspaceRoute(requestUrl()),
    onApplied: (cursor) => markLiveApplied(cursor),
    onFailed: () =>
      documentNavigate(`${window.location.pathname}${window.location.search}`, {
        replace: true,
      }),
  });

  createEffect(() => {
    if (!composerActive() && !routeLoading() && !selectionLoading()) liveRefresh.resume();
  });

  const updateComposerActive = (active: boolean) => {
    setComposerActive(active);
    if (!active) liveRefresh.resume();
  };

  const openSettings = async (initialTab?: string) => {
    if (settingsOpening()) return;
    setSettingsOpening(true);
    try {
      const result = await openMailboxSettingsDialog({
        mailboxId: data().mailbox.id,
        currentUserId: props.currentUserId,
        currentUserEmail: props.currentUserEmail,
        dateConfig: props.dateConfig,
        initialTab,
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
    const oauthUrl = new URL(window.location.href);
    const oauthOutcome = oauthUrl.searchParams.get("oauth");
    const oauthFlowId = oauthUrl.searchParams.get("flow");
    if (oauthOutcome) {
      oauthUrl.searchParams.delete("oauth");
      oauthUrl.searchParams.delete("flow");
      window.history.replaceState(window.history.state, "", `${oauthUrl.pathname}${oauthUrl.search}${oauthUrl.hash}`);
      if (oauthOutcome === "connected" || oauthOutcome === "reconnected") toast.success("Provider connected with OAuth");
      else if (oauthOutcome === "partial")
        toast("Provider connected, but setup still requires attention", {
          title: "OAuth setup incomplete",
        });
      else toast.error("OAuth authorization could not be completed");
      void (async () => {
        if (oauthFlowId) {
          try {
            const response = await apiClient.oauth.flows[":flowId"].$get({ param: { flowId: oauthFlowId } });
            if (response.ok) {
              const result = await response.json();
              const resultCode = result.resultCode?.toLowerCase() ?? null;
              if (result.message && resultCode !== "connected" && resultCode !== "reconnected" && resultCode !== "partial") {
                toast.error(result.message);
              }
              if (result.diagnostics?.imap.status === "failed" || result.diagnostics?.smtp.status === "failed") {
                toast.error(`IMAP: ${result.diagnostics.imap.message}; SMTP: ${result.diagnostics.smtp.message}`);
              }
            }
          } catch {
            toast.error("OAuth completed, but its connection status could not be loaded");
          }
        }
        await openSettings("connections");
      })();
    }
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
          controls.terminate({
            code: "resource_mismatch",
            message: "Mail live subscription changed resources",
          });
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
          if (message.payload.event.conversationId) detailCache.invalidate(message.payload.event.conversationId);
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
          controls.terminate({
            code: message.payload.code,
            message: message.payload.message,
          });
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
    routeController?.abort();
    detailCache.clear();
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

  const loadConversationDetail = (conversationId: string) =>
    detailCache.load(conversationId, async (signal) => {
      const response = await apiClient.mailboxes[":mailboxId"]["workspace-detail"][":conversationId"].$get(
        { param: { mailboxId, conversationId } },
        { init: { signal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not load conversation"));
      return await response.json();
    });

  const prefetchConversation = (item: MailListItem) => {
    if (!item.conversationId || item.conversationId === data().selectedConversationId) return;
    void loadConversationDetail(item.conversationId).catch((error) => {
      if (!isAbortError(error)) detailCache.invalidate(item.conversationId!);
    });
  };

  const prefetchNeighbors = (conversationId: string) => {
    const items = data().listItems;
    const index = items.findIndex((item) => item.conversationId === conversationId);
    if (index < 0) return;
    const neighbors = [items[index - 1], items[index + 1]].filter((item): item is MailListItem => Boolean(item?.conversationId));
    detailCache.retain(new Set([conversationId, ...neighbors.map((item) => item.conversationId!)]));
    for (const neighbor of neighbors) prefetchConversation(neighbor);
  };

  const focusConversation = (conversationId: string, target: "reader" | "row") => {
    requestAnimationFrame(() => {
      const element =
        target === "reader"
          ? document.querySelector<HTMLElement>("[data-mail-reader-heading]")
          : document.querySelector<HTMLElement>(`[data-conversation-id="${CSS.escape(conversationId)}"] .mail-list-row`);
      element?.focus({ preventScroll: true });
      if (target === "row") element?.scrollIntoView({ block: "nearest" });
    });
  };

  const applyConversationRoute = async (
    href: string,
    item: MailListItem,
    activation: "keyboard" | "pointer",
  ): Promise<"applied" | "failed" | "stale"> => {
    if (!item.conversationId) return "failed";
    const target = new URL(href, window.location.origin);
    if (target.origin !== window.location.origin || target.pathname !== `/app/mail/${mailboxId}`) return "failed";

    routeRequest += 1;
    routeController?.abort();
    routeController = null;
    setRouteLoading(false);
    const request = ++selectionRequest;
    setSelectionLoading(true);
    const items = data().listItems;
    const index = items.findIndex((candidate) => candidate.conversationId === item.conversationId);
    detailCache.retain(
      new Set(
        [items[index - 1]?.conversationId, item.conversationId, items[index + 1]?.conversationId].filter(
          (conversationId): conversationId is string => Boolean(conversationId),
        ),
      ),
    );
    try {
      const detail = await loadConversationDetail(item.conversationId);
      if (request !== selectionRequest) return "stale";
      batch(() => {
        setRequestUrl(target.toString());
        setData((current) => ({
          ...current,
          ...detail,
          selectedConversationId: item.conversationId,
          selectedMessageId: null,
          selectedSubject: detail.selectedSubject || item.subject || "Message",
        }));
        if (!detail.collaborationState) setDetailsOpen(false);
      });
      void persistConversationRead(item);
      prefetchNeighbors(item.conversationId);
      if (activation === "keyboard") focusConversation(item.conversationId, "reader");
      return "applied";
    } catch (error) {
      if (!isAbortError(error)) detailCache.invalidate(item.conversationId);
      return request !== selectionRequest || isAbortError(error) ? "stale" : "failed";
    } finally {
      if (request === selectionRequest) {
        setSelectionLoading(false);
        liveRefresh.resume();
      }
    }
  };

  const navigateConversation = async (nav: LinkNavigateEvent, item: MailListItem, activation: "keyboard" | "pointer") => {
    if (!item.conversationId) return await navigateWorkspace(nav);
    const result = await applyConversationRoute(nav.href, item, activation);
    if (result === "applied") nav.push(undefined, { scroll: "preserve" });
    else if (result === "failed") nav.fallback();
  };

  const reconcileWorkspace = async () => {
    const result = await replaceWorkspaceRoute(requestUrl());
    if (result === "failed") documentNavigate(requestUrl(), { replace: true });
  };

  const orderedConversationIds = () => data().listItems.flatMap((item) => (item.conversationId ? [item.conversationId] : []));

  const toggleConversationSelection = (item: MailListItem, range: boolean) => {
    if (!item.conversationId) return;
    setConversationSelection((selection) =>
      toggleMailConversationSelection({
        selection,
        conversationId: item.conversationId!,
        orderedConversationIds: orderedConversationIds(),
        range,
      }),
    );
  };

  const clearConversationSelection = () => {
    const anchor = conversationSelection().anchorId;
    setConversationSelection(emptyMailConversationSelection());
    if (anchor) focusConversation(anchor, "row");
  };

  const commandTargets = (commandId: MailTriageCommandId): MailBulkTarget[] => {
    const selectedIds = selectedConversationIds();
    const ids = selectedIds.size > 0 ? selectedIds : new Set(data().selectedConversationId ? [data().selectedConversationId] : []);
    const targets = data().listItems.flatMap((item) => {
      if (!item.conversationId || !ids.has(item.conversationId)) return [];
      const activeFolderId = item.conversationId === data().selectedConversationId ? data().folderId : null;
      const sourceFolderIds =
        commandId === "mark_read" && item.unreadFolderIds.length > 0
          ? item.unreadFolderIds
          : [activeFolderId ?? item.sourceFolderId].filter((folderId): folderId is string => Boolean(folderId));
      return [
        {
          conversationId: item.conversationId,
          label: item.subject || "(no subject)",
          sourceFolderIds,
        },
      ];
    });
    if (targets.length > 0 || selectedIds.size > 0 || !data().selectedConversationId) return targets;
    const detailFolderIds =
      commandId === "mark_read"
        ? [
            ...new Set(
              data()
                .detailMessages.filter((message) => !message.flags.includes("\\Seen"))
                .map((message) => message.folderId),
            ),
          ]
        : [data().folderId ?? data().detailMessages.at(-1)?.folderId ?? null];
    return [
      {
        conversationId: data().selectedConversationId!,
        label: data().selectedSubject || "(no subject)",
        sourceFolderIds: detailFolderIds.filter((folderId): folderId is string => Boolean(folderId)),
      },
    ];
  };

  const chooseDestinationFolder = async () => {
    const folders = data().folders.filter((folder) => folder.selectable && folder.discoveryState === "active");
    const selected = await openSpotlightSearch<{ folderId: string }>({
      title: "Move to folder",
      icon: "ti ti-folder-symlink",
      placeholder: "Search folders...",
      noResultsText: "No selectable folder found.",
      resolve: ({ query }) => {
        const needle = query.trim().toLocaleLowerCase();
        return folders
          .filter((folder) => !needle || folder.name.toLocaleLowerCase().includes(needle))
          .map((folder) => ({
            label: folder.name,
            desc: folder.role === "folder" ? "Provider folder" : folder.role,
            icon: "ti ti-folder",
            value: { folderId: folder.id },
          }));
      },
    });
    return selected?.value?.folderId ?? null;
  };

  const runTriageCommand = async (
    commandId: MailTriageCommandId,
    options: {
      targets?: MailBulkTarget[];
      destinationFolderId?: string;
      silent?: boolean;
    } = {},
  ) => {
    if (!canWrite() || commandPending()) return;
    let targets = options.targets ?? commandTargets(commandId);
    if (targets.length === 0) {
      if (!options.silent) await prompts.error("Select a conversation with an active provider placement.");
      return;
    }
    const destinationFolderId = commandId === "move" ? (options.destinationFolderId ?? (await chooseDestinationFolder())) : undefined;
    if (commandId === "move" && !destinationFolderId) return;

    if (commandId === "move") {
      targets = targets
        .map((target) => ({
          ...target,
          sourceFolderIds: target.sourceFolderIds.filter((sourceFolderId) => sourceFolderId !== destinationFolderId),
        }))
        .filter((target) => target.sourceFolderIds.length > 0);
      if (targets.length === 0) {
        if (!options.silent) toast("The selected conversations are already in this folder", { title: "Nothing to move" });
        return;
      }
    }

    const correlationId = crypto.randomUUID();
    setCommandPending(true);
    if (commandId === "mark_read" || commandId === "mark_unread") {
      const unread = commandId === "mark_unread";
      for (const target of targets) setConversationUnread(target.conversationId, unread);
    }

    try {
      const result = await executeMailBulkAction({
        commandId,
        targets,
        submit: async (target, sourceFolderId) => {
          const response = await apiClient.mailboxes[":mailboxId"].conversations[":conversationId"].actions.$post({
            param: { mailboxId, conversationId: target.conversationId },
            json: buildMailTriageInput({
              commandId,
              sourceFolderId,
              destinationFolderId: destinationFolderId ?? undefined,
              correlationId,
              idempotencyKey: crypto.randomUUID(),
            }),
          });
          if (!response.ok)
            throw new Error(await readApiError(response, `Could not ${getMailCommand(commandId).label.toLocaleLowerCase()}`));
        },
      });

      const succeeded = new Set(result.succeededConversationIds);
      setConversationSelection((current) => ({
        ids: new Set([...current.ids].filter((id) => !succeeded.has(id))),
        anchorId: current.anchorId && !succeeded.has(current.anchorId) ? current.anchorId : null,
      }));

      const removesActiveConversation =
        (commandId === "archive" || commandId === "junk" || commandId === "trash" || commandId === "move") &&
        Boolean(data().selectedConversationId && succeeded.has(data().selectedConversationId!));
      if (result.succeededConversationIds.length > 0) {
        if (removesActiveConversation) {
          const focusAfterRemoval = findMailFocusAfterRemoval({
            orderedConversationIds: orderedConversationIds(),
            activeConversationId: data().selectedConversationId,
            removedConversationIds: succeeded,
          });
          await openWorkspaceHref(buildMailListHref(new URL(requestUrl())), true);
          if (focusAfterRemoval) focusConversation(focusAfterRemoval, "row");
        } else await reconcileWorkspace();
        if (!options.silent) {
          toast.success(
            targets.length === 1
              ? `${getMailCommand(commandId).label} queued`
              : `${getMailCommand(commandId).label} queued for ${result.succeededConversationIds.length} conversations`,
          );
        }
      } else if (commandId === "mark_read" || commandId === "mark_unread") {
        await reconcileWorkspace();
      }
      if (result.failures.length > 0) {
        const details = result.failures
          .slice(0, 5)
          .map(
            (failure) =>
              `${failure.label}: ${failure.message}${failure.submittedPlacements > 0 ? " (some placements were already queued)" : ""}`,
          )
          .join("\n");
        await prompts.error(details, {
          title: `${result.failures.length} of ${targets.length} conversations failed`,
        });
      }
    } finally {
      setCommandPending(false);
    }
  };

  const openRelativeConversation = async (delta: -1 | 1) => {
    const items = data().listItems.filter((item): item is MailListItem & { conversationId: string } => Boolean(item.conversationId));
    if (items.length === 0) return;
    const currentIndex = items.findIndex((item) => item.conversationId === data().selectedConversationId);
    const target = items[Math.min(Math.max((currentIndex < 0 ? (delta > 0 ? -1 : 1) : currentIndex) + delta, 0), items.length - 1)];
    if (!target || target.conversationId === data().selectedConversationId) return;
    const href = buildMailSelectionHref(new URL(requestUrl()), target);
    if ((await applyConversationRoute(href, target, "keyboard")) === "applied") navigate(href, { scroll: "preserve" });
  };

  const openCommandPalette = async () => {
    const hasTargets = commandTargets("archive").length > 0;
    const selected = await openSpotlightSearch<{
      commandId: MailProductivityCommandId;
    }>({
      title: "Mail commands",
      icon: "ti ti-command",
      placeholder: "Search commands...",
      noResultsText: "No available command found.",
      resolve: ({ query }) => {
        const needle = query.trim().toLocaleLowerCase();
        return MAIL_COMMANDS.filter((command) => {
          if (command.id === "command_palette") return false;
          if (command.scope === "conversation" && (!canWrite() || !hasTargets)) return false;
          if (command.id === "clear_selection" && selectedConversationIds().size === 0) return false;
          return !needle || `${command.label} ${command.description}`.toLocaleLowerCase().includes(needle);
        }).map((command) => {
          const shortcut = resolveMailShortcut(command.id, props.initialPreferences);
          return {
            label: command.label,
            desc: shortcut ? `${command.description} · ${shortcut}` : command.description,
            icon: command.icon,
            value: { commandId: command.id },
          };
        });
      },
    });
    if (selected?.value) await runProductivityCommand(selected.value.commandId);
  };

  const runProductivityCommand = async (commandId: MailProductivityCommandId) => {
    if (isMailTriageCommand(commandId)) return await runTriageCommand(commandId);
    if (commandId === "next") return await openRelativeConversation(1);
    if (commandId === "previous") return await openRelativeConversation(-1);
    if (commandId === "clear_selection") return clearConversationSelection();
    if (commandId === "command_palette") return await openCommandPalette();
    if (commandId === "configure_shortcuts") {
      if (
        await openMailShortcutSettings({
          ...props.initialPreferences,
          listCollapsed: listCollapsed(),
        })
      )
        window.location.reload();
    }
  };

  hotkeys.create(() => {
    const entries: Record<string, { label: string; desc: string; run: () => void | Promise<void> }> = {};
    for (const command of MAIL_COMMANDS) {
      const shortcut = resolveMailShortcut(command.id, props.initialPreferences);
      if (!shortcut) continue;
      entries[shortcut] = {
        label: command.label,
        desc: command.description,
        run: () => (isMailHotkeyBlocked() ? undefined : runProductivityCommand(command.id)),
      };
    }
    return entries;
  });

  let autoReadSelectionId: string | null = null;
  createEffect(() => {
    const item = selectedListItem();
    const conversationId = item?.conversationId ?? data().selectedConversationId;
    if (conversationId === autoReadSelectionId) return;
    autoReadSelectionId = conversationId;
    if (item?.unread) void persistConversationRead(item);
    else if (conversationId && selectedUnread()) void runTriageCommand("mark_read", { silent: true });
  });

  createEffect(() => {
    const conversationId = data().selectedConversationId;
    data().listItems;
    if (conversationId) prefetchNeighbors(conversationId);
  });

  const setDetailsVisible = (open: boolean) => {
    setDetailsOpen(open);
    requestAnimationFrame(() => {
      const target = open
        ? document.querySelector<HTMLElement>("[data-mail-details-heading]")
        : document.querySelector<HTMLElement>("[data-mail-details-trigger]");
      target?.focus({ preventScroll: true });
    });
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
        onMoveConversation={(input) =>
          runTriageCommand("move", {
            targets: [
              {
                conversationId: input.conversationId,
                label: "Conversation",
                sourceFolderIds: [input.sourceFolderId],
              },
            ],
            destinationFolderId: input.destinationFolderId,
          })
        }
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
                    selectedConversationIds={selectedConversationIds()}
                    nextCursor={data().nextListCursor}
                    dateConfig={props.dateConfig}
                    canWrite={canWrite()}
                    savedViews={data().savedViews}
                    activeSavedViewId={data().savedViewId}
                    loading={routeLoading()}
                    onCollapse={() => setCollapsed(true)}
                    onNavigate={navigateWorkspace}
                    onNavigateItem={navigateConversation}
                    onToggleSelection={toggleConversationSelection}
                    onSelectAll={() => setConversationSelection(selectVisibleMailConversations(orderedConversationIds()))}
                    onClearSelection={clearConversationSelection}
                    onBulkCommand={runTriageCommand}
                    onOpenCommands={openCommandPalette}
                    onPrefetch={prefetchConversation}
                    onOpenHref={openWorkspaceHref}
                    onLoadMore={loadMoreConversations}
                  />
                </AppWorkspace.MainPane>
                <MailConversationReader
                  mailboxId={data().mailbox.id}
                  requestUrl={requestUrl()}
                  canWrite={canWrite()}
                  canAdmin={canAdmin()}
                  identities={data().identities}
                  selectionKey={data().selectedConversationId ?? data().selectedMessageId}
                  selectedConversationId={data().selectedConversationId}
                  unread={selectedUnread()}
                  reference={data().selectedReference}
                  subject={data().selectedSubject}
                  messages={data().detailMessages}
                  totalMessageCount={selectedListItem()?.messageCount ?? data().detailMessages.length}
                  error={data().detailError}
                  dateConfig={props.dateConfig}
                  listCollapsed={listCollapsed()}
                  detailsOpen={detailsOpen()}
                  onRestoreList={() => setCollapsed(false)}
                  onToggleDetails={() => canShowDetails() && setDetailsVisible(!detailsOpen())}
                  commandPending={commandPending()}
                  onCommand={runTriageCommand}
                  onReconcile={reconcileWorkspace}
                  onComposerActiveChange={updateComposerActive}
                  onClose={closeConversation}
                />
              </>
            }
          >
            <MailScheduledView
              mailboxId={data().mailbox.id}
              page={
                data().scheduledPage ?? {
                  items: [],
                  nextCursor: null,
                  total: data().scheduledCount,
                }
              }
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
              active={detailsOpen()}
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
              onClose={() => setDetailsVisible(false)}
            />
          </Show>
        </AppWorkspace.Detail>
      </AppWorkspace.Content>
    </AppWorkspace>
  );
}
