import { describe, expect, test } from "bun:test";
import {
  activateWorkflowInputSchema,
  backfillWorkflowInputSchema,
  createConversationCommentSchema,
  createWorkflowInputSchema,
  createWorkflowVersionInputSchema,
  deactivateWorkflowInputSchema,
  dryRunWorkflowInputSchema,
  invokeWorkflowInputSchema,
  mailSearchExpressionSchema,
  mergeConversationsInputSchema,
  messageStateChangeSchema,
  oneShotWorkflowInputSchema,
  preflightWorkflowInputSchema,
  splitConversationInputSchema,
  updateConversationCollaborationSchema,
  updateConversationCommentSchema,
  validateWorkflowInputSchema,
  workflowRunStateSchema,
  workflowTargetStateSchema,
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

  test("keeps exact YAML source and rejects the provisional JSON definition envelope", () => {
    const source = "steps:\n  - succeed:\n      message: Done\n";
    expect(validateWorkflowInputSchema.parse({ source })).toEqual({ source });
    expect(validateWorkflowInputSchema.safeParse({ source: "  \n" }).success).toBe(false);
    expect(validateWorkflowInputSchema.safeParse({ source, definition: { steps: [] } }).success).toBe(false);

    const created = createWorkflowInputSchema.parse({ name: "Route mail", source });
    expect(created).toMatchObject({ name: "Route mail", source, priority: 100 });
    expect(created.effectBudget.maxTargets).toBe(1_000);
    expect(createWorkflowInputSchema.safeParse({ name: "Route mail", source, enabled: true }).success).toBe(false);
    expect(createWorkflowVersionInputSchema.safeParse({ name: "Not version metadata", source }).success).toBe(false);
  });

  test("keeps activation metadata outside YAML and trigger registrations inside it", () => {
    const expectedVersionId = "00000000-0000-4000-8000-000000000001";
    expect(activateWorkflowInputSchema.parse({ expectedVersionId })).toEqual({ expectedVersionId });
    expect(activateWorkflowInputSchema.safeParse({ expectedVersionId, triggers: [] }).success).toBe(false);
    expect(activateWorkflowInputSchema.safeParse({ expectedVersionId, enabled: true }).success).toBe(false);
    expect(deactivateWorkflowInputSchema.safeParse({ expectedVersionId }).success).toBe(true);
    expect(deactivateWorkflowInputSchema.safeParse({ expectedVersionId, reason: "legacy" }).success).toBe(false);
  });

  test("separates advisory dry runs from effectful preflight-bound runs", () => {
    const expectedVersionId = "00000000-0000-4000-8000-000000000001";
    const base = {
      expectedVersionId,
      inputs: { threshold: 3 },
      query: { type: "all" as const },
    };
    const effectful = {
      ...base,
      occurredAt: "2026-07-15T12:00:00.000Z",
      preflightHash: "a".repeat(64),
      idempotencyKey: "route-mail-1",
    };

    expect(preflightWorkflowInputSchema.safeParse(base).success).toBe(true);
    expect(preflightWorkflowInputSchema.safeParse({ expectedVersionId, inputs: {} }).success).toBe(false);
    expect(dryRunWorkflowInputSchema.safeParse({ ...base, idempotencyKey: "dry-run-1" }).success).toBe(true);
    expect(dryRunWorkflowInputSchema.safeParse(effectful).success).toBe(false);
    expect(invokeWorkflowInputSchema.safeParse(effectful).success).toBe(true);
    expect(backfillWorkflowInputSchema.safeParse(effectful).success).toBe(true);
    expect(oneShotWorkflowInputSchema.safeParse(effectful).success).toBe(true);
    expect(invokeWorkflowInputSchema.safeParse({ ...base, idempotencyKey: "missing-preflight" }).success).toBe(false);
  });

  test("exposes materialization only as a parent run state", () => {
    expect(workflowRunStateSchema.parse("materializing")).toBe("materializing");
    expect(workflowTargetStateSchema.safeParse("materializing").success).toBe(false);
  });
});
