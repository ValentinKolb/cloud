import {
  AiApiErrorSchema,
  type AiConversation,
  AiCreateConversationInputSchema,
  AiMessageForkInputSchema,
  AiMessageRetryInputSchema,
  type AiModelPolicy,
  AiReplayQuerySchema,
  AiTurnActionSchema,
  AiTurnInputSchema,
  abortAiTurn,
  aiConversationStore,
  aiTurnInputToContent,
  createAiEventReplayResponse,
  createAiTurnResponse,
  listAiModels,
  listPendingAiTurnActions,
  submitAiTurnAction,
  toAiActionFailureResponse,
  toAiErrorResponse,
  toPublicAiSettingsState,
  validateAiTurnRequest,
} from "@valentinkolb/cloud/ai";
import { type AuthContext, auth, err, fail, jsonResponse, ok, rateLimit, respond, v } from "@valentinkolb/cloud/server";
import { type Context, Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

const ConversationSchema = z.object({
  id: z.string(),
  appId: z.string(),
  title: z.string(),
  resource: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("direct") }),
    z.object({
      kind: z.literal("resource"),
      appId: z.string(),
      resourceType: z.string(),
      resourceId: z.string(),
      title: z.string().optional(),
    }),
  ]),
  createdByUserId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const StoredMessageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  seq: z.number(),
  kind: z.enum(["message", "summary"]),
  message: z.unknown(),
  modelProfileId: z.string().nullable(),
  providerModel: z.string().nullable(),
  usage: z.unknown().nullable(),
  stopReason: z.string().nullable(),
  loopAggregate: z.unknown().nullable(),
  loopDoneReason: z.string().nullable(),
  createdAt: z.string(),
});

const TurnSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  status: z.enum(["running", "completed", "failed", "aborted"]),
  modelProfileId: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  error: z.string().nullable(),
});

const ModelSchema = z.object({
  id: z.string(),
  label: z.string(),
  provider: z.string(),
  model: z.string(),
  capabilities: z.array(z.string()),
  dataBoundary: z.enum(["hosted", "private"]),
  contextWindow: z.number().optional(),
});

const StatusSchema = z.object({
  ok: z.boolean(),
  enabled: z.boolean(),
  defaultModelId: z.string(),
  error: z.unknown().nullable(),
  models: z.array(ModelSchema),
});

const ConversationDetailSchema = z.object({
  conversation: ConversationSchema,
  messages: z.array(StoredMessageSchema),
  activeTurn: TurnSchema.nullable(),
  pendingActions: z.array(
    z.discriminatedUnion("type", [
      z.object({
        type: z.literal("approval_request"),
        turnId: z.string(),
        conversationId: z.string(),
        loopId: z.string().optional(),
        callId: z.string(),
        name: z.string(),
        args: z.unknown(),
        message: z.string().optional(),
        allowAlways: z.boolean(),
      }),
      z.object({
        type: z.literal("frontend_tool"),
        turnId: z.string(),
        conversationId: z.string(),
        loopId: z.string().optional(),
        callId: z.string(),
        name: z.string(),
        args: z.unknown(),
        mode: z.enum(["client", "client_view", "client_interaction"]),
      }),
    ]),
  ),
});

const actorUser = (c: Context<AuthContext>) => {
  const actor = c.get("actor");
  return actor.kind === "user" ? actor.user : actor.delegatedUser;
};

const userId = (c: { get(key: "user"): { id: string } }) => c.get("user").id;

const notFound = (c: Context<AuthContext>) => respond(c, fail(err.notFound("Conversation")));

const ASSISTANT_APP_ID = "assistant";
const ASSISTANT_OPENAPI_TAG = "Assistant";
const ASSISTANT_SYSTEM_PROMPT =
  "You are the general-purpose Assistant app. Help with writing, rewriting, summarizing, explaining, and planning.";

const retryInstruction = (mode: "retry" | "details" | "concise") => {
  if (mode === "details") return "Answer the user's request again with more detail and specificity.";
  if (mode === "concise") return "Answer the user's request again more concisely.";
  return null;
};

const loadAssistantConversation = async (
  c: Context<AuthContext>,
): Promise<{ ok: true; conversation: AiConversation } | { ok: false; response: Awaited<ReturnType<typeof notFound>> }> => {
  const conversationId = c.req.param("conversationId");
  if (!conversationId) return { ok: false, response: await notFound(c) };
  const conversation = await aiConversationStore.getConversation({
    conversationId,
    appId: ASSISTANT_APP_ID,
    ownerUserId: userId(c),
  });
  if (!conversation) return { ok: false, response: await notFound(c) };
  return { ok: true, conversation };
};

const loadAssistantTurnConversation = async (
  c: Context<AuthContext>,
): Promise<{ ok: true; conversation: AiConversation; turnId: string } | { ok: false; response: Awaited<ReturnType<typeof notFound>> }> => {
  const turnId = c.req.param("turnId");
  if (!turnId) return { ok: false, response: await notFound(c) };
  const loaded = await loadAssistantConversation(c);
  if (!loaded.ok) return loaded;
  return { ok: true, conversation: loaded.conversation, turnId };
};

const app = new Hono<AuthContext>()
  .use(rateLimit())
  .use("*", auth.requireRole("authenticated"))
  .use("*", async (c, next) => {
    const user = actorUser(c);
    if (!user) return respond(c, fail(err.forbidden("Assistant requires a user-backed actor")));
    c.set("user", user);
    await next();
  })
  .get(
    "/status",
    describeRoute({
      tags: [ASSISTANT_OPENAPI_TAG],
      summary: "Get AI configuration status",
      responses: { 200: jsonResponse(StatusSchema, "AI status") },
    }),
    async (c) => respond(c, ok(await toPublicAiSettingsState())),
  )
  .get(
    "/models",
    describeRoute({
      tags: [ASSISTANT_OPENAPI_TAG],
      summary: "List selectable assistant models",
      responses: { 200: jsonResponse(z.array(ModelSchema), "Model profiles") },
    }),
    async (c) => respond(c, ok(await listAiModels({ kind: "selectable", requiredCapabilities: ["streaming"] }))),
  )
  .get(
    "/conversations",
    describeRoute({
      tags: [ASSISTANT_OPENAPI_TAG],
      summary: "List conversations",
      responses: { 200: jsonResponse(z.array(ConversationSchema), "Conversations") },
    }),
    async (c) => respond(c, ok(await aiConversationStore.listConversations({ appId: ASSISTANT_APP_ID, ownerUserId: userId(c) }))),
  )
  .post(
    "/conversations",
    describeRoute({
      tags: [ASSISTANT_OPENAPI_TAG],
      summary: "Create a conversation",
      responses: {
        200: jsonResponse(ConversationSchema, "Conversation"),
        400: jsonResponse(AiApiErrorSchema, "Invalid input"),
      },
    }),
    v("json", AiCreateConversationInputSchema),
    async (c) => {
      const body = c.req.valid("json");
      return respond(
        c,
        ok(await aiConversationStore.createConversation({ appId: ASSISTANT_APP_ID, ownerUserId: userId(c), title: body.title })),
        201,
      );
    },
  )
  .get(
    "/conversations/:conversationId",
    describeRoute({
      tags: [ASSISTANT_OPENAPI_TAG],
      summary: "Get conversation history",
      responses: {
        200: jsonResponse(ConversationDetailSchema, "Conversation with messages"),
        404: jsonResponse(AiApiErrorSchema, "Not found"),
      },
    }),
    async (c) => {
      const loaded = await loadAssistantConversation(c);
      if (!loaded.ok) return loaded.response;
      const { conversation } = loaded;
      const messages = await aiConversationStore.listMessages({ conversationId: conversation.id });
      const activeTurn = await aiConversationStore.getRunningTurn({ conversationId: conversation.id });
      const pendingActions = activeTurn ? await listPendingAiTurnActions({ conversationId: conversation.id, turnId: activeTurn.id }) : [];
      return respond(c, ok({ conversation, messages, activeTurn, pendingActions }));
    },
  )
  .post(
    "/conversations/:conversationId/messages/:messageId/fork",
    describeRoute({
      tags: [ASSISTANT_OPENAPI_TAG],
      summary: "Fork an assistant conversation from a message",
      responses: {
        200: jsonResponse(ConversationDetailSchema, "Forked conversation with copied messages"),
        400: jsonResponse(AiApiErrorSchema, "Invalid input"),
        404: jsonResponse(AiApiErrorSchema, "Not found"),
      },
    }),
    v("json", AiMessageForkInputSchema),
    async (c) => {
      const loaded = await loadAssistantConversation(c);
      if (!loaded.ok) return loaded.response;
      const messageId = c.req.param("messageId");
      if (!messageId) return respond(c, fail(err.notFound("Message")));

      const messages = await aiConversationStore.listMessages({ conversationId: loaded.conversation.id });
      const target = messages.find((message) => message.id === messageId);
      if (!target) return respond(c, fail(err.notFound("Message")));

      const body = c.req.valid("json");
      const conversation = await aiConversationStore.createConversation({
        appId: ASSISTANT_APP_ID,
        ownerUserId: userId(c),
        title: body.title ?? loaded.conversation.title,
        resource: loaded.conversation.resource,
      });
      await aiConversationStore.copyMessages({
        sourceConversationId: loaded.conversation.id,
        targetConversationId: conversation.id,
        throughSeq: target.seq,
      });
      return respond(
        c,
        ok({
          conversation,
          messages: await aiConversationStore.listMessages({ conversationId: conversation.id }),
          activeTurn: null,
          pendingActions: [],
        }),
      );
    },
  )
  .post(
    "/conversations/:conversationId/messages/:messageId/retry",
    describeRoute({
      tags: [ASSISTANT_OPENAPI_TAG],
      summary: "Retry a user message in-place as an SSE stream",
      responses: {
        200: { description: "SSE stream" },
        400: jsonResponse(AiApiErrorSchema, "Invalid input"),
        404: jsonResponse(AiApiErrorSchema, "Not found"),
        409: jsonResponse(AiApiErrorSchema, "Running turn or AI not configured"),
      },
    }),
    v("json", AiMessageRetryInputSchema),
    async (c) => {
      const loaded = await loadAssistantConversation(c);
      if (!loaded.ok) return loaded.response;
      const { conversation } = loaded;
      const messageId = c.req.param("messageId");
      if (!messageId) return respond(c, fail(err.notFound("Message")));

      const runningTurn = await aiConversationStore.getRunningTurn({ conversationId: conversation.id });
      if (runningTurn) return respond(c, fail(err.conflict("Running turn")));

      const messages = await aiConversationStore.listMessages({ conversationId: conversation.id });
      const target = messages.find((message) => message.id === messageId);
      if (!target || target.kind !== "message" || target.message.role !== "user") {
        return respond(c, fail(err.badInput("Retry requires a user message.")));
      }

      const body = c.req.valid("json");
      const input = body.content?.length ? body.content : target.message.content;
      const instruction = retryInstruction(body.mode);
      const modelPolicy = { kind: "selectable", requiredCapabilities: ["streaming"] } satisfies AiModelPolicy;

      try {
        await validateAiTurnRequest({
          input,
          requestedModelId: body.modelProfileId,
          modelPolicy,
        });
      } catch (error) {
        return toAiErrorResponse(c, error);
      }

      await aiConversationStore.truncateMessagesFrom({ conversationId: conversation.id, fromSeq: target.seq });

      try {
        return await createAiTurnResponse({
          conversationId: conversation.id,
          input,
          actor: c.get("actor"),
          requestedModelId: body.modelProfileId,
          modelPolicy,
          systemPrompt: instruction ? [ASSISTANT_SYSTEM_PROMPT, instruction].join("\n\n") : ASSISTANT_SYSTEM_PROMPT,
          toolSource: { kind: "default" },
          toolApprovalContext: {
            actorUserId: userId(c),
            appId: ASSISTANT_APP_ID,
            resource: { kind: "direct" },
          },
          signal: c.req.raw.signal,
        });
      } catch (error) {
        return toAiErrorResponse(c, error);
      }
    },
  )
  .post(
    "/conversations/:conversationId/turns",
    describeRoute({
      tags: [ASSISTANT_OPENAPI_TAG],
      summary: "Run an assistant turn as an SSE stream",
      responses: {
        200: { description: "SSE stream" },
        400: jsonResponse(AiApiErrorSchema, "Invalid input"),
        404: jsonResponse(AiApiErrorSchema, "Not found"),
        409: jsonResponse(AiApiErrorSchema, "AI not configured"),
      },
    }),
    v("json", AiTurnInputSchema),
    async (c) => {
      const loaded = await loadAssistantConversation(c);
      if (!loaded.ok) return loaded.response;
      const { conversation } = loaded;

      const body = c.req.valid("json");
      try {
        return await createAiTurnResponse({
          conversationId: conversation.id,
          input: aiTurnInputToContent(body),
          actor: c.get("actor"),
          requestedModelId: body.modelProfileId,
          modelPolicy: { kind: "selectable", requiredCapabilities: ["streaming"] },
          systemPrompt: ASSISTANT_SYSTEM_PROMPT,
          toolSource: { kind: "default" },
          toolApprovalContext: {
            actorUserId: userId(c),
            appId: ASSISTANT_APP_ID,
            resource: { kind: "direct" },
          },
          signal: c.req.raw.signal,
        });
      } catch (error) {
        return toAiErrorResponse(c, error);
      }
    },
  )
  .post(
    "/conversations/:conversationId/turns/:turnId/abort",
    describeRoute({
      tags: [ASSISTANT_OPENAPI_TAG],
      summary: "Abort a running assistant turn",
      responses: {
        200: jsonResponse(z.object({ ok: z.literal(true) }), "Turn aborted"),
        404: jsonResponse(AiApiErrorSchema, "Not found"),
        409: jsonResponse(AiApiErrorSchema, "Turn is not running"),
      },
    }),
    async (c) => {
      const loaded = await loadAssistantTurnConversation(c);
      if (!loaded.ok) return loaded.response;
      const { conversation, turnId } = loaded;

      await abortAiTurn({ conversationId: conversation.id, turnId });
      return respond(c, ok({ ok: true }));
    },
  )
  .post(
    "/conversations/:conversationId/turns/:turnId/actions/:callId",
    describeRoute({
      tags: [ASSISTANT_OPENAPI_TAG],
      summary: "Continue an assistant turn with an approval or frontend tool result",
      responses: {
        200: jsonResponse(z.object({ ok: z.literal(true) }), "Action accepted"),
        400: jsonResponse(AiApiErrorSchema, "Invalid action"),
        404: jsonResponse(AiApiErrorSchema, "Not found"),
        409: jsonResponse(AiApiErrorSchema, "Turn is not awaiting actions"),
      },
    }),
    v("json", AiTurnActionSchema),
    async (c) => {
      const callId = c.req.param("callId");
      if (!callId) return notFound(c);
      const loaded = await loadAssistantTurnConversation(c);
      if (!loaded.ok) return loaded.response;
      const { conversation, turnId } = loaded;

      const result = await submitAiTurnAction({
        conversationId: conversation.id,
        turnId,
        callId,
        action: c.req.valid("json"),
        toolApprovalContext: {
          actorUserId: userId(c),
          appId: ASSISTANT_APP_ID,
          resource: { kind: "direct" },
        },
      });
      if (!result.ok) {
        return toAiActionFailureResponse(c, result);
      }
      return respond(c, ok({ ok: true }));
    },
  )
  .get(
    "/conversations/:conversationId/turns/:turnId/events",
    describeRoute({
      tags: [ASSISTANT_OPENAPI_TAG],
      summary: "Replay or follow turn events from a cursor",
      responses: {
        200: { description: "SSE stream" },
        404: jsonResponse(AiApiErrorSchema, "Not found"),
      },
    }),
    v("query", AiReplayQuerySchema),
    async (c) => {
      const loaded = await loadAssistantTurnConversation(c);
      if (!loaded.ok) return loaded.response;
      const { conversation, turnId } = loaded;

      return createAiEventReplayResponse({
        conversationId: conversation.id,
        turnId,
        after: c.req.valid("query").after ?? c.req.header("Last-Event-ID"),
        signal: c.req.raw.signal,
      });
    },
  );

export default app;
export type ApiType = typeof app;
