import { Placeholder, StatusBadge } from "@valentinkolb/cloud/ui";
import { type DateContext, dates } from "@valentinkolb/stdlib";
import { Show } from "solid-js";
import type { DraftDerivationKind, DraftIntent, SenderIdentity } from "../../contracts";
import type { MessageDetail } from "../../service/messages";
import MailMessageAttachments from "./MailMessageAttachments";
import MailMessageBody from "./MailMessageBody";
import MailMessageDeliveryControl from "./MailMessageDeliveryControl";
import MailSenderMessageActions from "./MailSenderMessageActions";
import { isOutgoingMessage } from "./mail-conversation-history";
import {
  messageDeliveryAllowsResponses,
  messageDeliveryControlLabel,
  messageDeliveryPresentation,
  messagePreviewText,
} from "./mail-message-presentation";

const formatAddress = (address: { name: string | null; address: string }): string =>
  address.name ? `${address.name} <${address.address}>` : address.address;

const forwardBody = (message: MessageDetail, dateConfig: DateContext): string => `

---------- Forwarded message ----------
From: ${message.from.map(formatAddress).join(", ") || "Unknown sender"}
Date: ${dates.formatDateTime(message.internalDate, dateConfig)}
Subject: ${message.subject || "(no subject)"}
To: ${message.to.map(formatAddress).join(", ") || "Undisclosed recipients"}

${message.forwardText}`;

type MailMessageCardContext = {
  mailboxId: string;
  requestUrl: string;
  canWrite: boolean;
  canAdmin: boolean;
  selectionKey: string | null;
  selectedConversationId: string | null;
  sourceFolderId: string | null;
  totalMessageCount: number;
  identities: SenderIdentity[];
  dateConfig: DateContext;
  composerBusy: boolean;
};

type MailMessageCardActions = {
  toggle: (messageId: string) => void;
  selectionChange: (messageId: string, value: string) => void;
  compose: (intent: DraftIntent, message: MessageDetail, quotedBody?: string) => void;
  quoteReply: (message: MessageDetail, body: HTMLElement) => void;
  derive: (kind: DraftDerivationKind, message: MessageDetail) => void | Promise<void>;
  reconcile: () => Promise<void>;
  reassign: (messageId: string) => void | Promise<void>;
  split: (messageId: string) => void | Promise<void>;
};

export default function MailMessageCard(props: {
  message: MessageDetail;
  expanded: boolean;
  isLatest: boolean;
  selectionAvailable: boolean;
  context: MailMessageCardContext;
  actions: MailMessageCardActions;
}) {
  let messageBody!: HTMLDivElement;
  const controllableDelivery = () => {
    const delivery = props.message.delivery;
    return delivery && messageDeliveryControlLabel(delivery.state, props.context.canWrite) ? delivery : null;
  };
  const outgoing = () => isOutgoingMessage(props.message, props.context.identities);
  const senderLabel = () => {
    if (outgoing()) return "You";
    const sender = props.message.from[0];
    return sender?.name || sender?.address || "Unknown sender";
  };
  const recipientLabel = () => props.message.to.map((address) => address.name || address.address).join(", ") || "undisclosed recipients";
  const routeLabel = () => {
    if (outgoing()) return `to ${recipientLabel()}`;
    const ownAddresses = new Set(
      props.context.identities
        .filter((identity) => identity.status === "verified")
        .map((identity) => identity.fromAddress.trim().toLowerCase()),
    );
    return props.message.to.some((recipient) => ownAddresses.has(recipient.address.trim().toLowerCase()))
      ? "to me"
      : `to ${recipientLabel()}`;
  };
  const preview = () => messagePreviewText(props.message.plainText, props.message.forwardText);
  const exceptionalDelivery = () => {
    const delivery = props.message.delivery;
    return delivery ? !messageDeliveryAllowsResponses(delivery.state) : false;
  };
  const responseActions = () =>
    props.context.canWrite && props.context.selectedConversationId && !exceptionalDelivery()
      ? [
          {
            sectionLabel: "Respond",
            items: [
              {
                label: "Reply",
                icon: "ti ti-arrow-back-up",
                action: () => props.actions.compose("reply", props.message),
              },
              {
                label: "Reply all",
                icon: "ti ti-arrow-back-up-double",
                action: () => props.actions.compose("reply_all", props.message),
              },
              {
                label: "Forward",
                icon: "ti ti-arrow-forward-up",
                action: () => props.actions.compose("forward", props.message, forwardBody(props.message, props.context.dateConfig)),
              },
              ...(props.selectionAvailable
                ? [
                    {
                      label: "Quote selection",
                      icon: "ti ti-blockquote",
                      action: () => props.actions.quoteReply(props.message, messageBody),
                    },
                  ]
                : []),
            ],
          },
        ]
      : [];

  return (
    <article
      class="group min-w-0 scroll-mt-3 rounded-[var(--ui-radius-surface)] py-1 transition-colors hover:bg-[var(--ui-hover)] focus-within:bg-[var(--ui-hover)]"
      classList={{ "bg-[var(--ui-surface-subtle)]": props.expanded }}
      data-mail-message-id={props.message.id}
      data-mail-direction={outgoing() ? "outgoing" : "incoming"}
      style={`view-transition-name: mail-message-${props.message.id}`}
    >
      <div class="flex items-start gap-1 p-1">
        <button
          type="button"
          class="flex min-w-0 flex-1 items-start gap-3 rounded-[var(--ui-radius-control)] p-2 text-left"
          aria-expanded={props.expanded}
          onClick={() => props.actions.toggle(props.message.id)}
        >
          <span
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--ui-radius-control)]"
            classList={{
              "bg-[var(--ui-selected)] text-primary": outgoing(),
              "bg-[var(--ui-surface)] text-secondary": !outgoing(),
            }}
            title={outgoing() ? "Outgoing message" : "Incoming message"}
          >
            <i class={`ti ${outgoing() ? "ti-arrow-up-right" : "ti-arrow-down-left"}`} aria-hidden="true" />
            <span class="sr-only">{outgoing() ? "Outgoing message" : "Incoming message"}</span>
          </span>
          <span class="min-w-0 flex-1">
            <span class="flex min-w-0 items-baseline gap-2">
              <span
                class="truncate text-sm font-semibold text-primary"
                title={props.message.from.map(formatAddress).join(", ") || "Unknown sender"}
              >
                {senderLabel()}
              </span>
              <span class="truncate text-xs text-dimmed">{routeLabel()}</span>
            </span>
            <Show when={!props.expanded && preview()}>
              {(value) => (
                <span class="mt-1 block truncate text-xs leading-5 text-secondary" data-mail-message-preview>
                  {value()}
                </span>
              )}
            </Show>
            <Show when={props.message.delivery}>
              {(delivery) => {
                const status = messageDeliveryPresentation(delivery().state);
                return status ? (
                  <StatusBadge
                    tone={status.tone}
                    label={status.label}
                    icon={status.icon}
                    title={delivery().lastErrorMessage ?? undefined}
                    class="mt-1"
                  />
                ) : null;
              }}
            </Show>
          </span>
          <span class="flex shrink-0 items-center gap-2">
            <time class="shrink-0 text-xs text-dimmed" dateTime={props.message.internalDate}>
              {dates.formatDateTimeRelative(props.message.internalDate, props.context.dateConfig)}
            </time>
            <i class={`ti ${props.expanded ? "ti-chevron-up" : "ti-chevron-down"} text-dimmed`} aria-hidden="true" />
          </span>
        </button>
        <div class="mt-1 shrink-0">
          <MailSenderMessageActions
            mailboxId={props.context.mailboxId}
            requestUrl={props.context.requestUrl}
            canWrite={props.context.canWrite}
            canAdmin={props.context.canAdmin}
            selectionKey={props.context.selectionKey}
            selectedConversationId={props.context.selectedConversationId}
            sourceFolderId={props.context.sourceFolderId}
            message={props.message}
            totalMessageCount={props.context.totalMessageCount}
            identities={props.context.identities}
            primaryActions={responseActions()}
            onReconcile={props.actions.reconcile}
            onReassignMessage={props.actions.reassign}
            onSplitMessage={props.actions.split}
            onDeriveMessage={props.actions.derive}
          />
        </div>
      </div>
      <Show when={controllableDelivery()}>
        {(delivery) => (
          <MailMessageDeliveryControl
            mailboxId={props.context.mailboxId}
            delivery={delivery()}
            canWrite={props.context.canWrite}
            onReconcile={props.actions.reconcile}
          />
        )}
      </Show>
      <Show when={props.expanded}>
        <div class="pb-3 pl-14 pr-3 pt-2">
          <div ref={messageBody} class="mail-message-body min-w-0 overflow-x-auto text-sm text-primary">
            {props.message.sanitizedHtml || props.message.plainText ? (
              <MailMessageBody
                mailboxId={props.context.mailboxId}
                messageId={props.message.id}
                html={props.message.sanitizedHtml}
                plainText={props.message.plainText}
                attachments={props.message.attachments}
                remoteContent={props.message.remoteContent}
                onSelectionChange={(value) => props.actions.selectionChange(props.message.id, value)}
              />
            ) : props.message.hydrationStatus === "body" || props.message.hydrationStatus === "complete" ? (
              <Placeholder state="empty" variant="compact" title="This message has no body" />
            ) : props.message.hydrationStatus === "failed" ? (
              <Placeholder state="error" variant="compact" title="The message body could not be synchronized" />
            ) : (
              <Placeholder state="loading" title="Body is still synchronizing" />
            )}
          </div>
          <Show when={props.message.attachments.length > 0}>
            <MailMessageAttachments
              mailboxId={props.context.mailboxId}
              messageId={props.message.id}
              attachments={props.message.attachments}
              canShare={props.context.canAdmin}
            />
          </Show>
          <Show when={props.isLatest && props.context.canWrite && props.context.selectedConversationId && !exceptionalDelivery()}>
            <div class="mt-4 flex flex-wrap items-center gap-2" data-mail-direct-actions>
              <button
                type="button"
                class="btn-secondary btn-sm"
                disabled={props.context.composerBusy}
                onClick={() => props.actions.compose("reply", props.message)}
              >
                <i class="ti ti-arrow-back-up" aria-hidden="true" /> Reply
              </button>
              <button
                type="button"
                class="btn-simple btn-sm"
                disabled={props.context.composerBusy}
                onClick={() => props.actions.compose("reply_all", props.message)}
              >
                <i class="ti ti-arrow-back-up-double" aria-hidden="true" /> Reply all
              </button>
              <button
                type="button"
                class="btn-simple btn-sm"
                disabled={props.context.composerBusy}
                onClick={() => props.actions.compose("forward", props.message, forwardBody(props.message, props.context.dateConfig))}
              >
                <i class="ti ti-arrow-forward-up" aria-hidden="true" /> Forward
              </button>
              <Show when={props.selectionAvailable}>
                <button
                  type="button"
                  class="btn-simple btn-sm"
                  disabled={props.context.composerBusy}
                  onClick={() => props.actions.quoteReply(props.message, messageBody)}
                >
                  <i class="ti ti-blockquote" aria-hidden="true" /> Quote selection
                </button>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </article>
  );
}
