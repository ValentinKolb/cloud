import { mutation } from "@k2b/stdlib/solid";
import { Dropdown, type DropdownItem, prompts, toast } from "@valentinkolb/cloud/ui";
import { createEffect, on, onCleanup } from "solid-js";
import { apiClient } from "../../api/client";
import type { DraftDerivationKind, MailRuleConditions, SenderIdentity, SenderMatchKind } from "../../contracts";
import type { MessageDetail } from "../../service/messages";
import { readApiError } from "./api-response";
import { openMailRuleEditor, type RuleActionKind } from "./MailRuleSettings";
import { isOutgoingMessage } from "./mail-conversation-history";
import { resolveMailMessageActionVisibility } from "./mail-message-action-visibility";
import { buildExactSenderSearchHref, senderDomainFromAddress } from "./mail-navigation";
import { openMessageAsSpacesEvent } from "./mail-spaces-event";

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
  sourceFolderId: string | null;
  message: MessageDetail;
  totalMessageCount: number;
  identities: SenderIdentity[];
  primaryActions?: DropdownItem[];
  onReconcile: () => Promise<void>;
  onReassignMessage: (messageId: string) => void | Promise<void>;
  onSplitMessage: (messageId: string) => void | Promise<void>;
  onDeriveMessage: (kind: DraftDerivationKind, message: MessageDetail) => unknown;
}) {
  const openMailRule = (address: string, options: { matchKind?: SenderMatchKind; action?: RuleActionKind; name?: string } = {}) => {
    const matchKind = options.matchKind ?? "sender";
    const matchValue = matchKind === "domain" ? senderDomainFromAddress(address) : address;
    if (!matchValue) return void prompts.error("This message does not contain a complete sender domain.");
    const initialConditions: MailRuleConditions = {
      mode: "all",
      items: [
        matchKind === "sender"
          ? { field: "sender_address", operator: "is", value: matchValue }
          : { field: "sender_domain", operator: "is", value: matchValue },
      ],
    };
    void openMailRuleEditor({
      mailboxId: props.mailboxId,
      initialName: options.name ?? `Messages from ${matchValue}`,
      initialConditions,
      initialAction: options.action ?? "mark_read",
      onSaved: () => undefined,
    });
  };

  const messageKeywords = mutation.create<boolean, SelectionContext>({
    mutation: async (_, { abortSignal }) => {
      const message = props.message;
      const folderId = message.folderId;
      if (!message.remoteMessageRefId || !folderId) {
        await prompts.error("This message has no active provider placement.", { title: "Provider keywords unavailable" });
        return false;
      }
      const values = await prompts.form({
        title: "Edit provider keywords",
        icon: "ti ti-tags",
        fields: {
          keywords: {
            type: "tags",
            label: "Provider keywords",
            description: "These values sync through IMAP and are separate from Cloud tags.",
            default: message.keywords,
            maxTags: 100,
          },
        },
        confirmText: "Apply",
      });
      if (!values || abortSignal.aborted) return false;
      const next = [...new Set((values.keywords ?? []).map((keyword) => keyword.trim()).filter(Boolean))];
      const current = new Set(message.keywords.map((keyword) => keyword.toLowerCase()));
      const desired = new Set(next.map((keyword) => keyword.toLowerCase()));
      const addKeywords = next.filter((keyword) => !current.has(keyword.toLowerCase()));
      const removeKeywords = message.keywords.filter((keyword) => !desired.has(keyword.toLowerCase()));
      if (addKeywords.length === 0 && removeKeywords.length === 0) return false;
      const response = await apiClient.mailboxes[":mailboxId"].commands.$post(
        {
          param: { mailboxId: props.mailboxId },
          json: {
            kind: "change_message_state",
            remoteMessageRefId: message.remoteMessageRefId,
            folderId,
            change: { addFlags: [], removeFlags: [], addKeywords, removeKeywords },
            idempotencyKey: crypto.randomUUID(),
          },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not update provider keywords"));
      return true;
    },
    onSuccess: (changed) => {
      if (changed) toast.success("Provider keyword update queued");
    },
    onError: (error) => prompts.error(error.message),
  });

  const conversationKeyword = mutation.create<boolean, SelectionContext, SelectionContext>({
    mutation: async (_, { abortSignal }) => {
      const conversationId = props.selectedConversationId;
      const sourceFolderId = props.sourceFolderId ?? props.message.folderId;
      if (!conversationId || !sourceFolderId) return false;
      const values = await prompts.form({
        title: "Change conversation provider keyword",
        icon: "ti ti-tags",
        fields: {
          operation: {
            type: "select",
            label: "Change",
            options: [
              { id: "add", label: "Add keyword" },
              { id: "remove", label: "Remove keyword" },
            ],
            default: "add",
            required: true,
          },
          keyword: {
            type: "text",
            label: "Provider keyword",
            description: "Applied to every message in this conversation's current provider folder.",
            required: true,
          },
        },
        confirmText: "Queue change",
      });
      const keyword = values?.keyword.trim();
      if (!values || !keyword || abortSignal.aborted) return false;
      const response = await apiClient.mailboxes[":mailboxId"].conversations[":conversationId"].actions.$post(
        {
          param: { mailboxId: props.mailboxId, conversationId },
          json: {
            kind: "change_state",
            sourceFolderId,
            change:
              values.operation === "remove"
                ? { addFlags: [], removeFlags: [], addKeywords: [], removeKeywords: [keyword] }
                : { addFlags: [], removeFlags: [], addKeywords: [keyword], removeKeywords: [] },
            idempotencyKey: crypto.randomUUID(),
            correlationId: crypto.randomUUID(),
          },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not queue the conversation keyword change"));
      return true;
    },
    onBefore: (context) => context,
    onSuccess: async (changed, context) => {
      if (!changed) return;
      toast.success("Conversation keyword change queued");
      if (context?.selectionKey === props.selectionKey) await props.onReconcile();
    },
    onError: (error) => prompts.error(error.message),
  });

  const markSenderRead = mutation.create<boolean, { address: string; selectionKey: string | null }, SelectionContext>({
    mutation: async ({ address }, { abortSignal }) => {
      const previewResponse = await apiClient.mailboxes[":mailboxId"]["mail-rules"].preview.$post(
        {
          param: { mailboxId: props.mailboxId },
          json: {
            conditions: {
              mode: "all",
              items: [{ field: "sender_address", operator: "is", value: address }],
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
      const response = await apiClient.mailboxes[":mailboxId"]["mail-rules"]["mark-read"].$post(
        {
          param: { mailboxId: props.mailboxId },
          json: { matchKind: "sender", matchValue: address, idempotencyKey: crypto.randomUUID() },
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
    onBefore: ({ selectionKey }) => ({ selectionKey }),
    onSuccess: async (changed, context) => {
      if (!changed) return;
      if (context?.selectionKey === props.selectionKey) await props.onReconcile();
    },
    onError: (error) => prompts.error(error.message),
  });

  const createEventInSpaces = mutation.create<void, SelectionContext>({
    mutation: async (_context, { abortSignal }) =>
      openMessageAsSpacesEvent({ mailboxId: props.mailboxId, messageId: props.message.id, abortSignal }),
    onError: (error) => prompts.error(error.message, { title: "Could not open Spaces" }),
  });

  const pending = () =>
    messageKeywords.loading() || conversationKeyword.loading() || markSenderRead.loading() || createEventInSpaces.loading();
  const sender = () => props.message.from[0] ?? null;
  const findSenderHref = () => (sender() ? buildExactSenderSearchHref(new URL(props.requestUrl), sender()!.address) : null);
  const actionVisibility = () =>
    resolveMailMessageActionVisibility({
      outgoing: isOutgoingMessage(props.message, props.identities),
      hasSender: Boolean(sender()),
      hasMailingListUnsubscribe: Boolean(props.message.mailingList?.unsubscribe),
      hasProviderPlacement: Boolean(props.message.remoteMessageRefId && props.message.folderId),
      hasConversation: Boolean(props.selectedConversationId),
      hasConversationSourceFolder: Boolean(props.sourceFolderId ?? props.message.folderId),
      totalMessageCount: props.totalMessageCount,
      canWrite: props.canWrite,
      canAdmin: props.canAdmin,
    });

  createEffect(
    on(
      () => props.selectionKey,
      () => {
        messageKeywords.abort();
        conversationKeyword.abort();
        markSenderRead.abort();
        createEventInSpaces.abort();
      },
      { defer: true },
    ),
  );
  onCleanup(() => {
    messageKeywords.abort();
    conversationKeyword.abort();
    markSenderRead.abort();
    createEventInSpaces.abort();
  });

  return (
    <Dropdown
      trigger={
        <button type="button" class="icon-btn icon-btn-sm" aria-label="Message actions" disabled={pending()}>
          <i class={`ti ${pending() ? "ti-loader-2 animate-spin" : "ti-dots"}`} aria-hidden="true" />
        </button>
      }
      position="bottom-left"
      width="w-64"
      elements={[
        ...(props.primaryActions ?? []),
        ...(sender() && actionVisibility().findSender
          ? [
              {
                sectionLabel: "Sender",
                items: [
                  ...(findSenderHref() ? [{ label: "Find all from this sender", icon: "ti ti-search", href: findSenderHref()! }] : []),
                  ...(actionVisibility().createMailRule
                    ? [
                        {
                          label: "Create rule from sender",
                          icon: "ti ti-filter-plus",
                          action: () => openMailRule(sender()!.address),
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
                          action: () => openMailRule(sender()!.address, { action: "junk", name: `Block ${sender()!.address}` }),
                        },
                        ...(senderDomainFromAddress(sender()!.address)
                          ? [
                              {
                                label: "Block sender domain",
                                icon: "ti ti-world-x",
                                action: () =>
                                  openMailRule(sender()!.address, {
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
                          href: `/app/mail/${props.mailboxId}/subscriptions?list=${encodeURIComponent(props.message.mailingList.listKey)}`,
                        },
                      ]
                    : []),
                ],
              },
            ]
          : []),
        ...(props.canWrite || actionVisibility().providerKeywords
          ? [
              {
                sectionLabel: "Message",
                items: [
                  ...(props.canWrite
                    ? [
                        {
                          label: "Create event in Spaces",
                          icon: "ti ti-calendar-plus",
                          action: () => void createEventInSpaces.mutate({ selectionKey: props.selectionKey }),
                        },
                      ]
                    : []),
                  ...(actionVisibility().providerKeywords
                    ? [
                        {
                          label: "Provider keywords",
                          icon: "ti ti-tags",
                          action: () => void messageKeywords.mutate({ selectionKey: props.selectionKey }),
                        },
                      ]
                    : []),
                ],
              },
            ]
          : []),
        ...(actionVisibility().conversationKeyword || actionVisibility().conversationRepair
          ? [
              {
                sectionLabel: "Conversation",
                items: [
                  ...(actionVisibility().conversationKeyword
                    ? [
                        {
                          label: "Conversation provider keyword",
                          icon: "ti ti-tags",
                          action: () => void conversationKeyword.mutate({ selectionKey: props.selectionKey }),
                        },
                      ]
                    : []),
                  ...(actionVisibility().conversationRepair
                    ? [
                        {
                          label: "Move to another conversation",
                          icon: "ti ti-message-forward",
                          action: () => props.onReassignMessage(props.message.id),
                        },
                        {
                          label: "Start a new conversation",
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
                label: "Edit as new",
                icon: "ti ti-copy",
                action: () => props.onDeriveMessage("edit_as_new", props.message),
              },
            ]
          : []),
        ...(actionVisibility().resend
          ? [
              {
                label: "Resend as a new draft",
                icon: "ti ti-repeat",
                action: () => props.onDeriveMessage("resend", props.message),
              },
            ]
          : []),
      ]}
    />
  );
}
