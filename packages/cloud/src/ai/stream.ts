import { topic } from "@valentinkolb/sync";
import { logger } from "../services/logging";
import {
  type AiStreamSseEvent,
  type AiTurnSnapshot,
  type AiWireEvent,
  isNewerWireEvent,
  steerAppliedBlockId,
  steerMessageBlockId,
} from "./protocol";
import { aiConversationStore } from "./store";
import type { AiConversation } from "./types";

const log = logger("ai:stream");

/**
 * Live fanout for wire events. Events carry their full payload so the SSE hot
 * path never touches Postgres; durable state lives in ai.messages plus the
 * throttled ai.turns.live_blocks snapshot.
 */
export const aiStreamTopic = topic<AiWireEvent>({
  id: "cloud-ai-stream",
  retentionMs: 15 * 60 * 1000,
  limits: { payloadBytes: 256 * 1024 },
});

export type AiTurnControlEvent = { type: "abort"; conversationId: string; turnId: string };

export const aiTurnControlsTopic = topic<AiTurnControlEvent>({
  id: "cloud-ai-turn-controls",
  retentionMs: 15 * 60 * 1000,
  limits: { payloadBytes: 4 * 1024 },
});

export const publishAiWireEvent = async (event: AiWireEvent): Promise<void> => {
  await aiStreamTopic.pub({
    tenantId: event.conversationId,
    orderingKey: event.turnId,
    data: event,
    idempotencyKey: `wire:${event.turnId}:${event.attempt}:${event.seq}`,
  });
};

export const publishAiTurnAbort = async (input: { conversationId: string; turnId: string }): Promise<void> => {
  await aiTurnControlsTopic.pub({
    tenantId: input.conversationId,
    orderingKey: input.turnId,
    data: { type: "abort", conversationId: input.conversationId, turnId: input.turnId },
    idempotencyKey: `turn-abort:${input.turnId}`,
  });
};

const encoder = new TextEncoder();
const DEFAULT_HEARTBEAT_MS = 5_000;

export const sseHeaders = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

export const encodeSseEvent = (event: AiStreamSseEvent): Uint8Array =>
  encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);

export const encodeSseHeartbeat = (): Uint8Array => encoder.encode(": heartbeat\n\n");

const turnSnapshotFromActive = (active: NonNullable<Awaited<ReturnType<typeof aiConversationStore.getActiveTurn>>>): AiTurnSnapshot => ({
  turnId: active.turn.id,
  attempt: active.turn.attempt,
  status: active.turn.status,
  seq: active.liveSeq,
  blocks: active.liveBlocks,
  modelProfileId: active.turn.modelProfileId,
  createdAt: active.turn.createdAt,
});

/** Initial history window; older messages load on demand while scrolling up. */
export const AI_STREAM_INITIAL_MESSAGE_LIMIT = 100;

export const loadAiStreamState = async (conversation: AiConversation): Promise<Extract<AiStreamSseEvent, { type: "state" }>> => {
  const [page, active] = await Promise.all([
    aiConversationStore.listMessagesPage({ conversationId: conversation.id, limit: AI_STREAM_INITIAL_MESSAGE_LIMIT }),
    aiConversationStore.getActiveTurn({ conversationId: conversation.id }),
  ]);
  const snapshot = active ? turnSnapshotFromActive(active) : null;
  if (snapshot) {
    const steers = await aiConversationStore.listTurnSteers({ conversationId: conversation.id, turnId: snapshot.turnId });
    const known = new Set(snapshot.blocks.map((block) => block.id));
    for (const steer of steers) {
      if (steer.status === "discarded" || known.has(steerMessageBlockId(steer.id))) continue;
      snapshot.blocks.push({
        id: steerMessageBlockId(steer.id),
        kind: "steer_message",
        steerId: steer.id,
        text: steer.text,
        status: steer.status === "pending" ? "pending" : "consumed",
      });
      if (steer.status === "consumed" && !known.has(steerAppliedBlockId(steer.id))) {
        snapshot.blocks.push({ id: steerAppliedBlockId(steer.id), kind: "steer_applied", steerId: steer.id });
      }
    }
  }
  return {
    type: "state",
    conversation,
    messages: page.messages,
    hasMoreMessages: page.hasMore,
    activeTurn: snapshot,
  };
};

/**
 * Conversation-scoped SSE stream: one `state` snapshot, then the live tail.
 *
 * The topic cursor is grabbed before the snapshot is loaded, so every event
 * that races the snapshot is replayed from the tail and deduplicated via
 * (attempt, seq). Events of unknown turns are dropped until their
 * `turn_started` arrives, which makes stale retention entries harmless.
 */
export const createAiConversationStreamResponse = (input: {
  conversation: AiConversation;
  signal?: AbortSignal;
  heartbeatMs?: number;
}): Response => {
  const heartbeatMs = input.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const liveAbort = new AbortController();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const abortLive = () => liveAbort.abort();
  if (input.signal?.aborted) abortLive();
  else input.signal?.addEventListener("abort", abortLive, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (chunk: Uint8Array): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(chunk);
          return true;
        } catch {
          close();
          return false;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = undefined;
        input.signal?.removeEventListener("abort", abortLive);
        abortLive();
        try {
          controller.close();
        } catch {
          // The client may already have cancelled the stream.
        }
      };

      if (heartbeatMs > 0) {
        heartbeat = setInterval(() => {
          enqueue(encodeSseHeartbeat());
        }, heartbeatMs);
      }

      try {
        const liveAfter = (await aiStreamTopic.latestCursor({ tenantId: input.conversation.id }).catch(() => null)) ?? "0-0";
        const state = await loadAiStreamState(input.conversation);
        if (!enqueue(encodeSseEvent(state))) return;

        // Forwarding gate: events of the snapshot turn continue from the snapshot
        // position; other turns only start at their turn_started event.
        let current: { turnId: string; attempt: number; seq: number } | null = state.activeTurn
          ? { turnId: state.activeTurn.turnId, attempt: state.activeTurn.attempt, seq: state.activeTurn.seq }
          : null;

        for await (const received of aiStreamTopic.live({
          tenantId: input.conversation.id,
          after: liveAfter,
          signal: liveAbort.signal,
        })) {
          const event = received.data;
          if (current?.turnId === event.turnId) {
            if (!isNewerWireEvent(event, current)) continue;
          } else if (event.type !== "turn_started") {
            continue;
          }
          current = { turnId: event.turnId, attempt: event.attempt, seq: event.seq };

          if (event.type === "turn_finished") {
            const messages = await aiConversationStore
              .listTurnMessages({ conversationId: event.conversationId, loopId: event.turnId })
              .catch(() => []);
            if (!enqueue(encodeSseEvent({ ...event, messages }))) return;
            continue;
          }

          if (!enqueue(encodeSseEvent(event))) return;
        }
      } catch (error) {
        if (!liveAbort.signal.aborted) {
          log.warn("AI conversation stream failed", {
            conversationId: input.conversation.id,
            error: error instanceof Error ? error.message : "AI conversation stream failed",
          });
        }
      } finally {
        close();
      }
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      abortLive();
    },
  });

  return new Response(stream, { headers: sseHeaders });
};
