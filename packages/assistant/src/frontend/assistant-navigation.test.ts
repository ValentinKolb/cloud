import { describe, expect, test } from "bun:test";
import { assistantConversationHref, assistantConversationIdFromHref } from "./assistant-navigation";

describe("Assistant conversation navigation", () => {
  test("sets and encodes the conversation while preserving other URL state", () => {
    expect(assistantConversationHref("https://cloud.test/app/assistant?mode=compact#latest", "chat / one")).toBe(
      "/app/assistant?mode=compact&conversation=chat+%2F+one#latest",
    );
  });

  test("removes only the conversation parameter", () => {
    expect(assistantConversationHref("/app/assistant?conversation=old&mode=compact#latest", null)).toBe(
      "/app/assistant?mode=compact#latest",
    );
  });

  test("reads conversation ids from absolute and relative hrefs", () => {
    expect(assistantConversationIdFromHref("/app/assistant?conversation=chat-1")).toBe("chat-1");
    expect(assistantConversationIdFromHref("https://cloud.test/app/assistant?conversation=chat%202")).toBe("chat 2");
    expect(assistantConversationIdFromHref("/app/assistant")).toBeNull();
  });
});
