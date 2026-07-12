import { describe, expect, test } from "bun:test";
import { withNotificationTimeout } from "./notification-timeout";

describe("browser notification timeout", () => {
  test("returns a completed status check", async () => {
    await expect(withNotificationTimeout(Promise.resolve("ready"), 100, "timed out")).resolves.toBe("ready");
  });

  test("rejects a status check that never settles", async () => {
    const pending = new Promise<never>(() => undefined);
    await expect(withNotificationTimeout(pending, 5, "status timed out")).rejects.toThrow("status timed out");
  });
});
