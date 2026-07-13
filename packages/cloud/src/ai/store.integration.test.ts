import { describe, expect, test } from "bun:test";
import type { LoopAggregate, Message } from "@valentinkolb/nessi";
import { sql } from "bun";
import { forgetAiToolApproval, hasRememberedAiToolApproval, rememberAiToolApproval } from "./approvals";
import { migrateCloudAi } from "./migrate";
import { aiConversationStore } from "./store";

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
      }[]
    >`
      SELECT
        to_regclass('ai.conversations')::text AS conversations,
        to_regclass('ai.messages')::text AS messages,
        to_regclass('ai.turns')::text AS turns
    `;
    return Boolean(aiRow?.conversations && aiRow.messages && aiRow.turns);
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

const userMessage = (text: string): Message => ({ role: "user", content: [{ type: "text", text }] });
const assistantMessage = (text: string): Message => ({
  role: "assistant",
  content: [{ type: "text", text }],
  stopReason: "stop",
});

const runConfig = { kind: "chat" as const, input: "hi", toolSource: { kind: "none" as const } };

describe("AI conversation store integration", () => {
  test("preserves full and historical tool results while keeping turn usage separate from loop usage", async () => {
    if (!(await canUseAiDatabase())) return;
    const userId = await insertUser();
    const conversationIds: string[] = [];

    try {
      const conversation = await aiConversationStore.createConversation({ appId: "ai-test", ownerUserId: userId });
      conversationIds.push(conversation.id);
      const store = aiConversationStore.createSessionStore({ conversationId: conversation.id, modelProfileId: "test-model" });
      const turnUsage = { input: 15_876, output: 32, total: 15_908 };
      const loopUsage = { input: 69_944, output: 819, total: 70_763 };

      await store.append({
        role: "assistant",
        content: [{ type: "tool_call", id: "bash-1", name: "bash", args: { command: "build-report" } }],
        usage: { input: 8_598, output: 118, total: 8_716 },
        stopReason: "tool_use",
      });
      await store.append({
        role: "tool_result",
        callId: "bash-1",
        name: "bash",
        result: { stdout: "full output", stderr: "", exitCode: 0 },
        historicalResult: {
          originLoopId: "loop-1",
          value: { command: "build-report", exitCode: 0, stdoutExcerpt: "full output", stderrExcerpt: "" },
        },
      });
      await store.append({
        role: "assistant",
        content: [{ type: "text", text: "Done" }],
        usage: turnUsage,
        stopReason: "stop",
      });

      const aggregate: LoopAggregate = {
        turns: [
          {
            message: { role: "assistant", content: [{ type: "text", text: "Working" }], stopReason: "tool_use" },
            usage: { input: 8_598, output: 118, total: 8_716 },
            stopReason: "tool_use",
            toolCalls: [],
          },
          {
            message: { role: "assistant", content: [{ type: "text", text: "Done" }], stopReason: "stop" },
            usage: turnUsage,
            stopReason: "stop",
            toolCalls: [],
          },
        ],
        usage: loopUsage,
        issueCount: 0,
        issues: [],
        toolCallCount: 1,
        toolErrorCount: 0,
        toolIssueCount: 0,
        toolMalformedCount: 0,
        toolCancelledCount: 0,
        toolIssues: [],
        assistantMessageCount: 2,
      };
      await aiConversationStore.setLatestAssistantLoopAggregate({
        conversationId: conversation.id,
        aggregate,
        doneReason: "stop",
      });

      const messages = await aiConversationStore.listMessages({ conversationId: conversation.id });
      const toolResult = messages.find((entry) => entry.message.role === "tool_result")?.message;
      const finalAssistant = messages.findLast((entry) => entry.message.role === "assistant");
      expect(toolResult?.role === "tool_result" ? toolResult.historicalResult : undefined).toEqual({
        originLoopId: "loop-1",
        value: { command: "build-report", exitCode: 0, stdoutExcerpt: "full output", stderrExcerpt: "" },
      });
      expect(finalAssistant?.usage).toEqual(turnUsage);
      expect(finalAssistant?.loopAggregate?.usage).toEqual(loopUsage);
    } finally {
      await cleanupFixture({ userId, conversationIds });
    }
  });

  test("submitChatTurn persists user message and turn transactionally", async () => {
    if (!(await canUseAiDatabase())) {
      console.warn("Skipping AI store DB test: auth/ai tables are not available.");
      return;
    }
    const userId = await insertUser();
    const conversationIds: string[] = [];

    try {
      const conversation = await aiConversationStore.createConversation({ appId: "ai-test", ownerUserId: userId });
      conversationIds.push(conversation.id);

      const submitted = await aiConversationStore.submitChatTurn({
        conversationId: conversation.id,
        modelProfileId: "test-model",
        runConfig,
        userMessage: userMessage("Hello turn"),
      });

      expect(submitted.turn.status).toBe("queued");
      expect(submitted.turn.attempt).toBe(0);
      expect(submitted.message.message.role).toBe("user");
      expect(submitted.message.loopId).toBe(submitted.turn.id);
      expect(submitted.message.seq).toBe(1);
      const [storedConfig] = await sql<{ kind: string | null; json_type: string | null }[]>`
        SELECT run_config->>'kind' AS kind, jsonb_typeof(run_config) AS json_type
        FROM ai.turns
        WHERE id = ${submitted.turn.id}::uuid
      `;
      expect(storedConfig).toEqual({ kind: "chat", json_type: "object" });

      // Conversation title derives from the first user message.
      const detail = await aiConversationStore.getConversation({ conversationId: conversation.id });
      expect(detail?.title).toBe("Hello turn");

      // A second active turn for the same conversation must be rejected (partial unique index).
      await expect(
        aiConversationStore.submitChatTurn({
          conversationId: conversation.id,
          modelProfileId: "test-model",
          runConfig,
          userMessage: userMessage("Second"),
        }),
      ).rejects.toThrow();

      // ...and because it is transactional, the second user message must NOT exist.
      const messages = await aiConversationStore.listMessages({ conversationId: conversation.id });
      expect(messages).toHaveLength(1);
    } finally {
      await cleanupFixture({ userId, conversationIds });
    }
  });

  test("claimTurn increments attempts, enforces caps, and hands out run config", async () => {
    if (!(await canUseAiDatabase())) return;
    const userId = await insertUser();
    const conversationIds: string[] = [];

    try {
      const conversation = await aiConversationStore.createConversation({ appId: "ai-test", ownerUserId: userId });
      conversationIds.push(conversation.id);
      const { turn } = await aiConversationStore.submitChatTurn({
        conversationId: conversation.id,
        modelProfileId: "test-model",
        runConfig,
        userMessage: userMessage("claim me"),
      });

      const claim = await aiConversationStore.claimTurn({
        conversationId: conversation.id,
        turnId: turn.id,
        leaseOwner: "worker-a",
        leaseMs: 30_000,
        from: "queue",
        maxAttempts: 50,
        runBudgetMs: 60_000,
      });
      expect(claim).not.toBeNull();
      expect(claim!.turn.attempt).toBe(1);
      expect(claim!.turn.status).toBe("running");
      expect(claim!.runConfig).toMatchObject({ kind: "chat" });

      // A second worker cannot claim while the lease is live.
      const contender = await aiConversationStore.claimTurn({
        conversationId: conversation.id,
        turnId: turn.id,
        leaseOwner: "worker-b",
        leaseMs: 30_000,
        from: "queue",
        maxAttempts: 50,
        runBudgetMs: 60_000,
      });
      expect(contender).toBeNull();

      // Expire the lease manually — now the claim succeeds and bumps the attempt.
      await sql`UPDATE ai.turns SET lease_expires_at = now() - interval '1 second' WHERE id = ${turn.id}`;
      const reclaimed = await aiConversationStore.claimTurn({
        conversationId: conversation.id,
        turnId: turn.id,
        leaseOwner: "worker-b",
        leaseMs: 30_000,
        from: "queue",
        maxAttempts: 50,
        runBudgetMs: 60_000,
      });
      expect(reclaimed?.turn.attempt).toBe(2);

      // Heartbeat only works for the current owner.
      expect(
        await aiConversationStore.heartbeatTurn({
          conversationId: conversation.id,
          turnId: turn.id,
          leaseOwner: "worker-a",
          leaseMs: 30_000,
        }),
      ).toBe(false);
      expect(
        await aiConversationStore.heartbeatTurn({
          conversationId: conversation.id,
          turnId: turn.id,
          leaseOwner: "worker-b",
          leaseMs: 30_000,
        }),
      ).toBe(true);

      // Attempt cap blocks further claims.
      await sql`UPDATE ai.turns SET lease_expires_at = now() - interval '1 second' WHERE id = ${turn.id}`;
      const capped = await aiConversationStore.claimTurn({
        conversationId: conversation.id,
        turnId: turn.id,
        leaseOwner: "worker-c",
        leaseMs: 30_000,
        from: "queue",
        maxAttempts: 2,
        runBudgetMs: 60_000,
      });
      expect(capped).toBeNull();

      expect(
        await aiConversationStore.completeTurn({
          conversationId: conversation.id,
          turnId: turn.id,
          status: "completed",
          leaseOwner: "worker-b",
        }),
      ).toBe("completed");
      const done = await aiConversationStore.getTurn({ conversationId: conversation.id, turnId: turn.id });
      expect(done?.status).toBe("completed");
    } finally {
      await cleanupFixture({ userId, conversationIds });
    }
  });

  test("suspend, resolve, and continuation claim flow", async () => {
    if (!(await canUseAiDatabase())) return;
    const userId = await insertUser();
    const conversationIds: string[] = [];

    try {
      const conversation = await aiConversationStore.createConversation({ appId: "ai-test", ownerUserId: userId });
      conversationIds.push(conversation.id);
      const { turn } = await aiConversationStore.submitChatTurn({
        conversationId: conversation.id,
        modelProfileId: "test-model",
        runConfig,
        userMessage: userMessage("suspend me"),
      });

      await aiConversationStore.claimTurn({
        conversationId: conversation.id,
        turnId: turn.id,
        leaseOwner: "worker-a",
        leaseMs: 30_000,
        from: "queue",
        maxAttempts: 50,
        runBudgetMs: 60_000,
      });

      await aiConversationStore.savePendingTurnAction({
        turnId: turn.id,
        conversationId: conversation.id,
        callId: "call-1",
        kind: "approval",
        status: "pending",
        name: "danger",
        args: { action: "wipe" },
        approvalScope: "danger",
        allowAlways: true,
        resolvedEvent: null,
      });

      const blocks = [{ id: "tool-call-1", kind: "tool" as const, callId: "call-1", name: "danger", status: "awaiting_approval" as const }];
      expect(
        await aiConversationStore.suspendTurn({
          conversationId: conversation.id,
          turnId: turn.id,
          leaseOwner: "worker-a",
          blocks,
          seq: 7,
          waitingBudgetMs: 60 * 60_000,
        }),
      ).toBe(true);

      const active = await aiConversationStore.getActiveTurn({ conversationId: conversation.id });
      expect(active?.turn.status).toBe("waiting_for_action");
      expect(active?.liveBlocks).toHaveLength(1);
      expect(active?.liveSeq).toBe(7);
      expect(
        (
          await aiConversationStore.enqueueTurnSteer({
            conversationId: conversation.id,
            turnId: turn.id,
            clientRequestId: "waiting-steer",
            text: "Apply after approval",
          })
        ).ok,
      ).toBe(true);

      // A continuation claim requires a resolved action.
      const early = await aiConversationStore.claimTurn({
        conversationId: conversation.id,
        turnId: turn.id,
        leaseOwner: "worker-b",
        leaseMs: 30_000,
        from: "waiting",
        maxAttempts: 50,
        runBudgetMs: 60_000,
      });
      expect(early).toBeNull();

      const resolved = await aiConversationStore.resolvePendingTurnAction({
        conversationId: conversation.id,
        turnId: turn.id,
        callId: "call-1",
        event: { type: "approval_response", callId: "call-1", approved: true },
      });
      expect(resolved?.status).toBe("resolved");

      const continuation = await aiConversationStore.claimTurn({
        conversationId: conversation.id,
        turnId: turn.id,
        leaseOwner: "worker-b",
        leaseMs: 30_000,
        from: "waiting",
        maxAttempts: 50,
        runBudgetMs: 60_000,
      });
      expect(continuation?.turn.attempt).toBe(2);
      expect(continuation?.liveBlocks).toHaveLength(1);

      const resumedSteers = await aiConversationStore.takePendingTurnSteers({
        conversationId: conversation.id,
        turnId: turn.id,
        leaseOwner: "worker-b",
      });
      expect(resumedSteers.map((steer) => steer.text)).toEqual(["Apply after approval"]);

      const seeds = await aiConversationStore.listResolvedPendingActions({ conversationId: conversation.id, turnId: turn.id });
      expect(seeds).toHaveLength(1);
      expect(seeds[0]?.resolvedEvent).toMatchObject({ type: "approval_response", approved: true });
    } finally {
      await cleanupFixture({ userId, conversationIds });
    }
  });

  test("durable steering is ordered, idempotent, and atomically persisted before completion", async () => {
    if (!(await canUseAiDatabase())) return;
    const userId = await insertUser();
    const conversationIds: string[] = [];

    try {
      const conversation = await aiConversationStore.createConversation({ appId: "ai-test", ownerUserId: userId });
      conversationIds.push(conversation.id);
      const { turn } = await aiConversationStore.submitChatTurn({
        conversationId: conversation.id,
        modelProfileId: "test-model",
        runConfig,
        userMessage: userMessage("Start"),
      });
      await aiConversationStore.claimTurn({
        conversationId: conversation.id,
        turnId: turn.id,
        leaseOwner: "steer-worker",
        leaseMs: 30_000,
        from: "queue",
        maxAttempts: 5,
        runBudgetMs: 60_000,
      });

      const first = await aiConversationStore.enqueueTurnSteer({
        conversationId: conversation.id,
        turnId: turn.id,
        clientRequestId: "request-1",
        text: "First steer",
      });
      const duplicate = await aiConversationStore.enqueueTurnSteer({
        conversationId: conversation.id,
        turnId: turn.id,
        clientRequestId: "request-1",
        text: "First steer",
      });
      const second = await aiConversationStore.enqueueTurnSteer({
        conversationId: conversation.id,
        turnId: turn.id,
        clientRequestId: "request-2",
        text: "Second steer",
      });
      expect(first.ok && duplicate.ok ? duplicate.steer.id : null).toBe(first.ok ? first.steer.id : null);
      expect(second.ok ? second.steer.seq : null).toBe(2);

      expect(await aiConversationStore.completeTurn({
        conversationId: conversation.id,
        turnId: turn.id,
        status: "completed",
        leaseOwner: "steer-worker",
      })).toBe("pending_steering");
      expect((await aiConversationStore.listMessages({ conversationId: conversation.id })).filter((entry) => entry.message.role === "user")).toHaveLength(1);

      await expect(aiConversationStore.takePendingTurnSteers({
        conversationId: conversation.id,
        turnId: turn.id,
        leaseOwner: "other-worker",
      })).rejects.toThrow("lost its lease");

      const consumed = await aiConversationStore.takePendingTurnSteers({
        conversationId: conversation.id,
        turnId: turn.id,
        leaseOwner: "steer-worker",
      });
      expect(consumed.map((steer) => steer.text)).toEqual(["First steer", "Second steer"]);
      expect(consumed.every((steer) => steer.status === "consumed" && Boolean(steer.messageId))).toBe(true);
      expect(await aiConversationStore.takePendingTurnSteers({
        conversationId: conversation.id,
        turnId: turn.id,
        leaseOwner: "steer-worker",
      })).toEqual([]);

      const messages = await aiConversationStore.listMessages({ conversationId: conversation.id });
      const steeringMessages = messages.filter((entry) => entry.meta?.steerId);
      expect(steeringMessages.map((entry) => entry.message.role === "user" ? entry.message.content[0] : null)).toEqual([
        { type: "text", text: "First steer" },
        { type: "text", text: "Second steer" },
      ]);
      expect(new Set(steeringMessages.map((entry) => entry.meta?.steerId))).toEqual(new Set(consumed.map((steer) => steer.id)));

      expect(await aiConversationStore.completeTurn({
        conversationId: conversation.id,
        turnId: turn.id,
        status: "completed",
        leaseOwner: "steer-worker",
      })).toBe("completed");
    } finally {
      await cleanupFixture({ userId, conversationIds });
    }
  });

  test("abort request marks ownerless turns for caller finalization", async () => {
    if (!(await canUseAiDatabase())) return;
    const userId = await insertUser();
    const conversationIds: string[] = [];

    try {
      const conversation = await aiConversationStore.createConversation({ appId: "ai-test", ownerUserId: userId });
      conversationIds.push(conversation.id);
      const { turn } = await aiConversationStore.submitChatTurn({
        conversationId: conversation.id,
        modelProfileId: "test-model",
        runConfig,
        userMessage: userMessage("abort me"),
      });
      await aiConversationStore.enqueueTurnSteer({
        conversationId: conversation.id,
        turnId: turn.id,
        clientRequestId: "abort-steer",
        text: "Too late",
      });

      const request = await aiConversationStore.requestTurnAbort({ conversationId: conversation.id, turnId: turn.id });
      expect(request).toMatchObject({ found: true, status: "queued", ownerless: true });

      // Ownerless finalization (no leaseOwner) works for queued turns.
      expect(
        await aiConversationStore.completeTurn({
          conversationId: conversation.id,
          turnId: turn.id,
          status: "aborted",
        }),
      ).toBe("completed");
      expect((await aiConversationStore.listTurnSteers({ conversationId: conversation.id, turnId: turn.id }))[0]?.status).toBe("discarded");

      // Cancel-requested turns are no longer claimable.
      const claim = await aiConversationStore.claimTurn({
        conversationId: conversation.id,
        turnId: turn.id,
        leaseOwner: "worker-a",
        leaseMs: 30_000,
        from: "queue",
        maxAttempts: 50,
        runBudgetMs: 60_000,
      });
      expect(claim).toBeNull();
    } finally {
      await cleanupFixture({ userId, conversationIds });
    }
  });

  test("sweepTurns requeues crashed turns and finalizes over-budget or cancelled ones", async () => {
    if (!(await canUseAiDatabase())) return;
    const userId = await insertUser();
    const conversationIds: string[] = [];

    try {
      // Crashed running turn (lease expired, within budget) -> requeued.
      const crashConv = await aiConversationStore.createConversation({ appId: "ai-test", ownerUserId: userId });
      conversationIds.push(crashConv.id);
      const { turn: crashTurn } = await aiConversationStore.submitChatTurn({
        conversationId: crashConv.id,
        modelProfileId: "test-model",
        runConfig,
        userMessage: userMessage("crash"),
      });
      await aiConversationStore.claimTurn({
        conversationId: crashConv.id,
        turnId: crashTurn.id,
        leaseOwner: "worker-a",
        leaseMs: 30_000,
        from: "queue",
        maxAttempts: 50,
        runBudgetMs: 600_000,
      });
      await sql`UPDATE ai.turns SET lease_expires_at = now() - interval '1 second' WHERE id = ${crashTurn.id}`;

      // Over-budget running turn (deadline passed, lease expired) -> failed.
      const budgetConv = await aiConversationStore.createConversation({ appId: "ai-test", ownerUserId: userId });
      conversationIds.push(budgetConv.id);
      const { turn: budgetTurn } = await aiConversationStore.submitChatTurn({
        conversationId: budgetConv.id,
        modelProfileId: "test-model",
        runConfig,
        userMessage: userMessage("budget"),
      });
      await aiConversationStore.claimTurn({
        conversationId: budgetConv.id,
        turnId: budgetTurn.id,
        leaseOwner: "worker-b",
        leaseMs: 30_000,
        from: "queue",
        maxAttempts: 50,
        runBudgetMs: 600_000,
      });
      await sql`
        UPDATE ai.turns
        SET lease_expires_at = now() - interval '1 second', deadline = now() - interval '1 second'
        WHERE id = ${budgetTurn.id}
      `;

      // Waiting turn past its action deadline -> aborted.
      const waitConv = await aiConversationStore.createConversation({ appId: "ai-test", ownerUserId: userId });
      conversationIds.push(waitConv.id);
      const { turn: waitTurn } = await aiConversationStore.submitChatTurn({
        conversationId: waitConv.id,
        modelProfileId: "test-model",
        runConfig,
        userMessage: userMessage("wait"),
      });
      await aiConversationStore.claimTurn({
        conversationId: waitConv.id,
        turnId: waitTurn.id,
        leaseOwner: "worker-c",
        leaseMs: 30_000,
        from: "queue",
        maxAttempts: 50,
        runBudgetMs: 600_000,
      });
      await aiConversationStore.suspendTurn({
        conversationId: waitConv.id,
        turnId: waitTurn.id,
        leaseOwner: "worker-c",
        blocks: [],
        seq: 1,
        waitingBudgetMs: 60_000,
      });
      await sql`UPDATE ai.turns SET deadline = now() - interval '1 second' WHERE id = ${waitTurn.id}`;

      const sweep = await aiConversationStore.sweepTurns();

      expect(sweep.requeued.some((entry) => entry.turnId === crashTurn.id)).toBe(true);
      expect(sweep.failed.some((entry) => entry.turnId === budgetTurn.id)).toBe(true);
      expect(sweep.aborted.some((entry) => entry.turnId === waitTurn.id)).toBe(true);

      const requeued = await aiConversationStore.getTurn({ conversationId: crashConv.id, turnId: crashTurn.id });
      expect(requeued?.status).toBe("queued");
      const failed = await aiConversationStore.getTurn({ conversationId: budgetConv.id, turnId: budgetTurn.id });
      expect(failed?.status).toBe("failed");
      const aborted = await aiConversationStore.getTurn({ conversationId: waitConv.id, turnId: waitTurn.id });
      expect(aborted?.status).toBe("aborted");
    } finally {
      await cleanupFixture({ userId, conversationIds });
    }
  });

  test("session store guards turn-owned appends by lease and skips user messages", async () => {
    if (!(await canUseAiDatabase())) return;
    const userId = await insertUser();
    const conversationIds: string[] = [];

    try {
      const conversation = await aiConversationStore.createConversation({ appId: "ai-test", ownerUserId: userId });
      conversationIds.push(conversation.id);
      const { turn } = await aiConversationStore.submitChatTurn({
        conversationId: conversation.id,
        modelProfileId: "test-model",
        runConfig,
        userMessage: userMessage("session"),
      });
      await aiConversationStore.claimTurn({
        conversationId: conversation.id,
        turnId: turn.id,
        leaseOwner: "worker-a",
        leaseMs: 30_000,
        from: "queue",
        maxAttempts: 50,
        runBudgetMs: 60_000,
      });

      const session = aiConversationStore.createSessionStore({
        conversationId: conversation.id,
        modelProfileId: "test-model",
        turnId: turn.id,
        leaseOwner: "worker-a",
      });

      // nessi re-appends the input on legacy paths — the session store must ignore it.
      await session.append(userMessage("session"));
      // Assistant output is appended with the turn as loop id.
      await session.append(assistantMessage("answer"));

      const messages = await aiConversationStore.listMessages({ conversationId: conversation.id });
      expect(messages).toHaveLength(2);
      expect(messages[1]?.message.role).toBe("assistant");
      expect(messages[1]?.loopId).toBe(turn.id);

      // A non-owner session store must fail loudly instead of writing.
      const stranger = aiConversationStore.createSessionStore({
        conversationId: conversation.id,
        modelProfileId: "test-model",
        turnId: turn.id,
        leaseOwner: "worker-zzz",
      });
      await expect(stranger.append(assistantMessage("intruder"))).rejects.toThrow("lost its lease");

      const load = await session.load();
      expect(load).toHaveLength(2);
    } finally {
      await cleanupFixture({ userId, conversationIds });
    }
  });

  test("compaction archives in place and reuses the checkpoint seq for the summary", async () => {
    if (!(await canUseAiDatabase())) return;
    const userId = await insertUser();
    const conversationIds: string[] = [];

    try {
      const conversation = await aiConversationStore.createConversation({ appId: "ai-test", ownerUserId: userId });
      conversationIds.push(conversation.id);

      // Seed four messages without a turn (plain session store path).
      const session = aiConversationStore.createSessionStore({ conversationId: conversation.id });
      await session.append(assistantMessage("one"));
      await session.append(assistantMessage("two"));
      await session.append(assistantMessage("three"));
      await session.append(assistantMessage("four"));

      await aiConversationStore.compactMessages({
        conversationId: conversation.id,
        checkpointSeq: 3,
        summary: assistantMessage("Conversation summary: one to three"),
      });

      // Human view keeps the archived messages visible; the summary marker sits
      // after the rows it replaced (same checkpoint seq, summary sorts last).
      const visible = await aiConversationStore.listMessages({ conversationId: conversation.id });
      expect(visible.map((entry) => [entry.seq, entry.kind])).toEqual([
        [1, "message"],
        [2, "message"],
        [3, "message"],
        [3, "summary"],
        [4, "message"],
      ]);
      expect(visible.slice(0, 3).every((entry) => entry.compactedAt !== null)).toBe(true);
      expect(visible[3]?.meta).toEqual({ compactedCount: 3 });

      // The model context only contains the summary and what follows.
      const context = await aiConversationStore.listContextMessages({ conversationId: conversation.id });
      expect(context.map((entry) => [entry.seq, entry.kind])).toEqual([
        [3, "summary"],
        [4, "message"],
      ]);

      // New appends continue after the highest ever seq.
      await session.append(assistantMessage("five"));
      const afterAppend = await aiConversationStore.listContextMessages({ conversationId: conversation.id });
      expect(afterAppend.at(-1)?.seq).toBe(5);

      // A second compaction hides the superseded summary from the human view.
      await aiConversationStore.compactMessages({
        conversationId: conversation.id,
        checkpointSeq: 4,
        summary: assistantMessage("Conversation summary: everything through four"),
      });
      const afterSecond = await aiConversationStore.listMessages({ conversationId: conversation.id });
      expect(afterSecond.filter((entry) => entry.kind === "summary")).toHaveLength(1);
      expect(afterSecond.find((entry) => entry.kind === "summary")).toMatchObject({ seq: 4 });
    } finally {
      await cleanupFixture({ userId, conversationIds });
    }
  });

  test("projects stable conversation organization and durable run attention state", async () => {
    if (!(await canUseAiDatabase())) return;
    const userId = await insertUser();
    const conversationIds: string[] = [];

    try {
      const create = async (title: string) => {
        const conversation = await aiConversationStore.createConversation({ appId: "ai-test", ownerUserId: userId, title });
        conversationIds.push(conversation.id);
        return conversation;
      };
      const normal = await create("Normal");
      const pinned = await create("Pinned");
      const running = await create("Running");
      const attention = await create("Attention");
      const failed = await create("Failed");
      const done = await create("Done");

      const pinnedUpdatedAt = pinned.updatedAt;
      const pinnedResult = await aiConversationStore.setConversationPinned({
        conversationId: pinned.id,
        appId: "ai-test",
        ownerUserId: userId,
        pinned: true,
      });
      expect(pinnedResult).toMatchObject({ pinnedAt: expect.any(String), updatedAt: pinnedUpdatedAt });
      expect((await aiConversationStore.listConversations({ appId: "ai-test", ownerUserId: userId }))[0]?.id).toBe(pinned.id);

      const insertTurn = async (conversationId: string, status: string, completed = false) => {
        await sql`
          INSERT INTO ai.turns (conversation_id, status, completed_at)
          VALUES (${conversationId}::uuid, ${status}, ${completed ? new Date().toISOString() : null})
        `;
      };
      await insertTurn(running.id, "running");
      await insertTurn(attention.id, "waiting_for_action");
      await insertTurn(failed.id, "failed", true);
      await insertTurn(done.id, "completed", true);

      const summaries = await aiConversationStore.listConversations({ appId: "ai-test", ownerUserId: userId });
      expect(summaries.find((item) => item.id === running.id)?.runStatus).toBe("running");
      expect(summaries.find((item) => item.id === attention.id)?.runStatus).toBe("needs_attention");
      expect(summaries.find((item) => item.id === failed.id)?.runStatus).toBe("failed");
      expect(summaries.find((item) => item.id === done.id)).toMatchObject({ runStatus: "idle", unreadCompletion: true });
      expect(await aiConversationStore.listConversations({ appId: "ai-test", ownerUserId: userId, status: "running" })).toHaveLength(1);
      expect(await aiConversationStore.listConversations({ appId: "ai-test", ownerUserId: userId, status: "needs_attention" })).toHaveLength(1);
      expect(await aiConversationStore.listConversations({ appId: "ai-test", ownerUserId: userId, status: "failed" })).toHaveLength(1);
      expect(await aiConversationStore.listConversations({ appId: "ai-test", ownerUserId: userId, status: "unread" })).toHaveLength(1);
      expect(await aiConversationStore.archiveConversation({ conversationId: running.id, appId: "ai-test", ownerUserId: userId })).toBe(false);

      expect(await aiConversationStore.markConversationViewed({ conversationId: done.id, appId: "ai-test", ownerUserId: userId })).toBe(true);
      expect((await aiConversationStore.getConversation({ conversationId: done.id }))?.unreadCompletion).toBe(false);
      await aiConversationStore.updateConversationMetadata({
        conversationId: done.id,
        appId: "ai-test",
        ownerUserId: userId,
        title: "Done renamed",
        icon: done.icon,
        description: done.description,
      });
      expect((await aiConversationStore.getConversation({ conversationId: done.id }))?.unreadCompletion).toBe(false);

      expect(await aiConversationStore.archiveConversation({ conversationId: pinned.id, appId: "ai-test", ownerUserId: userId })).toBe(true);
      expect(await aiConversationStore.getConversation({ conversationId: pinned.id })).toBeNull();
      expect(await aiConversationStore.listConversations({ appId: "ai-test", ownerUserId: userId, archived: true })).toHaveLength(1);
      expect(await aiConversationStore.restoreConversation({ conversationId: pinned.id, appId: "ai-test", ownerUserId: userId })).toMatchObject({
        id: pinned.id,
        pinnedAt: null,
        archivedAt: null,
      });
      expect(await aiConversationStore.getConversation({ conversationId: normal.id })).toMatchObject({ runStatus: "idle" });
    } finally {
      await cleanupFixture({ userId, conversationIds });
    }
  });

  test("tool approval preferences remember and forget approvals", async () => {
    if (!(await canUseAiDatabase())) return;
    const userId = await insertUser();

    try {
      const context = { actorUserId: userId, appId: "ai-test", resource: { kind: "direct" as const } };
      const tool = { toolName: `tool-${crypto.randomUUID()}`, approvalScope: "scope" };

      expect(await hasRememberedAiToolApproval(context, tool)).toBe(false);
      await rememberAiToolApproval(context, tool);
      expect(await hasRememberedAiToolApproval(context, tool)).toBe(true);
      await forgetAiToolApproval(context, tool);
      expect(await hasRememberedAiToolApproval(context, tool)).toBe(false);
    } finally {
      await cleanupFixture({ userId, conversationIds: [] });
    }
  });
});
