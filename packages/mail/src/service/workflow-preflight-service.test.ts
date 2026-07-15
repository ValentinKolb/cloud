import { describe, expect, test } from "bun:test";
import type { WorkflowBoundPlan } from "@valentinkolb/cloud/workflows";
import type { FrozenMailWorkflowSource } from "./workflow-data";
import { buildFrozenWorkflowInputs, planFrozenWorkflowTarget, workflowPlanRequirements } from "./workflow-preflight-service";

const source: FrozenMailWorkflowSource = {
  message: {
    id: "20000000-0000-4000-8000-000000000001",
    remoteMessageRefId: "20000000-0000-4000-8000-000000000002",
    messageId: "20000000-0000-4000-8000-000000000001",
    conversationId: "20000000-0000-4000-8000-000000000003",
    subject: "Invoice",
    body: "Attached invoice",
    bodyText: "Attached invoice",
    bodyHtml: "<p>Attached invoice</p>",
    bodyAvailable: true,
    attachmentsAvailable: true,
    sender: [{ role: "from", name: "Sender", email: "sender@example.test" }],
    recipients: [{ role: "to", name: null, email: "mailbox@example.test" }],
    attachments: [
      {
        id: "20000000-0000-4000-8000-000000000004",
        filename: "invoice.pdf",
        contentType: "application/pdf",
        disposition: "attachment",
        contentId: null,
        sizeBytes: 100,
      },
    ],
    hasAttachments: true,
    folderId: "20000000-0000-4000-8000-000000000005",
    flags: ["seen"],
    keywords: ["finance"],
    direction: "inbound",
    internalDate: "2026-07-15T10:00:00.000Z",
    receivedAt: "2026-07-15T10:00:00.000Z",
    sentAt: null,
  },
  conversation: {
    id: "20000000-0000-4000-8000-000000000003",
    subject: "Invoice",
    assigneeUserId: null,
    status: "open",
    workStatus: "open",
    responseNeeded: true,
    revision: 4,
    latestMessageAt: "2026-07-15T10:00:00.000Z",
  },
};

const plan: WorkflowBoundPlan = {
  schemaVersion: 2,
  languageId: "mail",
  languageVersion: 1,
  sourceHash: "a".repeat(64),
  manifestHash: "b".repeat(64),
  catalogHash: "c".repeat(64),
  actionPolicies: {
    addKeyword: { effect: "durable-intent", dryRun: "validate" },
    setConversationStatus: { effect: "transactional", dryRun: "full" },
  },
  inputs: [
    { name: "message", type: "mailMessage", config: { required: true } },
    { name: "conversation", type: "mailConversation", config: { required: true } },
  ],
  triggers: [],
  steps: [
    {
      kind: "if",
      condition: { operator: "contains", operands: ["${{ inputs.message.body }}", "invoice"] },
      then: [
        {
          kind: "action",
          action: "addKeyword",
          config: { message: "${{ inputs.message }}", keyword: "finance" },
          sourcePath: ["steps", 0, "then", 0],
        },
        {
          kind: "action",
          action: "setConversationStatus",
          config: { conversation: "${{ inputs.conversation }}", status: "done" },
          sourcePath: ["steps", 0, "then", 1],
        },
      ],
      else: [],
      sourcePath: ["steps", 0],
    },
  ],
  bindings: {},
};

describe("Mail workflow preflight", () => {
  test("derives frozen-data requirements from the shared bound plan", () => {
    expect(workflowPlanRequirements(plan)).toEqual({ body: true, attachments: false, conversation: true });
  });

  test("maps declared Mail inputs to complete frozen objects", () => {
    const inputs = buildFrozenWorkflowInputs(plan, source, { callerValue: "kept", message: "untrusted-id" });
    expect(inputs.callerValue).toBe("kept");
    expect(inputs.message).toBe(source.message);
    expect(inputs.conversation).toBe(source.conversation);
  });

  test("uses shared dry-run traversal and excludes no-op effects", async () => {
    const result = await planFrozenWorkflowTarget({
      workflowId: "10000000-0000-4000-8000-000000000001",
      versionIdentity: "version-1",
      plan,
      source,
      inputs: {},
      occurredAt: "2026-07-15T11:00:00.000Z",
    });
    expect(result).toEqual({
      ok: true,
      data: [{ category: "collaboration", action: "setConversationStatus", stepPath: ["steps", 0, "then", 1] }],
    });
  });

  test("plans shared variables and terminal actions without Mail effects", async () => {
    const result = await planFrozenWorkflowTarget({
      workflowId: "10000000-0000-4000-8000-000000000001",
      versionIdentity: "version-1",
      plan: {
        ...plan,
        actionPolicies: {
          setVariable: { effect: "pure", dryRun: "full" },
          succeed: { effect: "pure", dryRun: "full" },
        },
        steps: [
          {
            kind: "action",
            action: "setVariable",
            config: { name: "subject", value: "${{ inputs.message.subject }}" },
            sourcePath: ["steps", 0],
          },
          {
            kind: "action",
            action: "succeed",
            config: { message: "Planned ${{ subject }}" },
            sourcePath: ["steps", 1],
          },
        ],
      },
      source,
      inputs: {},
      occurredAt: "2026-07-15T11:00:00.000Z",
    });

    expect(result).toEqual({ ok: true, data: [] });
  });
});
