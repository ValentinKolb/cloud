import { Placeholder, StatusBadge, type StatusTone } from "@valentinkolb/cloud/ui";
import { type DateContext, dates } from "@valentinkolb/stdlib";
import { Show } from "solid-js";
import type { DraftDerivationKind, DraftIntent, SenderIdentity } from "../../contracts";
import type { MessageDetail } from "../../service/messages";
import MailMessageAttachments from "./MailMessageAttachments";
import MailMessageBody from "./MailMessageBody";
import MailSenderMessageActions from "./MailSenderMessageActions";

const formatAddress = (address: { name: string | null; address: string }): string =>
  address.name ? `${address.name} <${address.address}>` : address.address;

const deliveryPresentation = (delivery: NonNullable<MessageDetail["delivery"]>): { label: string; icon: string; tone: StatusTone } => {
  switch (delivery.state) {
    case "scheduled":
      return { label: "Scheduled", icon: "ti ti-clock", tone: "neutral" };
    case "undo_window":
      return { label: "Queued", icon: "ti ti-clock-pause", tone: "neutral" };
    case "sending":
      return { label: "Sending", icon: "ti ti-loader-2", tone: "running" };
    case "accepted":
    case "sent_sync_pending":
    case "sent":
    case "reconciled_accepted":
      return { label: "Sent", icon: "ti ti-check", tone: "ok" };
    case "failed":
    case "reconciled_unsent":
      return { label: "Send failed", icon: "ti ti-alert-circle", tone: "error" };
    case "unknown":
    case "needs_attention":
      return { label: "Needs attention", icon: "ti ti-alert-triangle", tone: "warn" };
    case "cancelled":
      return { label: "Cancelled", icon: "ti ti-ban", tone: "neutral" };
  }
};

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
  context: MailMessageCardContext;
  actions: MailMessageCardActions;
}) {
  let messageBody!: HTMLDivElement;

  return (
    <article class="min-w-0 py-2" style={`view-transition-name: mail-message-${props.message.id}`}>
      <button
        type="button"
        class="flex w-full items-start gap-3 rounded-[var(--ui-radius-control)] p-2 text-left hover:bg-[var(--ui-hover)]"
        aria-expanded={props.expanded}
        onClick={() => props.actions.toggle(props.message.id)}
      >
        <span class="thumbnail flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
          <i class="ti ti-user" aria-hidden="true" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="flex items-baseline justify-between gap-3">
            <span class="truncate text-sm font-semibold text-primary">
              {props.message.from.map(formatAddress).join(", ") || "Unknown sender"}
            </span>
            <time class="shrink-0 text-xs text-dimmed" dateTime={props.message.internalDate}>
              {dates.formatDateTimeRelative(props.message.internalDate, props.context.dateConfig)}
            </time>
          </span>
          <span class="block truncate text-xs text-dimmed">
            To {props.message.to.map(formatAddress).join(", ") || "undisclosed recipients"}
          </span>
          <Show when={props.message.delivery}>
            {(delivery) => {
              const status = deliveryPresentation(delivery());
              return (
                <StatusBadge
                  tone={status.tone}
                  label={status.label}
                  icon={status.icon}
                  title={delivery().lastErrorMessage ?? undefined}
                  class="mt-1"
                />
              );
            }}
          </Show>
        </span>
        <i class={`ti ${props.expanded ? "ti-chevron-up" : "ti-chevron-down"} mt-1 text-dimmed`} aria-hidden="true" />
      </button>
      <Show when={props.expanded}>
        <div class="pb-3 pl-14 pr-2 pt-2">
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
          <Show when={props.context.canWrite && props.context.selectedConversationId}>
            <div class="mt-4 flex flex-wrap items-center gap-2">
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
              <button
                type="button"
                class="btn-simple btn-sm"
                disabled={props.context.composerBusy}
                onClick={() => props.actions.quoteReply(props.message, messageBody)}
              >
                <i class="ti ti-blockquote" aria-hidden="true" /> Quote selection
              </button>
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
                onReconcile={props.actions.reconcile}
                onReassignMessage={props.actions.reassign}
                onSplitMessage={props.actions.split}
                onDeriveMessage={props.actions.derive}
              />
            </div>
          </Show>
        </div>
      </Show>
    </article>
  );
}
