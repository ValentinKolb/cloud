import type { Tool, ToolContext } from "@valentinkolb/nessi";
import type { z } from "zod";
import type { AuthContext, RequestActor } from "../server";
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

type RegisteredAiResource = AiResourceDefinition<Record<string, string>, unknown> & {
  params: z.ZodType<Record<string, string>>;
};

type ResourceRunContext = {
  actor: RequestActor;
  ownerUserId: string;
  params: Record<string, string>;
  descriptor: AiResourceDescriptor;
  conversationResource: AiConversationResource;
  modelPolicy: AiModelPolicy;
  systemPrompt: string;
  resourceContext: string;
  tools: AiRuntimeTool[];
};

const resources = new Map<string, RegisteredAiResource>();

export const normalizeAiResourcePath = (path: string): string => {
  const prefixed = path.startsWith("/") ? path : `/${path}`;
  return prefixed === "/" ? "" : prefixed.replace(/\/+$/, "");
};

export const aiResourceKey = (definition: Pick<AiResourceDefinition<unknown>, "appId" | "id" | "path">): string =>
  `${definition.appId}:${definition.id}:${normalizeAiResourcePath(definition.path)}`;

export const registerAiResourceDefinition = <TParams extends Record<string, string>, TAccess>(
  definition: AiResourceDefinition<TParams, TAccess> & { params: z.ZodType<TParams> },
): string => {
  const key = aiResourceKey(definition);
  resources.set(key, definition as unknown as RegisteredAiResource);
  return key;
};

const actorUserId = (actor: AuthContext["Variables"]["actor"]): string | null => {
  if (actor.kind === "user") return actor.user.id;
  return actor.delegatedUser?.id ?? null;
};

const resolveValue = async <TParams, TAccess, TValue>(
  value: TValue | ((ctx: AiResourceHookContext<TParams, TAccess>) => Awaitable<TValue>) | undefined,
  ctx: AiResourceHookContext<TParams, TAccess>,
  fallback: TValue,
): Promise<TValue> => {
  if (typeof value === "function") return (value as (ctx: AiResourceHookContext<TParams, TAccess>) => Awaitable<TValue>)(ctx);
  return value ?? fallback;
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

export const resolveAiResourceDescriptor = async <TParams extends Record<string, string>, TAccess>(
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

export const guardAiResourceTools = <TParams extends Record<string, string>, TAccess>(
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

export const resolveAiResourceRunContext = async (input: {
  resourceKey: string;
  params: Record<string, string>;
  actor: RequestActor;
  signal: AbortSignal;
}): Promise<ResourceRunContext> => {
  const definition = resources.get(input.resourceKey);
  if (!definition) throw new Error(`AI resource "${input.resourceKey}" is not registered on this worker.`);

  const params = definition.params.parse(input.params);
  const ownerUserId = actorUserId(input.actor);
  if (!ownerUserId) throw new Error("AI resource turns require a user-backed actor.");

  const accessResult: AiAccessResult<unknown> = await definition.access({
    params,
    actor: input.actor,
    signal: input.signal,
  });
  if (!accessResult.allowed) throw new Error(accessResult.reason || "AI resource access denied");

  const hook: AiResourceHookContext<Record<string, string>, unknown> = {
    params,
    actor: input.actor,
    access: accessResult.data,
    signal: input.signal,
  };
  const descriptor = await resolveAiResourceDescriptor(definition, hook);
  const [modelPolicy, systemPrompt, resourceContext, tools] = await Promise.all([
    resolveValue(definition.modelPolicy, hook, { kind: "platform-default" } as AiModelPolicy),
    resolveValue(definition.systemPrompt, hook, ""),
    definition.context?.(hook) ?? "",
    resolveValue(definition.tools, hook, [] as AiRuntimeTool[]),
  ]);

  return {
    actor: input.actor,
    ownerUserId,
    params,
    descriptor,
    conversationResource: toResourceConversation(descriptor),
    modelPolicy,
    systemPrompt,
    resourceContext,
    tools: guardAiResourceTools(definition, hook, tools),
  };
};
