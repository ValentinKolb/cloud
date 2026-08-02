import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { err, fail, ok, type Result } from "@k2b/stdlib";
import {
  type CapabilityExecutionContext,
  type CapabilityInvocationResult,
  type CapabilityResult,
  type CloudResourceView,
  defineCapabilities,
  type UniversalSearchInput,
  UniversalSearchDataSchema,
  UniversalSearchInputSchema,
} from "@valentinkolb/cloud/contracts";
import type { z } from "zod";
import * as c from "./capability-contracts";
import type { Mailbox, MailDraft } from "./contracts";
import {
  type MailRequestContext,
  collaboration,
  commands,
  composeSafety,
  drafts,
  draftUploads,
  listSubscriptions,
  localTags,
  mailboxAccess,
  mailboxes,
  messages,
  reminders,
  scheduledSends,
  search,
  senderIdentities,
  triage,
} from "./service";
import type { ConversationSummary, MessageSummary } from "./service/messages";

const requestContext = (context: CapabilityExecutionContext): MailRequestContext => ({
  actor: context.actor,
  accessSubject: context.accessSubject,
});

const mapResult = <Source, Data>(result: Result<Source>, map: (source: Source) => Data): CapabilityInvocationResult<Data> =>
  result.ok ? ok({ data: map(result.data) }) : result;

const mapPage = <Source, Data>(
  result: Result<{ items: Source[]; nextCursor: string | null }>,
  map: (source: Source) => Data,
  refs?: (source: Source) => CapabilityResult<Data[]>["refs"],
): CapabilityInvocationResult<Data[]> =>
  result.ok
    ? ok({
        data: result.data.items.map(map),
        page: {
          hasMore: result.data.nextCursor !== null,
          ...(result.data.nextCursor ? { nextCursor: result.data.nextCursor } : {}),
        },
        ...(refs ? { refs: result.data.items.flatMap((item) => refs(item) ?? []) } : {}),
      })
    : result;

const mapBoundedList = <Source, Data>(
  result: Result<Source[]>,
  map: (source: Source) => Data,
  limit = 100,
): CapabilityInvocationResult<Data[]> =>
  result.ok
    ? ok({
        data: result.data.slice(0, limit).map(map),
        page: { hasMore: result.data.length > limit },
      })
    : result;

const stableUuid = (value: string): string => {
  const hex = createHash("sha256").update(value).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

const requireIdempotencyKey = (context: CapabilityExecutionContext): Result<string> =>
  context.idempotencyKey ? ok(context.idempotencyKey) : fail(err.badInput("An idempotency key is required"));

const mapMailbox = (mailbox: Mailbox & { permission: "read" | "write" | "admin" }) => ({
  id: mailbox.id,
  name: mailbox.name,
  description: mailbox.description,
  permission: mailbox.permission,
  health: mailbox.health,
  healthReason: mailbox.healthReason,
  syncEnabled: mailbox.syncEnabled,
  createdAt: mailbox.createdAt,
  updatedAt: mailbox.updatedAt,
});

const mapDraft = (draft: MailDraft) => ({
  id: draft.id,
  mailboxId: draft.mailboxId,
  conversationId: draft.conversationId,
  intent: draft.intent,
  sourceMessageId: draft.sourceMessageId,
  senderIdentityId: draft.senderIdentityId,
  to: draft.to,
  cc: draft.cc,
  bcc: draft.bcc,
  subject: draft.subject,
  body: draft.body,
  format: draft.format,
  priority: draft.priority,
  requestDeliveryReceipt: draft.requestDeliveryReceipt,
  requestReadReceipt: draft.requestReadReceipt,
  attachments: draft.attachments,
  revision: draft.revision,
  state: draft.state,
  createdAt: draft.createdAt,
  updatedAt: draft.updatedAt,
});

const mapConversation = (mailboxId: string, conversation: ConversationSummary) => ({
  id: conversation.id,
  mailboxId,
  primaryReference: conversation.primaryReference,
  subject: conversation.subject,
  participantSummary: conversation.participantSummary,
  participantLabels: conversation.participantLabels,
  latestMessageAt: conversation.latestMessageAt,
  workStatus: conversation.workStatus,
  assigneeUserId: conversation.assigneeUserId,
  snoozedUntil: conversation.snoozedUntil,
  revision: conversation.revision,
  updatedAt: conversation.updatedAt,
  unread: conversation.unread,
  activeFolderIds: conversation.activeFolderIds,
  flagged: conversation.flagged,
  hasAttachments: conversation.hasAttachments,
  messageCount: conversation.messageCount,
  preview: conversation.preview,
});

const mapMessageSummary = (mailboxId: string, conversationId: string | null, message: MessageSummary) => ({
  id: message.id,
  mailboxId,
  conversationId,
  subject: message.subject,
  messageId: message.messageId,
  internalDate: message.internalDate,
  sentAt: message.sentAt,
  from: message.from,
  to: message.to,
  flags: message.flags,
  keywords: message.keywords,
  hydrationStatus: message.hydrationStatus,
  remoteAvailable: message.remoteAvailable,
});

const boundedText = (value: string | null, max = 256 * 1024): { text: string | null; truncated: boolean } => {
  if (value === null || value.length <= max) return { text: value, truncated: false };
  return { text: value.slice(0, max), truncated: true };
};

const runSearch = async (input: UniversalSearchInput, capabilityContext: CapabilityExecutionContext) => {
  if (!input.query.trim()) return ok({ data: [] });
  const context = requestContext(capabilityContext);
  const mailboxResult = await mailboxes.listMailboxes(context, 20);
  if (!mailboxResult.ok) return ok({ data: [] });
  const pages: Array<{ mailbox: (typeof mailboxResult.data)[number]; page: Awaited<ReturnType<typeof search.searchMessages>> }> = [];
  for (let offset = 0; offset < mailboxResult.data.length; offset += 4) {
    pages.push(
      ...(await Promise.all(
        mailboxResult.data.slice(offset, offset + 4).map(async (mailbox) => ({
          mailbox,
          page: await search.searchMessages({
            context,
            mailboxId: mailbox.id,
            request: {
              expression: { type: "text", field: "any", query: input.query, match: "words" },
              sort: "relevance",
              limit: Math.min(input.limit, 10),
            },
          }),
        })),
      )),
    );
  }
  const data: CloudResourceView[] = pages
    .flatMap(({ mailbox, page }) => (page.ok ? page.data.items.map((message, mailboxRank) => ({ mailbox, message, mailboxRank })) : []))
    .sort((left, right) => left.mailboxRank - right.mailboxRank || right.message.internalDate.localeCompare(left.message.internalDate))
    .slice(0, input.limit)
    .map(({ mailbox, message }) => ({
      ref: { type: "mail.message", id: message.id },
      title: message.subject || "(no subject)",
      preview: message.snippet ?? message.from.map((address) => address.name || address.address).join(", "),
      icon: "ti ti-mail",
      priority: 8,
      metadata: [
        { label: "Mailbox", value: mailbox.name },
        { label: "Date", value: message.internalDate },
      ],
      links: [{ rel: "open", href: message.conversationId ? `/app/mail/${mailbox.id}?conversation=${message.conversationId}` : `/app/mail/${mailbox.id}?message=${message.id}` }],
    }));
  return ok({ data });
};

const queryDefinitions = {
  search: {
    title: "Search mail",
    description: "Search messages across mailboxes the current actor can read.",
    input: UniversalSearchInputSchema,
    data: UniversalSearchDataSchema,
    universalSearch: { tags: [{ tag: "mail", title: "Mail", description: "Search mail messages.", aliases: ["email", "message"] }] },
    run: runSearch,
  },
  "mailbox.list": {
    title: "List mailboxes",
    description: "List accessible mailboxes with permission and operational health.",
    input: c.MailboxListInputSchema,
    data: c.MailboxListDataSchema,
    run: async (input: z.output<typeof c.MailboxListInputSchema>, context: CapabilityExecutionContext) => {
      const result = await mailboxes.listMailboxes(
        requestContext(context),
        input.limit,
        undefined,
        input.query,
        input.minimumPermission,
      );
      return mapResult(result, (items) =>
        items.map((item) => mapMailbox(item as Mailbox & { permission: "read" | "write" | "admin" })),
      );
    },
  },
  "mailbox.get": {
    title: "Get mailbox",
    description: "Read one accessible mailbox without exposing connector credentials.",
    input: c.MailboxGetInputSchema,
    data: c.MailboxDataSchema,
    run: async (input: z.output<typeof c.MailboxGetInputSchema>, context: CapabilityExecutionContext) => {
      const mailContext = requestContext(context);
      const mailbox = await mailboxes.getMailbox(mailContext, input.mailboxId);
      if (!mailbox.ok) return mailbox;
      const permission = await mailboxAccess.getMailboxPermission(mailContext, input.mailboxId);
      return permission === "none" ? fail(err.forbidden("Mailbox access is required")) : ok({ data: mapMailbox({ ...mailbox.data, permission }) });
    },
  },
  "mailbox.identity.list": {
    title: "List sender identities",
    description: "List verified or configured From identities for one mailbox.",
    input: c.SenderIdentityListInputSchema,
    data: c.SenderIdentityListDataSchema,
    run: async (input: z.output<typeof c.SenderIdentityListInputSchema>, context: CapabilityExecutionContext) =>
      mapBoundedList(await senderIdentities.listSenderIdentities(requestContext(context), input.mailboxId), (item) => ({
        id: item.id, mailboxId: item.mailboxId, label: item.label, displayName: item.displayName, fromAddress: item.fromAddress,
        replyTo: item.replyTo, defaultCc: item.defaultCc, defaultBcc: item.defaultBcc, defaultFormat: item.defaultFormat,
        defaultPriority: item.defaultPriority, defaultDeliveryReceipt: item.defaultDeliveryReceipt,
        defaultReadReceipt: item.defaultReadReceipt, isDefault: item.isDefault, status: item.status as "unverified" | "verified" | "rejected",
        createdAt: item.createdAt, updatedAt: item.updatedAt,
      })),
  },
  "mailbox.member.list": {
    title: "List mailbox members",
    description: "List people eligible for assignment in a mailbox.",
    input: c.MailboxMemberListInputSchema,
    data: c.MailboxMemberListDataSchema,
    run: async (input: z.output<typeof c.MailboxMemberListInputSchema>, context: CapabilityExecutionContext) =>
      mapResult(await collaboration.listAssignableUsers({ context: requestContext(context), mailboxId: input.mailboxId, search: input.query, limit: input.limit }), (items) => items),
  },
  "folder.list": {
    title: "List folders",
    description: "List selectable folders and their visible counts.",
    input: c.FolderListInputSchema,
    data: c.FolderListDataSchema,
    run: async (input: z.output<typeof c.FolderListInputSchema>, context: CapabilityExecutionContext) =>
      mapBoundedList(
        await messages.listFolders(requestContext(context), input.mailboxId),
        ({ id, parentId, name, role, selectable, showInSidebar, total, unread }) => ({
          id,
          parentId,
          name,
          role,
          selectable,
          showInSidebar,
          total,
          unread,
        }),
      ),
  },
  "conversation.list": {
    title: "List conversations",
    description: "List bounded conversation summaries for a mailbox view or folder.",
    input: c.ConversationListInputSchema,
    data: c.ConversationListDataSchema,
    run: async (input: z.output<typeof c.ConversationListInputSchema>, context: CapabilityExecutionContext) =>
      mapPage(await messages.listConversations({ context: requestContext(context), mailboxId: input.mailboxId, folderId: input.folderId, status: input.workStatus, view: input.view, cursor: input.cursor, limit: input.limit }), (item) => mapConversation(input.mailboxId, item)),
  },
  "conversation.search": {
    title: "Search conversations",
    description: "Search a whole mailbox using structured sender, recipient, subject, body, date, flag, folder, or attachment expressions.",
    input: c.ConversationSearchInputSchema,
    data: c.ConversationSearchDataSchema,
    run: async (input: z.output<typeof c.ConversationSearchInputSchema>, context: CapabilityExecutionContext) => {
      const result = await search.searchMessages({ context: requestContext(context), mailboxId: input.mailboxId, request: { expression: input.expression, sort: input.sort, cursor: input.cursor, limit: input.limit } });
      if (!result.ok) return result;
      return ok({
        data: result.data.items.filter((item) => item.conversationId).map((item) => ({
          id: item.conversationId!, mailboxId: input.mailboxId, primaryReference: item.primaryReference, subject: item.subject,
          participantSummary: item.participantSummary, participantLabels: item.participantLabels, latestMessageAt: item.latestMessageAt,
          workStatus: item.workStatus ?? "needs_action", assigneeUserId: item.assigneeUserId, snoozedUntil: item.snoozedUntil,
          revision: item.revision, updatedAt: item.updatedAt, unread: item.unread, activeFolderIds: item.activeFolderIds,
          flagged: item.flagged, hasAttachments: item.hasAttachments, messageCount: item.messageCount, preview: item.snippet,
        })),
        page: { hasMore: result.data.nextCursor !== null, ...(result.data.nextCursor ? { nextCursor: result.data.nextCursor } : {}) },
      });
    },
  },
  "conversation.get": {
    title: "Get conversation",
    description: "Read collaboration state, tags, and up to 100 message summaries for one conversation.",
    input: c.ConversationGetInputSchema,
    data: c.ConversationGetDataSchema,
    run: async (input: z.output<typeof c.ConversationGetInputSchema>, context: CapabilityExecutionContext) => {
      const mailContext = requestContext(context);
      const [state, tags, page] = await Promise.all([
        collaboration.getConversationCollaboration({ context: mailContext, mailboxId: input.mailboxId, conversationId: input.conversationId }),
        localTags.getConversationLocalTags({ context: mailContext, mailboxId: input.mailboxId, conversationId: input.conversationId }),
        messages.listConversationMessages({ context: mailContext, mailboxId: input.mailboxId, conversationId: input.conversationId, limit: 100 }),
      ]);
      if (!state.ok) return state;
      if (!tags.ok) return tags;
      if (!page.ok) return page;
      return ok({ data: { conversationId: input.conversationId, collaboration: state.data, tags: tags.data.tags, messages: page.data.items.map((item) => mapMessageSummary(input.mailboxId, input.conversationId, item)), messagesTruncated: page.data.nextCursor !== null } });
    },
  },
  "message.list": {
    title: "List messages",
    description: "List bounded message summaries in chronological conversation order.",
    input: c.MessageListInputSchema,
    data: c.MessageListDataSchema,
    run: async (input: z.output<typeof c.MessageListInputSchema>, context: CapabilityExecutionContext) =>
      mapPage(await messages.listConversationMessages({ context: requestContext(context), mailboxId: input.mailboxId, conversationId: input.conversationId, cursor: input.cursor, limit: input.limit }), (item) => mapMessageSummary(input.mailboxId, input.conversationId, item)),
  },
  "message.get": {
    title: "Get message",
    description: "Read safe plain-text message content and bounded attachment metadata. Raw source and HTML are excluded.",
    input: c.MessageGetInputSchema,
    data: c.MessageDataSchema,
    run: async (input: z.output<typeof c.MessageGetInputSchema>, context: CapabilityExecutionContext) => {
      const result = await messages.getMessage({ context: requestContext(context), mailboxId: input.mailboxId, messageId: input.messageId });
      if (!result.ok) return result;
      const item = result.data;
      const body = boundedText(item.plainText ?? item.forwardText);
      const attachments = item.attachments.slice(0, 100).map(({ id, filename, contentType, sizeBytes }) => ({
        id,
        filename,
        contentType,
        sizeBytes,
        downloadHref: `/api/mail/mailboxes/${input.mailboxId}/messages/${input.messageId}/attachments/${id}`,
      }));
      return ok({
        data: {
          ...mapMessageSummary(input.mailboxId, null, item),
          contentType: item.contentType,
          sizeBytes: item.sizeBytes,
          replyTo: item.replyTo,
          cc: item.cc,
          headers: Object.entries(item.selectedHeaders)
            .filter((entry): entry is [string, string] => typeof entry[1] === "string")
            .slice(0, 50)
            .map(([name, value]) => ({ name: name.slice(0, 128), value: value.slice(0, 8192) })),
          text: body.text,
          bodyTruncated: body.truncated,
          attachments,
          attachmentsTruncated: item.attachments.length > 100,
          delivery: item.delivery
            ? {
                id: item.delivery.submissionId,
                state: item.delivery.state,
                scheduledAt: item.delivery.scheduledAt,
                undoUntil: item.delivery.undoUntil,
                acceptedAt: item.delivery.acceptedAt,
                errorCode: item.delivery.lastErrorCode,
                errorMessage: item.delivery.lastErrorMessage,
              }
            : null,
        },
        refs: [
          { type: "mail.message", id: item.id },
          ...attachments.slice(0, 99).map((attachment) => ({ type: "mail.attachment", id: attachment.id })),
        ],
        links: [
          { rel: "open" as const, href: `/app/mail/${input.mailboxId}?message=${item.id}` },
          ...attachments.slice(0, 19).map((attachment) => ({
            rel: "download" as const,
            href: attachment.downloadHref,
            title: attachment.filename?.trim() || "Download attachment",
          })),
        ],
      });
    },
  },
  "draft.list": {
    title: "List drafts",
    description: "List active user drafts for one mailbox.",
    input: c.DraftListInputSchema,
    data: c.DraftListDataSchema,
    run: async (input: z.output<typeof c.DraftListInputSchema>, context: CapabilityExecutionContext) => mapResult(await drafts.listDrafts(requestContext(context), input.mailboxId, input.limit), (items) => items.map(mapDraft)),
  },
  "draft.get": {
    title: "Get draft",
    description: "Read one editable or scheduled draft.",
    input: c.DraftGetInputSchema,
    data: c.DraftDataSchema,
    run: async (input: z.output<typeof c.DraftGetInputSchema>, context: CapabilityExecutionContext) => mapResult(await drafts.getDraft(requestContext(context), input.mailboxId, input.draftId), mapDraft),
  },
  "draft.send.review": {
    title: "Review draft before sending",
    description: "Return the current bounded safety warnings and approval fingerprint required by draft.send.",
    input: c.DraftSendReviewInputSchema,
    data: c.DraftSendReviewDataSchema,
    run: async (input: z.output<typeof c.DraftSendReviewInputSchema>, context: CapabilityExecutionContext) => mapResult(await composeSafety.reviewDraftComposeSafety({ context: requestContext(context), ...input }), (item) => item),
  },
  "mailbox.tag.list": {
    title: "List mailbox tags",
    description: "List Cloud-local collaboration tags for a mailbox.",
    input: c.TagListInputSchema,
    data: c.TagListDataSchema,
    run: async (input: z.output<typeof c.TagListInputSchema>, context: CapabilityExecutionContext) =>
      mapBoundedList(await localTags.listLocalTags(requestContext(context), input.mailboxId), (item) => item),
  },
  "conversation.comment.list": {
    title: "List conversation comments",
    description: "List bounded internal team comments for a conversation.",
    input: c.CommentListInputSchema,
    data: c.CommentListDataSchema,
    run: async (input: z.output<typeof c.CommentListInputSchema>, context: CapabilityExecutionContext) => mapPage(await collaboration.listConversationComments({ context: requestContext(context), ...input }), (item) => item),
  },
  "conversation.activity.list": {
    title: "List mail activity",
    description: "List bounded mailbox or conversation collaboration activity.",
    input: c.ActivityListInputSchema,
    data: c.ActivityListDataSchema,
    run: async (input: z.output<typeof c.ActivityListInputSchema>, context: CapabilityExecutionContext) => mapPage(await collaboration.listActivity({ context: requestContext(context), ...input }), (item) => item),
  },
  "conversation.reminder.get": {
    title: "Get personal reminder",
    description: "Read the current user's personal reminder for one conversation.",
    input: c.ReminderGetInputSchema,
    data: c.ReminderGetDataSchema,
    run: async (input: z.output<typeof c.ReminderGetInputSchema>, context: CapabilityExecutionContext) =>
      mapResult(await reminders.getConversationReminder({ context: requestContext(context), ...input }), (item) => item),
  },
  "delivery.list": {
    title: "List scheduled deliveries",
    description: "List messages still in an undo window or scheduled for later delivery.",
    input: c.DeliveryListInputSchema,
    data: c.DeliveryListDataSchema,
    run: async (input: z.output<typeof c.DeliveryListInputSchema>, context: CapabilityExecutionContext) => {
      const result = await scheduledSends.listScheduledSends({ context: requestContext(context), ...input });
      if (!result.ok) return result;
      return ok({ data: result.data.items.map((item) => ({ id: item.id, commandId: item.commandId, draftId: item.draftId, conversationId: item.conversationId, subject: item.subject, scheduledAt: item.scheduledAt, nextAttemptAt: item.nextAttemptAt, state: item.state, attempt: item.attempt, lastError: item.lastError, createdAt: item.createdAt })), page: { hasMore: result.data.nextCursor !== null, ...(result.data.nextCursor ? { nextCursor: result.data.nextCursor } : {}) } });
    },
  },
  "delivery.get": {
    title: "Get scheduled delivery",
    description: "Read one scheduled delivery by identifier.",
    input: c.DeliveryGetInputSchema,
    data: c.DeliveryDataSchema,
    run: async (input: z.output<typeof c.DeliveryGetInputSchema>, context: CapabilityExecutionContext) =>
      mapResult(
        await scheduledSends.getScheduledSend({
          context: requestContext(context),
          mailboxId: input.mailboxId,
          scheduledSendId: input.deliveryId,
        }),
        (item) => ({
          id: item.id,
          commandId: item.commandId,
          draftId: item.draftId,
          conversationId: item.conversationId,
          subject: item.subject,
          scheduledAt: item.scheduledAt,
          nextAttemptAt: item.nextAttemptAt,
          state: item.state,
          attempt: item.attempt,
          lastError: item.lastError,
          createdAt: item.createdAt,
        }),
      ),
  },
  "mailing-list.subscription.list": {
    title: "List mailing-list subscriptions",
    description: "List mailing lists detected from standards-based message headers.",
    input: c.SubscriptionListInputSchema,
    data: c.SubscriptionListDataSchema,
    run: async (input: z.output<typeof c.SubscriptionListInputSchema>, context: CapabilityExecutionContext) => mapPage(await listSubscriptions.listSubscriptions({ context: requestContext(context), ...input }), (item) => item),
  },
  "mailing-list.subscription.get": {
    title: "Get mailing-list subscription",
    description: "Read current unsubscribe information for one detected mailing list.",
    input: c.SubscriptionGetInputSchema,
    data: c.SubscriptionGetDataSchema,
    run: async (input: z.output<typeof c.SubscriptionGetInputSchema>, context: CapabilityExecutionContext) => mapResult(await listSubscriptions.getSubscription(requestContext(context), input.mailboxId, input.listKey), (item) => item),
  },
};

const actionDefinitions = {
  "draft.create": {
    title: "Create draft",
    description: "Create an idempotent editable mail draft. Inline attachments are limited to ten files and one MiB each.",
    input: c.DraftCreateInputSchema,
    data: c.DraftDataSchema,
    destructive: false, openWorld: false, approval: "once", idempotency: "required", target: { type: "mailbox", inputField: "mailboxId" },
    run: async (input: z.output<typeof c.DraftCreateInputSchema>, context: CapabilityExecutionContext) => {
      const key = requireIdempotencyKey(context);
      if (!key.ok) return key;
      const totalBytes = input.attachments.reduce((sum, attachment) => sum + Buffer.byteLength(attachment.base64, "base64"), 0);
      if (totalBytes > 5 * 1024 * 1024) return fail(err.badInput("Inline attachments exceed the five MiB request limit"));
      if (input.attachments.some((attachment) => Buffer.byteLength(attachment.base64, "base64") > 1024 * 1024)) return fail(err.badInput("An inline attachment exceeds one MiB"));
      const draftContent = { senderIdentityId: input.senderIdentityId, to: input.to, cc: input.cc, bcc: input.bcc, subject: input.subject, body: input.body, format: input.format, priority: input.priority, requestDeliveryReceipt: input.requestDeliveryReceipt, requestReadReceipt: input.requestReadReceipt };
      const origin = { kind: "compose" as const, input: { ...draftContent, intent: input.intent, conversationId: input.conversationId, sourceMessageId: input.sourceMessageId, includeSourceAttachments: input.includeSourceAttachments } };
      let result = await drafts.materializeDraftSeed({ context: requestContext(context), mailboxId: input.mailboxId, input: { idempotencyKey: stableUuid(key.data), origin, draft: draftContent } });
      if (!result.ok) return result;
      for (const attachment of input.attachments) {
        const bytes = Buffer.from(attachment.base64, "base64");
        const hash = createHash("sha256").update(bytes).digest("hex");
        if (result.data.attachments.some((existing) => existing.filename === attachment.filename && existing.contentHash === hash)) continue;
        const upload = await draftUploads.uploadDraftAttachmentStream({ context: requestContext(context), mailboxId: input.mailboxId, draftId: result.data.id, expectedRevision: result.data.revision, filename: attachment.filename, contentType: attachment.contentType, byteLength: bytes.byteLength, stream: Readable.from(bytes) });
        if (!upload.ok) return upload;
        result = upload;
      }
      return ok({
        data: mapDraft(result.data),
        refs: [{ type: "mail.draft", id: result.data.id }],
        links: [{ rel: "edit" as const, href: `/app/mail/${input.mailboxId}/compose/${result.data.id}` }],
      });
    },
  },
  "draft.update": {
    title: "Update draft", description: "Replace editable draft content using an optimistic revision.", input: c.DraftUpdateInputSchema, data: c.DraftDataSchema,
    destructive: false, openWorld: false, approval: "once", idempotency: "none", target: { type: "draft", inputField: "draftId" },
    run: async (input: z.output<typeof c.DraftUpdateInputSchema>, context: CapabilityExecutionContext) => mapResult(await drafts.updateDraft({ context: requestContext(context), mailboxId: input.mailboxId, draftId: input.draftId, expectedRevision: input.expectedRevision, input: input.draft }), mapDraft),
  },
  "draft.discard": {
    title: "Discard draft", description: "Discard one user draft using an optimistic revision.", input: c.DraftDiscardInputSchema, data: c.DeletedDataSchema,
    destructive: true, openWorld: false, approval: "always", idempotency: "none", target: { type: "draft", inputField: "draftId" },
    run: async (input: z.output<typeof c.DraftDiscardInputSchema>, context: CapabilityExecutionContext) => mapResult(await drafts.discardDraft({ context: requestContext(context), ...input }), () => ({ deleted: true as const })),
  },
  "draft.attachment.add": {
    title: "Add draft attachment", description: "Add one bounded inline attachment to a draft.", input: c.DraftAttachmentAddInputSchema, data: c.DraftDataSchema,
    destructive: false, openWorld: false, approval: "once", idempotency: "none", target: { type: "draft", inputField: "draftId" },
    run: async (input: z.output<typeof c.DraftAttachmentAddInputSchema>, context: CapabilityExecutionContext) => {
      const bytes = Buffer.from(input.attachment.base64, "base64");
      if (bytes.byteLength > 1024 * 1024) return fail(err.badInput("Inline attachment exceeds one MiB"));
      return mapResult(await draftUploads.uploadDraftAttachmentStream({ context: requestContext(context), mailboxId: input.mailboxId, draftId: input.draftId, expectedRevision: input.expectedRevision, filename: input.attachment.filename, contentType: input.attachment.contentType, byteLength: bytes.byteLength, stream: Readable.from(bytes) }), mapDraft);
    },
  },
  "draft.attachment.remove": {
    title: "Remove draft attachment", description: "Remove one attachment using an optimistic draft revision.", input: c.DraftAttachmentRemoveInputSchema, data: c.DraftDataSchema,
    destructive: true, openWorld: false, approval: "once", idempotency: "none", target: { type: "draft", inputField: "draftId" },
    run: async (input: z.output<typeof c.DraftAttachmentRemoveInputSchema>, context: CapabilityExecutionContext) => mapResult(await drafts.removeDraftAttachment({ context: requestContext(context), ...input }), mapDraft),
  },
  "draft.send": {
    title: "Send draft", description: "Queue a reviewed draft for immediate or scheduled external delivery.", input: c.DraftSendInputSchema, data: c.DraftSendDataSchema,
    destructive: false, openWorld: true, approval: "always", idempotency: "required", target: { type: "draft", inputField: "draftId" },
    run: async (input: z.output<typeof c.DraftSendInputSchema>, context: CapabilityExecutionContext) => {
      const key = requireIdempotencyKey(context);
      if (!key.ok) return key;
      const result = await commands.createActorCommand({ context: requestContext(context), mailboxId: input.mailboxId, input: { kind: "send", draftId: input.draftId, expectedDraftRevision: input.expectedRevision, senderIdentityId: input.senderIdentityId, scheduledAt: input.scheduledAt, undoSeconds: input.undoSeconds, safetyApproval: input.safetyApproval, idempotencyKey: key.data } });
      if (!result.ok) return result;
      const draft = await drafts.getDraft(requestContext(context), input.mailboxId, input.draftId);
      return ok({ data: { commandId: result.data.id, state: result.data.state, draftId: input.draftId, conversationId: draft.ok ? draft.data.conversationId : null }, refs: [{ type: "mail.draft", id: input.draftId }] });
    },
  },
  "delivery.cancel": {
    title: "Cancel delivery", description: "Cancel a scheduled or undo-window delivery and either restore or discard its draft.", input: c.DeliveryCancelInputSchema, data: c.DeliveryCancelDataSchema,
    destructive: true, openWorld: false, approval: "always", idempotency: "none", target: { type: "delivery", inputField: "deliveryId" },
    run: async (input: z.output<typeof c.DeliveryCancelInputSchema>, context: CapabilityExecutionContext) => mapResult(await scheduledSends.cancelScheduledSend({ context: requestContext(context), mailboxId: input.mailboxId, scheduledSendId: input.deliveryId, input: { disposition: input.disposition } }), (item) => item),
  },
  "conversation.mark": {
    title: "Mark conversations", description: "Mark up to 100 conversations read or flagged in their source folder.", input: c.ConversationMarkInputSchema, data: c.ConversationMutationDataSchema,
    destructive: false, openWorld: false, approval: "once", idempotency: "required",
    run: async (input: z.output<typeof c.ConversationMarkInputSchema>, context: CapabilityExecutionContext) => {
      const key = requireIdempotencyKey(context); if (!key.ok) return key;
      const data = [];
      for (const target of input.targets) {
        const addFlags: Array<"seen" | "flagged"> = [];
        const removeFlags: Array<"seen" | "flagged"> = [];
        if (input.read !== undefined) (input.read ? addFlags : removeFlags).push("seen");
        if (input.flagged !== undefined) (input.flagged ? addFlags : removeFlags).push("flagged");
        const result = await triage.createConversationTriageCommands({ context: requestContext(context), mailboxId: input.mailboxId, conversationId: target.conversationId, input: { kind: "change_state", sourceFolderId: target.sourceFolderId, change: { addFlags, removeFlags, addKeywords: [], removeKeywords: [] }, idempotencyKey: `${key.data}:${target.conversationId}` } });
        if (!result.ok) return result;
        data.push({
          conversationId: target.conversationId,
          correlationId: result.data.correlationId,
          commands: result.data.commands.map((command) => ({ id: command.id, state: command.state })),
        });
      }
      return ok({ data });
    },
  },
  "conversation.move": {
    title: "Move conversations", description: "Move up to 100 conversations to a standard role or an explicit folder.", input: c.ConversationMoveInputSchema, data: c.ConversationMutationDataSchema,
    destructive: true, openWorld: false, approval: "once", idempotency: "required",
    run: async (input: z.output<typeof c.ConversationMoveInputSchema>, context: CapabilityExecutionContext) => {
      const key = requireIdempotencyKey(context); if (!key.ok) return key;
      const data = [];
      for (const target of input.targets) {
        const move = input.destination.kind === "role" ? { kind: "move_to_role" as const, sourceFolderId: target.sourceFolderId, role: input.destination.role } : { kind: "move_to_folder" as const, sourceFolderId: target.sourceFolderId, destinationFolderId: input.destination.folderId };
        const result = await triage.createConversationTriageCommands({ context: requestContext(context), mailboxId: input.mailboxId, conversationId: target.conversationId, input: { ...move, idempotencyKey: `${key.data}:${target.conversationId}` } });
        if (!result.ok) return result;
        data.push({
          conversationId: target.conversationId,
          correlationId: result.data.correlationId,
          commands: result.data.commands.map((command) => ({ id: command.id, state: command.state })),
        });
      }
      return ok({ data });
    },
  },
  "conversation.tag.update": {
    title: "Update conversation tags", description: "Add and remove Cloud-local tags with optimistic concurrency.", input: c.ConversationTagUpdateInputSchema, data: c.ConversationTagDataSchema,
    destructive: false, openWorld: false, approval: "once", idempotency: "none", target: { type: "conversation", inputField: "conversationId" },
    run: async (input: z.output<typeof c.ConversationTagUpdateInputSchema>, context: CapabilityExecutionContext) => {
      const current = await localTags.getConversationLocalTags({ context: requestContext(context), mailboxId: input.mailboxId, conversationId: input.conversationId });
      if (!current.ok) return current;
      const next = new Set(current.data.tags.map((tag) => tag.id));
      for (const id of input.addTagIds) next.add(id); for (const id of input.removeTagIds) next.delete(id);
      return mapResult(await localTags.setConversationLocalTags({ context: requestContext(context), mailboxId: input.mailboxId, conversationId: input.conversationId, input: { expectedRevision: input.expectedRevision, tagIds: [...next] } }), (item) => item);
    },
  },
  "conversation.collaboration.update": {
    title: "Update collaboration", description: "Assign, snooze, or change the work status of a conversation.", input: c.CollaborationUpdateInputSchema, data: c.CollaborationDataSchema,
    destructive: false, openWorld: false, approval: "once", idempotency: "none", target: { type: "conversation", inputField: "conversationId" },
    run: async (input: z.output<typeof c.CollaborationUpdateInputSchema>, context: CapabilityExecutionContext) => mapResult(await collaboration.updateConversationCollaboration({ context: requestContext(context), mailboxId: input.mailboxId, conversationId: input.conversationId, input: { expectedRevision: input.expectedRevision, assigneeUserId: input.assigneeUserId, workStatus: input.workStatus, snoozedUntil: input.snoozedUntil } }), (item) => item),
  },
  "conversation.reminder.set": {
    title: "Set personal reminder",
    description: "Create or reschedule the current user's personal conversation reminder.",
    input: c.ReminderSetInputSchema,
    data: c.ReminderDataSchema,
    destructive: false,
    openWorld: false,
    approval: "once",
    idempotency: "none",
    target: { type: "conversation", inputField: "conversationId" },
    run: async (input: z.output<typeof c.ReminderSetInputSchema>, context: CapabilityExecutionContext) =>
      mapResult(
        await reminders.setConversationReminder({
          context: requestContext(context),
          mailboxId: input.mailboxId,
          conversationId: input.conversationId,
          input: { dueAt: input.dueAt, expectedRevision: input.expectedRevision },
        }),
        (item) => item,
      ),
  },
  "conversation.reminder.cancel": {
    title: "Cancel personal reminder",
    description: "Cancel the current user's pending conversation reminder.",
    input: c.ReminderCancelInputSchema,
    data: c.ReminderDataSchema,
    destructive: true,
    openWorld: false,
    approval: "once",
    idempotency: "none",
    target: { type: "conversation", inputField: "conversationId" },
    run: async (input: z.output<typeof c.ReminderCancelInputSchema>, context: CapabilityExecutionContext) =>
      mapResult(
        await reminders.cancelConversationReminder({
          context: requestContext(context),
          mailboxId: input.mailboxId,
          conversationId: input.conversationId,
          input: { expectedRevision: input.expectedRevision },
        }),
        (item) => item,
      ),
  },
  "conversation.comment.create": {
    title: "Create internal comment", description: "Add an internal team comment to a conversation.", input: c.CommentCreateInputSchema, data: c.CommentDataSchema,
    destructive: false, openWorld: false, approval: "once", idempotency: "none", target: { type: "conversation", inputField: "conversationId" },
    run: async (input: z.output<typeof c.CommentCreateInputSchema>, context: CapabilityExecutionContext) => mapResult(await collaboration.createConversationComment({ context: requestContext(context), mailboxId: input.mailboxId, conversationId: input.conversationId, input: { body: input.body, parentCommentId: input.parentCommentId, referencedMessageId: input.referencedMessageId } }), (item) => item),
  },
  "conversation.comment.update": {
    title: "Update internal comment", description: "Edit an owned internal comment using an optimistic revision.", input: c.CommentUpdateInputSchema, data: c.CommentDataSchema,
    destructive: false, openWorld: false, approval: "once", idempotency: "none", target: { type: "comment", inputField: "commentId" },
    run: async (input: z.output<typeof c.CommentUpdateInputSchema>, context: CapabilityExecutionContext) => mapResult(await collaboration.updateConversationComment({ context: requestContext(context), mailboxId: input.mailboxId, conversationId: input.conversationId, commentId: input.commentId, input: { expectedRevision: input.expectedRevision, body: input.body } }), (item) => item),
  },
  "conversation.comment.delete": {
    title: "Delete internal comment", description: "Soft-delete an internal comment using an optimistic revision.", input: c.CommentDeleteInputSchema, data: c.CommentDataSchema,
    destructive: true, openWorld: false, approval: "always", idempotency: "none", target: { type: "comment", inputField: "commentId" },
    run: async (input: z.output<typeof c.CommentDeleteInputSchema>, context: CapabilityExecutionContext) => mapResult(await collaboration.deleteConversationComment({ context: requestContext(context), mailboxId: input.mailboxId, conversationId: input.conversationId, commentId: input.commentId, input: { expectedRevision: input.expectedRevision } }), (item) => item),
  },
  "mailbox.tag.create": {
    title: "Create mailbox tag", description: "Create a reusable Cloud-local mailbox tag.", input: c.TagCreateInputSchema, data: c.TagDataSchema,
    destructive: false, openWorld: false, approval: "once", idempotency: "none", target: { type: "mailbox", inputField: "mailboxId" },
    run: async (input: z.output<typeof c.TagCreateInputSchema>, context: CapabilityExecutionContext) => mapResult(await localTags.createLocalTag({ context: requestContext(context), mailboxId: input.mailboxId, input: { name: input.name, color: input.color } }), (item) => item),
  },
  "mailbox.tag.update": {
    title: "Update mailbox tag", description: "Rename or recolor a mailbox tag using an optimistic revision.", input: c.TagUpdateInputSchema, data: c.TagDataSchema,
    destructive: false, openWorld: false, approval: "once", idempotency: "none", target: { type: "tag", inputField: "tagId" },
    run: async (input: z.output<typeof c.TagUpdateInputSchema>, context: CapabilityExecutionContext) => mapResult(await localTags.updateLocalTag({ context: requestContext(context), mailboxId: input.mailboxId, tagId: input.tagId, input: { expectedRevision: input.expectedRevision, name: input.name, color: input.color } }), (item) => item),
  },
  "mailbox.tag.delete": {
    title: "Delete mailbox tag", description: "Delete a mailbox tag and remove it from conversations.", input: c.TagDeleteInputSchema, data: c.DeletedDataSchema,
    destructive: true, openWorld: false, approval: "always", idempotency: "none", target: { type: "tag", inputField: "tagId" },
    run: async (input: z.output<typeof c.TagDeleteInputSchema>, context: CapabilityExecutionContext) => mapResult(await localTags.deleteLocalTag({ context: requestContext(context), mailboxId: input.mailboxId, tagId: input.tagId, input: { expectedRevision: input.expectedRevision } }), () => ({ deleted: true as const })),
  },
  "mailing-list.unsubscribe": {
    title: "Unsubscribe from mailing list", description: "Request standards-based one-click unsubscribe after confirming the current advertised endpoint.", input: c.SubscriptionUnsubscribeInputSchema, data: c.SubscriptionUnsubscribeDataSchema,
    destructive: true, openWorld: true, approval: "always", idempotency: "required", target: { type: "mailing-list", inputField: "listKey" },
    run: async (input: z.output<typeof c.SubscriptionUnsubscribeInputSchema>, context: CapabilityExecutionContext) => mapResult(await listSubscriptions.requestUnsubscribe({ context: requestContext(context), mailboxId: input.mailboxId, input: { listKey: input.listKey, href: input.href } }), (item) => item),
  },
} as const;

export const mailCapabilities = defineCapabilities({
  version: 1,
  types: {
    mailbox: { title: "Mailbox", description: "A mailbox the actor may access.", icon: "ti ti-inbox" },
    "sender-identity": { title: "Sender identity", description: "A From identity configured for a mailbox.", icon: "ti ti-user-send" },
    folder: { title: "Mail folder", description: "A selectable provider mail folder.", icon: "ti ti-folder" },
    conversation: { title: "Mail conversation", description: "A grouped mail conversation with collaboration state.", icon: "ti ti-messages" },
    message: { title: "Mail message", description: "One message in an accessible mailbox.", icon: "ti ti-mail" },
    attachment: { title: "Mail attachment", description: "Bounded metadata for a message or draft attachment.", icon: "ti ti-paperclip" },
    draft: { title: "Mail draft", description: "An editable outgoing message.", icon: "ti ti-mail-pencil" },
    tag: { title: "Mail tag", description: "A Cloud-local collaboration tag.", icon: "ti ti-tag" },
    comment: { title: "Mail comment", description: "An internal conversation comment.", icon: "ti ti-message" },
    reminder: { title: "Mail reminder", description: "A user's personal reminder for a conversation.", icon: "ti ti-bell" },
    delivery: { title: "Mail delivery", description: "A queued, undo-window, or scheduled delivery.", icon: "ti ti-clock-send" },
    "mailing-list": { title: "Mailing list", description: "A mailing list detected from standards-based headers.", icon: "ti ti-mail-forward" },
  },
  queries: queryDefinitions,
  actions: actionDefinitions,
});
