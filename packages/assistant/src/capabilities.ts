import { err, fail, ok } from "@k2b/stdlib";
import {
  AI_SHORT_ID_PATTERN,
  type AiConversation,
  type AiConversationResourceRef,
  type AiStoredMessage,
  aiCapabilityToolName,
  aiConversationStore,
  isConversationResourceCursor,
} from "@valentinkolb/cloud/ai";
import {
  CloudResourceRefSchema,
  type CloudResourceView,
  capabilityPage,
  defineCapabilities,
  UniversalSearchDataSchema,
} from "@valentinkolb/cloud/contracts";
import { z } from "zod";
import { deliverPendingAssistantMessages } from "./inter-chat-messages";

const ASSISTANT_APP_ID = "assistant";
const MAX_MESSAGE_TEXT_CHARS = 8_000;
const ChatIdSchema = z.string().regex(AI_SHORT_ID_PATTERN).describe("Readable six-character Assistant chat ID.");
const CursorSchema = z
  .string()
  .regex(/^[1-9]\d*$/)
  .optional()
  .describe("Numeric cursor returned by the previous message page.");
const resourceCursorSchema = (scope: "conversation" | "user") =>
  z
    .string()
    .min(1)
    .max(2_048)
    .refine((value) => isConversationResourceCursor(value, scope), "Invalid resource cursor")
    .optional()
    .describe("Opaque cursor returned by the previous resource page.");
const CHAT_MESSAGE_TOOL_NAME = aiCapabilityToolName(ASSISTANT_APP_ID, "action", "chat.message");

const ChatsSearchInputSchema = z
  .object({
    query: z.string().trim().max(500).default("").describe("Words to match in chat titles, summaries, or visible messages."),
    refs: z
      .array(CloudResourceRefSchema)
      .max(10)
      .optional()
      .describe("Require chats to contain every exact structured Cloud resource ref."),
    archived: z.boolean().default(false).describe("Search archived chats instead of active chats."),
    limit: z.number().int().min(1).max(20).default(10).describe("Maximum number of matching chats to return."),
  })
  .strict();

const ChatPageInputSchema = z
  .object({
    chatId: ChatIdSchema,
    cursor: CursorSchema,
    limit: z.number().int().min(1).max(20).default(20).describe("Maximum number of visible messages to return."),
  })
  .strict();

const ChatReadInputSchema = z
  .object({
    id: ChatIdSchema.describe("Readable ID of the owned chat to read."),
    cursor: CursorSchema,
    limit: z.number().int().min(1).max(20).default(20).describe("Maximum number of visible messages to return."),
  })
  .strict();

const ChatSearchInputSchema = ChatPageInputSchema.extend({
  query: z.string().trim().min(1).max(500).describe("Words to match in visible messages from this chat."),
}).strict();

const ChatResourcesInputSchema = z
  .object({
    chatId: ChatIdSchema,
    query: z.string().trim().max(500).optional().describe("Optional title, type, or readable resource ID filter."),
    cursor: resourceCursorSchema("conversation"),
    limit: z.number().int().min(1).max(50).default(20).describe("Maximum number of resource refs to return."),
  })
  .strict();

const ChatsResourcesInputSchema = ChatResourcesInputSchema.omit({ chatId: true, cursor: true })
  .extend({ cursor: resourceCursorSchema("user") })
  .strict();

const ChatSummarySchema = z
  .object({
    id: ChatIdSchema,
    title: z.string().min(1).max(120),
    description: z.string().max(2_000),
    status: z.enum(["idle", "queued", "running", "needs_attention", "failed"]),
    archived: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

const VisibleMessageSchema = z
  .object({
    id: ChatIdSchema,
    seq: z.number().int().min(1),
    role: z.enum(["user", "assistant", "summary"]),
    text: z.string().min(1).max(MAX_MESSAGE_TEXT_CHARS),
    truncated: z.boolean(),
    createdAt: z.string(),
  })
  .strict();

const ChatMessagesDataSchema = z
  .object({
    chat: ChatSummarySchema,
    messages: z.array(VisibleMessageSchema).max(40),
  })
  .strict();

const ResourceDataSchema = z
  .object({
    ref: CloudResourceRefSchema,
    title: z.string().max(500).nullable(),
    preview: z.string().max(2_000).nullable(),
    icon: z.string().max(120).nullable(),
    href: z.string().max(2_048).nullable(),
    firstSeenAt: z.string(),
    lastSeenAt: z.string(),
    sourceTurnId: ChatIdSchema.nullable(),
    sourceCallId: z.string().max(500).nullable(),
  })
  .strict();

const ChatResourcesDataSchema = z.object({ chat: ChatSummarySchema, resources: z.array(ResourceDataSchema).max(50) }).strict();
const ChatsResourcesDataSchema = z
  .array(
    ResourceDataSchema.extend({
      chat: z.object({ id: ChatIdSchema, title: z.string().min(1).max(120), icon: z.string().max(120), updatedAt: z.string() }).strict(),
    }).strict(),
  )
  .max(50);

const ChatMessageInputSchema = z
  .object({
    chatId: ChatIdSchema.describe("Readable ID of the owned target chat."),
    text: z.string().trim().min(1).max(10_000).describe("Exact message to send to the target chat."),
  })
  .strict();
const ChatMessageDataSchema = z
  .object({
    id: ChatIdSchema,
    status: z.enum(["queued", "delivered"]),
    targetChatId: ChatIdSchema,
  })
  .strict();

const chatHref = (chatId: string): string => `/app/assistant?conversation=${encodeURIComponent(chatId)}`;

const chatSummary = (chat: AiConversation) => ({
  id: chat.shortId,
  title: chat.title,
  description: chat.description,
  status: chat.runStatus,
  archived: chat.archivedAt !== null,
  createdAt: chat.createdAt,
  updatedAt: chat.updatedAt,
});

const toResourceView = (chat: AiConversation): CloudResourceView => ({
  ref: { type: "assistant.chat", id: chat.shortId },
  title: chat.title,
  ...(chat.description.trim() ? { preview: chat.description } : {}),
  ...(chat.icon.trim() ? { icon: chat.icon } : {}),
  priority: chat.pinnedAt ? 8 : 6,
  metadata: [
    { label: "Status", value: chat.runStatus },
    { label: "Updated", value: chat.updatedAt },
  ],
  links: [{ rel: "open", href: chatHref(chat.shortId) }],
});

const visibleMessage = (stored: AiStoredMessage) => {
  const message = stored.message;
  if (message.role === "tool_result") return null;
  const text = message.content
    .flatMap((part) => {
      if (typeof part === "string") return [part];
      return part.type === "text" ? [part.text] : [];
    })
    .join("")
    .trim();
  if (!text) return null;
  return {
    id: stored.shortId,
    seq: stored.seq,
    role: stored.kind === "summary" ? ("summary" as const) : message.role,
    text: text.slice(0, MAX_MESSAGE_TEXT_CHARS),
    truncated: text.length > MAX_MESSAGE_TEXT_CHARS,
    createdAt: stored.createdAt,
  };
};

const resourceData = (resource: AiConversationResourceRef) => ({
  ref: resource.ref,
  title: resource.title,
  preview: resource.preview,
  icon: resource.icon,
  href: resource.href,
  firstSeenAt: resource.firstSeenAt,
  lastSeenAt: resource.lastSeenAt,
  sourceTurnId: resource.sourceTurnId,
  sourceCallId: resource.sourceCallId,
});

const ownedChat = async (chatId: string, userId: string, archived = false): Promise<AiConversation | null> =>
  aiConversationStore.getConversationByShortId({ shortId: chatId, appId: ASSISTANT_APP_ID, ownerUserId: userId, archived });
const readableOwnedChat = async (chatId: string, userId: string): Promise<AiConversation | null> =>
  (await ownedChat(chatId, userId)) ?? ownedChat(chatId, userId, true);

export const assistantCapabilities = defineCapabilities({
  protocolVersion: 1,
  types: {
    chat: {
      title: "Assistant chat",
      description: "A private Assistant conversation owned by the current user.",
      icon: "ti ti-message-chatbot",
      reader: "chat.read",
    },
  },
  queries: {
    "chats.search": {
      title: "Search Assistant chats",
      description: "Find the current user's Assistant chats by text and exact Cloud resource refs.",
      input: ChatsSearchInputSchema,
      data: UniversalSearchDataSchema,
      openWorld: false,
      async run(input, context) {
        if (!context.user) return fail(err.forbidden("Assistant chats require a user-backed actor"));
        const chats = await aiConversationStore.listConversations({
          appId: ASSISTANT_APP_ID,
          ownerUserId: context.user.id,
          search: input.query || undefined,
          refs: input.refs,
          archived: input.archived,
          limit: input.limit,
        });
        return ok({ data: chats.map(toResourceView) });
      },
    },
    "chat.read": {
      title: "Read an Assistant chat",
      description: "Read one page of visible user and assistant text from one explicitly identified owned chat.",
      input: ChatReadInputSchema,
      data: ChatMessagesDataSchema,
      openWorld: false,
      async run(input, context) {
        if (!context.user) return fail(err.forbidden("Assistant chats require a user-backed actor"));
        const chat = await readableOwnedChat(input.id, context.user.id);
        if (!chat) return fail(err.notFound("Chat"));
        const beforeSeq = input.cursor === undefined ? undefined : Number(input.cursor);
        if (beforeSeq !== undefined && (!Number.isSafeInteger(beforeSeq) || beforeSeq <= 0)) return fail(err.badInput("Invalid cursor"));
        const page = await aiConversationStore.listMessagesPage({ conversationId: chat.id, beforeSeq, limit: input.limit });
        const oldestSeq = page.messages[0]?.seq;
        return ok({
          data: { chat: chatSummary(chat), messages: page.messages.flatMap((message) => visibleMessage(message) ?? []) },
          refs: [{ type: "assistant.chat", id: chat.shortId }],
          links: [{ rel: "open", href: chatHref(chat.shortId) }],
          page: capabilityPage(page.hasMore && oldestSeq !== undefined ? String(oldestSeq) : undefined),
        });
      },
    },
    "chat.search": {
      title: "Search messages in an Assistant chat",
      description: "Search visible text inside one explicitly identified owned Assistant chat, including compacted history.",
      input: ChatSearchInputSchema,
      data: ChatMessagesDataSchema,
      openWorld: false,
      async run(input, context) {
        if (!context.user) return fail(err.forbidden("Assistant chats require a user-backed actor"));
        const chat = await readableOwnedChat(input.chatId, context.user.id);
        if (!chat) return fail(err.notFound("Chat"));
        const beforeSeq = input.cursor === undefined ? undefined : Number(input.cursor);
        if (beforeSeq !== undefined && (!Number.isSafeInteger(beforeSeq) || beforeSeq <= 0)) return fail(err.badInput("Invalid cursor"));
        const page = await aiConversationStore.searchConversationMessages({
          conversationId: chat.id,
          query: input.query,
          beforeSeq,
          limit: input.limit,
        });
        return ok({
          data: { chat: chatSummary(chat), messages: page.messages.flatMap((message) => visibleMessage(message) ?? []) },
          refs: [{ type: "assistant.chat", id: chat.shortId }],
          links: [{ rel: "open", href: chatHref(chat.shortId) }],
          page: capabilityPage(page.nextCursor),
        });
      },
    },
    "chat.resources": {
      title: "List resources used in an Assistant chat",
      description: "List or search structured Cloud resource refs observed in one explicitly identified owned chat.",
      input: ChatResourcesInputSchema,
      data: ChatResourcesDataSchema,
      openWorld: false,
      async run(input, context) {
        if (!context.user) return fail(err.forbidden("Assistant chats require a user-backed actor"));
        const chat = await readableOwnedChat(input.chatId, context.user.id);
        if (!chat) return fail(err.notFound("Chat"));
        const page = await aiConversationStore.listConversationResources({
          conversationId: chat.id,
          search: input.query,
          before: input.cursor,
          limit: input.limit,
        });
        return ok({
          data: { chat: chatSummary(chat), resources: page.resources.map(resourceData) },
          refs: page.resources.map((resource) => resource.ref),
          links: [{ rel: "open", href: chatHref(chat.shortId) }],
          page: capabilityPage(page.nextCursor),
        });
      },
    },
    "chats.resources": {
      title: "Search resources used across Assistant chats",
      description: "List or search structured Cloud resource refs across the current user's active Assistant chats.",
      input: ChatsResourcesInputSchema,
      data: ChatsResourcesDataSchema,
      openWorld: false,
      async run(input, context) {
        if (!context.user) return fail(err.forbidden("Assistant chats require a user-backed actor"));
        const page = await aiConversationStore.listUserConversationResources({
          appId: ASSISTANT_APP_ID,
          ownerUserId: context.user.id,
          search: input.query,
          before: input.cursor,
          limit: input.limit,
        });
        return ok({
          data: page.resources.map((resource) => ({
            ...resourceData(resource),
            chat: { id: resource.chat.shortId, title: resource.chat.title, icon: resource.chat.icon, updatedAt: resource.chat.updatedAt },
          })),
          refs: page.resources.map((resource) => resource.ref),
          page: capabilityPage(page.nextCursor),
        });
      },
    },
  },
  actions: {
    "chat.message": {
      title: "Message another Assistant chat",
      description: "Queue one attributable message for another owned Assistant chat after reviewing the exact target and text.",
      input: ChatMessageInputSchema,
      data: ChatMessageDataSchema,
      destructive: false,
      openWorld: false,
      idempotency: "required",
      async review(input, context) {
        if (!context.user) return fail(err.forbidden("Assistant chats require a user-backed actor"));
        const target = await ownedChat(input.chatId, context.user.id);
        if (!target) return fail(err.notFound("Chat"));
        return ok({
          message: `Send this message to ${target.title} (${target.shortId}).`,
          details: [
            { label: "Target chat", value: `${target.title} (${target.shortId})` },
            { label: "Message", value: input.text },
          ],
          links: [{ rel: "open", href: chatHref(target.shortId), title: "Open target chat" }],
        });
      },
      async run(input, context) {
        if (!context.user) return fail(err.forbidden("Assistant chats require a user-backed actor"));
        if (!context.idempotencyKey) return fail(err.badInput("Idempotency-Key is required"));
        const origin = await aiConversationStore.getCapabilityInvocationOrigin({
          idempotencyKey: context.idempotencyKey,
          toolName: CHAT_MESSAGE_TOOL_NAME,
        });
        if (!origin) return fail(err.forbidden("Inter-chat messages require an Assistant AI turn"));
        const created = await aiConversationStore.createInterChatMessage({
          appId: ASSISTANT_APP_ID,
          sourceConversationId: origin.conversationId,
          sourceTurnId: origin.turnId,
          sourceCallId: origin.callId,
          targetChatId: input.chatId,
          actorUserId: context.user.id,
          text: input.text,
          idempotencyKey: context.idempotencyKey,
        });
        if (!created.ok) {
          if (created.reason === "same_chat") return fail(err.badInput("Choose another chat"));
          if (created.reason === "recursive")
            return fail(err.forbidden("A turn started by an inter-chat message cannot message another chat"));
          return fail(err.notFound("Chat"));
        }
        if (created.message.status === "failed") return fail(err.conflict("The target chat could not accept the message"));
        const delivery =
          created.message.status === "delivered" ? null : await deliverPendingAssistantMessages(created.message.targetConversationId);
        const status = created.message.status === "delivered" ? "delivered" : (delivery?.get(created.message.id) ?? "queued");
        if (status === "failed") return fail(err.conflict("The target chat could not accept the message"));
        return ok({
          data: { id: created.message.shortId, status, targetChatId: created.message.targetChatId },
          refs: [{ type: "assistant.chat", id: created.message.targetChatId }],
          links: [{ rel: "open", href: chatHref(created.message.targetChatId) }],
        });
      },
    },
  },
});
