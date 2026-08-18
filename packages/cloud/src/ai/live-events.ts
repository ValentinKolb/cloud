import { z } from "zod";

export const AI_INVALIDATION_DOMAINS = [
  "conversation-list",
  "conversation-detail",
  "conversation-sources",
  "conversation-files",
  "conversation-tasks",
  "project-list",
  "project-detail",
  "project-context",
] as const;

export const AiInvalidationDomainSchema = z.enum(AI_INVALIDATION_DOMAINS);
export type AiInvalidationDomain = z.infer<typeof AiInvalidationDomainSchema>;

const AiResourceIdSchema = z.string().regex(/^[0-9A-Za-z]{6}$/);
export const AiLiveCursorSchema = z.string().regex(/^\d+-\d+$/);

export const AiInvalidationSchema = z
  .object({
    type: z.literal("ai.invalidated"),
    changeId: z.uuid(),
    conversationId: AiResourceIdSchema.nullable(),
    projectId: AiResourceIdSchema.nullable(),
    domains: z.array(AiInvalidationDomainSchema).min(1),
    at: z.string().datetime(),
  })
  .strict();

export type AiInvalidation = z.infer<typeof AiInvalidationSchema>;

export const AI_LIVE_WS_TYPE = {
  subscribe: "ai.live.subscribe",
  ready: "ai.live.ready",
  event: "ai.live.event",
  scopeChanged: "ai.live.scope_changed",
  revoked: "ai.live.revoked",
  error: "ai.live.error",
} as const;

const AiLiveSubscribeMessageSchema = z
  .object({
    type: z.literal(AI_LIVE_WS_TYPE.subscribe),
    payload: z.object({ fromCursor: AiLiveCursorSchema.nullable(), recover: z.boolean() }).strict(),
  })
  .strict();

export const AiLiveClientMessageSchema = z.discriminatedUnion("type", [AiLiveSubscribeMessageSchema]);
export type AiLiveClientMessage = z.infer<typeof AiLiveClientMessageSchema>;

const AiLiveRevocationCodeSchema = z.enum(["login_required", "access_denied"]);
const AiLiveErrorCodeSchema = z.enum(["invalid_json", "invalid_message", "backpressure", "internal_error", "stream_failed"]);

export type AiLiveRevocationCode = z.infer<typeof AiLiveRevocationCodeSchema>;
export type AiLiveErrorCode = z.infer<typeof AiLiveErrorCodeSchema>;

export const AiLiveServerMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal(AI_LIVE_WS_TYPE.ready),
      payload: z.object({ cursor: AiLiveCursorSchema, recovered: z.boolean() }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal(AI_LIVE_WS_TYPE.event),
      payload: z.object({ cursor: AiLiveCursorSchema, event: AiInvalidationSchema }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal(AI_LIVE_WS_TYPE.scopeChanged),
      payload: z.object({ at: z.string().datetime() }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal(AI_LIVE_WS_TYPE.revoked),
      payload: z.object({ code: AiLiveRevocationCodeSchema, message: z.string().min(1).max(500) }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal(AI_LIVE_WS_TYPE.error),
      payload: z.object({ code: AiLiveErrorCodeSchema, message: z.string().min(1).max(500) }).strict(),
    })
    .strict(),
]);

export type AiLiveServerMessage = z.infer<typeof AiLiveServerMessageSchema>;

export const parseAiLiveServerMessage = (raw: string): AiLiveServerMessage | null => {
  try {
    const parsed = AiLiveServerMessageSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};
