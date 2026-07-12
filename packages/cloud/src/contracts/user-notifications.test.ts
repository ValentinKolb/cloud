import { describe, expect, test } from "bun:test";
import { BrowserPushSubscriptionSchema } from "./user-notifications";

const subscription = (endpoint: string) => ({
  endpoint,
  expirationTime: null,
  keys: { p256dh: "p".repeat(65), auth: "a".repeat(24) },
});

describe("browser push subscription contract", () => {
  test("accepts public HTTPS endpoints", () => {
    expect(BrowserPushSubscriptionSchema.safeParse(subscription("https://push.example.test/subscriptions/one")).success).toBe(true);
  });

  test("rejects local, private, credentialed, and non-standard-port endpoints", () => {
    for (const endpoint of [
      "https://localhost/push",
      "https://127.0.0.1/push",
      "https://[::1]/push",
      "https://user:pass@push.example.test/push",
      "https://push.example.test:8443/push",
    ]) {
      expect(BrowserPushSubscriptionSchema.safeParse(subscription(endpoint)).success).toBe(false);
    }
  });
});
