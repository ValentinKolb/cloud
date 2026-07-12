import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { defineApp } from "../_internal/define-app";
import { type AnyBoundNotificationDefinition, type NotificationSendInput, notification } from "./notification-types";

declare module "@valentinkolb/cloud/contracts/notifications" {
  interface NotificationChannelRegistry {
    mobileTest: true;
  }
}

const NOTIFICATIONS = {
  turnCompleted: notification({
    recipient: "user",
    label: "Completed chats",
    description: "When an Assistant response is ready.",
    delivery: { recommended: ["browser"] },
    data: z.object({ conversationId: z.string() }),
    render: ({ conversationId }) => ({
      title: "Response ready",
      targetHref: `/app/assistant/${conversationId}`,
    }),
  }),
  magicLink: notification({
    recipient: "email",
    label: "Sign-in links",
    description: "Required email sign-in links.",
    delivery: { required: ["email"] },
    data: z.object({ token: z.string() }),
    render: () => ({ title: "Sign in" }),
  }),
  mobileReady: notification({
    recipient: "user",
    label: "Mobile test",
    description: "Compile-time coverage for deployment-defined channels.",
    delivery: { recommended: ["mobileTest"] },
    data: z.object({}),
    render: () => ({ title: "Mobile test" }),
  }),
};

const app = defineApp({
  id: "type-test",
  name: "Type test",
  icon: "ti ti-test-pipe",
  description: "Notification type test app.",
  baseUrl: "http://app-type-test:3000",
  routes: ["/app/type-test"],
  notifications: NOTIFICATIONS,
});

const acceptsSend = <D extends AnyBoundNotificationDefinition>(_definition: D, _input: NotificationSendInput<D>) => undefined;

acceptsSend(app.notifications.turnCompleted, {
  recipient: { userId: "user-1" },
  data: { conversationId: "conversation-1" },
  idempotencyKey: "turn-1",
});

acceptsSend(app.notifications.magicLink, {
  recipient: { email: "user@example.org" },
  data: { token: "secret" },
  idempotencyKey: "magic-link-1",
});

acceptsSend(app.notifications.turnCompleted, {
  // @ts-expect-error User-targeted kinds cannot bypass preferences with an email address.
  recipient: { email: "user@example.org" },
  data: { conversationId: "c" },
  idempotencyKey: "x",
});

// @ts-expect-error Payload fields retain their schema-inferred types across defineApp.
acceptsSend(app.notifications.turnCompleted, { recipient: { userId: "u" }, data: { conversationId: 42 }, idempotencyKey: "x" });

describe("notification definitions", () => {
  test("bind stable app-qualified ids", () => {
    expect(app.notifications.turnCompleted.id).toBe("type-test.turnCompleted");
    expect(app.notifications.magicLink.id).toBe("type-test.magicLink");
  });

  test("reject email recipients without required email delivery", () => {
    expect(() =>
      notification({
        recipient: "email",
        label: "Invite",
        description: "Invite by email.",
        data: z.object({}),
        render: () => ({ title: "Invite" }),
      }),
    ).toThrow("must require the email channel");
  });
});
