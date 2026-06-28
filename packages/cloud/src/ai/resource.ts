import type { Tool, ToolContext } from "@valentinkolb/nessi";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { type AuthContext, err, fail, ok, respond, v } from "../server";
import {
  AiCreateConversationInputSchema,
  AiReplayQuerySchema,
  AiTurnInputSchema,
  toAiActionFailureResponse,
  toAiErrorResponse,
} from "./http";
import { AiTurnActionSchema, abortAiTurn, createAiTurnResponse, listPendingAiTurnActions, submitAiTurnAction } from "./runtime";
import { listAiModels, toPublicAiSettingsState } from "./settings";
import { aiConversationStore } from "./store";
import { createAiEventReplayResponse } from "./stream";
import type {
  AiAccessResult,
  AiConversationResource,
  AiModelPolicy,
  AiResourceDefinition,
  AiResourceDescriptor,
  AiResourceHookContext,
  AiRuntimeTool,
  AiToolRuntime,
} from "./types";

type Awaitable<T> = T | Promise<T>;

type CleanPathParam<T extends string> = T extends `${infer Name}?`
  ? Name
  : T extends `${infer Name}{${string}`
    ? Name
    : T extends `${infer Name}.${string}`
      ? Name
      : T;

type PathParamKeys<TPath extends string> = TPath extends `${string}:${infer Rest}`
  ? Rest extends `${infer Param}/${infer Tail}`
    ? CleanPathParam<Param> | PathParamKeys<`/${Tail}`>
    : CleanPathParam<Rest>
  : never;

export type AiPathParams<TPath extends string> = {
  [Key in PathParamKeys<TPath>]: string;
};

export type DefineAiResourceConfig<TPath extends string, TParamsSchema extends z.ZodType<AiPathParams<TPath>>, TAccess> = Omit<
  AiResourceDefinition<z.infer<TParamsSchema>, TAccess>,
  "path"
> & {
  path: TPath;
  params: TParamsSchema;
};

export type DefinedAiResource<TPath extends string, TParamsSchema extends z.ZodType<AiPathParams<TPath>>, TAccess> = AiResourceDefinition<
  z.infer<TParamsSchema>,
  TAccess
> & {
  params: TParamsSchema;
  parseParams(raw: unknown): z.infer<TParamsSchema>;
  routes(): Hono<AuthContext>;
};

const normalizePath = (path: string): string => {
  const prefixed = path.startsWith("/") ? path : `/${path}`;
  return prefixed === "/" ? "" : prefixed.replace(/\/+$/, "");
};

const actorUserId = (actor: AuthContext["Variables"]["actor"]): string | null => {
  if (actor.kind === "user") return actor.user.id;
  return actor.delegatedUser?.id ?? null;
};

const readActor = (c: Context<AuthContext>) => c.get("actor" as never) as AuthContext["Variables"]["actor"] | undefined;

const resolveValue = async <TParams, TAccess, TValue>(
  value: TValue | ((ctx: AiResourceHookContext<TParams, TAccess>) => Awaitable<TValue>) | undefined,
  ctx: AiResourceHookContext<TParams, TAccess>,
  fallback: TValue,
): Promise<TValue> => {
  if (typeof value === "function") return (value as (ctx: AiResourceHookContext<TParams, TAccess>) => Awaitable<TValue>)(ctx);
  return value ?? fallback;
};

const normalizePolicy = (policy: AiModelPolicy | undefined): AiModelPolicy => policy ?? { kind: "platform-default" };

const policyForModelList = (policy: AiModelPolicy): AiModelPolicy => {
  if (policy.kind !== "locked") return policy;
  return {
    kind: "selectable",
    allowedModelIds: [policy.modelId],
    allowedDataBoundaries: policy.allowedDataBoundaries,
    requiredCapabilities: policy.requiredCapabilities,
  };
};

const toResourceConversation = (resource: AiResourceDescriptor): AiConversationResource => ({
  kind: "resource",
  appId: resource.appId,
  resourceType: resource.resourceType,
  resourceId: resource.resourceId,
  title: resource.title,
});

const toResourceId = <TParams extends Record<string, string>, TAccess>(
  definition: AiResourceDefinition<TParams, TAccess>,
  ctx: AiResourceHookContext<TParams, TAccess>,
): Awaitable<string> => {
  if (typeof definition.resourceId === "function") return definition.resourceId(ctx);
  if (definition.resourceId) return ctx.params[definition.resourceId] ?? JSON.stringify(ctx.params);
  if ("id" in ctx.params && typeof ctx.params.id === "string") return ctx.params.id;
  const entries = Object.entries(ctx.params);
  if (entries.length === 1) return entries[0]![1];
  return JSON.stringify(ctx.params);
};

const resolveDescriptor = async <TParams extends Record<string, string>, TAccess>(
  definition: AiResourceDefinition<TParams, TAccess>,
  ctx: AiResourceHookContext<TParams, TAccess>,
): Promise<AiResourceDescriptor> => {
  const [resourceId, title] = await Promise.all([
    toResourceId(definition, ctx),
    resolveValue(definition.resourceTitle, ctx, undefined as string | undefined),
  ]);
  return {
    appId: definition.appId,
    resourceType: definition.id,
    resourceId,
    title,
  };
};

const parseResourceParams = <TParams extends Record<string, string>>(definition: { params: z.ZodType }, raw: unknown) => {
  const parsed = definition.params.safeParse(raw);
  if (!parsed.success) {
    return fail(err.badInput(z.prettifyError(parsed.error)));
  }
  return ok(parsed.data as TParams);
};

type ResourceRequestContext<TParams extends Record<string, string>, TAccess> = {
  actor: AuthContext["Variables"]["actor"];
  ownerUserId: string;
  params: TParams;
  access: TAccess;
  hook: AiResourceHookContext<TParams, TAccess>;
  descriptor: AiResourceDescriptor;
  conversationResource: AiConversationResource;
};

const loadResourceRequestContext = async <TParams extends Record<string, string>, TAccess>(
  c: Context<AuthContext>,
  definition: AiResourceDefinition<TParams, TAccess> & { params: z.ZodType },
): Promise<ResourceRequestContext<TParams, TAccess> | Response> => {
  const actor = readActor(c);
  if (!actor) return (await respond(c, fail(err.unauthenticated("Authentication required")))) as unknown as Response;
  const ownerUserId = actorUserId(actor);
  if (!ownerUserId) return (await respond(c, fail(err.forbidden("AI conversations require a user-backed actor")))) as unknown as Response;

  const paramsResult = parseResourceParams<TParams>(definition, c.req.param());
  if (!paramsResult.ok) return (await respond(c, paramsResult)) as unknown as Response;

  const accessResult: AiAccessResult<TAccess> = await definition.access({
    params: paramsResult.data,
    actor,
    signal: c.req.raw.signal,
  });
  if (!accessResult.allowed) {
    return (await respond(c, fail(err.forbidden(accessResult.reason || "AI resource access denied")))) as unknown as Response;
  }

  const access = accessResult.data as TAccess;
  const hook: AiResourceHookContext<TParams, TAccess> = {
    params: paramsResult.data,
    actor,
    access,
    signal: c.req.raw.signal,
  };
  const descriptor = await resolveDescriptor(definition, hook);

  return {
    actor,
    ownerUserId,
    params: paramsResult.data,
    access,
    hook,
    descriptor,
    conversationResource: toResourceConversation(descriptor),
  };
};

const guardTools = <TParams extends Record<string, string>, TAccess>(
  definition: AiResourceDefinition<TParams, TAccess>,
  hook: AiResourceHookContext<TParams, TAccess>,
  tools: AiRuntimeTool[],
): AiRuntimeTool[] =>
  tools.map((tool) => {
    if ("location" in tool) {
      if (tool.location !== "server") return tool;
      return {
        ...tool,
        run: async (input: unknown, toolCtx: ToolContext & { actor: typeof hook.actor }) => {
          const latest = await definition.access({
            params: hook.params,
            actor: hook.actor,
            signal: toolCtx.signal,
          });
          if (!latest.allowed) throw new Error(latest.reason || "AI resource access denied");
          return tool.run(input, toolCtx);
        },
      } as AiToolRuntime;
    }

    if (tool.kind !== "server") return tool;
    return {
      ...tool,
      execute: async (input: unknown, toolCtx: ToolContext) => {
        const latest = await definition.access({
          params: hook.params,
          actor: hook.actor,
          signal: toolCtx.signal,
        });
        if (!latest.allowed) throw new Error(latest.reason || "AI resource access denied");
        return tool.execute(input, toolCtx);
      },
    } as Tool;
  });

const createAiResourceRoutes = <TPath extends string, TParamsSchema extends z.ZodType<AiPathParams<TPath>>, TAccess>(
  definition: AiResourceDefinition<z.infer<TParamsSchema>, TAccess> & {
    path: TPath;
    params: TParamsSchema;
  },
) => {
  const basePath = normalizePath(definition.path);

  return new Hono<AuthContext>()
    .get(`${basePath}/status`, async (c) => {
      const ctx = await loadResourceRequestContext(c, definition);
      if (ctx instanceof Response) return ctx;
      const policy = normalizePolicy(await resolveValue(definition.modelPolicy, ctx.hook, { kind: "platform-default" }));
      const [status, models] = await Promise.all([toPublicAiSettingsState(), listAiModels(policyForModelList(policy))]);
      return respond(c, ok({ ...status, models, resource: ctx.descriptor, modelPolicy: policy }));
    })
    .get(`${basePath}/conversations`, async (c) => {
      const ctx = await loadResourceRequestContext(c, definition);
      if (ctx instanceof Response) return ctx;
      return respond(
        c,
        ok(
          await aiConversationStore.listConversations({
            appId: definition.appId,
            ownerUserId: ctx.ownerUserId,
            resource: ctx.conversationResource,
          }),
        ),
      );
    })
    .post(`${basePath}/conversations`, v("json", AiCreateConversationInputSchema), async (c) => {
      const body = c.req.valid("json");
      const ctx = await loadResourceRequestContext(c, definition);
      if (ctx instanceof Response) return ctx;
      return respond(
        c,
        ok(
          await aiConversationStore.createConversation({
            appId: definition.appId,
            ownerUserId: ctx.ownerUserId,
            title: body.title ?? ctx.descriptor.title,
            resource: ctx.conversationResource,
          }),
        ),
        201,
      );
    })
    .get(`${basePath}/conversations/:conversationId`, async (c) => {
      const ctx = await loadResourceRequestContext(c, definition);
      if (ctx instanceof Response) return ctx;
      const conversationId = c.req.param("conversationId");
      if (!conversationId) return respond(c, fail(err.notFound("Conversation")));
      const conversation = await aiConversationStore.getConversation({
        conversationId,
        appId: definition.appId,
        ownerUserId: ctx.ownerUserId,
        resource: ctx.conversationResource,
      });
      if (!conversation) return respond(c, fail(err.notFound("Conversation")));
      const [messages, activeTurn] = await Promise.all([
        aiConversationStore.listMessages({ conversationId: conversation.id }),
        aiConversationStore.getRunningTurn({ conversationId: conversation.id }),
      ]);
      const pendingActions = activeTurn ? listPendingAiTurnActions({ conversationId: conversation.id, turnId: activeTurn.id }) : [];
      return respond(c, ok({ conversation, messages, activeTurn, pendingActions }));
    })
    .post(`${basePath}/conversations/:conversationId/turns`, v("json", AiTurnInputSchema), async (c) => {
      const body = c.req.valid("json");
      const ctx = await loadResourceRequestContext(c, definition);
      if (ctx instanceof Response) return ctx;
      const conversationId = c.req.param("conversationId");
      if (!conversationId) return respond(c, fail(err.notFound("Conversation")));
      const conversation = await aiConversationStore.getConversation({
        conversationId,
        appId: definition.appId,
        ownerUserId: ctx.ownerUserId,
        resource: ctx.conversationResource,
      });
      if (!conversation) return respond(c, fail(err.notFound("Conversation")));

      try {
        const [modelPolicy, systemPrompt, resourceContext, tools] = await Promise.all([
          resolveValue(definition.modelPolicy, ctx.hook, { kind: "platform-default" }),
          resolveValue(definition.systemPrompt, ctx.hook, ""),
          definition.context?.(ctx.hook) ?? "",
          resolveValue(definition.tools, ctx.hook, [] as AiRuntimeTool[]),
        ]);
        return await createAiTurnResponse({
          conversationId: conversation.id,
          input: body.message,
          actor: ctx.actor,
          requestedModelId: body.modelProfileId,
          modelPolicy: normalizePolicy(modelPolicy),
          systemPrompt,
          resourceContext,
          tools: guardTools(definition, ctx.hook, tools),
          toolApprovalContext: {
            actorUserId: ctx.ownerUserId,
            appId: definition.appId,
            resource: ctx.conversationResource,
          },
          signal: c.req.raw.signal,
        });
      } catch (error) {
        return toAiErrorResponse(c, error);
      }
    })
    .post(`${basePath}/conversations/:conversationId/turns/:turnId/abort`, async (c) => {
      const ctx = await loadResourceRequestContext(c, definition);
      if (ctx instanceof Response) return ctx;
      const conversationId = c.req.param("conversationId");
      const turnId = c.req.param("turnId");
      if (!conversationId || !turnId) return respond(c, fail(err.notFound("Conversation")));
      const conversation = await aiConversationStore.getConversation({
        conversationId,
        appId: definition.appId,
        ownerUserId: ctx.ownerUserId,
        resource: ctx.conversationResource,
      });
      if (!conversation) return respond(c, fail(err.notFound("Conversation")));

      const result = abortAiTurn({ conversationId: conversation.id, turnId });
      if (!result.ok) return toAiActionFailureResponse(c, result);
      return respond(c, ok({ ok: true }));
    })
    .post(`${basePath}/conversations/:conversationId/turns/:turnId/actions/:callId`, v("json", AiTurnActionSchema), async (c) => {
      const ctx = await loadResourceRequestContext(c, definition);
      if (ctx instanceof Response) return ctx;
      const conversationId = c.req.param("conversationId");
      const turnId = c.req.param("turnId");
      const callId = c.req.param("callId");
      if (!conversationId || !turnId || !callId) return respond(c, fail(err.notFound("Conversation")));
      const conversation = await aiConversationStore.getConversation({
        conversationId,
        appId: definition.appId,
        ownerUserId: ctx.ownerUserId,
        resource: ctx.conversationResource,
      });
      if (!conversation) return respond(c, fail(err.notFound("Conversation")));

      const result = await submitAiTurnAction({
        conversationId: conversation.id,
        turnId,
        callId,
        action: c.req.valid("json"),
        toolApprovalContext: {
          actorUserId: ctx.ownerUserId,
          appId: definition.appId,
          resource: ctx.conversationResource,
        },
      });

      if (!result.ok) {
        return toAiActionFailureResponse(c, result);
      }
      return respond(c, ok({ ok: true }));
    })
    .get(`${basePath}/conversations/:conversationId/turns/:turnId/events`, v("query", AiReplayQuerySchema), async (c) => {
      const query = c.req.valid("query");
      const ctx = await loadResourceRequestContext(c, definition);
      if (ctx instanceof Response) return ctx;
      const conversationId = c.req.param("conversationId");
      const turnId = c.req.param("turnId");
      if (!conversationId || !turnId) return respond(c, fail(err.notFound("Conversation")));
      const conversation = await aiConversationStore.getConversation({
        conversationId,
        appId: definition.appId,
        ownerUserId: ctx.ownerUserId,
        resource: ctx.conversationResource,
      });
      if (!conversation) return respond(c, fail(err.notFound("Conversation")));
      return createAiEventReplayResponse({
        conversationId: conversation.id,
        turnId,
        after: query.after ?? c.req.header("Last-Event-ID"),
        signal: c.req.raw.signal,
      });
    });
};

export const defineAiResource = <const TPath extends string, TParamsSchema extends z.ZodType<AiPathParams<TPath>>, TAccess = unknown>(
  config: DefineAiResourceConfig<TPath, TParamsSchema, TAccess>,
) => {
  const definition = {
    ...config,
    path: normalizePath(config.path) as TPath,
    parseParams: (raw: unknown) => config.params.parse(raw),
  };

  return {
    ...definition,
    routes: () => createAiResourceRoutes(definition),
  };
};

export const requireAiResourceAccess = async <TParams, TAccess>(
  resource: AiResourceDefinition<TParams, TAccess>,
  input: { params: TParams; actor: AuthContext["Variables"]["actor"]; signal: AbortSignal },
): Promise<TAccess> => {
  const result: AiAccessResult<TAccess> = await resource.access(input);
  if (!result.allowed) {
    throw new Error(result.reason || "AI resource access denied");
  }
  return result.data as TAccess;
};
