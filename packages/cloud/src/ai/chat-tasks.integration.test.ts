import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { AiChatTaskIdempotencyConflictError, aiChatTasks } from "./chat-tasks";
import { migrateCloudAi } from "./migrate";
import { AI_SHORT_ID_PATTERN, createAiShortId } from "./short-id";
import { aiConversations } from "./store";

const canUseAiDatabase = async (): Promise<boolean> => {
  try {
    const [row] = await sql<{ users: string | null }[]>`SELECT to_regclass('auth.users')::text AS users`;
    if (!row?.users) return false;
    await migrateCloudAi();
    return true;
  } catch {
    return false;
  }
};

const suite = (await canUseAiDatabase()) ? describe : describe.skip;

suite("AI chat tasks", () => {
  test("runs in its chat and is removed with the chat", async () => {
    const suffix = crypto.randomUUID();
    const [user] = await sql<{ id: string }[]>`
      INSERT INTO auth.users (uid, provider, profile, display_name, mail, given_name, sn)
      VALUES (${`ai-task-${suffix}`}, 'local', 'user', 'AI Task Test', ${`ai-task-${suffix}@example.test`}, 'AI', 'Task')
      RETURNING id
    `;
    const conversation = await aiConversations.createConversation({
      appId: "assistant",
      ownerUserId: user!.id,
      title: "Scheduled work",
    });

    try {
      const runAt = new Date(Date.now() + 60_000).toISOString();
      const task = await aiChatTasks.create({
        appId: "assistant",
        userId: user!.id,
        chatId: conversation.shortId,
        prompt: "Check the release status.",
        schedule: { kind: "once", runAt },
        timezone: "Europe/Berlin",
        idempotencyKey: `test:${suffix}`,
      });
      expect(task?.shortId).toMatch(AI_SHORT_ID_PATTERN);
      expect(task?.chatId).toBe(conversation.shortId);
      expect((await aiChatTasks.list({ appId: "assistant", userId: user!.id })).map((entry) => entry.shortId)).toEqual([task!.shortId]);

      const manualAt = new Date().toISOString();
      const manual = await aiChatTasks.createOccurrence({
        taskId: task!.id,
        scheduledFor: manualAt,
        trigger: "manual",
        requestKey: `manual:${task!.id}:${suffix}`,
      });
      expect(manual?.shortId).toMatch(AI_SHORT_ID_PATTERN);
      expect((await aiChatTasks.setState({ appId: "assistant", userId: user!.id, taskId: task!.shortId, state: "paused" }))?.state).toBe(
        "paused",
      );
      expect((await aiChatTasks.listQueuedOccurrences("assistant")).some((entry) => entry.occurrence.id === manual!.id)).toBe(false);
      expect((await aiChatTasks.setState({ appId: "assistant", userId: user!.id, taskId: task!.shortId, state: "active" }))?.state).toBe(
        "active",
      );
      expect((await aiChatTasks.listQueuedOccurrences("assistant")).find((entry) => entry.occurrence.id === manual!.id)?.task.shortId).toBe(
        task!.shortId,
      );
      const [blockingTurn] = await sql<{ id: string }[]>`
        INSERT INTO ai.turns (short_id, conversation_id, status)
        VALUES (${createAiShortId()}, ${conversation.id}::uuid, 'queued')
        RETURNING id
      `;
      expect(
        await aiChatTasks.deliverOccurrence({
          occurrenceId: manual!.id,
          modelProfileId: "test-model",
          runConfig: { kind: "chat", input: task!.prompt, toolSource: { kind: "none" } },
          userMessage: { role: "user", content: [{ type: "text", text: task!.prompt }] },
          expectedRevision: (await aiChatTasks.get({ appId: "assistant", userId: user!.id, taskId: task!.shortId }))!.revision,
        }),
      ).toEqual({ delivered: false, reason: "busy" });
      await sql`UPDATE ai.turns SET status = 'aborted', completed_at = now() WHERE id = ${blockingTurn!.id}::uuid`;
      const manualDelivery = await aiChatTasks.deliverOccurrence({
        occurrenceId: manual!.id,
        modelProfileId: "test-model",
        runConfig: { kind: "chat", input: task!.prompt, toolSource: { kind: "none" } },
        userMessage: { role: "user", content: [{ type: "text", text: task!.prompt }] },
        expectedRevision: (await aiChatTasks.get({ appId: "assistant", userId: user!.id, taskId: task!.shortId }))!.revision,
      });
      expect(manualDelivery.delivered).toBe(true);
      if (!manualDelivery.delivered) throw new Error("Expected manual task occurrence to be delivered");
      await sql`UPDATE ai.turns SET status = 'completed', completed_at = now() WHERE id = ${manualDelivery.turnId}::uuid`;
      await aiChatTasks.finalizeTurn({ turnId: manualDelivery.turnId, status: "completed" });
      expect((await aiChatTasks.get({ appId: "assistant", userId: user!.id, taskId: task!.shortId }))?.state).toBe("active");

      await sql`UPDATE ai.chat_tasks SET run_at = now() - interval '1 minute' WHERE id = ${task!.id}::uuid`;
      const occurrence = (await aiChatTasks.materializeDueOnce("assistant")).find((entry) => entry.taskId === task!.id);
      expect(occurrence?.id).toBeDefined();
      expect((await aiChatTasks.materializeDueOnce("assistant")).find((entry) => entry.taskId === task!.id)?.id).toBe(occurrence!.id);
      const delivered = await aiChatTasks.deliverOccurrence({
        occurrenceId: occurrence!.id,
        modelProfileId: "test-model",
        runConfig: { kind: "chat", input: task!.prompt, toolSource: { kind: "none" } },
        userMessage: { role: "user", content: [{ type: "text", text: task!.prompt }] },
        expectedRevision: (await aiChatTasks.get({ appId: "assistant", userId: user!.id, taskId: task!.shortId }))!.revision,
      });
      if (!delivered.delivered) throw new Error("Expected scheduled task occurrence to be delivered");
      const [scheduledMessage] = await sql<{ meta: unknown }[]>`
        SELECT meta FROM ai.messages WHERE loop_id = ${delivered.turnId} AND role = 'user'
      `;
      expect(scheduledMessage?.meta).toEqual({
        scheduledTask: {
          taskId: task!.shortId,
          occurrenceId: occurrence!.shortId,
          scheduledFor: occurrence!.scheduledFor,
          trigger: "scheduled",
        },
      });
      expect(await aiChatTasks.finalizeTurn({ turnId: delivered.turnId, status: "completed" })).toEqual({
        occurrenceId: occurrence!.id,
        failed: false,
      });
      expect((await aiChatTasks.get({ appId: "assistant", userId: user!.id, taskId: task!.shortId }))?.state).toBe("completed");

      await sql`DELETE FROM ai.conversations WHERE id = ${conversation.id}::uuid`;
      const [counts] = await sql<{ tasks: number; occurrences: number }[]>`
        SELECT
          (SELECT count(*)::int FROM ai.chat_tasks WHERE id = ${task!.id}::uuid) AS tasks,
          (SELECT count(*)::int FROM ai.chat_task_occurrences WHERE id IN (${manual!.id}::uuid, ${occurrence!.id}::uuid)) AS occurrences
      `;
      expect(counts).toEqual({ tasks: 0, occurrences: 0 });
    } finally {
      await sql`DELETE FROM ai.conversations WHERE id = ${conversation.id}::uuid`;
      await sql`DELETE FROM auth.users WHERE id = ${user!.id}::uuid`;
    }
  });

  test("keeps retries, lifecycle changes, and terminal recovery consistent", async () => {
    const suffix = crypto.randomUUID();
    const users = await sql<{ id: string }[]>`
      INSERT INTO auth.users (uid, provider, profile, display_name, mail, given_name, sn)
      VALUES
        (${`ai-task-owner-${suffix}`}, 'local', 'user', 'AI Task Owner', ${`ai-task-owner-${suffix}@example.test`}, 'AI', 'Owner'),
        (${`ai-task-peer-${suffix}`}, 'local', 'user', 'AI Task Peer', ${`ai-task-peer-${suffix}@example.test`}, 'AI', 'Peer')
      RETURNING id
    `;
    const owner = users[0]!;
    const peer = users[1]!;
    const conversation = await aiConversations.createConversation({
      appId: "assistant",
      ownerUserId: owner.id,
      title: "Task recovery",
    });
    const peerConversation = await aiConversations.createConversation({
      appId: "assistant",
      ownerUserId: peer.id,
      title: "Peer tasks",
    });

    try {
      const createInput = {
        appId: "assistant",
        userId: owner.id,
        chatId: conversation.shortId,
        prompt: "Check recovery.",
        schedule: { kind: "cron" as const, cron: "0 9 * * 1" },
        timezone: "Europe/Berlin",
        idempotencyKey: `shared-${suffix}`,
      };
      const task = await aiChatTasks.create(createInput);
      expect((await aiChatTasks.create(createInput))?.id).toBe(task!.id);
      await expect(aiChatTasks.create({ ...createInput, prompt: "Different input" })).rejects.toBeInstanceOf(
        AiChatTaskIdempotencyConflictError,
      );
      expect(
        await aiChatTasks.create({ ...createInput, userId: peer.id, chatId: peerConversation.shortId, prompt: "Peer input" }),
      ).not.toBeNull();

      await aiChatTasks.setState({ appId: "assistant", userId: owner.id, taskId: task!.shortId, state: "paused" });
      expect(
        (
          await aiChatTasks.update({
            appId: "assistant",
            userId: owner.id,
            taskId: task!.shortId,
            prompt: "Updated while paused.",
          })
        )?.state,
      ).toBe("paused");
      await aiChatTasks.setState({ appId: "assistant", userId: owner.id, taskId: task!.shortId, state: "active" });
      const activeRevision = (await aiChatTasks.get({ appId: "assistant", userId: owner.id, taskId: task!.shortId }))!.revision;
      expect((await aiChatTasks.setState({ appId: "assistant", userId: owner.id, taskId: task!.shortId, state: "active" }))?.revision).toBe(
        activeRevision,
      );

      const stale = await aiChatTasks.createOccurrence({
        taskId: task!.id,
        scheduledFor: new Date().toISOString(),
        trigger: "manual",
        requestKey: `manual:stale:${suffix}`,
      });
      await aiChatTasks.update({
        appId: "assistant",
        userId: owner.id,
        taskId: task!.shortId,
        schedule: { kind: "cron", cron: "0 9 * * 1" },
        timezone: "Europe/Berlin",
      });
      expect((await aiChatTasks.listOccurrences({ appId: "assistant", userId: owner.id, taskId: task!.shortId }))?.[0]?.state).toBe(
        "queued",
      );
      await aiChatTasks.getQueuedOccurrence("assistant", stale!.id);
      await aiChatTasks.update({ appId: "assistant", userId: owner.id, taskId: task!.shortId, prompt: "Updated before preflight failed." });
      expect(await aiChatTasks.failOccurrence({ occurrenceId: stale!.id, error: "Stale preflight" })).toBe("stale");
      expect((await aiChatTasks.listOccurrences({ appId: "assistant", userId: owner.id, taskId: task!.shortId }))?.[0]?.state).toBe(
        "queued",
      );
      const rebound = await aiChatTasks.getQueuedOccurrence("assistant", stale!.id);
      const staleDelivery = await aiChatTasks.deliverOccurrence({
        occurrenceId: stale!.id,
        modelProfileId: "test-model",
        runConfig: { kind: "chat", input: rebound!.task.prompt, toolSource: { kind: "none" } },
        userMessage: { role: "user", content: [{ type: "text", text: rebound!.task.prompt }] },
        expectedRevision: rebound!.task.revision,
      });
      if (!staleDelivery.delivered) throw new Error("Expected stale occurrence delivery");
      await aiChatTasks.update({ appId: "assistant", userId: owner.id, taskId: task!.shortId, prompt: "Newer task prompt." });
      await sql`
        UPDATE ai.turns SET status = 'failed', error = 'Old run failed', completed_at = now()
        WHERE id = ${staleDelivery.turnId}::uuid
      `;
      await aiChatTasks.finalizeTurn({ turnId: staleDelivery.turnId, status: "failed" });
      expect((await aiChatTasks.get({ appId: "assistant", userId: owner.id, taskId: task!.shortId }))?.state).toBe("active");

      const failed = await aiChatTasks.createOccurrence({
        taskId: task!.id,
        scheduledFor: new Date(Date.now() + 1).toISOString(),
        trigger: "manual",
        requestKey: `manual:failed:${suffix}`,
      });
      const failedDelivery = await aiChatTasks.deliverOccurrence({
        occurrenceId: failed!.id,
        modelProfileId: "test-model",
        runConfig: { kind: "chat", input: "Fail", toolSource: { kind: "none" } },
        userMessage: { role: "user", content: [{ type: "text", text: "Fail" }] },
        expectedRevision: (await aiChatTasks.get({ appId: "assistant", userId: owner.id, taskId: task!.shortId }))!.revision,
      });
      if (!failedDelivery.delivered) throw new Error("Expected failed occurrence delivery");
      await sql`
        UPDATE ai.turns SET status = 'failed', error = 'Model unavailable', completed_at = now()
        WHERE id = ${failedDelivery.turnId}::uuid
      `;
      expect(await aiChatTasks.listTerminalRunningTurns("assistant")).toContainEqual({
        turnId: failedDelivery.turnId,
        status: "failed",
      });
      await aiChatTasks.finalizeTurn({ turnId: failedDelivery.turnId, status: "failed" });
      const detail = await aiChatTasks.listOccurrences({ appId: "assistant", userId: owner.id, taskId: task!.shortId });
      expect(detail?.find((entry) => entry.id === failed!.id)?.error).toBe("Model unavailable");
      expect((await aiChatTasks.get({ appId: "assistant", userId: owner.id, taskId: task!.shortId }))?.state).toBe("needs_attention");
      expect((await aiChatTasks.setState({ appId: "assistant", userId: owner.id, taskId: task!.shortId, state: "active" }))?.state).toBe(
        "active",
      );

      await sql`UPDATE ai.chat_tasks SET state = 'completed' WHERE id = ${task!.id}::uuid`;
      expect(
        (await aiChatTasks.update({ appId: "assistant", userId: owner.id, taskId: task!.shortId, prompt: "Still complete." }))?.state,
      ).toBe("completed");
      expect(
        (
          await aiChatTasks.update({
            appId: "assistant",
            userId: owner.id,
            taskId: task!.shortId,
            schedule: { kind: "once", runAt: new Date(Date.now() + 60_000).toISOString() },
            timezone: "Europe/Berlin",
          })
        )?.state,
      ).toBe("active");
      await sql`UPDATE ai.chat_tasks SET state = 'needs_attention' WHERE id = ${task!.id}::uuid`;
      expect(await aiChatTasks.setState({ appId: "assistant", userId: owner.id, taskId: task!.shortId, state: "active" })).toBeNull();
    } finally {
      await sql`DELETE FROM ai.conversations WHERE id IN (${conversation.id}::uuid, ${peerConversation.id}::uuid)`;
      await sql`DELETE FROM auth.users WHERE id IN (${owner.id}::uuid, ${peer.id}::uuid)`;
    }
  });
});
