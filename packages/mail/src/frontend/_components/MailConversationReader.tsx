import { Dropdown, Placeholder, prompts, Tooltip, toast } from "@valentinkolb/cloud/ui";
import { Link, type LinkNavigateEvent } from "@valentinkolb/ssr/nav";
import { type DateContext, dates } from "@valentinkolb/stdlib";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type { ConversationDraftSummary, DraftIntent, MailCommand, MailDraft, SenderIdentity } from "../../contracts";
import type { MessageDetail } from "../../service/messages";
import { readApiError } from "./api-response";
import MailComposer from "./MailComposer";
import { buildMailListHref } from "./mail-navigation";

const formatAddress = (address: { name: string | null; address: string }): string =>
  address.name ? `${address.name} <${address.address}>` : address.address;

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const replySubject = (subject: string): string => (/^re:/i.test(subject) ? subject : `Re: ${subject}`);
const forwardSubject = (subject: string): string => (/^fwd:/i.test(subject) ? subject : `Fwd: ${subject}`);
const forwardBody = (message: MessageDetail, dateConfig: DateContext): string => `

---------- Forwarded message ----------
From: ${message.from.map(formatAddress).join(", ") || "Unknown sender"}
Date: ${dates.formatDateTime(message.internalDate, dateConfig)}
Subject: ${message.subject || "(no subject)"}
To: ${message.to.map(formatAddress).join(", ") || "Undisclosed recipients"}

${message.plainText ?? "[HTML message body]"}`;

type ComposerRequest = {
  intent: DraftIntent;
  message: MessageDetail;
  quotedBody?: string;
};

type ActiveComposer = ComposerRequest & {
  initialDraft?: MailDraft;
};

type DraftLookup = {
  conversationId: string;
  request: ComposerRequest;
};

type TriageKind = "archive" | "trash" | "junk" | "read" | "unread" | "flag" | "unflag";
type TriageRequest = {
  kind: TriageKind;
  conversationId: string;
  sourceFolderIds: string[];
  previousUnread: boolean | null;
};

const PENDING_COMMAND_STATES = new Set<MailCommand["state"]>(["queued", "executing", "ambiguous"]);
const SUCCESS_COMMAND_STATES = new Set<MailCommand["state"]>(["confirmed", "reconciled"]);

const intentLabel = (intent: DraftIntent): string =>
  intent === "reply" ? "reply" : intent === "reply_all" ? "reply all" : intent === "forward" ? "forward" : "message";

export default function MailConversationReader(props: {
  mailboxId: string;
  requestUrl: string;
  canWrite: boolean;
  identities: SenderIdentity[];
  selectionKey: string | null;
  selectedConversationId: string | null;
  unread: boolean;
  sourceFolderId: string | null;
  unreadSourceFolderIds: string[];
  reference: string | null;
  subject: string;
  messages: MessageDetail[];
  totalMessageCount: number;
  error: string | null;
  dateConfig: DateContext;
  listCollapsed: boolean;
  detailsOpen: boolean;
  onRestoreList: () => void;
  onToggleDetails: () => void;
  onUnreadChange: (conversationId: string, unread: boolean) => void;
  onReconcile: () => Promise<void>;
  onSelectionRemoved: () => Promise<void>;
  onComposerActiveChange: (active: boolean) => void;
  onNavigate: (event: LinkNavigateEvent) => void | Promise<void>;
}) {
  const [expandedMessages, setExpandedMessages] = createSignal(new Set(props.messages.slice(-1).map((message) => message.id)));
  const [compose, setCompose] = createSignal<ActiveComposer | null>(null);
  const [openingDraft, setOpeningDraft] = createSignal(false);
  const lastMessage = () => props.messages.at(-1);
  const closeHref = () => buildMailListHref(new URL(props.requestUrl));
  let draftLoadController: AbortController | null = null;
  let closeDraftDialog: ((value: ConversationDraftSummary | null | undefined) => void) | null = null;
  let disposed = false;

  const toggleMessage = (messageId: string) =>
    setExpandedMessages((current) => {
      const next = new Set(current);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });

  const waitForCommands = async (commands: MailCommand[], signal: AbortSignal): Promise<void> => {
    const deadline = Date.now() + 20_000;
    let current = commands;
    while (current.some((command) => PENDING_COMMAND_STATES.has(command.state))) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (Date.now() >= deadline) throw new Error("Mail action is still synchronizing");
      await new Promise((resolve) => setTimeout(resolve, 250));
      current = await Promise.all(
        current.map(async (command) => {
          if (!PENDING_COMMAND_STATES.has(command.state)) return command;
          const response = await apiClient.mailboxes[":mailboxId"].commands[":commandId"].$get(
            { param: { mailboxId: props.mailboxId, commandId: command.id } },
            { init: { signal } },
          );
          if (!response.ok) throw new Error(await readApiError(response, "Could not confirm mail action"));
          return await response.json();
        }),
      );
    }
    const failed = current.find((command) => !SUCCESS_COMMAND_STATES.has(command.state));
    if (failed) throw new Error(failed.lastError || `Mail action ended in ${failed.state}`);
  };

  const executeTriage = async (action: TriageRequest, signal: AbortSignal): Promise<TriageRequest> => {
    const queued = await Promise.all(
      action.sourceFolderIds.map(async (sourceFolderId) => {
        const input =
          action.kind === "archive" || action.kind === "trash" || action.kind === "junk"
            ? {
                kind: "move_to_role" as const,
                sourceFolderId,
                role: action.kind,
                idempotencyKey: crypto.randomUUID(),
              }
            : {
                kind: "change_state" as const,
                sourceFolderId,
                change: {
                  addFlags: action.kind === "read" ? ["seen" as const] : action.kind === "flag" ? ["flagged" as const] : [],
                  removeFlags: action.kind === "unread" ? ["seen" as const] : action.kind === "unflag" ? ["flagged" as const] : [],
                  addKeywords: [],
                  removeKeywords: [],
                },
                idempotencyKey: crypto.randomUUID(),
              };
        const response = await apiClient.mailboxes[":mailboxId"].conversations[":conversationId"].actions.$post({
          param: { mailboxId: props.mailboxId, conversationId: action.conversationId },
          json: input,
        });
        if (!response.ok) throw new Error(await readApiError(response, "Mail action failed"));
        return await response.json();
      }),
    );
    await waitForCommands(
      queued.flatMap((result) => result.commands),
      signal,
    );
    return action;
  };

  const triage = mutations.create<TriageRequest, TriageRequest, TriageRequest>({
    onBefore: (action) => action,
    mutation: (action, { abortSignal }) => executeTriage(action, abortSignal),
    onSuccess: (action) => {
      toast.success("Mail action completed");
      void (action.kind === "archive" || action.kind === "trash" || action.kind === "junk"
        ? props.onSelectionRemoved()
        : props.onReconcile());
    },
    onError: (error, action) => {
      if (action?.previousUnread !== null && action?.previousUnread !== undefined) {
        props.onUnreadChange(action.conversationId, action.previousUnread);
      }
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        prompts.error(error.message);
      }
    },
  });

  const markRead = mutations.create<TriageRequest, TriageRequest, TriageRequest>({
    onBefore: (action) => action,
    mutation: (action, { abortSignal }) => executeTriage(action, abortSignal),
    onSuccess: () => void props.onReconcile(),
    onError: (error, action) => {
      if (action) props.onUnreadChange(action.conversationId, action.previousUnread ?? true);
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        toast.error(error.message, { title: "Could not mark conversation as read" });
      }
    },
  });

  const runTriage = (kind: TriageKind, automatic = false) => {
    const conversationId = props.selectedConversationId;
    const detailUnreadFolderIds =
      kind === "read"
        ? [
            ...new Set(
              props.messages
                .filter((message) => !message.flags.includes("\\Seen"))
                .map((message) => message.folderId)
                .filter((folderId): folderId is string => Boolean(folderId)),
            ),
          ]
        : [];
    const fallbackFolderId = props.sourceFolderId ?? lastMessage()?.folderId ?? null;
    const sourceFolderIds =
      kind === "read" && props.unreadSourceFolderIds.length > 0
        ? props.unreadSourceFolderIds
        : detailUnreadFolderIds.length > 0
          ? detailUnreadFolderIds
          : fallbackFolderId
            ? [fallbackFolderId]
            : [];
    if (!conversationId || sourceFolderIds.length === 0) {
      if (!automatic) void prompts.error("This conversation has no active provider placement.");
      return;
    }
    const previousUnread = kind === "read" || kind === "unread" ? props.unread : null;
    if (kind === "read") props.onUnreadChange(conversationId, false);
    if (kind === "unread") props.onUnreadChange(conversationId, true);
    const request = { kind, conversationId, sourceFolderIds, previousUnread };
    if (automatic) markRead.mutate(request);
    else triage.mutate(request);
  };

  const showComposer = (request: ComposerRequest, initialDraft?: MailDraft) => {
    setCompose({ ...request, initialDraft });
    props.onComposerActiveChange(true);
  };

  const isCurrentLookup = (lookup: DraftLookup) => !disposed && props.selectedConversationId === lookup.conversationId;

  const openConversationDraft = async (lookup: DraftLookup, summary: ConversationDraftSummary) => {
    draftLoadController?.abort();
    const controller = new AbortController();
    draftLoadController = controller;
    setOpeningDraft(true);
    try {
      const response = await apiClient.mailboxes[":mailboxId"].drafts[":draftId"].$get(
        { param: { mailboxId: props.mailboxId, draftId: summary.id } },
        { init: { signal: controller.signal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not open draft"));
      const selectedDraft = await response.json();
      if (isCurrentLookup(lookup)) showComposer(lookup.request, selectedDraft);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        await prompts.error(error instanceof Error ? error.message : "Could not open draft");
      }
    } finally {
      if (draftLoadController === controller) {
        draftLoadController = null;
        setOpeningDraft(false);
      }
    }
  };

  const chooseConversationDraft = async (lookup: DraftLookup, existingDrafts: ConversationDraftSummary[]) => {
    if (!isCurrentLookup(lookup)) return;
    if (existingDrafts.length === 0) return showComposer(lookup.request);
    const selected = await prompts.dialog<ConversationDraftSummary | null>(
      (close) => {
        closeDraftDialog = close;
        createEffect(() => {
          if (!isCurrentLookup(lookup)) close(undefined);
        });
        return (
          <div class="flex min-h-0 flex-col gap-3">
            <p class="text-sm text-secondary">
              {existingDrafts.length === 1
                ? "This conversation already has a draft. Continue it or start a separate message."
                : `This conversation already has ${existingDrafts.length} drafts. Continue one or start a separate message.`}
            </p>
            <div class="flex max-h-[55vh] flex-col gap-2 overflow-y-auto">
              <For each={existingDrafts}>
                {(existingDraft) => (
                  <button
                    type="button"
                    class="group flex min-w-0 items-start gap-3 rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)] p-3 text-left hover:bg-[var(--ui-hover)]"
                    onClick={() => close(existingDraft)}
                  >
                    <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--ui-radius-control)] bg-[var(--ui-surface)] text-dimmed">
                      <i class="ti ti-file-pencil" aria-hidden="true" />
                    </span>
                    <span class="flex min-w-0 flex-1 flex-col gap-1">
                      <span class="flex min-w-0 items-center gap-2">
                        <span class="min-w-0 flex-1 truncate text-sm font-medium text-primary">
                          {existingDraft.subject || "(no subject)"}
                        </span>
                        <span class="shrink-0 text-xs font-medium text-secondary group-hover:text-primary">Continue</span>
                      </span>
                      <span class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-dimmed">
                        <span>
                          <i class="ti ti-user mr-1" aria-hidden="true" />
                          Created by {existingDraft.createdByDisplayName}
                        </span>
                        <span>
                          {intentLabel(existingDraft.intent)} · updated{" "}
                          {dates.formatDateTimeRelative(existingDraft.updatedAt, props.dateConfig)}
                        </span>
                      </span>
                      <span class="line-clamp-2 min-h-5 text-xs leading-5 text-secondary">
                        {existingDraft.bodyPreview || "No content yet"}
                      </span>
                    </span>
                  </button>
                )}
              </For>
            </div>
            <div class="flex items-center justify-end gap-2">
              <button type="button" class="btn-secondary btn-sm" onClick={() => close(undefined)}>
                Cancel
              </button>
              <button type="button" class="btn-primary btn-sm" onClick={() => close(null)}>
                <i class="ti ti-plus" aria-hidden="true" />
                New {intentLabel(lookup.request.intent)}
              </button>
            </div>
          </div>
        );
      },
      {
        title: "Continue a draft?",
        icon: "ti ti-file-pencil",
        size: "large",
      },
    );
    closeDraftDialog = null;
    if (selected === undefined || !isCurrentLookup(lookup)) return;
    if (selected) return void openConversationDraft(lookup, selected);
    showComposer(lookup.request);
  };

  const conversationDrafts = mutations.create<ConversationDraftSummary[], DraftLookup, DraftLookup>({
    onBefore: (lookup) => lookup,
    mutation: async (lookup, { abortSignal }) => {
      const response = await apiClient.mailboxes[":mailboxId"].conversations[":conversationId"].drafts.$get(
        {
          param: { mailboxId: props.mailboxId, conversationId: lookup.conversationId },
          query: { limit: "20" },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not check conversation drafts"));
      return response.json();
    },
    onSuccess: (existingDrafts, context) => {
      if (context) void chooseConversationDraft(context, existingDrafts);
    },
    onError: (error) => prompts.error(error.message),
  });

  const composerBusy = () => Boolean(compose()) || conversationDrafts.loading() || openingDraft();

  const startComposer = (intent: DraftIntent, message: MessageDetail, quotedBody?: string) => {
    const conversationId = props.selectedConversationId;
    if (!conversationId || composerBusy()) return;
    void conversationDrafts.mutate({
      conversationId,
      request: { intent, message, quotedBody },
    });
  };

  const closeComposer = () => {
    setCompose(null);
    props.onComposerActiveChange(false);
  };

  let currentSelection = props.selectionKey;
  let autoReadSelection: string | null | undefined;
  createEffect(() => {
    const selection = props.selectionKey;
    if (selection === autoReadSelection) return;
    autoReadSelection = selection;
    if (selection && props.canWrite && props.selectedConversationId && props.unread) {
      runTriage("read", true);
    }
  });

  createEffect(() => {
    const nextSelection = props.selectionKey;
    if (nextSelection === currentSelection) return;
    currentSelection = nextSelection;
    conversationDrafts.abort();
    draftLoadController?.abort();
    setExpandedMessages(new Set(props.messages.slice(-1).map((message) => message.id)));
    if (compose()) closeComposer();
  });

  onCleanup(() => {
    disposed = true;
    closeDraftDialog?.(undefined);
    closeDraftDialog = null;
    triage.abort();
    markRead.abort();
    conversationDrafts.abort();
    draftLoadController?.abort();
  });

  const startQuoteReply = (message: MessageDetail, article: HTMLElement) => {
    const selection = window.getSelection();
    const text = selection?.toString().trim() ?? "";
    if (!text || !selection?.anchorNode || !article.contains(selection.anchorNode)) {
      return prompts.error("Select text in this message first.", { title: "Quote in reply" });
    }
    const sender = message.from[0]?.name || message.from[0]?.address || "Sender";
    const quote = `${dates.formatDateTime(message.internalDate, props.dateConfig)} ${sender} wrote:\n${text
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n")}\n\n`;
    startComposer("reply", message, quote);
  };

  const replyAllRecipients = (message: MessageDetail): string[] => {
    const own = new Set(props.identities.map((identity) => identity.fromAddress.toLowerCase()));
    return [...message.from, ...message.to]
      .map((address) => address.address.toLowerCase())
      .filter((address, index, all) => !own.has(address) && all.indexOf(address) === index);
  };

  return (
    <div class="flex h-full min-h-0 flex-col bg-[var(--ui-surface)]">
      <Show when={props.error}>
        {(error) => (
          <Placeholder
            state="error"
            variant="panel"
            title="Could not load this message"
            description={error()}
            action={
              <button type="button" class="btn-secondary btn-sm" onClick={() => void props.onReconcile()}>
                <i class="ti ti-refresh" aria-hidden="true" /> Retry
              </button>
            }
          />
        )}
      </Show>
      <Show when={!props.error && props.totalMessageCount > props.messages.length}>
        <div class="info-block-warning mx-3 mt-3 text-xs" role="status">
          Showing the latest {props.messages.length} of {props.totalMessageCount} messages in this unusually long conversation.
        </div>
      </Show>
      <Show
        when={props.messages.length > 0}
        fallback={
          <div class="flex min-h-0 flex-1 items-center justify-center p-[var(--ui-space-shell)]">
            <Placeholder
              icon="ti ti-mail-opened"
              title="Choose a conversation"
              description="Select a message from the list to read its complete thread."
            />
          </div>
        }
      >
        <header class="detail-header flex shrink-0 flex-col gap-2">
          <div class="flex min-w-0 items-start gap-2">
            <Link
              href={closeHref()}
              class="icon-btn lg:hidden"
              aria-label="Back to conversation list"
              onNavigate={props.onNavigate}
              scroll="preserve"
            >
              <i class="ti ti-arrow-left" aria-hidden="true" />
              <span class="sr-only">Back to conversation list</span>
            </Link>
            <Show when={props.listCollapsed}>
              <Tooltip content="Show conversation list">
                <button
                  type="button"
                  class="icon-btn hidden lg:inline-flex"
                  aria-label="Show conversation list"
                  onClick={props.onRestoreList}
                >
                  <i class="ti ti-layout-sidebar-left-expand" aria-hidden="true" />
                </button>
              </Tooltip>
            </Show>
            <div class="min-w-0 flex-1">
              <div class="flex min-w-0 items-center gap-2">
                <h1 class="truncate text-lg font-semibold text-primary">{props.subject || "(no subject)"}</h1>
                <Show when={props.reference}>
                  <button
                    type="button"
                    class="chip shrink-0 font-mono text-xs"
                    title="Copy conversation reference"
                    onClick={() => {
                      const reference = props.reference;
                      if (!reference) return;
                      void navigator.clipboard.writeText(reference).then(
                        () => toast.success("Reference copied"),
                        () => toast.error("Could not copy reference"),
                      );
                    }}
                  >
                    <i class="ti ti-hash" aria-hidden="true" />
                    {props.reference}
                  </button>
                </Show>
              </div>
              <p class="mt-0.5 text-xs text-dimmed">
                {props.messages.length} message{props.messages.length === 1 ? "" : "s"}
              </p>
            </div>
            <Show when={props.canWrite}>
              <div class="flex items-center gap-1">
                <Tooltip content="Archive">
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label="Archive conversation"
                    disabled={triage.loading()}
                    onClick={() => runTriage("archive")}
                  >
                    <i class="ti ti-archive" aria-hidden="true" />
                  </button>
                </Tooltip>
                <Tooltip content="Move to junk">
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label="Move conversation to junk"
                    disabled={triage.loading()}
                    onClick={() => runTriage("junk")}
                  >
                    <i class="ti ti-alert-octagon" aria-hidden="true" />
                  </button>
                </Tooltip>
                <Tooltip content="Delete">
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label="Delete conversation"
                    disabled={triage.loading()}
                    onClick={() => runTriage("trash")}
                  >
                    <i class="ti ti-trash" aria-hidden="true" />
                  </button>
                </Tooltip>
                <Dropdown
                  trigger={
                    <button type="button" class="icon-btn" aria-label="More conversation actions">
                      <i class="ti ti-dots" aria-hidden="true" />
                    </button>
                  }
                  position="bottom-left"
                  width="w-52"
                  elements={[
                    {
                      label: props.unread ? "Mark as read" : "Mark as unread",
                      icon: props.unread ? "ti ti-mail-opened" : "ti ti-mail",
                      action: () => runTriage(props.unread ? "read" : "unread"),
                    },
                    {
                      label: lastMessage()?.flags.includes("\\Flagged") ? "Remove flag" : "Flag conversation",
                      icon: lastMessage()?.flags.includes("\\Flagged") ? "ti ti-flag-off" : "ti ti-flag",
                      action: () => runTriage(lastMessage()?.flags.includes("\\Flagged") ? "unflag" : "flag"),
                    },
                    { label: "Print conversation", icon: "ti ti-printer", action: () => window.print() },
                  ]}
                />
              </div>
            </Show>
            <Tooltip content="Conversation details">
              <button
                type="button"
                class="icon-btn"
                classList={{ "bg-[var(--ui-selected)]": props.detailsOpen }}
                aria-label="Toggle conversation details"
                aria-pressed={props.detailsOpen}
                onClick={props.onToggleDetails}
              >
                <i class="ti ti-layout-sidebar-right" aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto p-2 sm:p-3" data-scroll-preserve={`mail-reader-${props.selectionKey}`}>
          <div class="mx-auto flex w-full max-w-5xl flex-col gap-2">
            <For each={props.messages}>
              {(message, index) => {
                let article!: HTMLElement;
                const expanded = () => expandedMessages().has(message.id);
                return (
                  <article ref={article} class="paper overflow-hidden" style={`view-transition-name: mail-message-${message.id}`}>
                    <button
                      type="button"
                      class="flex w-full items-start gap-3 p-3 text-left"
                      aria-expanded={expanded()}
                      onClick={() => toggleMessage(message.id)}
                    >
                      <span class="thumbnail flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
                        <i class="ti ti-user" aria-hidden="true" />
                      </span>
                      <span class="min-w-0 flex-1">
                        <span class="flex items-baseline justify-between gap-3">
                          <span class="truncate text-sm font-semibold text-primary">
                            {message.from.map(formatAddress).join(", ") || "Unknown sender"}
                          </span>
                          <time class="shrink-0 text-xs text-dimmed" dateTime={message.internalDate}>
                            {dates.formatDateTimeRelative(message.internalDate, props.dateConfig)}
                          </time>
                        </span>
                        <span class="block truncate text-xs text-dimmed">
                          To {message.to.map(formatAddress).join(", ") || "undisclosed recipients"}
                        </span>
                      </span>
                      <i class={`ti ${expanded() ? "ti-chevron-up" : "ti-chevron-down"} mt-1 text-dimmed`} aria-hidden="true" />
                    </button>
                    <Show when={expanded()}>
                      <div class="px-4 pb-4 pl-15">
                        <div class="mail-message-body min-w-0 overflow-x-auto text-sm text-primary">
                          {message.sanitizedHtml ? (
                            <div class="markdown max-w-none" innerHTML={message.sanitizedHtml} />
                          ) : message.plainText ? (
                            <pre class="whitespace-pre-wrap break-words font-sans">{message.plainText}</pre>
                          ) : (
                            <Placeholder state="loading" title="Body is still synchronizing" />
                          )}
                        </div>
                        <Show when={message.attachments.length > 0}>
                          <div class="mt-4">
                            <p class="mb-2 text-xs font-medium uppercase text-dimmed">Received with this message</p>
                            <div class="flex flex-wrap gap-2">
                              <For each={message.attachments}>
                                {(attachment) => (
                                  <a
                                    href={`/api/mail/mailboxes/${props.mailboxId}/messages/${message.id}/attachments/${attachment.id}?inline=true`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    class="btn-secondary btn-sm max-w-full"
                                  >
                                    <i class="ti ti-paperclip" aria-hidden="true" />
                                    <span class="max-w-48 truncate">{attachment.filename ?? attachment.contentType}</span>
                                    <span class="text-xs text-dimmed">{formatBytes(attachment.sizeBytes)}</span>
                                  </a>
                                )}
                              </For>
                            </div>
                          </div>
                        </Show>
                        <Show when={props.canWrite && props.selectedConversationId}>
                          <div class="mt-4 flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              class="btn-secondary btn-sm"
                              disabled={composerBusy()}
                              onClick={() => startComposer("reply", message)}
                            >
                              <i class="ti ti-arrow-back-up" aria-hidden="true" /> Reply
                            </button>
                            <button
                              type="button"
                              class="btn-simple btn-sm"
                              disabled={composerBusy()}
                              onClick={() => startComposer("reply_all", message)}
                            >
                              <i class="ti ti-arrow-back-up-double" aria-hidden="true" /> Reply all
                            </button>
                            <button
                              type="button"
                              class="btn-simple btn-sm"
                              disabled={composerBusy()}
                              onClick={() => startComposer("forward", message, forwardBody(message, props.dateConfig))}
                            >
                              <i class="ti ti-arrow-forward-up" aria-hidden="true" /> Forward
                            </button>
                            <button
                              type="button"
                              class="btn-simple btn-sm"
                              disabled={composerBusy()}
                              onClick={() => startQuoteReply(message, article)}
                            >
                              <i class="ti ti-blockquote" aria-hidden="true" /> Quote selection
                            </button>
                          </div>
                        </Show>
                      </div>
                    </Show>
                  </article>
                );
              }}
            </For>
          </div>
        </div>

        <Show when={compose()}>
          {(active) => (
            <div class="flex max-h-[52%] min-h-72 shrink-0 overflow-hidden bg-[var(--ui-surface)] shadow-[0_-8px_24px_rgb(0_0_0/0.06)]">
              <MailComposer
                mailboxId={props.mailboxId}
                identities={props.identities}
                initialDraft={active().initialDraft}
                surface="compact"
                returnHref={props.requestUrl}
                dateConfig={props.dateConfig}
                onClose={closeComposer}
                seed={
                  active().initialDraft
                    ? undefined
                    : {
                        intent: active().intent,
                        conversationId: props.selectedConversationId,
                        sourceMessageId: active().message.id,
                        to:
                          active().intent === "forward"
                            ? []
                            : active().intent === "reply_all"
                              ? replyAllRecipients(active().message)
                              : active().message.from.map((address) => address.address),
                        subject: active().intent === "forward" ? forwardSubject(props.subject) : replySubject(props.subject),
                        body: active().quotedBody ?? "",
                        sourceAttachmentCount: active().intent === "forward" ? active().message.attachments.length : 0,
                      }
                }
              />
            </div>
          )}
        </Show>
      </Show>
    </div>
  );
}
