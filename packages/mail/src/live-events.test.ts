import { describe, expect, test } from "bun:test";
import {
  MAIL_LIVE_WS_TYPE,
  MailLiveClientMessageSchema,
  type MailLiveServerMessage,
  MailLiveServerMessageSchema,
  parseMailLiveServerMessage,
} from "./live-events";

const MAILBOX_ID = "1da425e0-6bea-47ee-95a4-9d2151802171";
const CONVERSATION_ID = "06efc190-c522-47a3-a972-3c9aef8c7e2b";

describe("Mail live protocol", () => {
  test("validates subscribe cursors and rejects unknown client messages", () => {
    expect(
      MailLiveClientMessageSchema.safeParse({
        type: MAIL_LIVE_WS_TYPE.subscribe,
        payload: { mailboxId: MAILBOX_ID, fromCursor: "12-4" },
      }).success,
    ).toBeTrue();
    expect(
      MailLiveClientMessageSchema.safeParse({
        type: MAIL_LIVE_WS_TYPE.subscribe,
        payload: { mailboxId: MAILBOX_ID, fromCursor: "latest" },
      }).success,
    ).toBeFalse();
    expect(MailLiveClientMessageSchema.safeParse({ type: "mail.live.legacy", payload: {} }).success).toBeFalse();
  });

  test("parses every server message variant through one discriminated union", () => {
    const event = {
      type: MAIL_LIVE_WS_TYPE.event,
      payload: {
        mailboxId: MAILBOX_ID,
        cursor: "13-1",
        event: {
          type: "conversation.changed",
          mailboxId: MAILBOX_ID,
          conversationId: CONVERSATION_ID,
          reason: "comment",
          targetId: CONVERSATION_ID,
          activityId: "42",
          at: "2026-07-16T20:00:00.000Z",
        },
      },
    } satisfies MailLiveServerMessage;
    const messages = [
      { type: MAIL_LIVE_WS_TYPE.ready, payload: { mailboxId: MAILBOX_ID, cursor: "12-4" } },
      event,
      {
        type: MAIL_LIVE_WS_TYPE.revoked,
        payload: { mailboxId: MAILBOX_ID, code: "access_denied", message: "Access denied" },
      },
      {
        type: MAIL_LIVE_WS_TYPE.error,
        payload: { mailboxId: MAILBOX_ID, code: "stream_failed", message: "Stream failed" },
      },
    ];

    for (const message of messages) expect(MailLiveServerMessageSchema.safeParse(message).success).toBeTrue();
    expect(parseMailLiveServerMessage(JSON.stringify(event))).toEqual(event);
    expect(
      MailLiveServerMessageSchema.safeParse({
        ...event,
        payload: { ...event.payload, event: { ...event.payload.event, reason: "space_link" } },
      }).success,
    ).toBeTrue();
    expect(
      MailLiveServerMessageSchema.safeParse({
        type: MAIL_LIVE_WS_TYPE.event,
        payload: {
          mailboxId: MAILBOX_ID,
          cursor: "14-1",
          event: {
            type: "mailbox.changed",
            mailboxId: MAILBOX_ID,
            conversationId: null,
            reason: "local_tag",
            targetId: null,
            activityId: "43",
            at: "2026-07-16T20:01:00.000Z",
          },
        },
      }).success,
    ).toBeTrue();
    for (const reason of ["scheduled_send", "deleted", "restored"] as const) {
      expect(
        MailLiveServerMessageSchema.safeParse({
          type: MAIL_LIVE_WS_TYPE.event,
          payload: {
            mailboxId: MAILBOX_ID,
            cursor: "15-1",
            event: {
              type: "mailbox.changed",
              mailboxId: MAILBOX_ID,
              conversationId: null,
              reason,
              targetId: null,
              activityId: `lifecycle-${reason}`,
              at: "2026-07-16T20:02:00.000Z",
            },
          },
        }).success,
      ).toBeTrue();
    }
    expect(parseMailLiveServerMessage("not-json")).toBeNull();
    expect(parseMailLiveServerMessage(JSON.stringify({ type: MAIL_LIVE_WS_TYPE.event, payload: {} }))).toBeNull();
  });
});
