import { describe, expect, test } from "bun:test";
import {
  createSavedWorkflowRunInputSchema,
  createConversationCommentSchema,
  mailSearchExpressionSchema,
  mergeConversationsInputSchema,
  messageStateChangeSchema,
  splitConversationInputSchema,
  updateConversationCollaborationSchema,
  updateConversationCommentSchema,
  workflowDefinitionSchema,
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

  test("requires explicit confirmation and unique message ids for manual threading", () => {
    const sourceConversationId = "00000000-0000-4000-8000-000000000001";
    const messageId = "00000000-0000-4000-8000-000000000002";
    expect(
      mergeConversationsInputSchema.safeParse({
        sourceConversationId,
        expectedTargetRevision: 1,
        expectedSourceRevision: 1,
      }).success,
    ).toBe(false);
    expect(
      splitConversationInputSchema.safeParse({
        messageIds: [messageId, messageId],
        expectedRevision: 1,
        confirm: true,
      }).success,
    ).toBe(false);
  });
});

describe("mail workflow contracts", () => {
  test("rejects deeply nested search expressions without overflowing the stack", () => {
    let expression: unknown = { field: "subject", query: "invoice", match: "contains" };
    for (let depth = 0; depth < 10_000; depth += 1) expression = { not: expression };

    expect(() => mailSearchExpressionSchema.safeParse(expression)).not.toThrow();
    expect(mailSearchExpressionSchema.safeParse(expression).success).toBe(false);

    const cyclic: { not?: unknown } = {};
    cyclic.not = cyclic;
    expect(() => mailSearchExpressionSchema.safeParse(cyclic)).not.toThrow();
    expect(mailSearchExpressionSchema.safeParse(cyclic).success).toBe(false);
  });

  test("rejects deeply nested workflow trees without overflowing the stack", () => {
    let step: unknown = { action: "status.set", status: "done" };
    for (let depth = 0; depth < 10_000; depth += 1) {
      step = {
        when: { field: "subject", operator: "contains", value: "invoice" },
        then: [step],
      };
    }
    const definition = {
      version: 1,
      name: "Deep workflow",
      trigger: { type: "manual" },
      effectBudget: { maxTargets: 1, maxMoves: 0, maxKeywordChanges: 0, maxCollaborationChanges: 1 },
      steps: [step],
    };

    expect(() => workflowDefinitionSchema.safeParse(definition)).not.toThrow();
    expect(workflowDefinitionSchema.safeParse(definition).success).toBe(false);
  });

  test("rejects blank text conditions and out-of-range database versions", () => {
    expect(
      workflowDefinitionSchema.safeParse({
        version: 1,
        name: "Blank condition",
        trigger: { type: "manual" },
        effectBudget: { maxTargets: 1, maxMoves: 0, maxKeywordChanges: 0, maxCollaborationChanges: 1 },
        steps: [
          {
            when: { field: "subject", operator: "contains", value: "   " },
            then: [{ action: "status.set", status: "done" }],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      createSavedWorkflowRunInputSchema.safeParse({
        query: { type: "all" },
        previewHash: "a".repeat(64),
        idempotencyKey: "version-overflow",
        version: 2_147_483_648,
      }).success,
    ).toBe(false);
  });
});
