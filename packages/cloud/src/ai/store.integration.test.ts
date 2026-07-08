import { describe, expect, test } from "bun:test";
import type { Message } from "@valentinkolb/nessi";
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
      ).toBe(true);
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

      const seeds = await aiConversationStore.listResolvedPendingActions({ conversationId: conversation.id, turnId: turn.id });
      expect(seeds).toHaveLength(1);
      expect(seeds[0]?.resolvedEvent).toMatchObject({ type: "approval_response", approved: true });
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

      const request = await aiConversationStore.requestTurnAbort({ conversationId: conversation.id, turnId: turn.id });
      expect(request).toMatchObject({ found: true, status: "queued", ownerless: true });

      // Ownerless finalization (no leaseOwner) works for queued turns.
      expect(
        await aiConversationStore.completeTurn({
          conversationId: conversation.id,
          turnId: turn.id,
          status: "aborted",
        }),
      ).toBe(true);

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

      const active = await aiConversationStore.listMessages({ conversationId: conversation.id });
      expect(active).toHaveLength(2);
      expect(active[0]).toMatchObject({ seq: 3, kind: "summary" });
      expect(active[1]).toMatchObject({ seq: 4 });

      // Archived rows keep their original seqs.
      const archived = await sql<{ seq: number }[]>`
        SELECT seq FROM ai.messages
        WHERE conversation_id = ${conversation.id} AND compacted_at IS NOT NULL
        ORDER BY seq ASC
      `;
      expect(archived.map((row) => row.seq)).toEqual([1, 2, 3]);

      // New appends continue after the highest ever seq.
      await session.append(assistantMessage("five"));
      const afterAppend = await aiConversationStore.listMessages({ conversationId: conversation.id });
      expect(afterAppend.at(-1)?.seq).toBe(5);
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
