import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Message } from "@valentinkolb/nessi";
import { sql } from "bun";
import { AiTurnExecutor } from "./executor";
import { migrateCloudAi } from "./migrate";
import type { AiWireEvent } from "./protocol";
import { createAiProvider } from "./provider";
import { aiConversationStore } from "./store";
import { aiStreamTopic } from "./stream";
import type { AiModelProfile } from "./types";
import type { validateAiTurnRequest } from "./validate";

/**
 * End-to-end executor test against the real DB + Redis, driving a local
 * OpenAI-compatible mock server so no real model is called. Verifies the full
 * turn lifecycle: claim -> nessi loop -> block wire events -> message
 * persistence -> turn_finished.
 *
 * The executor's settings/model resolution is injected (validateTurn), so this
 * suite NEVER reads or writes shared settings — configured model profiles in
 * the dev environment stay untouched.
 */

const MODEL_ID = "mock-exec";
let mockServer: ReturnType<typeof Bun.serve> | null = null;
/** The SSE chunks the mock returns for the next /chat/completions call. */
let nextCompletion: string[] = [];
let completionQueue: string[][] = [];
let onCompletionRequest: ((body: unknown, index: number) => void | Promise<void>) | null = null;
let completionRequestCount = 0;

const mockProfile = (): AiModelProfile => ({
  id: MODEL_ID,
  label: "Mock",
  provider: "openai-compatible",
  model: "mock",
  enabled: true,
  capabilities: ["streaming"],
  dataBoundary: "private",
  baseURL: `http://localhost:${mockServer?.port ?? 0}/v1`,
  apiKey: "test",
});

/** Injected settings seam — no shared settings reads/writes anywhere in this suite. */
const fakeValidateTurn: typeof validateAiTurnRequest = async () => {
  const profile = mockProfile();
  return {
    settings: {
      ok: true,
      enabled: true,
      defaultModelId: MODEL_ID,
      globalInstructions: "",
      compactionPrompt: "",
      maxToolResultChars: 2_000,
      firecrawlConfigured: false,
      profiles: [profile],
    },
    resolved: { profile, provider: createAiProvider(profile, "test") },
  };
};

const sseChunk = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;

const textCompletion = (text: string): string[] => [
  sseChunk({ choices: [{ delta: { role: "assistant" } }] }),
  ...text.split(" ").map((word, index) => sseChunk({ choices: [{ delta: { content: (index === 0 ? "" : " ") + word } }] })),
  sseChunk({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } }),
  "data: [DONE]\n\n",
];

const canRun = async (): Promise<boolean> => {
  try {
    const [row] = await sql<{ users: string | null }[]>`SELECT to_regclass('auth.users')::text AS users`;
    if (!row?.users) return false;
    await migrateCloudAi();
    return true;
  } catch {
    return false;
  }
};

beforeAll(() => {
  mockServer = Bun.serve({
    port: 0,
    async fetch(req) {
      if (new URL(req.url).pathname.endsWith("/chat/completions")) {
        const requestBody = await req.json().catch(() => null);
        const requestIndex = completionRequestCount++;
        await onCompletionRequest?.(requestBody, requestIndex);
        const chunks = completionQueue.shift() ?? nextCompletion;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            const encoder = new TextEncoder();
            for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
            controller.close();
          },
        });
        return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
      }
      return new Response("not found", { status: 404 });
    },
  });
});

afterAll(() => {
  mockServer?.stop(true);
});

const insertUser = async () => {
  const suffix = crypto.randomUUID();
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO auth.users (uid, provider, profile, display_name, mail, given_name, sn)
    VALUES (${`ai-exec-${suffix}`}, 'local', 'user', 'AI Exec', ${`ai-exec-${suffix}@example.test`}, 'AI', 'Exec')
    RETURNING id
  `;
  return row!.id;
};

const collectWire = async (conversationId: string, until: (event: AiWireEvent) => boolean, timeoutMs = 5_000): Promise<AiWireEvent[]> => {
  const events: AiWireEvent[] = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const after = (await aiStreamTopic.latestCursor({ tenantId: conversationId }).catch(() => null)) ?? "0-0";
    for await (const received of aiStreamTopic.live({ tenantId: conversationId, after, signal: controller.signal })) {
      events.push(received.data);
      if (until(received.data)) break;
    }
  } catch {
    // aborted on timeout
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return events;
};

const userMessage = (text: string): Message => ({ role: "user", content: [{ type: "text", text }] });

const createExecutor = (leaseOwner: string) =>
  new AiTurnExecutor({ leaseOwner, heartbeatMs: 5_000, enqueueContinuation: async () => {}, validateTurn: fakeValidateTurn });

describe("AI executor integration", () => {
  test("runs a chat turn end to end: claim, stream, persist, finish", async () => {
    if (!(await canRun())) {
      console.warn("Skipping executor integration test: DB not available.");
      return;
    }
    const userId = await insertUser();
    const conversation = await aiConversationStore.createConversation({ appId: "ai-exec", ownerUserId: userId });

    try {
      nextCompletion = textCompletion("Hello from the mock model");
      const { turn } = await aiConversationStore.submitChatTurn({
        conversationId: conversation.id,
        modelProfileId: MODEL_ID,
        runConfig: { kind: "chat", input: "Hi", toolSource: { kind: "none" } },
        userMessage: userMessage("Hi"),
      });

      // Start collecting wire events, then run the executor.
      const collecting = collectWire(conversation.id, (event) => event.type === "turn_finished");

      const claim = await aiConversationStore.claimTurn({
        conversationId: conversation.id,
        turnId: turn.id,
        leaseOwner: "exec-test",
        leaseMs: 30_000,
        from: "queue",
        maxAttempts: 5,
        runBudgetMs: 60_000,
      });
      expect(claim).not.toBeNull();

      await createExecutor("exec-test").run({ conversationId: conversation.id, turnId: turn.id, claim: claim!, signal: new AbortController().signal });

      const events = await collecting;
      const types = events.map((event) => event.type);
      expect(types).toContain("turn_started");
      expect(types.some((type) => type === "block_set" || type === "block_delta")).toBe(true);
      const finished = events.find((event) => event.type === "turn_finished");
      expect(finished).toMatchObject({ status: "completed" });

      // The turn is completed and the assistant message is persisted with loop id = turn id.
      const finalTurn = await aiConversationStore.getTurn({ conversationId: conversation.id, turnId: turn.id });
      expect(finalTurn?.status).toBe("completed");

      const messages = await aiConversationStore.listMessages({ conversationId: conversation.id });
      expect(messages).toHaveLength(2);
      expect(messages[0]?.message.role).toBe("user");
      expect(messages[1]?.message.role).toBe("assistant");
      expect(messages[1]?.loopId).toBe(turn.id);
      const assistantText = messages[1]?.message.role === "assistant" ? messages[1].message.content.map((b) => (b.type === "text" ? b.text : "")).join("") : "";
      expect(assistantText).toContain("Hello from the mock model");
    } finally {
      await sql`DELETE FROM ai.conversations WHERE id = ${conversation.id}::uuid`;
      await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
    }
  });

  test("a fresh claim after a crash re-runs without duplicating the user message", async () => {
    if (!(await canRun())) return;
    const userId = await insertUser();
    const conversation = await aiConversationStore.createConversation({ appId: "ai-exec", ownerUserId: userId });

    try {
      nextCompletion = textCompletion("Recovered answer");
      const { turn } = await aiConversationStore.submitChatTurn({
        conversationId: conversation.id,
        modelProfileId: MODEL_ID,
        runConfig: { kind: "chat", input: "Hi", toolSource: { kind: "none" } },
        userMessage: userMessage("Hi"),
      });

      // Simulate a crashed first attempt: claim then expire the lease without running.
      await aiConversationStore.claimTurn({
        conversationId: conversation.id,
        turnId: turn.id,
        leaseOwner: "dead-worker",
        leaseMs: 30_000,
        from: "queue",
        maxAttempts: 5,
        runBudgetMs: 60_000,
      });
      await sql`UPDATE ai.turns SET lease_expires_at = now() - interval '1 second' WHERE id = ${turn.id}`;

      // Recovery: a second worker claims (attempt 2) and runs to completion.
      const claim = await aiConversationStore.claimTurn({
        conversationId: conversation.id,
        turnId: turn.id,
        leaseOwner: "live-worker",
        leaseMs: 30_000,
        from: "queue",
        maxAttempts: 5,
        runBudgetMs: 60_000,
      });
      expect(claim?.turn.attempt).toBe(2);

      await createExecutor("live-worker").run({ conversationId: conversation.id, turnId: turn.id, claim: claim!, signal: new AbortController().signal });

      const messages = await aiConversationStore.listMessages({ conversationId: conversation.id });
      // Exactly one user message (no duplicate) and one assistant answer.
      expect(messages.filter((m) => m.message.role === "user")).toHaveLength(1);
      expect(messages.filter((m) => m.message.role === "assistant")).toHaveLength(1);
    } finally {
      await sql`DELETE FROM ai.conversations WHERE id = ${conversation.id}::uuid`;
      await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
    }
  });

  test("steering submitted during the final provider response continues the same turn", async () => {
    if (!(await canRun())) return;
    const userId = await insertUser();
    const conversation = await aiConversationStore.createConversation({ appId: "ai-exec", ownerUserId: userId });

    try {
      completionRequestCount = 0;
      completionQueue = [textCompletion("Initial answer"), textCompletion("Revised answer")];
      const requests: unknown[] = [];
      const { turn } = await aiConversationStore.submitChatTurn({
        conversationId: conversation.id,
        modelProfileId: MODEL_ID,
        runConfig: { kind: "chat", input: "Start", toolSource: { kind: "none" } },
        userMessage: userMessage("Start"),
      });
      onCompletionRequest = async (body, index) => {
        requests.push(body);
        if (index !== 0) return;
        const result = await aiConversationStore.enqueueTurnSteer({
          conversationId: conversation.id,
          turnId: turn.id,
          clientRequestId: "late-steer",
          text: "Change course",
        });
        expect(result.ok).toBe(true);
      };

      const collecting = collectWire(conversation.id, (event) => event.type === "turn_finished");
      const claim = await aiConversationStore.claimTurn({
        conversationId: conversation.id,
        turnId: turn.id,
        leaseOwner: "steer-exec",
        leaseMs: 30_000,
        from: "queue",
        maxAttempts: 5,
        runBudgetMs: 60_000,
      });
      await createExecutor("steer-exec").run({
        conversationId: conversation.id,
        turnId: turn.id,
        claim: claim!,
        signal: new AbortController().signal,
      });

      const events = await collecting;
      const blockSets = events.filter((event): event is Extract<AiWireEvent, { type: "block_set" }> => event.type === "block_set");
      expect(blockSets.some((event) => event.block.kind === "steer_message" && event.block.status === "consumed")).toBe(true);
      expect(blockSets.some((event) => event.block.kind === "steer_applied")).toBe(true);
      expect(events.at(-1)).toMatchObject({ type: "turn_finished", status: "completed" });

      const messages = await aiConversationStore.listMessages({ conversationId: conversation.id });
      expect(messages.map((entry) => entry.message.role)).toEqual(["user", "assistant", "user", "assistant"]);
      expect(messages[2]?.meta?.steerId).toBeTruthy();
      expect(requests).toHaveLength(2);
      expect(JSON.stringify(requests[1])).toContain("Change course");
    } finally {
      onCompletionRequest = null;
      completionQueue = [];
      await sql`DELETE FROM ai.conversations WHERE id = ${conversation.id}::uuid`;
      await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
    }
  });
});
