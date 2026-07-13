import { describe, expect, test } from "bun:test";
import type { WorkflowDefinition } from "../contracts";
import { normalizeWorkflowFlags, workflowSourceStateHash } from "./workflow-data";
import { evaluateWorkflow, validateWorkflowDefinition, type WorkflowSnapshot } from "./workflow-evaluator";

const FOLDER_ID = "00000000-0000-4000-8000-000000000001";
const DESTINATION_ID = "00000000-0000-4000-8000-000000000002";
const USER_ID = "00000000-0000-4000-8000-000000000003";

const definition = (steps: WorkflowDefinition["steps"]): WorkflowDefinition => ({
  version: 1,
  name: "Route mail",
  description: null,
  priority: 100,
  trigger: { type: "backfill" },
  effectBudget: {
    maxTargets: 1_000,
    maxMoves: 1_000,
    maxKeywordChanges: 2_000,
    maxCollaborationChanges: 2_000,
  },
  steps,
});

const snapshot = (overrides: Partial<WorkflowSnapshot> = {}): WorkflowSnapshot => ({
  remoteMessageRefId: "00000000-0000-4000-8000-000000000010",
  messageId: "00000000-0000-4000-8000-000000000011",
  conversationId: "00000000-0000-4000-8000-000000000012",
  subject: "Invoice for July",
  body: "Please review the attached invoice.",
  bodyAvailable: true,
  senderValues: ["Billing", "billing@example.com"],
  recipientValues: ["support@example.com"],
  attachmentNames: ["invoice.pdf"],
  attachmentsAvailable: true,
  hasAttachment: true,
  contentHash: "a".repeat(64),
  internalDate: "2026-07-13T00:00:00.000Z",
  folderId: FOLDER_ID,
  flags: [],
  keywords: [],
  collaboration: {
    revision: 4,
    assigneeUserId: null,
    workStatus: "open",
    responseNeeded: true,
  },
  ...overrides,
});

describe("mail workflow validation", () => {
  test("rejects cloud actions after provider mutations and actions after a move", () => {
    const validation = validateWorkflowDefinition(
      definition([
        { action: "remote.move", destinationFolderId: DESTINATION_ID },
        { action: "assign", userId: USER_ID },
      ]),
    );

    expect(validation.valid).toBe(false);
    expect(validation.diagnostics.map((item) => item.code)).toContain("ACTION_ORDER");
    expect(validation.diagnostics.map((item) => item.code)).toContain("MOVE_MUST_BE_LAST");
  });

  test("rejects contradictory keyword changes on one reachable path", () => {
    const validation = validateWorkflowDefinition(
      definition([
        { action: "remote.keyword.add", keyword: "Finance" },
        { action: "remote.keyword.remove", keyword: "finance" },
      ]),
    );

    expect(validation.valid).toBe(false);
    expect(validation.diagnostics).toContainEqual(expect.objectContaining({ code: "KEYWORD_CONFLICT", path: "steps.1" }));
  });
});

describe("mail workflow evaluation", () => {
  test("normalizes IMAP system flags and binds source hashes to message identity", () => {
    expect(normalizeWorkflowFlags(["\\Seen", "\\Answered"])).toEqual(["answered", "seen"]);
    expect(workflowSourceStateHash(snapshot(), "1")).not.toBe(
      workflowSourceStateHash(snapshot({ conversationId: "00000000-0000-4000-8000-000000000099" }), "1"),
    );
  });

  test("selects one branch, removes no-ops, and freezes collaboration revisions", () => {
    const result = evaluateWorkflow(
      definition([
        {
          when: {
            any: [
              { field: "subject", operator: "contains", value: "invoice" },
              { field: "attachmentName", operator: "endsWith", value: ".pdf" },
            ],
          },
          then: [
            { action: "assign", userId: USER_ID },
            { action: "status.set", status: "waiting" },
            { action: "remote.keyword.add", keyword: "Finance" },
            { action: "remote.move", destinationFolderId: DESTINATION_ID },
          ],
          else: [{ action: "remote.keyword.add", keyword: "Other" }],
        },
      ]),
      snapshot(),
    );

    expect(result.state).toBe("ready");
    if (result.state !== "ready") return;
    expect(result.actions.map((item) => item.action.action)).toEqual(["assign", "status.set", "remote.keyword.add", "remote.move"]);
    expect(result.actions.map((item) => item.expectedConversationRevision)).toEqual([4, 5, null, null]);
    expect(result.actions.map((item) => item.path)).toEqual(["steps.0.then.0", "steps.0.then.1", "steps.0.then.2", "steps.0.then.3"]);
  });

  test("short-circuits a false all-condition without waiting for an unavailable body", () => {
    const result = evaluateWorkflow(
      definition([
        {
          when: {
            all: [
              { field: "subject", operator: "contains", value: "not present" },
              { field: "body", operator: "contains", value: "invoice" },
            ],
          },
          then: [{ action: "remote.keyword.add", keyword: "Finance" }],
        },
      ]),
      snapshot({ body: "", bodyAvailable: false }),
    );

    expect(result).toEqual({ state: "ready", actions: [] });
  });

  test("reports waiting data when the selected branch needs unavailable attachment metadata", () => {
    const result = evaluateWorkflow(
      definition([
        {
          when: { field: "attachmentName", operator: "endsWith", value: ".pdf" },
          then: [{ action: "remote.keyword.add", keyword: "Finance" }],
        },
      ]),
      snapshot({ attachmentNames: [], attachmentsAvailable: false }),
    );

    expect(result).toEqual({ state: "waiting_data", actions: [] });
  });
});
