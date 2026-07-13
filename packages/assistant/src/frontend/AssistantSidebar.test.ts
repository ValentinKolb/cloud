import { describe, expect, test } from "bun:test";
import type { AiConversation } from "@valentinkolb/cloud/ai";
import { groupRecentConversations } from "./conversation-view";

const conversation = (id: string, updatedAt: string, pinnedAt: string | null = null): AiConversation => ({
  id,
  appId: "assistant",
  title: id,
  titleSource: "default",
  icon: "ti ti-message",
  description: "",
  descriptionSource: "default",
  keywords: [],
  pinnedAt,
  archivedAt: null,
  runStatus: "idle",
  unreadCompletion: false,
  resource: { kind: "direct" },
  createdByUserId: "user-1",
  createdAt: updatedAt,
  updatedAt,
});

describe("Assistant recent conversation groups", () => {
  test("keeps old pinned chats visible without duplicating them in date groups", () => {
    const groups = groupRecentConversations(
      [
        conversation("pinned", "2025-01-01T00:00:00.000Z", "2026-07-12T09:00:00.000Z"),
        conversation("today", "2026-07-12T08:00:00.000Z"),
        conversation("old", "2025-01-01T00:00:00.000Z"),
      ],
      new Date("2026-07-12T10:00:00.000Z"),
    );

    expect(groups.map((group) => [group.title, group.items.map((item) => item.id)])).toEqual([
      ["Pinned", ["pinned"]],
      ["Today", ["today"]],
    ]);
  });
});
