import { describe, expect, test } from "bun:test";
import {
  NOTIFICATION_LIVE_WS_TYPE,
  NotificationLiveClientMessageSchema,
  NotificationLiveEventSchema,
  parseNotificationLiveServerMessage,
} from "./notification-live";

describe("notification live WebSocket contract", () => {
  test("accepts subscriptions with an optional stream cursor", () => {
    expect(
      NotificationLiveClientMessageSchema.safeParse({
        type: NOTIFICATION_LIVE_WS_TYPE.subscribe,
        payload: { fromCursor: "8-3" },
      }).success,
    ).toBeTrue();
    expect(
      NotificationLiveClientMessageSchema.safeParse({
        type: NOTIFICATION_LIVE_WS_TYPE.subscribe,
        payload: { fromCursor: null },
      }).success,
    ).toBeTrue();
    expect(
      NotificationLiveClientMessageSchema.safeParse({
        type: NOTIFICATION_LIVE_WS_TYPE.subscribe,
        payload: { fromCursor: "invalid" },
      }).success,
    ).toBeFalse();
  });

  test("validates safe notification targets", () => {
    expect(
      NotificationLiveEventSchema.safeParse({
        type: "cloud-notification",
        eventId: "event-1",
        title: "Ready",
        targetHref: "/app/assistant/chat?id=1",
      }).success,
    ).toBeTrue();
    expect(
      NotificationLiveEventSchema.safeParse({
        type: "cloud-notification",
        eventId: "event-1",
        title: "Ready",
        targetHref: "https://example.com",
      }).success,
    ).toBeFalse();
    expect(
      NotificationLiveEventSchema.safeParse({
        type: "cloud-notification",
        eventId: "event-1",
        title: "Ready",
        targetHref: "//example.com/path",
      }).success,
    ).toBeFalse();
  });

  test("parses typed server events and rejects malformed messages", () => {
    const message = parseNotificationLiveServerMessage(
      JSON.stringify({
        type: NOTIFICATION_LIVE_WS_TYPE.event,
        payload: {
          cursor: "9-1",
          event: { type: "cloud-notification", eventId: "event-2", title: "Complete", targetHref: "/app/assistant" },
        },
      }),
    );

    expect(message?.type).toBe(NOTIFICATION_LIVE_WS_TYPE.event);
    expect(parseNotificationLiveServerMessage("not-json")).toBeNull();
    expect(parseNotificationLiveServerMessage(JSON.stringify({ type: NOTIFICATION_LIVE_WS_TYPE.event, payload: {} }))).toBeNull();
  });
});
