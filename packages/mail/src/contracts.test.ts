import { describe, expect, test } from "bun:test";
import {
  createConversationCommentSchema,
  messageStateChangeSchema,
  updateConversationCollaborationSchema,
  updateConversationCommentSchema,
} from "./contracts";

describe("mail message state contracts", () => {
  test("keeps system flags and provider keywords in separate namespaces", () => {
    expect(
      messageStateChangeSchema.safeParse({
        addFlags: ["seen"],
        removeFlags: [],
        addKeywords: [],
        removeKeywords: ["seen"],
      }).success,
    ).toBe(true);
  });

  test("rejects contradictory changes within one namespace", () => {
    expect(
      messageStateChangeSchema.safeParse({
        addFlags: ["seen"],
        removeFlags: ["seen"],
        addKeywords: [],
        removeKeywords: [],
      }).success,
    ).toBe(false);
    expect(
      messageStateChangeSchema.safeParse({
        addFlags: [],
        removeFlags: [],
        addKeywords: ["FollowUp"],
        removeKeywords: ["followup"],
      }).success,
    ).toBe(false);
  });
});

describe("mail collaboration contracts", () => {
  test("requires one collaboration change", () => {
    expect(updateConversationCollaborationSchema.safeParse({ expectedRevision: 1 }).success).toBe(false);
    expect(updateConversationCollaborationSchema.safeParse({ expectedRevision: 1, assigneeUserId: null }).success).toBe(true);
  });

  test("preserves comment whitespace while rejecting blank comments", () => {
    const parsed = createConversationCommentSchema.safeParse({ body: "  useful context  ", mentionUserIds: [] });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.body).toBe("  useful context  ");
    expect(createConversationCommentSchema.safeParse({ body: " \n\t ", mentionUserIds: [] }).success).toBe(false);
  });

  test("rejects duplicate mentions in comment revisions", () => {
    const userId = "00000000-0000-4000-8000-000000000001";
    expect(
      updateConversationCommentSchema.safeParse({
        expectedRevision: 1,
        body: "Updated",
        mentionUserIds: [userId, userId],
      }).success,
    ).toBe(false);
  });
});
