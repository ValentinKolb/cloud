import { describe, expect, test } from "bun:test";
import {
  activateWorkflowInputSchema,
  addConversationLocalTagsSchema,
  backfillWorkflowInputSchema,
  cancelScheduledSendInputSchema,
  conversationTriageInputSchema,
  createAutomaticReplyConfigurationSchema,
  createConversationCommentSchema,
  createDraftAttachmentUploadSchema,
  createLocalTagSchema,
  createSenderIdentityInputSchema,
  createWorkflowInputSchema,
  createWorkflowVersionInputSchema,
  deactivateWorkflowInputSchema,
  draftContentInputSchema,
  draftEditableContentInputSchema,
  dryRunWorkflowInputSchema,
  invokeWorkflowInputSchema,
  mailSearchExpressionSchema,
  mergeConversationsInputSchema,
  messageStateChangeSchema,
  oneShotWorkflowInputSchema,
  parseConnectorCapabilities,
  preflightWorkflowInputSchema,
  reassignConversationMessageInputSchema,
  scheduledSendPageSchema,
  splitConversationInputSchema,
  updateAutomaticReplyConfigurationSchema,
  updateConversationCollaborationSchema,
  updateConversationCommentSchema,
  updateLocalTagSchema,
  validateWorkflowInputSchema,
  workflowRunStateSchema,
  workflowTargetStateSchema,
} from "./contracts";

describe("conversation tag contracts", () => {
  test("normalizes valid colors and rejects ambiguous tag colors", () => {
    expect(createLocalTagSchema.parse({ name: "Priority", color: " #AABBCC " })).toEqual({
      name: "Priority",
      color: "#aabbcc",
    });
    expect(createLocalTagSchema.safeParse({ name: "Priority", color: "red" }).success).toBe(false);
    expect(updateLocalTagSchema.safeParse({ expectedRevision: 1 }).success).toBe(false);
    expect(updateLocalTagSchema.safeParse({ expectedRevision: 1, color: "#0f766e" }).success).toBe(true);
  });

  test("bounds additive bulk assignments and rejects duplicate ids", () => {
    const conversationId = "00000000-0000-4000-8000-000000000001";
    const tagId = "00000000-0000-4000-8000-000000000002";
    expect(addConversationLocalTagsSchema.safeParse({ conversationIds: [conversationId], tagIds: [tagId] }).success).toBe(true);
    expect(addConversationLocalTagsSchema.safeParse({ conversationIds: [conversationId, conversationId], tagIds: [tagId] }).success).toBe(
      false,
    );
    expect(addConversationLocalTagsSchema.safeParse({ conversationIds: [conversationId], tagIds: [tagId, tagId] }).success).toBe(false);
    expect(addConversationLocalTagsSchema.safeParse({ conversationIds: [], tagIds: [tagId] }).success).toBe(false);
  });
});

const draftEditableContent = {
  senderIdentityId: "00000000-0000-4000-8000-000000000001",
  to: [],
  cc: [],
  bcc: [],
  subject: "Subject",
  body: "Body",
  format: "plain" as const,
};

describe("mail draft contracts", () => {
  test("keeps draft context immutable and bounds attachment uploads", () => {
    expect(draftEditableContentInputSchema.safeParse({ ...draftEditableContent, intent: "reply" }).success).toBe(false);
    expect(
      draftContentInputSchema.safeParse({
        ...draftEditableContent,
        conversationId: "00000000-0000-4000-8000-000000000002",
        intent: "reply",
        sourceMessageId: "00000000-0000-4000-8000-000000000003",
        includeSourceAttachments: false,
      }).success,
    ).toBe(true);
    expect(
      draftContentInputSchema.safeParse({
        ...draftEditableContent,
        conversationId: "00000000-0000-4000-8000-000000000002",
        intent: "forward",
        sourceMessageId: "00000000-0000-4000-8000-000000000003",
        includeSourceAttachments: true,
      }).success,
    ).toBe(true);
    expect(
      createDraftAttachmentUploadSchema.safeParse({
        filename: "too-large.bin",
        contentType: "application/octet-stream",
        byteLength: 100 * 1024 * 1024 + 1,
      }).success,
    ).toBe(false);
  });
});

describe("scheduled send contracts", () => {
  test("requires an explicit cancellation disposition and bounded projection", () => {
    expect(cancelScheduledSendInputSchema.safeParse({ disposition: "draft" }).success).toBe(true);
    expect(cancelScheduledSendInputSchema.safeParse({ disposition: "discard" }).success).toBe(true);
    expect(cancelScheduledSendInputSchema.safeParse({}).success).toBe(false);
    expect(cancelScheduledSendInputSchema.safeParse({ disposition: "delete" }).success).toBe(false);

    expect(
      scheduledSendPageSchema.safeParse({
        items: [
          {
            id: "00000000-0000-4000-8000-000000000001",
            commandId: "00000000-0000-4000-8000-000000000002",
            draftId: "00000000-0000-4000-8000-000000000003",
            conversationId: null,
            intent: "new",
            to: [{ name: null, address: "recipient@example.com" }],
            cc: [],
            bcc: [],
            subject: "Scheduled",
            bodyPreview: "Preview",
            scheduledAt: "2026-07-18T09:00:00.000Z",
            nextAttemptAt: null,
            state: "scheduled",
            attempt: 0,
            lastError: null,
            scheduledBy: { kind: "user", displayName: "Ada" },
            createdAt: "2026-07-17T09:00:00.000Z",
          },
        ],
        nextCursor: null,
        total: 1,
      }).success,
    ).toBe(true);
  });
});

describe("automatic reply configuration contracts", () => {
  const configuration = {
    name: "Out of office",
    enabled: true,
    senderIdentityId: "00000000-0000-4000-8000-000000000001",
    subject: "Re: original subject",
    body: "I am away.",
    format: "markdown" as const,
    ensureReference: false,
    minimumIntervalHours: 168,
    inactiveBehavior: "skip" as const,
    schedule: {
      timeZone: "Europe/Berlin",
      activeRanges: [{ from: "2026-07-20", to: "2026-08-03" }],
      weeklyWindows: [{ weekday: 1 as const, start: "00:00", end: "24:00" }],
      exceptions: [],
    },
  };

  test("keeps presets out of the persisted contract", () => {
    expect(createAutomaticReplyConfigurationSchema.safeParse(configuration).success).toBe(true);
    expect(createAutomaticReplyConfigurationSchema.safeParse({ ...configuration, preset: "out-of-office" }).success).toBe(false);
    expect(
      updateAutomaticReplyConfigurationSchema.safeParse({
        expectedRevision: 1,
        ...configuration,
      }).success,
    ).toBe(true);
    expect(updateAutomaticReplyConfigurationSchema.safeParse({ expectedRevision: 1, ...configuration, body: "  " }).success).toBe(false);
  });
});

describe("sender identity contracts", () => {
  test("requires an internal label and supplies safe identity defaults", () => {
    expect(
      createSenderIdentityInputSchema.safeParse({
        fromAddress: "sender@example.com",
      }).success,
    ).toBe(false);
    expect(
      createSenderIdentityInputSchema.parse({
        label: "Work",
        fromAddress: "sender@example.com",
      }),
    ).toMatchObject({
      label: "Work",
      displayName: "",
      defaultCc: [],
      authenticationPolicy: { automation: "mailbox" },
    });
  });

  test("preserves an explicit automation opt-out", () => {
    expect(
      createSenderIdentityInputSchema.parse({
        label: "Work",
        fromAddress: "sender@example.com",
        authenticationPolicy: { automation: "disabled" },
      }).authenticationPolicy,
    ).toEqual({ automation: "disabled" });
  });
});

describe("mail message state contracts", () => {
  test("accepts a bounded conversation move to a concrete folder", () => {
    expect(
      conversationTriageInputSchema.safeParse({
        kind: "move_to_folder",
        sourceFolderId: "00000000-0000-4000-8000-000000000001",
        destinationFolderId: "00000000-0000-4000-8000-000000000002",
        idempotencyKey: "move:test",
      }).success,
    ).toBe(true);
  });

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
    const parsed = createConversationCommentSchema.safeParse({ body: "  useful context  " });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.body).toBe("  useful context  ");
    expect(createConversationCommentSchema.safeParse({ body: " \n\t " }).success).toBe(false);
    expect(updateConversationCommentSchema.safeParse({ expectedRevision: 1, body: "Updated" }).success).toBe(true);
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
    expect(
      reassignConversationMessageInputSchema.safeParse({
        targetConversationId: sourceConversationId,
        expectedSourceRevision: 1,
        expectedTargetRevision: 1,
        confirm: true,
      }).success,
    ).toBe(true);
    expect(
      reassignConversationMessageInputSchema.safeParse({
        targetConversationId: sourceConversationId,
        expectedSourceRevision: 1,
        expectedTargetRevision: 1,
      }).success,
    ).toBe(false);
  });
});

describe("mail workflow contracts", () => {
  test("accepts only the canonical discriminated search AST", () => {
    const expressions = [
      { type: "text", field: "participants", query: "customer@example.com", match: "exact" },
      { type: "text", field: "attachment_name", query: "invoice", match: "contains" },
      { type: "text", field: "comment", query: "follow up", match: "words" },
      { type: "text", field: "reference", query: "SUP-42", match: "exact" },
      { type: "text", field: "folder", query: "Support", match: "phrase" },
      { type: "text", field: "tag", query: "Priority", match: "exact" },
      { type: "text", field: "keyword", query: "RemoteImportant", match: "exact" },
      { type: "date", field: "internal_date", operator: "after", value: "2026-07-01T00:00:00.000Z" },
      { type: "size", field: "attachment", operator: "at_least", bytes: 1024 },
      { type: "work_status", value: "waiting" },
      { type: "assignee", userId: null },
      { type: "snoozed", value: false },
      { type: "folder_id", folderId: crypto.randomUUID() },
      { type: "assigned_to_me" },
      { type: "all" },
    ];
    for (const expression of expressions) expect(mailSearchExpressionSchema.safeParse(expression).success).toBe(true);
    expect(mailSearchExpressionSchema.safeParse({ field: "subject", query: "legacy" }).success).toBe(false);
    expect(mailSearchExpressionSchema.safeParse({ and: expressions }).success).toBe(false);
  });

  test("rejects deeply nested search expressions without overflowing the stack", () => {
    let expression: unknown = { type: "text", field: "subject", query: "invoice", match: "contains" };
    for (let depth = 0; depth < 10_000; depth += 1) expression = { type: "not", expression };

    expect(() => mailSearchExpressionSchema.safeParse(expression)).not.toThrow();
    expect(mailSearchExpressionSchema.safeParse(expression).success).toBe(false);

    const cyclic: { type: "not"; expression?: unknown } = { type: "not" };
    cyclic.expression = cyclic;
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

  test("validates provider capability snapshots and defaults legacy quota evidence", () => {
    const legacy = {
      idle: true,
      condstore: true,
      qresync: false,
      move: true,
      uidplus: true,
      namespace: true,
      listExtended: true,
      specialUse: true,
      acl: false,
      notify: false,
      gmailExtensions: false,
    };
    expect(parseConnectorCapabilities(legacy)).toMatchObject({ idle: true, quota: false });
    expect(parseConnectorCapabilities({ ...legacy, idle: "yes" })).toMatchObject({ idle: false, quota: false });
  });
});
