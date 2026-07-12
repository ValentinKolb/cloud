import { type Context, Hono } from "hono";
import { z } from "zod";
import { type AuthContext, err, fail, ok, type RequestActor, respond, v } from "../server";
import type { AiToolApprovalContext } from "./approvals";
import { createConfiguredDefaultCloudAiTools } from "./default-tools";
import { AI_FILES_MAX_FILE_BYTES_DEFAULT, aiFileStore, guessAiMediaType, normalizeAiFilePath } from "./files-store";
import {
  AiCompactionInputSchema,
  AiCreateConversationInputSchema,
  AiMessageForkInputSchema,
  AiMessageRetryInputSchema,
  AiSteerInputSchema,
  AiTurnInputSchema,
  aiInputToUserMessage,
  aiTurnInputToContent,
  toAiActionFailureResponse,
  toAiErrorResponse,
} from "./http";
import { aiMaintenanceJobs } from "./maintenance";
import { createCloudAiMemoryTool } from "./memory-tool";
import { AI_USER_INSTRUCTIONS_MAX_CHARS, AI_USER_MEMORY_MAX_CHARS, aiActorUser, aiPrefsUserId, aiUserPrefs } from "./prefs";
import {
  AiTurnActionSchema,
  abortAiTurn,
  listPendingAiTurnActions,
  submitAiChatTurn,
  submitAiCompaction,
  submitAiTurnAction,
} from "./runtime";
import { listAiModels, readAiSettingsState, toPublicAiSettingsState } from "./settings";
import { aiConversationStore } from "./store";
import { createAiConversationStreamResponse, loadAiStreamState } from "./stream";
import { composeAiSystemPrompt } from "./system-prompt";
import { aiToolPromptHints } from "./tools";
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

const MessagesPageQuerySchema = z.object({
  before: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const FilesListQuerySchema = z.object({ prefix: z.string().optional() });
const FilePathQuerySchema = z.object({ path: z.string().min(1) });
const FileWriteSchema = z.object({
  path: z.string().min(1),
  content: z.string().max(12_000_000),
  encoding: z.enum(["utf8", "base64"]).default("utf8"),
});
const FileRenameSchema = z.object({ from: z.string().min(1), to: z.string().min(1) });

const AiUserPrefsInputSchema = z.object({
  instructions: z.string().max(AI_USER_INSTRUCTIONS_MAX_CHARS).optional(),
  memory: z.string().max(AI_USER_MEMORY_MAX_CHARS).optional(),
  memoryEnabled: z.boolean().optional(),
});

const notFound = (c: Context<AuthContext>) => respond(c, fail(err.notFound("Conversation")));

/** Fire-and-forget: remember the model this user actually ran a turn with (preselected for new chats). */
const rememberLastUsedModel = (actor: RequestActor, modelProfileId: string | null | undefined): void => {
  const userId = aiPrefsUserId(actor);
  if (!userId || !modelProfileId) return;
  void aiUserPrefs.update(userId, { lastModelId: modelProfileId }).catch(() => undefined);
};

const conversationDetail = async (conversation: AiConversation) => {
  const [state, timeline] = await Promise.all([
    loadAiStreamState(conversation),
    aiConversationStore.listConversationTimeline({ conversationId: conversation.id }),
  ]);
  return {
    conversation,
    messages: state.messages,
    hasMoreMessages: state.hasMoreMessages ?? false,
    activeTurn: state.activeTurn,
    timeline,
  };
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
    .get("/models", async (c) =>
      respond(c, ok(await listAiModels(config.modelListPolicy ?? { kind: "selectable", requiredCapabilities: ["streaming"] }))),
    )
    .get("/prefs", async (c) => {
      const ctx = await config.resolveContext(c);
      if (ctx instanceof Response) return ctx;
      const userId = aiPrefsUserId(ctx.actor);
      if (!userId) return respond(c, fail(err.forbidden("AI preferences require a user context.")));
      return respond(c, ok(await aiUserPrefs.get(userId)));
    })
    .put("/prefs", v("json", AiUserPrefsInputSchema), async (c) => {
      const ctx = await config.resolveContext(c);
      if (ctx instanceof Response) return ctx;
      const userId = aiPrefsUserId(ctx.actor);
      if (!userId) return respond(c, fail(err.forbidden("AI preferences require a user context.")));
      return respond(c, ok(await aiUserPrefs.update(userId, c.req.valid("json"))));
    })
    .get("/prefs/system-prompt", async (c) => {
      const ctx = await config.resolveContext(c);
      if (ctx instanceof Response) return ctx;
      const user = aiActorUser(ctx.actor);
      if (!user) return respond(c, fail(err.forbidden("AI preferences require a user context.")));

      // Same composition path as the executor, for a fresh chat in this app:
      // prefs + memory apply to the default toolset only.
      const isDefaultToolSource = ctx.toolSource.kind === "default";
      const prefs = isDefaultToolSource ? await aiUserPrefs.get(user.id) : null;
      const memoryEnabled = Boolean(prefs?.memoryEnabled);
      const tools = isDefaultToolSource
        ? [...(await createConfiguredDefaultCloudAiTools()), ...(memoryEnabled ? [createCloudAiMemoryTool()] : [])]
        : [];
      const state = await readAiSettingsState();

      const prompt = composeAiSystemPrompt({
        globalInstructions: state.globalInstructions,
        appPrompt: ctx.systemPrompt,
        user,
        appId: config.appId,
        memoryEnabled,
        toolHints: aiToolPromptHints(tools),
        userInstructions: prefs?.instructions,
        memory: prefs?.memory,
      });
      return respond(c, ok({ prompt, renderedAt: new Date().toISOString() }));
    })
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
    .get("/conversations/:conversationId/messages", v("query", MessagesPageQuerySchema), async (c) => {
      const ctx = await config.resolveContext(c);
      if (ctx instanceof Response) return ctx;
      const conversation = await loadConversation(c, ctx);
      if (!conversation) return notFound(c);
      const query = c.req.valid("query");
      const page = await aiConversationStore.listMessagesPage({
        conversationId: conversation.id,
        beforeSeq: query.before,
        limit: query.limit ?? 50,
      });
      return respond(c, ok(page));
    })
    .get("/conversations/:conversationId/timeline", async (c) => {
      const ctx = await config.resolveContext(c);
      if (ctx instanceof Response) return ctx;
      const conversation = await loadConversation(c, ctx);
      if (!conversation) return notFound(c);
      return respond(c, ok(await aiConversationStore.listConversationTimeline({ conversationId: conversation.id })));
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
      const archived = await aiConversationStore.archiveConversation({
        conversationId: conversation.id,
        appId: config.appId,
        ownerUserId: ctx.ownerUserId,
      });
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
        rememberLastUsedModel(ctx.actor, result.turn.modelProfileId);
        return respond(c, ok(result), 201);
      } catch (error) {
        return toAiErrorResponse(c, error);
      }
    })
    .post("/conversations/:conversationId/turns/:turnId/steer", v("json", AiSteerInputSchema), async (c) => {
      const ctx = await config.resolveContext(c);
      if (ctx instanceof Response) return ctx;
      const conversation = await loadConversation(c, ctx);
      if (!conversation) return notFound(c);
      const turnId = c.req.param("turnId");
      if (!turnId) return notFound(c);
      const body = c.req.valid("json");
      const result = await aiConversationStore.enqueueTurnSteer({
        conversationId: conversation.id,
        turnId,
        clientRequestId: body.clientRequestId,
        text: body.message,
      });
      if (!result.ok) {
        if (result.reason === "not_found") return respond(c, fail(err.notFound("Turn")));
        if (result.reason === "not_chat") return respond(c, fail(err.badInput("Compaction turns cannot be steered.")));
        return respond(c, fail(err.conflict("This turn is no longer active.")));
      }
      return respond(c, ok(result.steer), 201);
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
        rememberLastUsedModel(ctx.actor, result.turn.modelProfileId);
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
      await aiConversationStore.copyMessages({
        sourceConversationId: conversation.id,
        targetConversationId: forked.id,
        throughSeq: target.seq,
      });
      // The fork continues with the same VFS contents (uploads + produced files).
      await aiFileStore.copyToConversation({ sourceConversationId: conversation.id, targetConversationId: forked.id }).catch(() => undefined);
      return respond(c, ok(await conversationDetail(forked)));
    })
    .get("/conversations/:conversationId/enrichment", async (c) => {
      const ctx = await config.resolveContext(c);
      if (ctx instanceof Response) return ctx;
      const conversation = await loadConversation(c, ctx);
      if (!conversation) return notFound(c);
      const [status, runs] = await Promise.all([
        aiConversationStore.getEnrichmentStatus({ conversationId: conversation.id }),
        aiConversationStore.listEnrichmentRuns({ conversationId: conversation.id }),
      ]);
      return respond(c, ok({ status, runs }));
    })
    .post("/conversations/:conversationId/reindex", async (c) => {
      const ctx = await config.resolveContext(c);
      if (ctx instanceof Response) return ctx;
      const conversation = await loadConversation(c, ctx);
      if (!conversation) return notFound(c);
      await aiMaintenanceJobs.submitConversationReindex(conversation.id);
      return respond(c, ok({ queued: true }), 201);
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
    })

    // ── Conversation files (bash VFS: /input uploads, /files workspace) ────
    .get("/conversations/:conversationId/files", v("query", FilesListQuerySchema), async (c) => {
      const ctx = await config.resolveContext(c);
      if (ctx instanceof Response) return ctx;
      const conversation = await loadConversation(c, ctx);
      if (!conversation) return notFound(c);
      const files = await aiFileStore.list({ conversationId: conversation.id, prefix: c.req.valid("query").prefix ?? "/" });
      return respond(c, ok({ files, totalBytes: await aiFileStore.totalBytes(conversation.id) }));
    })
    .post("/conversations/:conversationId/files", async (c) => {
      const ctx = await config.resolveContext(c);
      if (ctx instanceof Response) return ctx;
      const conversation = await loadConversation(c, ctx);
      if (!conversation) return notFound(c);

      const form = await c.req.formData().catch(() => null);
      const file = form?.get("file");
      if (!(file instanceof File)) return respond(c, fail(err.badInput("Missing 'file' field")));
      if (file.size > AI_FILES_MAX_FILE_BYTES_DEFAULT) {
        return respond(c, fail(err.badInput(`File exceeds the ${Math.floor(AI_FILES_MAX_FILE_BYTES_DEFAULT / (1024 * 1024))} MB limit`)));
      }
      const dirInput = form?.get("dir");
      const dir = dirInput === "/files" ? "/files" : "/input";

      const name = (file.name || "upload").replaceAll("/", "_").replaceAll("\\", "_").replaceAll("\0", "").slice(0, 160) || "upload";
      let path = normalizeAiFilePath(`${dir}/${name}`);
      if (!path) return respond(c, fail(err.badInput("Invalid file name")));
      // Keep multiple same-named uploads apart: report.csv → report-2.csv.
      for (let attempt = 2; (await aiFileStore.stat({ conversationId: conversation.id, path })) && attempt < 100; attempt++) {
        const dot = name.lastIndexOf(".");
        const suffixed = dot > 0 ? `${name.slice(0, dot)}-${attempt}${name.slice(dot)}` : `${name}-${attempt}`;
        path = normalizeAiFilePath(`${dir}/${suffixed}`) ?? path;
      }

      try {
        await aiFileStore.write({
          conversationId: conversation.id,
          path,
          bytes: new Uint8Array(await file.arrayBuffer()),
          mediaType: file.type || guessAiMediaType(path),
        });
      } catch (error) {
        return respond(c, fail(err.badInput(error instanceof Error ? error.message : "Upload failed")));
      }
      const stat = await aiFileStore.stat({ conversationId: conversation.id, path });
      return respond(c, ok({ file: stat }));
    })
    .get("/conversations/:conversationId/files/content", v("query", FilePathQuerySchema), async (c) => {
      const ctx = await config.resolveContext(c);
      if (ctx instanceof Response) return ctx;
      const conversation = await loadConversation(c, ctx);
      if (!conversation) return notFound(c);
      const path = normalizeAiFilePath(c.req.valid("query").path);
      if (!path) return notFound(c);
      const [stat, bytes] = await Promise.all([
        aiFileStore.stat({ conversationId: conversation.id, path }),
        aiFileStore.readAll({ conversationId: conversation.id, path }),
      ]);
      if (!stat || !bytes) return notFound(c);
      const filename = path.slice(path.lastIndexOf("/") + 1).replaceAll('"', "");
      return c.body(bytes as unknown as ArrayBuffer, 200, {
        "Content-Type": stat.mediaType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(stat.size),
        "Cache-Control": "private, no-store",
      });
    })
    .delete("/conversations/:conversationId/files", v("query", FilePathQuerySchema), async (c) => {
      const ctx = await config.resolveContext(c);
      if (ctx instanceof Response) return ctx;
      const conversation = await loadConversation(c, ctx);
      if (!conversation) return notFound(c);
      const path = normalizeAiFilePath(c.req.valid("query").path);
      if (!path) return notFound(c);
      const removed = await aiFileStore.remove({ conversationId: conversation.id, path, recursive: false });
      if (removed === 0) return notFound(c);
      return respond(c, ok({ deleted: true }));
    })
    .put("/conversations/:conversationId/files/content", v("json", FileWriteSchema), async (c) => {
      const ctx = await config.resolveContext(c);
      if (ctx instanceof Response) return ctx;
      const conversation = await loadConversation(c, ctx);
      if (!conversation) return notFound(c);
      const body = c.req.valid("json");
      const path = normalizeAiFilePath(body.path);
      // /input mirrors what the user sent to the model — it stays immutable.
      if (!path || !path.startsWith("/files/")) return respond(c, fail(err.badInput("Only files under /files can be edited.")));
      try {
        await aiFileStore.write({
          conversationId: conversation.id,
          path,
          bytes: body.encoding === "base64" ? new Uint8Array(Buffer.from(body.content, "base64")) : new TextEncoder().encode(body.content),
          mediaType: guessAiMediaType(path),
        });
      } catch (error) {
        return respond(c, fail(err.badInput(error instanceof Error ? error.message : "Failed to write file")));
      }
      return respond(c, ok({ file: await aiFileStore.stat({ conversationId: conversation.id, path }) }));
    })
    .post("/conversations/:conversationId/files/rename", v("json", FileRenameSchema), async (c) => {
      const ctx = await config.resolveContext(c);
      if (ctx instanceof Response) return ctx;
      const conversation = await loadConversation(c, ctx);
      if (!conversation) return notFound(c);
      const body = c.req.valid("json");
      const from = normalizeAiFilePath(body.from);
      const to = normalizeAiFilePath(body.to);
      if (!from || !to || !from.startsWith("/files/") || !to.startsWith("/files/")) {
        return respond(c, fail(err.badInput("Only files under /files can be renamed.")));
      }
      if (await aiFileStore.stat({ conversationId: conversation.id, path: to })) {
        return respond(c, fail(err.conflict(`File "${to}"`)));
      }
      const renamed = await aiFileStore.rename({ conversationId: conversation.id, from, to });
      if (!renamed) return notFound(c);
      return respond(c, ok({ renamed: true }));
    });
};

export type AiChatRoutes = ReturnType<typeof createAiChatRoutes>;
