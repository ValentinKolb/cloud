import { mutation } from "@k2b/stdlib/solid";
import { Dropdown, type DropdownItem, prompts, toast } from "@k2b/ui";
import { createEffect, on, onCleanup } from "solid-js";
import { apiClient } from "../../api/client";
import type { DraftDerivationKind, MailAutomationConditions, SenderIdentity, SenderMatchKind } from "../../contracts";
import type { MessageDetail } from "../../service/messages";
import { readApiError } from "./api-response";
import { openIncomingAutomationEditor } from "./MailIncomingAutomationSettings";
import type { AutomationActionKind } from "./mail-automation-actions";
import { isOutgoingMessage } from "./mail-conversation-history";
import { resolveMailMessageActionVisibility } from "./mail-message-action-visibility";
import { buildExactSenderSearchHref, buildMailingListHref, senderDomainFromAddress } from "./mail-navigation";

type SelectionContext = {
  selectionKey: string | null;
};

export default function MailSenderMessageActions(props: {
  mailboxId: string;
  requestUrl: string;
  canWrite: boolean;
  canAdmin: boolean;
  selectionKey: string | null;
  selectedConversationId: string | null;
  message: MessageDetail;
  totalMessageCount: number;
  identities: SenderIdentity[];
  primaryActions?: DropdownItem[];
  onReconcile: () => Promise<void>;
  onReassignMessage: (messageId: string) => void | Promise<void>;
  onSplitMessage: (messageId: string) => void | Promise<void>;
  onDeriveMessage: (kind: DraftDerivationKind, message: MessageDetail) => unknown;
}) {
  const openIncomingAutomation = (
    address: string,
    options: { matchKind?: SenderMatchKind; action?: AutomationActionKind; name?: string } = {},
  ) => {
    const matchKind = options.matchKind ?? "sender";
    const matchValue = matchKind === "domain" ? senderDomainFromAddress(address) : address;
    if (!matchValue) return void prompts.error("This message does not contain a complete sender domain.");
    const initialConditions: MailAutomationConditions = {
      mode: "all",
      items: [
        matchKind === "sender"
          ? { field: "sender_address", operator: "is", value: matchValue }
          : { field: "sender_domain", operator: "is", value: matchValue },
      ],
    };
    void openIncomingAutomationEditor({
      mailboxId: props.mailboxId,
      initialName: options.name ?? `Messages from ${matchValue}`,
      initialScope: { mode: "matching", conditions: initialConditions },
      initialAction: options.action ?? "mark_read",
      onSaved: () => undefined,
    });
  };

  const markSenderRead = mutation.create<
    boolean,
    { address: string; selectionKey: string | null },
    SelectionContext & { idempotencyKey: string }
  >({
    mutation: async ({ address }, { abortSignal, idempotencyKey }) => {
      const previewResponse = await apiClient.mailboxes[":mailboxId"]["incoming-automations"].preview.$post(
        {
          param: { mailboxId: props.mailboxId },
          json: {
            scope: {
              mode: "matching",
              conditions: { mode: "all", items: [{ field: "sender_address", operator: "is", value: address }] },
            },
          },
        },
        { init: { signal: abortSignal } },
      );
      if (!previewResponse.ok) throw new Error(await readApiError(previewResponse, "Could not preview sender messages"));
      const preview = await previewResponse.json();
      if (preview.messageCount === 0) {
        toast("No messages from this sender were found", { title: "Nothing to change" });
        return false;
      }
      const confirmed = await prompts.confirm(
        `Queue a read-state update for unread messages among ${preview.messageCount} matching message${
          preview.messageCount === 1 ? "" : "s"
        }? ${preview.capped ? `At most ${preview.applicationLimit} messages are queued per action.` : ""}`,
        { title: `Mark messages from ${address} as read?`, confirmText: "Mark as read" },
      );
      if (!confirmed || abortSignal.aborted) return false;
      const response = await apiClient.mailboxes[":mailboxId"]["incoming-automations"]["mark-read"].$post(
        {
          param: { mailboxId: props.mailboxId },
          json: { matchKind: "sender", matchValue: address, idempotencyKey },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not queue sender messages"));
      const result = await response.json();
      if (abortSignal.aborted) return false;
      if (result.messageCount === 0) {
        toast("All matching messages are already read", { title: "Nothing to change" });
        return false;
      }
      toast.success(
        `${result.messageCount} message${result.messageCount === 1 ? "" : "s"} queued${
          result.capped ? `; limited to ${result.applicationLimit}` : ""
        }`,
      );
      return true;
    },
    onBefore: ({ selectionKey }) => ({ selectionKey, idempotencyKey: crypto.randomUUID() }),
    onSuccess: (changed, context) => {
      if (!changed) return;
      if (context?.selectionKey === props.selectionKey) {
        void props
          .onReconcile()
          .catch((error) =>
            prompts.error(error instanceof Error ? error.message : "Mail could not be refreshed", { title: "Update queued" }),
          );
      }
    },
    onError: (error) => prompts.error(error.message),
  });

  const reportPhishing = mutation.create<boolean, SelectionContext>({
    mutation: async (_, { abortSignal }) => {
      const confirmed = await prompts.confirm(
        "Mail administrators will receive the sender address, message ID, and any warning reasons. The subject and message body are not copied into the report.",
        { title: "Report this message as phishing?", confirmText: "Report message" },
      );
      if (!confirmed || abortSignal.aborted) return false;
      const response = await apiClient.mailboxes[":mailboxId"].messages[":messageId"]["security-report"].$post(
        { param: { mailboxId: props.mailboxId, messageId: props.message.id } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not report this message"));
      return true;
    },
    onSuccess: (reported) => {
      if (reported) toast.success("Message reported for review");
    },
    onError: (error) => prompts.error(error.message),
  });

  const pending = () => markSenderRead.loading() || reportPhishing.loading();
  const sender = () => props.message.from[0] ?? null;
  const findSenderHref = () => (sender() ? buildExactSenderSearchHref(new URL(props.requestUrl), sender()!.address) : null);
  const actionVisibility = () =>
    resolveMailMessageActionVisibility({
      outgoing: isOutgoingMessage(props.message, props.identities),
      hasSender: Boolean(sender()),
      hasMailingListUnsubscribe: Boolean(props.message.mailingList?.unsubscribe),
      hasConversation: Boolean(props.selectedConversationId),
      totalMessageCount: props.totalMessageCount,
      canWrite: props.canWrite,
      canAdmin: props.canAdmin,
    });

  createEffect(
    on(
      () => props.selectionKey,
      () => {
        markSenderRead.abort();
        reportPhishing.abort();
      },
      { defer: true },
    ),
  );
  onCleanup(() => {
    markSenderRead.abort();
    reportPhishing.abort();
  });

  return (
    <Dropdown.Root
      position="bottom-left"
      width="16rem"
      items={[
        ...(props.primaryActions ?? []),
        ...(sender() && actionVisibility().findSender
          ? [
              {
                sectionLabel: "Sender",
                items: [
                  ...(findSenderHref() ? [{ label: "Find all from this sender", icon: "ti ti-search", href: findSenderHref()! }] : []),
                  ...(actionVisibility().createIncomingAutomation
                    ? [
                        {
                          label: "Create automation from sender",
                          icon: "ti ti-filter-plus",
                          action: () => openIncomingAutomation(sender()!.address),
                        },
                      ]
                    : []),
                  ...(actionVisibility().markSenderRead
                    ? [
                        {
                          label: "Mark all as read",
                          icon: "ti ti-mail-opened",
                          action: () => void markSenderRead.mutate({ address: sender()!.address, selectionKey: props.selectionKey }),
                        },
                      ]
                    : []),
                  ...(actionVisibility().blockSender
                    ? [
                        {
                          label: "Block sender",
                          icon: "ti ti-user-x",
                          action: () => openIncomingAutomation(sender()!.address, { action: "junk", name: `Block ${sender()!.address}` }),
                        },
                        ...(senderDomainFromAddress(sender()!.address)
                          ? [
                              {
                                label: "Block sender domain",
                                icon: "ti ti-world-x",
                                action: () =>
                                  openIncomingAutomation(sender()!.address, {
                                    matchKind: "domain",
                                    action: "junk",
                                    name: `Block ${senderDomainFromAddress(sender()!.address)}`,
                                  }),
                              },
                            ]
                          : []),
                      ]
                    : []),
                  ...(actionVisibility().manageUnsubscribe && props.message.mailingList?.unsubscribe
                    ? [
                        {
                          label: "Manage unsubscribe",
                          icon: "ti ti-mail-off",
                          href: buildMailingListHref(new URL(props.requestUrl), props.message.mailingList.listKey),
                        },
                      ]
                    : []),
                  {
                    label: "Report phishing",
                    icon: "ti ti-shield-exclamation",
                    action: () => void reportPhishing.mutate({ selectionKey: props.selectionKey }),
                  },
                ],
              },
            ]
          : []),
        ...(actionVisibility().conversationRepair
          ? [
              {
                sectionLabel: "Conversation",
                items: [
                  ...(actionVisibility().conversationRepair
                    ? [
                        {
                          label: "Move message to another conversation",
                          icon: "ti ti-message-forward",
                          action: () => props.onReassignMessage(props.message.id),
                        },
                        {
                          label: "Start new conversation from this message",
                          icon: "ti ti-arrows-split-2",
                          action: () => props.onSplitMessage(props.message.id),
                        },
                      ]
                    : []),
                ],
              },
            ]
          : []),
        ...(actionVisibility().editAsNew
          ? [
              {
                label: "Use as new message",
                icon: "ti ti-copy",
                action: () => props.onDeriveMessage("edit_as_new", props.message),
              },
            ]
          : []),
      ]}
    >
      <Dropdown.Trigger iconOnly size="sm" type="button" variant="ghost" label="Message actions" disabled={pending()}>
        <i class={`ti ${pending() ? "ti-loader-2 animate-spin" : "ti-dots"}`} aria-hidden="true" />
      </Dropdown.Trigger>
    </Dropdown.Root>
  );
}
