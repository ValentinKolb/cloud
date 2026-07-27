import { describe, expect, test } from "bun:test";
import {
  assistantArtifactHref,
  assistantArtifactPathFromHref,
  assistantConversationHref,
  assistantConversationIdFromHref,
  shouldCommitConversationNavigation,
} from "./assistant-navigation";

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

  test("keeps an artifact within one conversation and clears it when switching chats", () => {
    const withArtifact = assistantArtifactHref("/app/assistant?conversation=chat-1", "/files/report.md");
    expect(withArtifact).toBe("/app/assistant?conversation=chat-1&artifact=%2Ffiles%2Freport.md");
    expect(assistantArtifactPathFromHref(withArtifact)).toBe("/files/report.md");
    expect(assistantConversationHref(withArtifact, "chat-2")).toBe("/app/assistant?conversation=chat-2");
    expect(assistantArtifactHref(withArtifact, null)).toBe("/app/assistant?conversation=chat-1");
  });

  test("commits successful opens and in-flight same-target clicks without duplicating the current URL", () => {
    const current = "/app/assistant?conversation=chat-1";
    const target = "/app/assistant?conversation=chat-2";
    expect(shouldCommitConversationNavigation("opened", current, target)).toBe(true);
    expect(shouldCommitConversationNavigation("unchanged", current, target)).toBe(true);
    expect(shouldCommitConversationNavigation("unchanged", current, current)).toBe(false);
    expect(shouldCommitConversationNavigation("stale", current, target)).toBe(false);
  });
});
