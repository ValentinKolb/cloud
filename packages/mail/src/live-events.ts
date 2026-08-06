import { z } from "zod";

export const MAIL_LIVE_WS_TYPE = {
  subscribe: "mail.live.subscribe",
  ready: "mail.live.ready",
  event: "mail.live.event",
  revoked: "mail.live.revoked",
  error: "mail.live.error",
} as const;

const MailConversationChangedEventSchema = z
  .object({
    type: z.literal("conversation.changed"),
    mailboxId: z.uuid(),
    conversationId: z.uuid(),
    reason: z.enum([
      "collaboration",
      "comment",
      "draft",
      "inbound",
      "outbound",
      "threading",
      "reminder",
      "local_tag",
      "reference",
      "summary",
    ]),
    targetId: z.uuid().nullable(),
    activityId: z.string().min(1).max(128),
    at: z.string().datetime(),
  })
  .strict();

const MailMailboxChangedEventSchema = z
  .object({
    type: z.literal("mailbox.changed"),
    mailboxId: z.uuid(),
    conversationId: z.null(),
    reason: z.enum([
      "local_tag",
      "reference_configuration",
      "automatic_reply",
      "incoming_automation",
      "scheduled_send",
      "subscription",
      "folder",
      "deleted",
      "restored",
    ]),
    targetId: z.uuid().nullable(),
    activityId: z.string().min(1).max(128),
    at: z.string().datetime(),
  })
  .strict();

export const MailCollaborationEventSchema = z.discriminatedUnion("type", [
  MailConversationChangedEventSchema,
  MailMailboxChangedEventSchema,
]);

export type MailCollaborationEvent = z.infer<typeof MailCollaborationEventSchema>;
export type MailConversationChangedEvent = Extract<MailCollaborationEvent, { type: "conversation.changed" }>;
export type MailMailboxChangedEvent = Extract<MailCollaborationEvent, { type: "mailbox.changed" }>;

export const MailLiveCursorSchema = z.string().regex(/^\d+-\d+$/);
const MailLiveRevocationCodeSchema = z.enum(["login_required", "not_found", "access_denied"]);
const MailLiveErrorCodeSchema = z.enum(["invalid_json", "invalid_message", "backpressure", "internal_error", "stream_failed"]);

export type MailLiveRevocationCode = z.infer<typeof MailLiveRevocationCodeSchema>;
export type MailLiveErrorCode = z.infer<typeof MailLiveErrorCodeSchema>;

const MailLiveSubscribeMessageSchema = z
  .object({
    type: z.literal(MAIL_LIVE_WS_TYPE.subscribe),
    payload: z
      .object({
        mailboxId: z.uuid(),
        fromCursor: MailLiveCursorSchema.nullable(),
      })
      .strict(),
  })
  .strict();

export const MailLiveClientMessageSchema = z.discriminatedUnion("type", [MailLiveSubscribeMessageSchema]);
export type MailLiveClientMessage = z.infer<typeof MailLiveClientMessageSchema>;

export const MailLiveServerMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal(MAIL_LIVE_WS_TYPE.ready),
      payload: z.object({ mailboxId: z.uuid(), cursor: MailLiveCursorSchema }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal(MAIL_LIVE_WS_TYPE.event),
      payload: z.object({ mailboxId: z.uuid(), cursor: MailLiveCursorSchema, event: MailCollaborationEventSchema }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal(MAIL_LIVE_WS_TYPE.revoked),
      payload: z
        .object({
          mailboxId: z.uuid(),
          code: MailLiveRevocationCodeSchema,
          message: z.string().min(1).max(500),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal(MAIL_LIVE_WS_TYPE.error),
      payload: z
        .object({
          mailboxId: z.uuid().optional(),
          code: MailLiveErrorCodeSchema,
          message: z.string().min(1).max(500),
        })
        .strict(),
    })
    .strict(),
]);

export type MailLiveServerMessage = z.infer<typeof MailLiveServerMessageSchema>;

export const parseMailLiveServerMessage = (raw: string): MailLiveServerMessage | null => {
  try {
    const parsed = MailLiveServerMessageSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};
