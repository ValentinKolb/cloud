import { Dropdown, Placeholder, prompts, Tooltip, toast } from "@valentinkolb/cloud/ui";
import { Link, type LinkNavigateEvent, refreshCurrentPath } from "@valentinkolb/ssr/nav";
import { type DateContext, dates } from "@valentinkolb/stdlib";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createEffect, createSignal, For, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type { DraftIntent, SenderIdentity } from "../../contracts";
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

export default function MailConversationReader(props: {
  mailboxId: string;
  requestUrl: string;
  canWrite: boolean;
  identities: SenderIdentity[];
  selectionKey: string | null;
  selectedConversationId: string | null;
  subject: string;
  messages: MessageDetail[];
  dateConfig: DateContext;
  listCollapsed: boolean;
  detailsOpen: boolean;
  onRestoreList: () => void;
  onToggleDetails: () => void;
  onComposerActiveChange: (active: boolean) => void;
  onNavigate: (event: LinkNavigateEvent) => void | Promise<void>;
}) {
  const [expandedMessages, setExpandedMessages] = createSignal(new Set(props.messages.slice(-1).map((message) => message.id)));
  const [compose, setCompose] = createSignal<{ intent: DraftIntent; message: MessageDetail; quotedBody?: string } | null>(null);
  const lastMessage = () => props.messages.at(-1);
  const closeHref = () => buildMailListHref(new URL(props.requestUrl));

  const toggleMessage = (messageId: string) =>
    setExpandedMessages((current) => {
      const next = new Set(current);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });

  const triage = mutations.create<void, { kind: "archive" | "trash" | "junk" | "read" | "unread" | "flag" | "unflag" }>({
    mutation: async (action) => {
      const message = lastMessage();
      if (!props.selectedConversationId || !message?.folderId) throw new Error("This conversation has no active provider placement.");
      const input =
        action.kind === "archive" || action.kind === "trash" || action.kind === "junk"
          ? {
              kind: "move_to_role" as const,
              sourceFolderId: message.folderId,
              role: action.kind,
              idempotencyKey: crypto.randomUUID(),
            }
          : {
              kind: "change_state" as const,
              sourceFolderId: message.folderId,
              change: {
                addFlags: action.kind === "read" ? ["seen" as const] : action.kind === "flag" ? ["flagged" as const] : [],
                removeFlags: action.kind === "unread" ? ["seen" as const] : action.kind === "unflag" ? ["flagged" as const] : [],
                addKeywords: [],
                removeKeywords: [],
              },
              idempotencyKey: crypto.randomUUID(),
            };
      const response = await apiClient.mailboxes[":mailboxId"].conversations[":conversationId"].actions.$post({
        param: { mailboxId: props.mailboxId, conversationId: props.selectedConversationId },
        json: input,
      });
      if (!response.ok) throw new Error(await readApiError(response, "Mail action failed"));
    },
    onSuccess: () => {
      toast.success("Mail action queued");
      refreshCurrentPath();
    },
    onError: (error) => prompts.error(error.message),
  });

  const startComposer = (intent: DraftIntent, message: MessageDetail, quotedBody?: string) => {
    setCompose({ intent, message, quotedBody });
    props.onComposerActiveChange(true);
  };
  const closeComposer = () => {
    setCompose(null);
    props.onComposerActiveChange(false);
  };

  let currentSelection = props.selectionKey;
  createEffect(() => {
    const nextSelection = props.selectionKey;
    if (nextSelection === currentSelection) return;
    currentSelection = nextSelection;
    setExpandedMessages(new Set(props.messages.slice(-1).map((message) => message.id)));
    if (compose()) closeComposer();
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
              <h1 class="truncate text-lg font-semibold text-primary">{props.subject || "(no subject)"}</h1>
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
                    onClick={() => triage.mutate({ kind: "archive" })}
                  >
                    <i class="ti ti-archive" aria-hidden="true" />
                  </button>
                </Tooltip>
                <Tooltip content="Move to junk">
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label="Move conversation to junk"
                    onClick={() => triage.mutate({ kind: "junk" })}
                  >
                    <i class="ti ti-alert-octagon" aria-hidden="true" />
                  </button>
                </Tooltip>
                <Tooltip content="Delete">
                  <button type="button" class="icon-btn" aria-label="Delete conversation" onClick={() => triage.mutate({ kind: "trash" })}>
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
                      label: lastMessage()?.flags.includes("\\Seen") ? "Mark as unread" : "Mark as read",
                      icon: lastMessage()?.flags.includes("\\Seen") ? "ti ti-mail" : "ti ti-mail-opened",
                      action: () => triage.mutate({ kind: lastMessage()?.flags.includes("\\Seen") ? "unread" : "read" }),
                    },
                    {
                      label: lastMessage()?.flags.includes("\\Flagged") ? "Remove flag" : "Flag conversation",
                      icon: lastMessage()?.flags.includes("\\Flagged") ? "ti ti-flag-off" : "ti ti-flag",
                      action: () => triage.mutate({ kind: lastMessage()?.flags.includes("\\Flagged") ? "unflag" : "flag" }),
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
                          <time class="shrink-0 text-2xs text-dimmed" dateTime={message.internalDate}>
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
                            <p class="mb-2 text-2xs font-medium uppercase text-dimmed">Received with this message</p>
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
                                    <span class="text-2xs text-dimmed">{formatBytes(attachment.sizeBytes)}</span>
                                  </a>
                                )}
                              </For>
                            </div>
                          </div>
                        </Show>
                        <Show when={props.canWrite && props.selectedConversationId}>
                          <div class="mt-4 flex flex-wrap items-center gap-2">
                            <button type="button" class="btn-secondary btn-sm" onClick={() => startComposer("reply", message)}>
                              <i class="ti ti-arrow-back-up" aria-hidden="true" /> Reply
                            </button>
                            <button type="button" class="btn-simple btn-sm" onClick={() => startComposer("reply_all", message)}>
                              <i class="ti ti-arrow-back-up-double" aria-hidden="true" /> Reply all
                            </button>
                            <button
                              type="button"
                              class="btn-simple btn-sm"
                              onClick={() => startComposer("forward", message, forwardBody(message, props.dateConfig))}
                            >
                              <i class="ti ti-arrow-forward-up" aria-hidden="true" /> Forward
                            </button>
                            <button type="button" class="btn-simple btn-sm" onClick={() => startQuoteReply(message, article)}>
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
            <div class="max-h-[52%] min-h-72 shrink-0 overflow-hidden bg-[var(--ui-surface)] shadow-[0_-8px_24px_rgb(0_0_0/0.06)]">
              <MailComposer
                mailboxId={props.mailboxId}
                identities={props.identities}
                surface="compact"
                returnHref={props.requestUrl}
                onClose={closeComposer}
                seed={{
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
                }}
              />
            </div>
          )}
        </Show>
      </Show>
    </div>
  );
}
