import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { migrateCloudAi } from "./migrate";
import { aiConversationStore } from "./store";
import { createAiEventReplayResponse, encodeSseEvent, encodeSseHeartbeat, publishAiEvent } from "./stream";
import type { AiSseEvent } from "./types";

const decode = (event: AiSseEvent) => new TextDecoder().decode(encodeSseEvent(event));

const canUseAiDatabase = async () => {
  try {
    const [authRow] = await sql<{ users: string | null }[]>`
      SELECT to_regclass('auth.users')::text AS users
    `;
    if (!authRow?.users) return false;
    await migrateCloudAi();
    return true;
  } catch {
    return false;
  }
};

const createStreamFixture = async () => {
  if (!(await canUseAiDatabase())) return null;
  const suffix = crypto.randomUUID();
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO auth.users (uid, provider, profile, display_name, mail, given_name, sn)
    VALUES (${`ai-stream-${suffix}`}, 'local', 'user', 'AI Stream Test', ${`ai-stream-${suffix}@example.test`}, 'AI', 'Stream')
    RETURNING id
  `;
  const conversation = await aiConversationStore.createConversation({
    appId: "ai-stream-test",
    ownerUserId: user!.id,
    title: "Stream test",
  });
  const turn = await aiConversationStore.createTurn({ conversationId: conversation.id, modelProfileId: "model-1" });
  return {
    conversationId: conversation.id,
    turnId: turn.id,
    cleanup: async () => {
      await sql`DELETE FROM ai.conversations WHERE id = ${conversation.id}::uuid`;
      await sql`DELETE FROM auth.users WHERE id = ${user!.id}::uuid`;
    },
  };
};

describe("AI SSE stream encoding", () => {
  test("uses the cloud event type and cursor as SSE metadata", () => {
    const encoded = decode({
      type: "turn_start",
      turnId: "turn-1",
      conversationId: "conversation-1",
      modelProfileId: "model-1",
      providerModel: "openai/gpt-4.1-mini",
      cursor: "1-0",
    });

    expect(encoded).toContain("id: 1-0\n");
    expect(encoded).toContain("event: turn_start\n");
    expect(encoded).toContain('"turnId":"turn-1"');
  });

  test("uses the nested Nessi event type for Nessi events", () => {
    const encoded = decode({
      type: "nessi",
      turnId: "turn-1",
      conversationId: "conversation-1",
      loopId: "turn-1",
      event: { type: "text", agentId: "cloud", loopId: "turn-1", delta: "Hello" },
      cursor: "2-0",
    });

    expect(encoded).toContain("event: text\n");
    expect(encoded).toContain('"loopId":"turn-1"');
    expect(encoded).toContain('"delta":"Hello"');
  });

  test("encodes heartbeats as SSE comments", () => {
    expect(new TextDecoder().decode(encodeSseHeartbeat())).toBe(": heartbeat\n\n");
  });

  test("cancels heartbeat-only replay streams without a final event", async () => {
    const response = createAiEventReplayResponse({
      conversationId: `stream-test-${crypto.randomUUID()}`,
      turnId: crypto.randomUUID(),
      after: "0-0",
      heartbeatMs: 1,
    });
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) return;

    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe(": heartbeat\n\n");
    await expect(reader.cancel()).resolves.toBeUndefined();
  });

  test("replays published events from the durable event log cursor", async () => {
    const fixture = await createStreamFixture();
    if (!fixture) {
      console.warn("Skipping AI event-log replay integration test: auth/ai tables are not available.");
      return;
    }

    try {
      const published = await publishAiEvent({
        type: "turn_start",
        turnId: fixture.turnId,
        conversationId: fixture.conversationId,
        modelProfileId: "model-1",
        providerModel: "provider/model",
      });

      const abort = new AbortController();
      const response = createAiEventReplayResponse({
        conversationId: fixture.conversationId,
        turnId: fixture.turnId,
        after: "0-0",
        signal: abort.signal,
      });
      const reader = response.body?.getReader();
      expect(reader).toBeDefined();
      if (!reader) return;

      const chunk = await reader.read();
      abort.abort();
      await reader.cancel().catch(() => undefined);

      const text = new TextDecoder().decode(chunk.value);
      expect(text).toContain(`id: ${published.cursor}\n`);
      expect(text).toContain("event: turn_start\n");
      expect(text).toContain(`"turnId":"${fixture.turnId}"`);
    } finally {
      await fixture.cleanup();
    }
  });

  test("follows durable DB events even when topic delivery misses an event", async () => {
    const fixture = await createStreamFixture();
    if (!fixture) {
      console.warn("Skipping AI event-log DB-poll integration test: auth/ai tables are not available.");
      return;
    }

    try {
      const response = createAiEventReplayResponse({
        conversationId: fixture.conversationId,
        turnId: fixture.turnId,
        after: "0-0",
        heartbeatMs: 0,
        pollMs: 10,
      });
      const reader = response.body?.getReader();
      expect(reader).toBeDefined();
      if (!reader) return;

      const read = reader.read();
      const stored = await aiConversationStore.appendTurnEvent({
        event: {
          type: "turn_start",
          turnId: fixture.turnId,
          conversationId: fixture.conversationId,
          modelProfileId: "model-1",
          providerModel: "provider/model",
        },
      });

      const chunk = await Promise.race([
        read,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Timed out waiting for DB-polled AI event")), 1_000)),
      ]);
      await reader.cancel().catch(() => undefined);

      const text = new TextDecoder().decode(chunk.value);
      expect(text).toContain(`id: ${stored?.cursor}\n`);
      expect(text).toContain("event: turn_start\n");
      expect(text).toContain(`"turnId":"${fixture.turnId}"`);
    } finally {
      await fixture.cleanup();
    }
  });

  test("fans out live turn events to multiple replay subscribers", async () => {
    const fixture = await createStreamFixture();
    if (!fixture) {
      console.warn("Skipping AI event-log multi-subscriber integration test: auth/ai tables are not available.");
      return;
    }

    try {
      const first = createAiEventReplayResponse({
        conversationId: fixture.conversationId,
        turnId: fixture.turnId,
        after: "0-0",
        heartbeatMs: 0,
        pollMs: 0,
      }).body?.getReader();
      const second = createAiEventReplayResponse({
        conversationId: fixture.conversationId,
        turnId: fixture.turnId,
        after: "0-0",
        heartbeatMs: 0,
        pollMs: 0,
      }).body?.getReader();
      expect(first).toBeDefined();
      expect(second).toBeDefined();
      if (!first || !second) return;

      const firstRead = first.read();
      const secondRead = second.read();
      const published = await publishAiEvent({
        type: "turn_start",
        turnId: fixture.turnId,
        conversationId: fixture.conversationId,
        modelProfileId: "model-1",
        providerModel: "provider/model",
      });

      const [firstChunk, secondChunk] = await Promise.race([
        Promise.all([firstRead, secondRead]),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Timed out waiting for multi-subscriber AI events")), 1_000)),
      ]);
      await first.cancel().catch(() => undefined);
      await second.cancel().catch(() => undefined);

      const firstText = new TextDecoder().decode(firstChunk.value);
      const secondText = new TextDecoder().decode(secondChunk.value);
      expect(firstText).toContain(`id: ${published.cursor}\n`);
      expect(secondText).toContain(`id: ${published.cursor}\n`);
      expect(firstText).toContain(`"turnId":"${fixture.turnId}"`);
      expect(secondText).toContain(`"turnId":"${fixture.turnId}"`);
    } finally {
      await fixture.cleanup();
    }
  });

  test("closes turn replay streams after final events", async () => {
    const fixture = await createStreamFixture();
    if (!fixture) {
      console.warn("Skipping AI event-log final-event integration test: auth/ai tables are not available.");
      return;
    }

    try {
      await publishAiEvent({
        type: "turn_start",
        turnId: fixture.turnId,
        conversationId: fixture.conversationId,
        modelProfileId: "model-1",
        providerModel: "provider/model",
      });
      await publishAiEvent({
        type: "done",
        turnId: fixture.turnId,
        conversationId: fixture.conversationId,
        reason: "stop",
        aggregate: null,
      });

      const response = createAiEventReplayResponse({ conversationId: fixture.conversationId, turnId: fixture.turnId, after: "0-0" });
      const text = await response.text();

      expect(text).toContain("event: turn_start\n");
      expect(text).toContain("event: done\n");
      expect(text).toContain(`"turnId":"${fixture.turnId}"`);
    } finally {
      await fixture.cleanup();
    }
  });

  test("resumes after the last cursor without duplicating prior events", async () => {
    const fixture = await createStreamFixture();
    if (!fixture) {
      console.warn("Skipping AI event-log cursor-resume integration test: auth/ai tables are not available.");
      return;
    }

    try {
      const first = await publishAiEvent({
        type: "turn_start",
        turnId: fixture.turnId,
        conversationId: fixture.conversationId,
        modelProfileId: "model-1",
        providerModel: "provider/model",
      });
      await publishAiEvent({
        type: "done",
        turnId: fixture.turnId,
        conversationId: fixture.conversationId,
        reason: "stop",
        aggregate: null,
      });

      const response = createAiEventReplayResponse({ conversationId: fixture.conversationId, turnId: fixture.turnId, after: first.cursor });
      const text = await response.text();

      expect(text).not.toContain("event: turn_start\n");
      expect(text).toContain("event: done\n");
      expect(text).toContain(`"turnId":"${fixture.turnId}"`);
    } finally {
      await fixture.cleanup();
    }
  });
});
