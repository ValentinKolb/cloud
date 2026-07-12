import { describe, expect, test } from "bun:test";
import { notificationTargetMatchesLocation } from "./notification-target";

describe("notificationTargetMatchesLocation", () => {
  test("accepts extra state on the current view", () => {
    expect(
      notificationTargetMatchesLocation(
        "/app/assistant?conversation=chat-1",
        "https://cloud.example/app/assistant?conversation=chat-1&artifact=%2Freport.md",
      ),
    ).toBe(true);
  });

  test("distinguishes another resource and rejects cross-origin targets", () => {
    expect(
      notificationTargetMatchesLocation("/app/assistant?conversation=chat-1", "https://cloud.example/app/assistant?conversation=chat-2"),
    ).toBe(false);
    expect(notificationTargetMatchesLocation("https://other.example/app/assistant", "https://cloud.example/app/assistant")).toBe(false);
  });
});
