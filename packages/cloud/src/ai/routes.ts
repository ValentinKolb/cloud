import { type Context, Hono } from "hono";
import { z } from "zod";
import { type AuthContext, type RequestActor, err, fail, ok, respond, v } from "../server";
import { type AiToolApprovalContext } from "./approvals";
import {
  AiCompactionInputSchema,
  AiCreateConversationInputSchema,
  AiMessageForkInputSchema,
  AiMessageRetryInputSchema,
  AiTurnInputSchema,
  aiInputToUserMessage,
  aiTurnInputToContent,
  toAiActionFailureResponse,
  toAiErrorResponse,
} from "./http";
import { AiTurnActionSchema, abortAiTurn, listPendingAiTurnActions, submitAiChatTurn, submitAiCompaction, submitAiTurnAction } from "./runtime";
import { listAiModels, toPublicAiSettingsState } from "./settings";
import { aiConversationStore } from "./store";
import { createAiConversationStreamResponse, loadAiStreamState } from "./stream";
import type { AiConversation, AiConversationResource, AiModelPolicy, AiTurnToolSource } from "./types";

/** Everything a resolved, authorized request needs to run against the shared runtime. */
export type AiChatRequestContext = {
  actor: RequestActor;
  ownerUserId: string;
  resource?: AiConversationResource;
  toolSource: AiTurnToolSource;
  systemPrompt?: string;
  modelPolicy: AiModelPolicy;
  toolApprovalContext: AiToolApprovalContext;
};

export type AiChatRoutesConfig = {
  appId: string;
  /** Default title for created conversations. */
  defaultTitle?: (ctx: AiChatRequestContext) => string | undefined;
  /** Policy used to list selectable models on /models. */
  modelListPolicy?: AiModelPolicy;
  /** System prompt mutation for retry modes (details/concise). */
  retryInstruction?: (mode: "retry" | "details" | "concise") => string | null;
  /** Authorize the request and produce its run context, or return an error Response. */
  resolveContext: (c: Context<AuthContext>) => Promise<AiChatRequestContext | Response>;
  /** Enable conversation metadata editing + archiving (direct chats). */
  allowConversationManagement?: boolean;
};

const ConversationListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

const ConversationMetadataInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  icon: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).optional(),
});

const notFound = (c: Context<AuthContext>) => respond(c, fail(err.notFound("Conversation")));

const conversationDetail = async (conversation: AiConversation) => {
  const state = await loadAiStreamState(conversation);
  return { conversation, messages: state.messages, activeTurn: state.activeTurn };
};

/**
 * The single AI chat route surface. The Assistant app and every embedded
 * resource chat instantiate this with their own `resolveContext`, so there is
 * exactly one implementation of conversations, turns, streaming, actions,
 * fork/retry, and compaction.
 */
export const createAiChatRoutes = (config: AiChatRoutesConfig) => {
  const loadConversation = async (c: Context<AuthContext>, ctx: AiChatRequestContext): Promise<AiConversation | null> => {
    const conversationId = c.req.param("conversationId");
    if (!conversationId) return null;
    return aiConversationStore.getConversation({
      conversationId,
      appId: config.appId,
      ownerUserId: ctx.ownerUserId,
      resource: ctx.resource,
    });
  };

  return new Hono<AuthContext>()
    .get("/status", async (c) => respond(c, ok(await toPublicAiSettingsState())))
    .get("/models", async (c) => respond(c, ok(await listAiModels(config.modelListPolicy ?? { kind: "selectable", requiredCapabilities: ["streaming"] }))))
    .get("/conversations", v("query", ConversationListQuerySchema), async (c) => {
      const ctx = await config.resolveContext(c);
      if (ctx instanceof Response) return ctx;
      const query = c.req.valid("query");
      return respond(
        c,
        ok(
          await aiConversationStore.listConversations({
            appId: config.appId,
            ownerUserId: ctx.ownerUserId,
            resource: ctx.resource,
            search: query.q,
            limit: query.limit,
          }),
        ),
      );
    })
    .post("/conversations", v("json", AiCreateConversationInputSchema), async (c) => {
      const ctx = await config.resolveContext(c);
      if (ctx instanceof Response) return ctx;
      const body = c.req.valid("json");
      return respond(
        c,
        ok(
          await aiConversationStore.createConversation({
            appId: config.appId,
            ownerUserId: ctx.ownerUserId,
            title: body.title ?? config.defaultTitle?.(ctx),
            resource: ctx.resource,
          }),
        ),
        201,
      );
    })
    .get("/conversations/:conversationId", async (c) => {
      const ctx = await config.resolveContext(c);
      if (ctx instanceof Response) return ctx;
      const conversation = await loadConversation(c, ctx);
      if (!conversation) return notFound(c);
      return respond(c, ok(await conversationDetail(conversation)));
    })
    .patch("/conversations/:conversationId", v("json", ConversationMetadataInputSchema), async (c) => {
      if (!config.allowConversationManagement) return notFound(c);
      const ctx = await config.resolveContext(c);
      if (ctx instanceof Response) return ctx;
      const conversation = await loadConversation(c, ctx);
      if (!conversation) return notFound(c);
      const body = c.req.valid("json");
      const updated = await aiConversationStore.updateConversationMetadata({
        conversationId: conversation.id,
        appId: config.appId,
        ownerUserId: ctx.ownerUserId,
        title: body.title,
        icon: body.icon,
        description: body.description,
      });
      if (!updated) return notFound(c);
      return respond(c, ok(updated));
    })
    .delete("/conversations/:conversationId", async (c) => {
      if (!config.allowConversationManagement) return notFound(c);
      const ctx = await config.resolveContext(c);
      if (ctx instanceof Response) return ctx;
      const conversation = await loadConversation(c, ctx);
      if (!conversation) return notFound(c);
      const archived = await aiConversationStore.archiveConversation({ conversationId: conversation.id, appId: config.appId, ownerUserId: ctx.ownerUserId });
      if (!archived) return notFound(c);
      return respond(c, ok({ ok: true }));
    })
    .post("/conversations/:conversationId/turns", v("json", AiTurnInputSchema), async (c) => {
      const ctx = await config.resolveContext(c);
      if (ctx instanceof Response) return ctx;
      const conversation = await loadConversation(c, ctx);
      if (!conversation) return notFound(c);
      const { input, message } = aiInputToUserMessage(aiTurnInputToContent(c.req.valid("json")));
      const modelProfileId = c.req.valid("json").modelProfileId;
      try {
        const result = await submitAiChatTurn({
          conversationId: conversation.id,
          input,
          userMessage: message,
          actor: ctx.actor,
          requestedModelId: modelProfileId,
          modelPolicy: ctx.modelPolicy,
          systemPrompt: ctx.systemPrompt,
          toolSource: ctx.toolSource,
          toolApprovalContext: ctx.toolApprovalContext,
        });
        return respond(c, ok(result), 201);
      } catch (error) {
        return toAiErrorResponse(c, error);
      }
    })
    .post("/conversations/:conversationId/messages/:messageId/retry", v("json", AiMessageRetryInputSchema), async (c) => {
      const ctx = await config.resolveContext(c);
      if (ctx instanceof Response) return ctx;
      const conversation = await loadConversation(c, ctx);
      if (!conversation) return notFound(c);
      const messageId = c.req.param("messageId");

      const messages = await aiConversationStore.listMessages({ conversationId: conversation.id });
      const target = messages.find((m) => m.id === messageId);
      if (!target || target.kind !== "message" || target.message.role !== "user") {
        return respond(c, fail(err.badInput("Retry requires a user message.")));
      }
      if (target.compactedAt) {
        return respond(c, fail(err.badInput("This message was compacted out of the model context and cannot be retried.")));
      }

      const body = c.req.valid("json");
      const content = body.content?.length ? aiTurnInputToContent({ content: body.content }) : target.message.content;
      const { input, message } = aiInputToUserMessage(content as never);
      const instruction = config.retryInstruction?.(body.mode) ?? null;
      const systemPrompt = [ctx.systemPrompt, instruction].filter(Boolean).join("\n\n") || undefined;

      try {
        const result = await submitAiChatTurn({
          conversationId: conversation.id,
          input,
          userMessage: message,
          actor: ctx.actor,
          requestedModelId: body.modelProfileId,
          modelPolicy: ctx.modelPolicy,
          systemPrompt,
          toolSource: ctx.toolSource,
          toolApprovalContext: ctx.toolApprovalContext,
          truncateFromSeq: target.seq,
        });
        return respond(c, ok(result), 201);
      } catch (error) {
        return toAiErrorResponse(c, error);
      }
    })
    .post("/conversations/:conversationId/messages/:messageId/fork", v("json", AiMessageForkInputSchema), async (c) => {
      const ctx = await config.resolveContext(c);
      if (ctx instanceof Response) return ctx;
      const conversation = await loadConversation(c, ctx);
      if (!conversation) return notFound(c);
      const messageId = c.req.param("messageId");

      const messages = await aiConversationStore.listMessages({ conversationId: conversation.id });
      const target = messages.find((m) => m.id === messageId);
      if (!target) return respond(c, fail(err.notFound("Message")));
      if (target.compactedAt) {
        return respond(c, fail(err.badInput("This message was compacted out of the model context and cannot be forked.")));
      }

      const body = c.req.valid("json");
      const forked = await aiConversationStore.createConversation({
        appId: config.appId,
        ownerUserId: ctx.ownerUserId,
        title: body.title ?? conversation.title,
        icon: conversation.icon,
        description: conversation.description,
        resource: ctx.resource,
      });
      await aiConversationStore.copyMessages({ sourceConversationId: conversation.id, targetConversationId: forked.id, throughSeq: target.seq });
      return respond(c, ok(await conversationDetail(forked)));
    })
    .post("/conversations/:conversationId/compact", v("json", AiCompactionInputSchema), async (c) => {
      const ctx = await config.resolveContext(c);
      if (ctx instanceof Response) return ctx;
      const conversation = await loadConversation(c, ctx);
      if (!conversation) return notFound(c);
      const body = c.req.valid("json");
      try {
        const result = await submitAiCompaction({
          conversationId: conversation.id,
          actor: ctx.actor,
          requestedModelId: body.modelProfileId,
          modelPolicy: ctx.modelPolicy,
        });
        return respond(c, ok(result), 201);
      } catch (error) {
        return toAiErrorResponse(c, error);
      }
    })
    .post("/conversations/:conversationId/turns/:turnId/abort", async (c) => {
      const ctx = await config.resolveContext(c);
      if (ctx instanceof Response) return ctx;
      const conversation = await loadConversation(c, ctx);
      if (!conversation) return notFound(c);
      const turnId = c.req.param("turnId");
      if (!turnId) return notFound(c);
      await abortAiTurn({ conversationId: conversation.id, turnId });
      return respond(c, ok({ ok: true }));
    })
    .post("/conversations/:conversationId/turns/:turnId/actions/:callId", v("json", AiTurnActionSchema), async (c) => {
      const ctx = await config.resolveContext(c);
      if (ctx instanceof Response) return ctx;
      const conversation = await loadConversation(c, ctx);
      if (!conversation) return notFound(c);
      const turnId = c.req.param("turnId");
      const callId = c.req.param("callId");
      if (!turnId || !callId) return notFound(c);
      const result = await submitAiTurnAction({
        conversationId: conversation.id,
        turnId,
        callId,
        action: c.req.valid("json"),
        toolApprovalContext: ctx.toolApprovalContext,
      });
      if (!result.ok) return toAiActionFailureResponse(c, result);
      return respond(c, ok({ ok: true }));
    })
    .get("/conversations/:conversationId/pending-actions/:turnId", async (c) => {
      const ctx = await config.resolveContext(c);
      if (ctx instanceof Response) return ctx;
      const conversation = await loadConversation(c, ctx);
      if (!conversation) return notFound(c);
      const turnId = c.req.param("turnId");
      if (!turnId) return notFound(c);
      return respond(c, ok(await listPendingAiTurnActions({ conversationId: conversation.id, turnId })));
    })
    .get("/conversations/:conversationId/stream", async (c) => {
      const ctx = await config.resolveContext(c);
      if (ctx instanceof Response) return ctx;
      const conversation = await loadConversation(c, ctx);
      if (!conversation) return notFound(c);
      return createAiConversationStreamResponse({ conversation, signal: c.req.raw.signal });
    });
};

export type AiChatRoutes = ReturnType<typeof createAiChatRoutes>;
