import { err, fail, ok } from "@k2b/stdlib";
import { type AiConversation, type AiStoredMessage, aiConversationStore } from "@valentinkolb/cloud/ai";
import { type CloudResourceView, capabilityPage, defineCapabilities, UniversalSearchDataSchema } from "@valentinkolb/cloud/contracts";
import { z } from "zod";

const ASSISTANT_APP_ID = "assistant";
const MAX_MESSAGE_TEXT_CHARS = 8_000;

const ChatSearchInputSchema = z
  .object({
    query: z.string().trim().max(500).default("").describe("Words to match in chat titles, descriptions, or keywords."),
    archived: z.boolean().default(false).describe("Search archived chats instead of active chats."),
    limit: z.number().int().min(1).max(20).default(10).describe("Maximum number of chats to return."),
  })
  .strict();

const ChatReadInputSchema = z
  .object({
    id: z.uuid().describe("Stable Assistant chat ID."),
    cursor: z
      .string()
      .regex(/^[1-9]\d{0,9}$/)
      .optional()
      .describe("Opaque cursor returned by the previous chat.read page."),
    limit: z.number().int().min(1).max(20).default(20).describe("Maximum number of message positions to read."),
  })
  .strict();

const ChatReadDataSchema = z
  .object({
    chat: z
      .object({
        id: z.uuid(),
        title: z.string().min(1).max(120),
        description: z.string().max(2_000),
        status: z.enum(["idle", "queued", "running", "needs_attention", "failed"]),
        archived: z.boolean(),
        createdAt: z.string(),
        updatedAt: z.string(),
      })
      .strict(),
    messages: z
      .array(
        z
          .object({
            id: z.uuid(),
            seq: z.number().int().min(1),
            role: z.enum(["user", "assistant", "summary"]),
            text: z.string().min(1).max(MAX_MESSAGE_TEXT_CHARS),
            truncated: z.boolean(),
            createdAt: z.string(),
          })
          .strict(),
      )
      .max(40),
  })
  .strict();

const chatHref = (chatId: string): string => `/app/assistant?conversation=${encodeURIComponent(chatId)}`;

const toResourceView = (chat: AiConversation): CloudResourceView => ({
  ref: { type: "assistant.chat", id: chat.id },
  title: chat.title,
  ...(chat.description.trim() ? { preview: chat.description } : {}),
  ...(chat.icon.trim() ? { icon: chat.icon } : {}),
  priority: chat.pinnedAt ? 8 : 6,
  metadata: [
    { label: "Status", value: chat.runStatus },
    { label: "Updated", value: chat.updatedAt },
  ],
  links: [{ rel: "open", href: chatHref(chat.id) }],
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
    id: stored.id,
    seq: stored.seq,
    role: stored.kind === "summary" ? ("summary" as const) : message.role,
    text: text.slice(0, MAX_MESSAGE_TEXT_CHARS),
    truncated: text.length > MAX_MESSAGE_TEXT_CHARS,
    createdAt: stored.createdAt,
  };
};

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
    "chat.search": {
      title: "Search Assistant chats",
      description: "Find the current user's Assistant chats by title, description, or indexed keywords and return links that open them.",
      input: ChatSearchInputSchema,
      data: UniversalSearchDataSchema,
      openWorld: false,
      async run(input, context) {
        if (!context.user) return fail(err.forbidden("Assistant chats require a user-backed actor"));
        const chats = await aiConversationStore.listConversations({
          appId: ASSISTANT_APP_ID,
          ownerUserId: context.user.id,
          search: input.query || undefined,
          archived: input.archived,
          limit: input.limit,
        });
        return ok({ data: chats.map(toResourceView) });
      },
    },
    "chat.read": {
      title: "Read an Assistant chat",
      description:
        "Read one page of visible user and assistant text from a current user's Assistant chat. Tool results and model thinking are not returned.",
      input: ChatReadInputSchema,
      data: ChatReadDataSchema,
      openWorld: false,
      async run(input, context) {
        if (!context.user) return fail(err.forbidden("Assistant chats require a user-backed actor"));
        const chat = await aiConversationStore.getConversation({
          conversationId: input.id,
          appId: ASSISTANT_APP_ID,
          ownerUserId: context.user.id,
        });
        if (!chat) return fail(err.notFound("Chat"));

        const beforeSeq = input.cursor === undefined ? undefined : Number(input.cursor);
        if (beforeSeq !== undefined && (!Number.isSafeInteger(beforeSeq) || beforeSeq <= 0)) return fail(err.badInput("Invalid cursor"));
        const page = await aiConversationStore.listMessagesPage({
          conversationId: chat.id,
          beforeSeq,
          limit: input.limit,
        });
        const oldestSeq = page.messages[0]?.seq;
        return ok({
          data: {
            chat: {
              id: chat.id,
              title: chat.title,
              description: chat.description,
              status: chat.runStatus,
              archived: chat.archivedAt !== null,
              createdAt: chat.createdAt,
              updatedAt: chat.updatedAt,
            },
            messages: page.messages.flatMap((message) => {
              const visible = visibleMessage(message);
              return visible ? [visible] : [];
            }),
          },
          refs: [{ type: "assistant.chat", id: chat.id }],
          links: [{ rel: "open", href: chatHref(chat.id) }],
          page: capabilityPage(page.hasMore && oldestSeq !== undefined ? String(oldestSeq) : undefined),
        });
      },
    },
  },
});
