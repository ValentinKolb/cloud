import { AppWorkspace, Placeholder, Tooltip } from "@valentinkolb/cloud/ui";
import { type DateContext, dates } from "@valentinkolb/stdlib";
import { Show } from "solid-js";
import type { SenderIdentity } from "../../contracts";
import type { ConversationCollaboration, ConversationComment, MailAssignableUser } from "../../service/collaboration";
import type { MessageDetail } from "../../service/messages";
import { buildMailListHref } from "../[mailboxId]/mailbox-page-data";
import ComposeMail from "./ComposeMail.island";
import ConversationCollaborationPanel from "./ConversationCollaboration.island";

const messageAddresses = (message: MessageDetail): string =>
  message.from.map((address) => (address.name ? `${address.name} <${address.address}>` : address.address)).join(", ");

const MessageSection = (props: { mailboxId: string; message: MessageDetail; dateConfig: DateContext }) => (
  <article class="detail-section">
    <header class="mb-4 flex flex-wrap items-start justify-between gap-2">
      <div class="min-w-0">
        <p class="truncate text-sm font-semibold text-primary">{messageAddresses(props.message) || "Unknown sender"}</p>
        <p class="truncate text-xs text-dimmed">
          To {props.message.to.map((address) => address.address).join(", ") || "undisclosed recipients"}
        </p>
      </div>
      <time
        class="shrink-0 text-xs text-dimmed"
        dateTime={props.message.internalDate}
        title={dates.formatDateTime(props.message.internalDate, props.dateConfig)}
      >
        {dates.formatDateTimeRelative(props.message.internalDate, props.dateConfig)}
      </time>
    </header>
    <div>
      {props.message.sanitizedHtml ? (
        <div class="markdown max-w-none overflow-x-auto text-sm" innerHTML={props.message.sanitizedHtml} />
      ) : props.message.plainText ? (
        <pre class="whitespace-pre-wrap break-words font-sans text-sm text-primary">{props.message.plainText}</pre>
      ) : (
        <Placeholder state="loading" title="Body is still synchronizing" />
      )}
      {props.message.attachments.length > 0 && (
        <div class="mt-4 flex flex-wrap gap-2 border-t border-subtle pt-3">
          {props.message.attachments.map((attachment) => (
            <a
              href={`/api/mail/mailboxes/${props.mailboxId}/messages/${props.message.id}/attachments/${attachment.id}`}
              class="btn-secondary btn-sm max-w-full"
              download={attachment.filename ?? "attachment"}
            >
              <i class="ti ti-paperclip" aria-hidden="true" />
              <span class="max-w-48 truncate">{attachment.filename ?? attachment.contentType}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  </article>
);

export default function MailConversationDetail(props: {
  mailboxId: string;
  requestUrl: string;
  currentUserId: string;
  canWrite: boolean;
  identities: SenderIdentity[];
  selectedConversationId: string | null;
  subject: string;
  messages: MessageDetail[];
  collaborationState: ConversationCollaboration | null;
  comments: ConversationComment[];
  assignableUsers: MailAssignableUser[];
  collaborationError: string | null;
  dateConfig: DateContext;
}) {
  const closeHref = buildMailListHref(new URL(props.requestUrl));
  const lastMessage = props.messages.at(-1);

  return (
    <AppWorkspace.Detail open={props.messages.length > 0} width="xl" id="mail-thread-detail" viewTransitionName="mail-thread-detail">
      {props.messages.length > 0 && (
        <div class="flex h-full min-h-0 flex-col">
          <header class="detail-header">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <h1 class="truncate text-base font-semibold text-primary">{props.subject || "(no subject)"}</h1>
                <p class="mt-0.5 text-xs text-dimmed">
                  {props.messages.length} message{props.messages.length === 1 ? "" : "s"}
                </p>
              </div>
              <Tooltip content="Close conversation">
                <a href={closeHref} class="icon-btn" aria-label="Close conversation">
                  <i class="ti ti-x" aria-hidden="true" />
                  <span class="sr-only">Close conversation</span>
                </a>
              </Tooltip>
            </div>
            <Show when={props.canWrite}>
              <div class="mt-3 flex flex-wrap items-center gap-2">
                <Show when={props.selectedConversationId}>
                  <ComposeMail
                    mailboxId={props.mailboxId}
                    identities={props.identities}
                    conversationId={props.selectedConversationId}
                    intent="reply"
                    sourceMessageId={lastMessage?.id}
                    initialTo={lastMessage?.from.map((address) => address.address) ?? []}
                    initialSubject={props.subject.toLowerCase().startsWith("re:") ? props.subject : `Re: ${props.subject}`}
                    label="Reply"
                    class="btn-primary btn-sm"
                  />
                </Show>
                <ComposeMail
                  mailboxId={props.mailboxId}
                  identities={props.identities}
                  conversationId={props.selectedConversationId}
                  intent="forward"
                  sourceMessageId={lastMessage?.id}
                  initialSubject={props.subject.toLowerCase().startsWith("fwd:") ? props.subject : `Fwd: ${props.subject}`}
                  label="Forward"
                  class="btn-secondary btn-sm"
                />
              </div>
            </Show>
          </header>
          <div class="detail-stack">
            {props.messages.map((message) => (
              <MessageSection mailboxId={props.mailboxId} message={message} dateConfig={props.dateConfig} />
            ))}
            <Show when={props.selectedConversationId && props.collaborationState}>
              <ConversationCollaborationPanel
                mailboxId={props.mailboxId}
                conversationId={props.selectedConversationId!}
                currentUserId={props.currentUserId}
                canWrite={props.canWrite}
                initialState={props.collaborationState!}
                initialComments={props.comments}
                assignableUsers={props.assignableUsers}
                dateConfig={props.dateConfig}
              />
            </Show>
            <Show when={props.collaborationError}>
              <section class="detail-section">
                <Placeholder state="error" title="Collaboration unavailable" description={props.collaborationError} />
              </section>
            </Show>
          </div>
        </div>
      )}
    </AppWorkspace.Detail>
  );
}
