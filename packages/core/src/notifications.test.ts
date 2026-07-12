import { describe, expect, test } from "bun:test";
import { app } from "./config";

describe("Core notification definitions", () => {
  test("keeps account expiry reminders required and user-bound", () => {
    const reminder = app.notifications.accountExpiryReminder;

    expect(reminder.id).toBe("core.accountExpiryReminder");
    expect(reminder.recipient).toBe("user");
    expect(reminder.delivery?.required).toEqual(["email"]);
  });
});
