import { describe, expect, test } from "bun:test";
import type { Message } from "@valentinkolb/nessi";
import { sql } from "bun";
import { forgetAiToolApproval, hasRememberedAiToolApproval, rememberAiToolApproval } from "./approvals";
import { migrateCloudAi } from "./migrate";
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
      await aiConversationStore.completeTurn({ turnId: turn.id, status: "completed" });
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
