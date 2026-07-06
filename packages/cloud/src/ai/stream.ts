import { topic } from "@valentinkolb/sync";
import type { AiSseEvent, AiStreamEvent } from "./types";
import { aiConversationStore } from "./store";
import { logger } from "../services/logging";

export const aiEventsTopic = topic<AiSseEvent>({
  id: "cloud-ai-events",
  retentionMs: 15 * 60 * 1000,
  limits: { payloadBytes: 256 * 1024 },
});

export type AiTurnControlEvent =
  | { type: "abort"; conversationId: string; turnId: string }
  | { type: "action"; conversationId: string; turnId: string; callId: string };

export const aiTurnControlsTopic = topic<AiTurnControlEvent>({
  id: "cloud-ai-turn-controls",
  retentionMs: 15 * 60 * 1000,
  limits: { payloadBytes: 16 * 1024 },
});

const encoder = new TextEncoder();
const DEFAULT_HEARTBEAT_MS = 5_000;
const DEFAULT_DB_POLL_MS = 2_000;
const log = logger("ai:stream");

export const sseHeaders = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

export const encodeSseEvent = (event: AiSseEvent): Uint8Array => {
  const name = event.type === "nessi" ? event.event.type : event.type;
  const id = event.cursor ? `id: ${event.cursor}\n` : "";
  return encoder.encode(`${id}event: ${name}\ndata: ${JSON.stringify(event)}\n\n`);
};

export const encodeSseHeartbeat = (): Uint8Array => encoder.encode(": heartbeat\n\n");

export const publishAiEvent = async (event: AiStreamEvent): Promise<AiSseEvent> => {
  const stored = await aiConversationStore.appendTurnEvent({ event });
  if (!stored) return event;
  const published = await aiEventsTopic
    .pub({
      tenantId: event.conversationId,
      orderingKey: event.turnId,
      data: stored,
      idempotencyKey: stored.cursor ? `turn-event:${stored.cursor}` : undefined,
    })
    .catch(() => null);
  return { ...stored, cursor: stored.cursor ?? published?.cursor };
};

export const publishAiTurnControl = async (event: AiTurnControlEvent): Promise<void> => {
  await aiTurnControlsTopic.pub({
    tenantId: event.conversationId,
    orderingKey: event.turnId,
    data: event,
    idempotencyKey:
      event.type === "abort" ? `turn-control:${event.turnId}:abort` : `turn-control:${event.turnId}:action:${event.callId}`,
  });
};

const cursorSeq = (cursor: string | null | undefined): number => {
  if (!cursor) return 0;
  const match = /^[0-9]+/.exec(cursor);
  if (!match) return 0;
  const value = Number(match[0]);
  return Number.isSafeInteger(value) ? value : 0;
};

export const createAiEventReplayResponse = (input: {
  conversationId: string;
  turnId?: string;
  after?: string | null;
  signal?: AbortSignal;
  heartbeatMs?: number;
  pollMs?: number;
}): Response => {
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const liveAbort = new AbortController();
  const heartbeatMs = input.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const pollMs = input.pollMs ?? DEFAULT_DB_POLL_MS;
  const abortLive = () => liveAbort.abort();
  const clearHeartbeat = () => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = undefined;
  };
  const clearPoll = () => {
    if (poll) clearInterval(poll);
    poll = undefined;
  };
  if (input.signal?.aborted) abortLive();
  else input.signal?.addEventListener("abort", abortLive, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (chunk: Uint8Array) => {
        if (closed) return false;
        try {
          controller.enqueue(chunk);
          return true;
        } catch {
          closed = true;
          clearHeartbeat();
          clearPoll();
          input.signal?.removeEventListener("abort", abortLive);
          abortLive();
          return false;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        clearHeartbeat();
        clearPoll();
        abortLive();
        input.signal?.removeEventListener("abort", abortLive);
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
      let lastSeq = cursorSeq(input.after);
      let polling = false;
      const replayFromDb = async (): Promise<boolean> => {
        if (closed || polling) return false;
        polling = true;
        let replayedCount = 0;
        let maxReplayLagMs = 0;
        const logReplay = () => {
          if (replayedCount === 0) return;
          log.info("AI SSE replay delivered durable events", {
            conversationId: input.conversationId,
            turnId: input.turnId ?? null,
            replayedCount,
            maxReplayLagMs,
            lastSeq,
          });
        };
        try {
          const replayed = await aiConversationStore
            .listTurnEvents({
              conversationId: input.conversationId,
              turnId: input.turnId,
              after: String(lastSeq),
            })
            .catch(() => []);

          for (const event of replayed) {
            if (event.seq <= lastSeq) continue;
            replayedCount += 1;
            maxReplayLagMs = Math.max(maxReplayLagMs, Date.now() - new Date(event.createdAt).getTime());
            lastSeq = event.seq;
            if (!enqueue(encodeSseEvent(event))) return true;
            if (input.turnId && (event.type === "done" || event.type === "error")) {
              logReplay();
              close();
              return true;
            }
          }
          logReplay();
          return false;
        } finally {
          polling = false;
        }
      };

      if (pollMs > 0) {
        poll = setInterval(() => {
          void replayFromDb();
        }, pollMs);
        if (typeof poll === "object" && poll && "unref" in poll && typeof poll.unref === "function") poll.unref();
      }

      try {
        const liveAfter = (await aiEventsTopic.latestCursor({ tenantId: input.conversationId }).catch(() => null)) ?? "0-0";
        if (await replayFromDb()) return;

        for await (const event of aiEventsTopic.live({
          tenantId: input.conversationId,
          after: liveAfter,
          signal: liveAbort.signal,
        })) {
          if (input.turnId && event.data.turnId !== input.turnId) continue;
          const eventSeq = cursorSeq(event.data.cursor);
          if (eventSeq > 0 && eventSeq <= lastSeq) continue;
          lastSeq = Math.max(lastSeq, eventSeq);
          if (!enqueue(encodeSseEvent({ ...event.data, cursor: event.data.cursor ?? event.cursor }))) break;
          if (input.turnId && (event.data.type === "done" || event.data.type === "error")) {
            close();
            return;
          }
        }
      } catch (error) {
        if (!liveAbort.signal.aborted) {
          const message = error instanceof Error ? error.message : "AI event stream failed";
          enqueue(
            encodeSseEvent({
              type: "error",
              turnId: input.turnId ?? "unknown",
              conversationId: input.conversationId,
              loopId: input.turnId,
              message,
            }),
          );
        }
      } finally {
        close();
      }
    },
    cancel() {
      closed = true;
      clearHeartbeat();
      clearPoll();
      abortLive();
    },
  });

  return new Response(stream, { headers: sseHeaders });
};
