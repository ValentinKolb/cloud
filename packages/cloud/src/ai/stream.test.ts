import { describe, expect, test } from "bun:test";
import { createAiEventReplayResponse, encodeSseEvent, encodeSseHeartbeat, publishAiEvent } from "./stream";
import type { AiSseEvent } from "./types";

const decode = (event: AiSseEvent) => new TextDecoder().decode(encodeSseEvent(event));

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
      event: { type: "text", agentId: "cloud", delta: "Hello" },
      cursor: "2-0",
    });

    expect(encoded).toContain("event: text\n");
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

  test("replays published events from the sync topic cursor", async () => {
    const conversationId = `stream-test-${crypto.randomUUID()}`;
    const turnId = crypto.randomUUID();

    let published: Awaited<ReturnType<typeof publishAiEvent>>;
    try {
      published = await publishAiEvent({
        type: "turn_start",
        turnId,
        conversationId,
        modelProfileId: "model-1",
        providerModel: "provider/model",
      });
    } catch (error) {
      console.warn(
        `Skipping AI sync.topic replay integration test: ${error instanceof Error ? error.message : "sync topic is not available"}.`,
      );
      return;
    }

    const abort = new AbortController();
    const response = createAiEventReplayResponse({ conversationId, turnId, after: "0-0", signal: abort.signal });
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) return;

    const chunk = await reader.read();
    abort.abort();
    await reader.cancel().catch(() => undefined);

    const text = new TextDecoder().decode(chunk.value);
    expect(text).toContain(`id: ${published.cursor}\n`);
    expect(text).toContain("event: turn_start\n");
    expect(text).toContain(`"turnId":"${turnId}"`);
  });

  test("closes turn replay streams after final events", async () => {
    const conversationId = `stream-test-${crypto.randomUUID()}`;
    const turnId = crypto.randomUUID();

    try {
      await publishAiEvent({
        type: "turn_start",
        turnId,
        conversationId,
        modelProfileId: "model-1",
        providerModel: "provider/model",
      });
      await publishAiEvent({
        type: "done",
        turnId,
        conversationId,
        reason: "stop",
      });
    } catch (error) {
      console.warn(
        `Skipping AI sync.topic final-event integration test: ${error instanceof Error ? error.message : "sync topic is not available"}.`,
      );
      return;
    }

    const response = createAiEventReplayResponse({ conversationId, turnId, after: "0-0" });
    const text = await response.text();

    expect(text).toContain("event: turn_start\n");
    expect(text).toContain("event: done\n");
    expect(text).toContain(`"turnId":"${turnId}"`);
  });

  test("resumes after the last cursor without duplicating prior events", async () => {
    const conversationId = `stream-test-${crypto.randomUUID()}`;
    const turnId = crypto.randomUUID();

    let firstCursor: string;
    try {
      const first = await publishAiEvent({
        type: "turn_start",
        turnId,
        conversationId,
        modelProfileId: "model-1",
        providerModel: "provider/model",
      });
      firstCursor = first.cursor ?? "0-0";
      await publishAiEvent({
        type: "done",
        turnId,
        conversationId,
        reason: "stop",
      });
    } catch (error) {
      console.warn(
        `Skipping AI sync.topic cursor-resume integration test: ${error instanceof Error ? error.message : "sync topic is not available"}.`,
      );
      return;
    }

    const response = createAiEventReplayResponse({ conversationId, turnId, after: firstCursor });
    const text = await response.text();

    expect(text).not.toContain("event: turn_start\n");
    expect(text).toContain("event: done\n");
    expect(text).toContain(`"turnId":"${turnId}"`);
  });
});
