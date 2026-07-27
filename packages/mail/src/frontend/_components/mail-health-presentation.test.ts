import { describe, expect, test } from "bun:test";
import { mailboxHealthPresentation } from "./mail-health-presentation";

describe("mailbox health presentation", () => {
  test("explains a transient connection timeout without blaming saved settings", () => {
    const presentation = mailboxHealthPresentation({
      health: "degraded",
      healthReason: "Failed to establish connection in required time",
    });

    expect(presentation).toMatchObject({
      title: "Mail is taking longer to connect",
      action: "health",
      actionLabel: "View status",
    });
    expect(presentation?.message).toContain("saved account is valid");
    expect(presentation?.message).not.toContain("Failed to establish");
  });

  test("directs authentication failures to delivery settings", () => {
    expect(mailboxHealthPresentation({ health: "auth_required", healthReason: "invalid credentials" })).toMatchObject({
      action: "delivery",
      actionLabel: "Reconnect account",
    });
  });

  test("keeps transitional states informative and active mailboxes quiet", () => {
    expect(mailboxHealthPresentation({ health: "reconnecting", healthReason: null })?.tone).toBe("info");
    expect(mailboxHealthPresentation({ health: "active", healthReason: null })).toBeNull();
    expect(mailboxHealthPresentation({ health: "paused", healthReason: null })?.message).toContain("resumed");
  });
});
