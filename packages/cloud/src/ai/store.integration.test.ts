import { describe, expect, test } from "bun:test";
import type { LoopAggregate, Message } from "@valentinkolb/nessi";
import { sql } from "bun";
import { forgetAiToolApproval, hasRememberedAiToolApproval, rememberAiToolApproval } from "./approvals";
import { migrateCloudAi } from "./migrate";
import { abortAiTurn, submitAiTurnAction } from "./runtime";
import { aiConversationStore } from "./store";
import { aiToolAudit } from "./tool-audit";

const canUseAiDatabase = async () => {
  try {
    const [authRow] = await sql<{ users: string | null }[]>`
      SELECT to_regclass('auth.users')::text AS users
    `;
    if (!authRow?.users) return false;

    await migrateCloudAi();

    const [aiRow] = await sql<
      {
        conversations: string | null;
        messages: string | null;
        turns: string | null;
        toolCalls: string | null;
        approvalPreferences: string | null;
      }[]
    >`
      SELECT
        to_regclass('ai.conversations')::text AS conversations,
        to_regclass('ai.messages')::text AS messages,
        to_regclass('ai.turns')::text AS turns,
        to_regclass('ai.tool_calls')::text AS "toolCalls",
        to_regclass('ai.tool_approval_preferences')::text AS "approvalPreferences"
    `;
    return Boolean(aiRow?.conversations && aiRow.messages && aiRow.turns && aiRow.toolCalls && aiRow.approvalPreferences);
  } catch {
    return false;
  }
};

const insertUser = async () => {
  const suffix = crypto.randomUUID();
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO auth.users (uid, provider, profile, display_name, mail, given_name, sn)
    VALUES (${`ai-store-${suffix}`}, 'local', 'user', 'AI Store Test', ${`ai-store-${suffix}@example.test`}, 'AI', 'Store')
    RETURNING id
  `;
  return row!.id;
};

const cleanupFixture = async (input: { userId: string; conversationIds: string[] }) => {
  for (const conversationId of input.conversationIds) {
    await sql`DELETE FROM ai.conversations WHERE id = ${conversationId}::uuid`;
  }
  await sql`DELETE FROM auth.users WHERE id = ${input.userId}::uuid`;
};

const parseJsonValue = <T>(value: unknown): T => (typeof value === "string" ? (JSON.parse(value) as T) : (value as T));

describe("AI conversation store integration", () => {
  test("persists conversations, messages, model metadata, and running turn locks", async () => {
    if (!(await canUseAiDatabase())) {
      console.warn("Skipping AI conversation store DB test: auth/ai tables are not available.");
      return;
    }

    const userId = await insertUser();
    const conversationIds: string[] = [];

    try {
      const direct = await aiConversationStore.createConversation({
        appId: "ai-test",
        ownerUserId: userId,
        title: "Manual title",
      });
      conversationIds.push(direct.id);

      const resource = {
        kind: "resource" as const,
        appId: "grids",
        resourceType: "base",
        resourceId: `base-${crypto.randomUUID()}`,
        title: "Base chat",
      };
      const resourceConversation = await aiConversationStore.createConversation({
        appId: "ai-test",
        ownerUserId: userId,
        resource,
      });
      conversationIds.push(resourceConversation.id);

      const metadataConversation = await aiConversationStore.createConversation({
        appId: "ai-test",
        ownerUserId: userId,
        title: "Metadata chat",
        icon: "ti ti-sparkles",
        description: "Initial description",
      });
      conversationIds.push(metadataConversation.id);
      expect(metadataConversation).toMatchObject({
        title: "Metadata chat",
        icon: "ti ti-sparkles",
        description: "Initial description",
      });

      const updatedMetadata = await aiConversationStore.updateConversationMetadata({
        conversationId: metadataConversation.id,
        appId: "ai-test",
        ownerUserId: userId,
        title: "Roadmap chat",
        icon: "ti ti-map",
        description: "Assistant planning notes",
      });
      expect(updatedMetadata).toMatchObject({
        id: metadataConversation.id,
        title: "Roadmap chat",
        icon: "ti ti-map",
        description: "Assistant planning notes",
      });

      const matchingPage = await aiConversationStore.listConversationsPage({
        appId: "ai-test",
        ownerUserId: userId,
        search: "roadmap",
        page: 1,
        perPage: 10,
      });
      expect(matchingPage.items.map((conversation) => conversation.id)).toContain(metadataConversation.id);
      expect(matchingPage.total).toBeGreaterThanOrEqual(1);

      expect(
        await aiConversationStore.archiveConversation({
          conversationId: metadataConversation.id,
          appId: "ai-test",
          ownerUserId: userId,
        }),
      ).toBe(true);
      expect(
        await aiConversationStore.getConversation({
          conversationId: metadataConversation.id,
          appId: "ai-test",
          ownerUserId: userId,
        }),
      ).toBeNull();

      const scoped = await aiConversationStore.listConversations({ appId: "ai-test", ownerUserId: userId, resource });
      expect(scoped.map((conversation) => conversation.id)).toEqual([resourceConversation.id]);
      expect(
        await aiConversationStore.getConversation({
          conversationId: resourceConversation.id,
          appId: "ai-test",
          ownerUserId: userId,
          resource: { ...resource, resourceId: "other-base" },
        }),
      ).toBeNull();

      const store = aiConversationStore.createSessionStore({ conversationId: direct.id, modelProfileId: "model-a" });
      const userMessage: Message = { role: "user", content: [{ type: "text", text: "Rewrite this text for me please" }] };
      const assistantMessage: Message = {
        role: "assistant",
        content: [{ type: "text", text: "Rewritten text." }],
        model: "provider/model",
        usage: { input: 4, output: 3, total: 7, creditsUsed: 0.007 },
        stopReason: "stop",
      };

      await store.append(userMessage);
      await store.append(assistantMessage);
      const loopAggregate: LoopAggregate = {
        turns: [
          {
            message: assistantMessage as Extract<Message, { role: "assistant" }>,
            usage: assistantMessage.usage,
            stopReason: "stop",
            toolCalls: [],
          },
        ],
        usage: assistantMessage.usage,
        toolCallCount: 0,
        toolErrorCount: 0,
        toolIssueCount: 0,
        toolMalformedCount: 0,
        toolCancelledCount: 0,
        toolIssues: [],
        assistantMessageCount: 1,
      };
      await aiConversationStore.setLatestAssistantLoopAggregate({
        conversationId: direct.id,
        aggregate: loopAggregate,
        doneReason: "stop",
      });

      const loaded = await store.load();
      expect(loaded.map((entry) => ({ seq: entry.seq, kind: entry.kind, message: entry.message }))).toEqual([
        { seq: 1, kind: "message", message: userMessage },
        { seq: 2, kind: "message", message: assistantMessage },
      ]);

      const messages = await aiConversationStore.listMessages({ conversationId: direct.id });
      expect(messages[1]).toMatchObject({
        modelProfileId: "model-a",
        providerModel: "provider/model",
        usage: { input: 4, output: 3, total: 7, creditsUsed: 0.007 },
        stopReason: "stop",
        loopAggregate,
        loopDoneReason: "stop",
      });
      expect((await aiConversationStore.getConversation({ conversationId: direct.id }))?.title).toBe("Rewrite this text for me please");

      const summaryMessage: Message = {
        role: "assistant",
        content: [{ type: "text", text: "Conversation summary: user asked for a rewrite." }],
        model: "provider/model",
        stopReason: "stop",
      };
      await aiConversationStore.compactMessages({
        conversationId: direct.id,
        checkpointSeq: 1,
        summary: summaryMessage,
        modelProfileId: "model-a",
      });
      await store.append({ role: "user", content: [{ type: "text", text: "Continue please" }] });

      expect((await store.load()).map((entry) => ({ seq: entry.seq, kind: entry.kind, message: entry.message }))).toEqual([
        { seq: 1, kind: "summary", message: summaryMessage },
        { seq: 2, kind: "message", message: assistantMessage },
        { seq: 3, kind: "message", message: { role: "user", content: [{ type: "text", text: "Continue please" }] } },
      ]);

      const turn = await aiConversationStore.createTurn({ conversationId: direct.id, modelProfileId: "model-a" });
      expect((await aiConversationStore.getRunningTurn({ conversationId: direct.id }))?.id).toBe(turn.id);
      await expect(aiConversationStore.createTurn({ conversationId: direct.id, modelProfileId: "model-a" })).rejects.toThrow();

      const loopStore = aiConversationStore.createSessionStore({
        conversationId: direct.id,
        modelProfileId: "model-a",
        turnId: turn.id,
      });
      const loopAssistantMessage: Message = {
        role: "assistant",
        content: [{ type: "text", text: "Loop scoped response." }],
        model: "provider/model",
        usage: { input: 2, output: 3, total: 5 },
        stopReason: "stop",
      };
      await loopStore.append(loopAssistantMessage);
      const loopMessages = await aiConversationStore.listMessages({ conversationId: direct.id });
      const storedLoopAssistant = loopMessages.find(
        (message) =>
          message.message.role === "assistant" &&
          message.message.content.some((part) => part.type === "text" && part.text === "Loop scoped response."),
      );
      expect(storedLoopAssistant).toMatchObject({ loopId: turn.id, modelProfileId: "model-a" });
      const loopScopedAggregate: LoopAggregate = {
        turns: [
          {
            message: loopAssistantMessage as Extract<Message, { role: "assistant" }>,
            usage: loopAssistantMessage.usage,
            stopReason: "stop",
            toolCalls: [],
          },
        ],
        usage: loopAssistantMessage.usage,
        toolCallCount: 0,
        toolErrorCount: 0,
        toolIssueCount: 0,
        toolMalformedCount: 0,
        toolCancelledCount: 0,
        toolIssues: [],
        assistantMessageCount: 1,
      };
      await aiConversationStore.setLatestAssistantLoopAggregate({
        conversationId: direct.id,
        loopId: turn.id,
        aggregate: loopScopedAggregate,
        doneReason: "stop",
      });
      const aggregatedLoopAssistant = (await aiConversationStore.listMessages({ conversationId: direct.id })).find(
        (message) => message.id === storedLoopAssistant?.id,
      );
      expect(aggregatedLoopAssistant).toMatchObject({
        loopId: turn.id,
        loopAggregate: loopScopedAggregate,
        loopDoneReason: "stop",
      });

      await aiConversationStore.savePendingTurnAction({
        conversationId: direct.id,
        turnId: turn.id,
        callId: "approval-1",
        kind: "approval",
        status: "pending",
        name: "write_record",
        args: { id: "record-1" },
        message: "Approve write",
        approvalScope: "write_record:v1",
        allowAlways: true,
        resolvedEvent: null,
      });
      expect(await aiConversationStore.listPendingTurnActions({ conversationId: direct.id, turnId: turn.id })).toEqual([
        {
          type: "approval_request",
          conversationId: direct.id,
          turnId: turn.id,
          loopId: turn.id,
          callId: "approval-1",
          name: "write_record",
          args: { id: "record-1" },
          message: "Approve write",
          allowAlways: true,
        },
      ]);
      const resolved = await aiConversationStore.resolvePendingTurnAction({
        conversationId: direct.id,
        turnId: turn.id,
        callId: "approval-1",
        event: { type: "approval_response", callId: "approval-1", approved: true },
      });
      expect(resolved?.resolvedEvent).toEqual({ type: "approval_response", callId: "approval-1", approved: true });
      expect(await aiConversationStore.listPendingTurnActions({ conversationId: direct.id, turnId: turn.id })).toEqual([]);

      const startEvent = await aiConversationStore.appendTurnEvent({
        event: {
          type: "turn_start",
          conversationId: direct.id,
          turnId: turn.id,
          modelProfileId: "model-a",
          providerModel: "provider/model",
        },
      });
      expect(startEvent?.cursor).toBeTruthy();
      const [storedEventShape] = await sql<{ jsonb_typeof: string }[]>`
        SELECT jsonb_typeof(event)
        FROM ai.turn_events
        WHERE seq = ${Number(startEvent?.seq)}
      `;
      expect(storedEventShape?.jsonb_typeof).toBe("object");
      await aiConversationStore.appendTurnEvent({
        event: {
          type: "done",
          conversationId: direct.id,
          turnId: turn.id,
          reason: "stop",
          aggregate: null,
        },
      });
      const replayedEvents = await aiConversationStore.listTurnEvents({
        conversationId: direct.id,
        turnId: turn.id,
        after: "0-0",
      });
      expect(replayedEvents.map((event) => event.type)).toEqual(["turn_start", "done"]);
      expect(
        (
          await aiConversationStore.listTurnEvents({
            conversationId: direct.id,
            turnId: turn.id,
            after: startEvent?.cursor,
          })
        ).map((event) => event.type),
      ).toEqual(["done"]);

      await aiConversationStore.completeTurn({ turnId: turn.id, status: "completed" });
      expect(await aiConversationStore.getRunningTurn({ conversationId: direct.id })).toBeNull();

      const abortTurn = await aiConversationStore.createTurn({ conversationId: direct.id, modelProfileId: "model-a" });
      expect(await aiConversationStore.requestTurnAbort({ conversationId: direct.id, turnId: abortTurn.id })).toMatchObject({
        found: true,
        status: "aborted",
        aborted: true,
      });
      expect(await aiConversationStore.getRunningTurn({ conversationId: direct.id })).toBeNull();
      expect(await aiConversationStore.requestTurnAbort({ conversationId: direct.id, turnId: abortTurn.id })).toMatchObject({
        found: true,
        status: "aborted",
        aborted: false,
      });

      const leasedTurn = await aiConversationStore.createTurn({
        conversationId: direct.id,
        modelProfileId: "model-a",
        leaseOwner: "worker-test",
        leaseMs: 30_000,
      });
      expect(
        await aiConversationStore.isTurnLeaseOwner({
          conversationId: direct.id,
          turnId: leasedTurn.id,
          leaseOwner: "worker-test",
        }),
      ).toBe(true);
      await aiConversationStore.completeTurn({ turnId: leasedTurn.id, status: "completed", leaseOwner: "other-worker" });
      expect((await aiConversationStore.getRunningTurn({ conversationId: direct.id }))?.id).toBe(leasedTurn.id);
      expect(
        await aiConversationStore.heartbeatTurn({
          conversationId: direct.id,
          turnId: leasedTurn.id,
          leaseOwner: "worker-test",
          leaseMs: 30_000,
        }),
      ).toBe(true);
      expect(
        await aiConversationStore.heartbeatTurn({
          conversationId: direct.id,
          turnId: leasedTurn.id,
          leaseOwner: "other-worker",
          leaseMs: 30_000,
        }),
      ).toBe(false);
      await sql`
        UPDATE ai.turns
        SET lease_expires_at = now() - interval '1 second'
        WHERE id = ${leasedTurn.id}::uuid
      `;
      expect(await aiConversationStore.expireStaleTurns({ conversationId: direct.id })).toBe(1);
      expect((await aiConversationStore.getRunningTurn({ conversationId: direct.id }))?.id).toBe(leasedTurn.id);
      expect(
        await aiConversationStore.isTurnLeaseOwner({
          conversationId: direct.id,
          turnId: leasedTurn.id,
          leaseOwner: "worker-test",
        }),
      ).toBe(false);
      expect((await aiConversationStore.listRecoverableTurns({ limit: 20 })).map((recoverable) => recoverable.id)).toContain(leasedTurn.id);
      expect(
        await aiConversationStore.claimTurnLease({
          conversationId: direct.id,
          turnId: leasedTurn.id,
          leaseOwner: "other-worker",
          leaseMs: 30_000,
        }),
      ).toBe(true);
      expect((await aiConversationStore.listRecoverableTurns({ limit: 20 })).map((recoverable) => recoverable.id)).not.toContain(
        leasedTurn.id,
      );
      await aiConversationStore.completeTurn({ turnId: leasedTurn.id, status: "completed", leaseOwner: "other-worker" });
      expect(await aiConversationStore.getRunningTurn({ conversationId: direct.id })).toBeNull();
    } finally {
      await cleanupFixture({ userId, conversationIds });
    }
  });
});

describe("AI tool audit and approval integration", () => {
  test("stores scoped approval preferences and redacted tool call lifecycle metadata", async () => {
    if (!(await canUseAiDatabase())) {
      console.warn("Skipping AI tool audit DB test: auth/ai tables are not available.");
      return;
    }

    const userId = await insertUser();
    const conversationIds: string[] = [];
    const extraUserIds: string[] = [];

    try {
      const resource = {
        kind: "resource" as const,
        appId: "grids",
        resourceType: "base",
        resourceId: `base-${crypto.randomUUID()}`,
      };
      const approvalContext = { actorUserId: userId, appId: "grids", resource };

      expect(await hasRememberedAiToolApproval(approvalContext, { toolName: "write_record", approvalScope: "v1" })).toBe(false);
      await rememberAiToolApproval(approvalContext, { toolName: "write_record", approvalScope: "v1" });
      expect(await hasRememberedAiToolApproval(approvalContext, { toolName: "write_record", approvalScope: "v1" })).toBe(true);
      expect(
        await hasRememberedAiToolApproval(
          { ...approvalContext, resource: { ...resource, appId: "other-app" } },
          { toolName: "write_record", approvalScope: "v1" },
        ),
      ).toBe(false);
      expect(await hasRememberedAiToolApproval(approvalContext, { toolName: "write_record", approvalScope: "v2" })).toBe(false);
      expect(await hasRememberedAiToolApproval(approvalContext, { toolName: "delete_record", approvalScope: "v1" })).toBe(false);
      const otherUserId = await insertUser();
      extraUserIds.push(otherUserId);
      expect(
        await hasRememberedAiToolApproval(
          { ...approvalContext, actorUserId: otherUserId },
          { toolName: "write_record", approvalScope: "v1" },
        ),
      ).toBe(false);
      expect(
        await hasRememberedAiToolApproval(
          { ...approvalContext, resource: { ...resource, resourceId: "other-base" } },
          { toolName: "write_record", approvalScope: "v1" },
        ),
      ).toBe(false);
      await rememberAiToolApproval(approvalContext, {
        toolName: "expired_write",
        approvalScope: "v1",
        expiresAt: new Date(Date.now() - 60_000),
      });
      expect(await hasRememberedAiToolApproval(approvalContext, { toolName: "expired_write", approvalScope: "v1" })).toBe(false);
      await forgetAiToolApproval(approvalContext, { toolName: "write_record", approvalScope: "v1" });
      expect(await hasRememberedAiToolApproval(approvalContext, { toolName: "write_record", approvalScope: "v1" })).toBe(false);
      await rememberAiToolApproval(approvalContext, { toolName: "write_record", approvalScope: "v1" });

      const conversation = await aiConversationStore.createConversation({
        appId: "ai-test",
        ownerUserId: userId,
        resource,
      });
      conversationIds.push(conversation.id);
      const turn = await aiConversationStore.createTurn({ conversationId: conversation.id, modelProfileId: "model-a" });

      await aiToolAudit.noteToolCall({
        conversationId: conversation.id,
        turnId: turn.id,
        callId: "call-1",
        toolName: "write_record",
        location: "server",
        args: { secret: "do-not-store", visible: "metadata-only" },
      });
      await aiToolAudit.noteApprovalRequested({
        conversationId: conversation.id,
        turnId: turn.id,
        callId: "call-1",
        toolName: "write_record",
        location: "server",
        args: { secret: "do-not-store", visible: "metadata-only" },
      });
      await aiToolAudit.noteApprovalResolved({ turnId: turn.id, callId: "call-1", approvalState: "approved_by_preference" });
      await aiToolAudit.noteToolStarted({ conversationId: conversation.id, turnId: turn.id, callId: "call-1", toolName: "write_record" });
      await aiToolAudit.noteToolCompleted({ turnId: turn.id, callId: "call-1", result: { id: "record-1", secret: "hidden" } });

      const [row] = await sql<
        {
          status: string;
          approval_state: string;
          input_meta: { type: string; keys: string[] };
          output_meta: { type: string; keys: string[] };
          error: string | null;
        }[]
      >`
        SELECT status, approval_state, input_meta, output_meta, error
        FROM ai.tool_calls
        WHERE turn_id = ${turn.id}::uuid AND call_id = 'call-1'
      `;

      const inputMeta = parseJsonValue<{ type: string; keys: string[] }>(row?.input_meta);
      const outputMeta = parseJsonValue<{ type: string; keys: string[] }>(row?.output_meta);

      expect({
        status: row?.status,
        approval_state: row?.approval_state,
        input_meta: inputMeta,
        output_meta: outputMeta,
        error: row?.error,
      }).toMatchObject({
        status: "completed",
        approval_state: "approved_by_preference",
        input_meta: { type: "object", keys: ["secret", "visible"] },
        output_meta: { type: "object", keys: ["id", "secret"] },
        error: null,
      });
      expect(JSON.stringify(inputMeta)).not.toContain("do-not-store");
      expect(JSON.stringify(outputMeta)).not.toContain("hidden");
    } finally {
      await cleanupFixture({ userId, conversationIds });
      for (const extraUserId of extraUserIds) {
        await sql`DELETE FROM auth.users WHERE id = ${extraUserId}::uuid`;
      }
    }
  });
});

describe("AI runtime durable turn controls", () => {
  test("accepts aborts and pending actions without a local active worker", async () => {
    if (!(await canUseAiDatabase())) {
      console.warn("Skipping AI runtime control DB test: auth/ai tables are not available.");
      return;
    }

    const userId = await insertUser();
    const conversationIds: string[] = [];

    try {
      const conversation = await aiConversationStore.createConversation({
        appId: "ai-test",
        ownerUserId: userId,
      });
      conversationIds.push(conversation.id);
      const turn = await aiConversationStore.createTurn({ conversationId: conversation.id, modelProfileId: "model-a" });

      await aiConversationStore.savePendingTurnAction({
        conversationId: conversation.id,
        turnId: turn.id,
        callId: "approval-remote",
        kind: "approval",
        status: "pending",
        name: "write_record",
        args: { id: "record-1" },
        approvalScope: "write_record:v1",
        allowAlways: false,
        resolvedEvent: null,
      });

      await expect(
        submitAiTurnAction({
          conversationId: conversation.id,
          turnId: turn.id,
          callId: "approval-remote",
          action: { type: "approval_response", approved: true },
        }),
      ).resolves.toEqual({ ok: true });
      await expect(
        submitAiTurnAction({
          conversationId: conversation.id,
          turnId: turn.id,
          callId: "approval-remote",
          action: { type: "approval_response", approved: true },
        }),
      ).resolves.toEqual({ ok: true });
      expect(
        await aiConversationStore.getPendingTurnAction({
          conversationId: conversation.id,
          turnId: turn.id,
          callId: "approval-remote",
        }),
      ).toMatchObject({
        resolvedEvent: { type: "approval_response", callId: "approval-remote", approved: true },
      });

      await expect(abortAiTurn({ conversationId: conversation.id, turnId: turn.id })).resolves.toEqual({ ok: true });
      await expect(abortAiTurn({ conversationId: conversation.id, turnId: turn.id })).resolves.toEqual({ ok: true });
      expect(await aiConversationStore.getRunningTurn({ conversationId: conversation.id })).toBeNull();
      expect(
        (await aiConversationStore.listTurnEvents({ conversationId: conversation.id, turnId: turn.id, after: "0-0" })).filter(
          (event) => event.type === "done" && event.reason === "aborted",
        ),
      ).toHaveLength(1);
    } finally {
      await cleanupFixture({ userId, conversationIds });
    }
  });
});
