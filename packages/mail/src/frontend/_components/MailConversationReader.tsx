import { AppWorkspace, CheckboxCard, Dropdown, Placeholder, prompts, Select, Tooltip, toast } from "@valentinkolb/cloud/ui";
import { Link, type LinkNavigateEvent } from "@k2b/ssr/nav";
import { type DateContext, dates } from "@valentinkolb/stdlib";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type {
  ConversationDraftSummary,
  DeriveDraftFromMessageInput,
  DraftDerivationKind,
  DraftIntent,
  MailDraft,
  SenderIdentity,
} from "../../contracts";
import type { MessageDetail } from "../../service/messages";
import { readApiError } from "./api-response";
import MailComposer from "./MailComposer";
import MailMessageCard from "./MailMessageCard";
import { getMailAction, type MailActionId } from "./mail-actions";
import { deriveReplyIdentityId, deriveReplyRecipients } from "./mail-compose-derivation";
import { buildMailListHref } from "./mail-navigation";

const replySubject = (subject: string): string => (/^re:/i.test(subject) ? subject : `Re: ${subject}`);
const forwardSubject = (subject: string): string => (/^fwd:/i.test(subject) ? subject : `Fwd: ${subject}`);

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

const composerRecipients = (request: ComposerRequest, identities: SenderIdentity[]): { to: string[]; cc: string[] } =>
  request.intent === "reply" || request.intent === "reply_all"
    ? deriveReplyRecipients(request.message, request.intent, identities)
    : { to: [], cc: [] };

const intentLabel = (intent: DraftIntent): string =>
  intent === "reply" ? "reply" : intent === "reply_all" ? "reply all" : intent === "forward" ? "forward" : "message";

export default function MailConversationReader(props: {
  mailboxId: string;
  requestUrl: string;
  canWrite: boolean;
  canAdmin: boolean;
  identities: SenderIdentity[];
  selectionKey: string | null;
  selectedConversationId: string | null;
  sourceFolderId: string | null;
  unread: boolean;
  flagged: boolean;
  inJunk: boolean;
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
  actionPending: boolean;
  onAction: (actionId: MailActionId, options?: { silent?: boolean }) => void | Promise<void>;
  onOpenHref: (href: string, replace?: boolean) => void | Promise<void>;
  onMergeConversation: () => void | Promise<void>;
  onReassignMessage: (messageId: string) => void | Promise<void>;
  onSplitMessage: (messageId: string) => void | Promise<void>;
  onReconcile: () => Promise<void>;
  onComposerActiveChange: (active: boolean) => void;
  onClose: (event: LinkNavigateEvent) => void | Promise<void>;
}) {
  const [expandedMessages, setExpandedMessages] = createSignal(new Set(props.messages.slice(-1).map((message) => message.id)));
  const [messageSelections, setMessageSelections] = createSignal<Record<string, string>>({});
  const [compose, setCompose] = createSignal<ActiveComposer | null>(null);
  const [openingDraft, setOpeningDraft] = createSignal(false);
  const closeHref = () => buildMailListHref(new URL(props.requestUrl));
  let draftLoadController: AbortController | null = null;
  let closeDraftDialog: ((value: ConversationDraftSummary | null | undefined) => void) | null = null;
  let cleanupPrint: (() => void) | null = null;
  let disposed = false;

  const toggleMessage = (messageId: string) =>
    setExpandedMessages((current) => {
      const next = new Set(current);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });

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
      if (isCurrentLookup(lookup) && !(error instanceof DOMException && error.name === "AbortError")) {
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
          param: {
            mailboxId: props.mailboxId,
            conversationId: lookup.conversationId,
          },
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

  const derivedDraft = mutations.create<
    MailDraft,
    { message: MessageDetail; input: DeriveDraftFromMessageInput },
    { message: MessageDetail; idempotencyKey: string }
  >({
    onBefore: ({ message, input }) => ({ message, idempotencyKey: input.idempotencyKey }),
    mutation: async ({ message, input }, { abortSignal }) => {
      const response = await apiClient.mailboxes[":mailboxId"].messages[":messageId"]["derive-draft"].$post(
        {
          param: { mailboxId: props.mailboxId, messageId: message.id },
          json: input,
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not create a draft from this message"));
      return response.json();
    },
    onSuccess: (created, context) => {
      if (context) {
        for (const [requestKey, idempotencyKey] of derivationKeys) {
          if (idempotencyKey === context.idempotencyKey) derivationKeys.delete(requestKey);
        }
      }
      if (context && props.messages.some((message) => message.id === context.message.id)) {
        showComposer({ intent: "new", message: context.message }, created);
      }
    },
    onError: (error) => prompts.error(error.message),
  });
  const derivationKeys = new Map<string, string>();

  const startComposer = (intent: DraftIntent, message: MessageDetail, quotedBody?: string) => {
    const conversationId = props.selectedConversationId;
    if (!conversationId || composerBusy()) return;
    void conversationDrafts.mutate({
      conversationId,
      request: { intent, message, quotedBody },
    });
  };

  const deriveMessage = async (kind: DraftDerivationKind, message: MessageDetail) => {
    if (composerBusy() || derivedDraft.loading()) return;
    const selectionKey = props.selectionKey;
    const identities = props.identities.filter((identity) => identity.status === "verified");
    const defaultIdentity = identities.find((identity) => identity.isDefault) ?? identities[0];
    if (!defaultIdentity) return prompts.error("Add a verified sending identity before reusing a message.");
    const choice = await prompts.dialog<Omit<DeriveDraftFromMessageInput, "idempotencyKey">>(
      (close) => {
        const [senderIdentityId, setSenderIdentityId] = createSignal(defaultIdentity.id);
        const [includeAttachments, setIncludeAttachments] = createSignal(message.attachments.length > 0);
        return (
          <div class="flex flex-col gap-3">
            <p class="text-sm text-secondary">
              {kind === "resend"
                ? "Create an independent draft with the original recipients and content. Nothing is sent until you review it."
                : "Create an independent draft from this message. The original message and conversation stay unchanged."}
            </p>
            <Select
              label="Send from"
              value={senderIdentityId}
              onChange={setSenderIdentityId}
              options={identities.map((identity) => ({ id: identity.id, label: identity.label }))}
            />
            <Show when={message.attachments.length > 0}>
              <CheckboxCard
                label={`Include ${message.attachments.length} attachment${message.attachments.length === 1 ? "" : "s"}`}
                value={includeAttachments}
                onChange={setIncludeAttachments}
              />
            </Show>
            <div class="flex items-center justify-end gap-2">
              <button type="button" class="btn-secondary btn-sm" onClick={() => close(undefined)}>
                Cancel
              </button>
              <button
                type="button"
                class="btn-primary btn-sm"
                onClick={() =>
                  close({
                    kind,
                    senderIdentityId: senderIdentityId(),
                    includeAttachments: includeAttachments(),
                  })
                }
              >
                <i class="ti ti-file-pencil" aria-hidden="true" /> Create draft
              </button>
            </div>
          </div>
        );
      },
      {
        title: kind === "resend" ? "Resend as a new draft" : "Edit as new",
        icon: kind === "resend" ? "ti ti-repeat" : "ti ti-copy",
        size: "small",
      },
    );
    if (choice && !disposed && selectionKey === props.selectionKey && props.messages.some((current) => current.id === message.id)) {
      const requestKey = JSON.stringify([message.id, choice.kind, choice.senderIdentityId, choice.includeAttachments]);
      const idempotencyKey = derivationKeys.get(requestKey) ?? crypto.randomUUID();
      derivationKeys.set(requestKey, idempotencyKey);
      derivedDraft.mutate({ message, input: { ...choice, idempotencyKey } });
    }
  };

  const closeComposer = () => {
    setCompose(null);
    props.onComposerActiveChange(false);
  };

  let currentSelection = props.selectionKey;
  let currentNewestMessageId = props.messages.at(-1)?.id ?? null;
  createEffect(() => {
    const nextSelection = props.selectionKey;
    const nextNewestMessageId = props.messages.at(-1)?.id ?? null;
    if (nextSelection !== currentSelection) {
      currentSelection = nextSelection;
      currentNewestMessageId = nextNewestMessageId;
      conversationDrafts.abort();
      draftLoadController?.abort();
      setExpandedMessages(new Set(props.messages.slice(-1).map((message) => message.id)));
      setMessageSelections({});
      if (compose()) closeComposer();
      return;
    }
    if (nextNewestMessageId && nextNewestMessageId !== currentNewestMessageId) {
      currentNewestMessageId = nextNewestMessageId;
      setExpandedMessages((current) => new Set(current).add(nextNewestMessageId));
    }
  });

  onCleanup(() => {
    disposed = true;
    closeDraftDialog?.(undefined);
    closeDraftDialog = null;
    cleanupPrint?.();
    conversationDrafts.abort();
    derivedDraft.abort();
    draftLoadController?.abort();
  });

  const startQuoteReply = (message: MessageDetail, body: HTMLElement) => {
    const selection = window.getSelection();
    const selectedInFrame = messageSelections()[message.id]?.trim() ?? "";
    const hostSelection = selection?.toString().trim() ?? "";
    const selectedInBody = selection?.anchorNode && body.contains(selection.anchorNode) ? hostSelection : "";
    const text = hostSelection ? selectedInBody : selectedInFrame;
    if (!text) {
      return prompts.error("Select text in this message first.", {
        title: "Quote in reply",
      });
    }
    const sender = message.from[0]?.name || message.from[0]?.address || "Sender";
    const quote = `${dates.formatDateTime(message.internalDate, props.dateConfig)} ${sender} wrote:\n${text
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n")}\n\n`;
    startComposer("reply", message, quote);
  };

  const printConversation = () => {
    cleanupPrint?.();
    const root = document.body;
    let active = true;
    let frame: number | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      if (!active) return;
      active = false;
      root.classList.remove("mail-printing-conversation");
      window.removeEventListener("afterprint", cleanup);
      if (timeout) clearTimeout(timeout);
      if (frame !== null) cancelAnimationFrame(frame);
      if (cleanupPrint === cleanup) cleanupPrint = null;
    };
    cleanupPrint = cleanup;
    root.classList.add("mail-printing-conversation");
    window.addEventListener("afterprint", cleanup, { once: true });
    timeout = setTimeout(cleanup, 60_000);
    frame = requestAnimationFrame(() => {
      frame = null;
      if (active) window.print();
    });
  };

  return (
    <div class="flex h-full min-h-0 flex-col bg-[var(--ui-surface)]" data-mail-print-root>
      <Show when={props.error}>
        {(error) => {
          const message = error();
          return (
            <Placeholder
              state="error"
              variant="panel"
              title="Could not load this message"
              description={message}
              action={
                <button type="button" class="btn-secondary btn-sm" onClick={() => void props.onReconcile()}>
                  <i class="ti ti-refresh" aria-hidden="true" /> Retry
                </button>
              }
            />
          );
        }}
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
              onNavigate={props.onClose}
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
                <h1 class="truncate text-lg font-semibold text-primary" data-mail-reader-heading tabIndex={-1}>
                  {props.subject || "(no subject)"}
                </h1>
                <Show when={props.flagged}>
                  <Tooltip content="Flagged conversation">
                    <span
                      class="flex h-7 w-7 shrink-0 items-center justify-center text-orange-600 dark:text-orange-400"
                      role="img"
                      aria-label="Flagged conversation"
                    >
                      <i class={getMailAction("flag").icon} aria-hidden="true" />
                    </span>
                  </Tooltip>
                </Show>
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
                {props.messages.length} message
                {props.messages.length === 1 ? "" : "s"}
              </p>
            </div>
            <Show when={props.canWrite}>
              <div class="flex items-center gap-1">
                <Tooltip content="Archive">
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label={getMailAction("archive").label}
                    disabled={props.actionPending}
                    onClick={() => void props.onAction("archive")}
                  >
                    <i class={getMailAction("archive").icon} aria-hidden="true" />
                  </button>
                </Tooltip>
                <Tooltip content={props.inJunk ? "Not spam" : "Move to junk"}>
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label={getMailAction(props.inJunk ? "not_spam" : "junk").label}
                    disabled={props.actionPending}
                    onClick={() => void props.onAction(props.inJunk ? "not_spam" : "junk")}
                  >
                    <i class={getMailAction(props.inJunk ? "not_spam" : "junk").icon} aria-hidden="true" />
                  </button>
                </Tooltip>
                <Tooltip content="Delete">
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label={getMailAction("trash").label}
                    disabled={props.actionPending}
                    onClick={() => void props.onAction("trash")}
                  >
                    <i class={getMailAction("trash").icon} aria-hidden="true" />
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
                      label: getMailAction(props.unread ? "mark_read" : "mark_unread").label,
                      icon: getMailAction(props.unread ? "mark_read" : "mark_unread").icon,
                      action: () => props.onAction(props.unread ? "mark_read" : "mark_unread"),
                    },
                    {
                      label: getMailAction(props.flagged ? "unflag" : "flag").label,
                      icon: getMailAction(props.flagged ? "unflag" : "flag").icon,
                      action: () => props.onAction(props.flagged ? "unflag" : "flag"),
                    },
                    {
                      label: getMailAction("move").label,
                      icon: getMailAction("move").icon,
                      action: () => props.onAction("move"),
                    },
                    {
                      label: "Merge with another conversation",
                      icon: "ti ti-git-merge",
                      action: props.onMergeConversation,
                    },
                    {
                      label: "Print conversation",
                      icon: "ti ti-printer",
                      action: printConversation,
                    },
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
                data-mail-details-trigger
                onClick={props.onToggleDetails}
              >
                <i class="ti ti-layout-sidebar-right" aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto px-3 py-2 sm:px-5" data-scroll-preserve={`mail-reader-${props.selectionKey}`}>
          <div class="mx-auto flex w-full max-w-4xl flex-col gap-5">
            <For each={props.messages}>
              {(message) => (
                <MailMessageCard
                  message={message}
                  expanded={expandedMessages().has(message.id)}
                  context={{
                    mailboxId: props.mailboxId,
                    requestUrl: props.requestUrl,
                    canWrite: props.canWrite,
                    canAdmin: props.canAdmin,
                    selectionKey: props.selectionKey,
                    selectedConversationId: props.selectedConversationId,
                    sourceFolderId: props.sourceFolderId,
                    totalMessageCount: props.totalMessageCount,
                    identities: props.identities,
                    dateConfig: props.dateConfig,
                    composerBusy: composerBusy(),
                  }}
                  actions={{
                    toggle: toggleMessage,
                    selectionChange: (messageId, value) =>
                      setMessageSelections((current) => {
                        if (current[messageId] === value) return current;
                        const next = { ...current };
                        if (value) next[messageId] = value;
                        else delete next[messageId];
                        return next;
                      }),
                    compose: startComposer,
                    quoteReply: startQuoteReply,
                    derive: (kind, selectedMessage) => {
                      void deriveMessage(kind, selectedMessage);
                    },
                    reconcile: props.onReconcile,
                    reassign: props.onReassignMessage,
                    split: props.onSplitMessage,
                  }}
                />
              )}
            </For>
          </div>
        </div>

        <Show when={compose()}>
          {(active) => {
            const request = active();
            const recipients = request.initialDraft ? null : composerRecipients(request, props.identities);
            const seed = request.initialDraft
              ? undefined
              : {
                  intent: request.intent,
                  senderIdentityId: deriveReplyIdentityId(request.message, props.identities),
                  conversationId: props.selectedConversationId,
                  sourceMessageId: request.message.id,
                  to: recipients?.to ?? [],
                  cc: recipients?.cc ?? [],
                  subject: request.intent === "forward" ? forwardSubject(props.subject) : replySubject(props.subject),
                  body: request.quotedBody ?? "",
                  sourceAttachmentCount: request.intent === "forward" ? request.message.attachments.length : 0,
                };
            return (
              <AppWorkspace.BottomDrawer
                id="mail-composer"
                open
                height="lg"
                minHeight={288}
                maxHeight={640}
                resizable
                class="bg-[var(--ui-surface)]"
              >
                <MailComposer
                  mailboxId={props.mailboxId}
                  identities={props.identities}
                  initialDraft={request.initialDraft}
                  surface="compact"
                  returnHref={props.requestUrl}
                  dateConfig={props.dateConfig}
                  canShareAttachments={props.canAdmin}
                  onClose={closeComposer}
                  seed={seed}
                />
              </AppWorkspace.BottomDrawer>
            );
          }}
        </Show>
      </Show>
    </div>
  );
}
