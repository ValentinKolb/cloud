import { topic } from "@valentinkolb/sync";
import type { AiSseEvent, AiStreamEvent } from "./types";

export const aiEventsTopic = topic<AiStreamEvent>({
  id: "cloud-ai-events",
  retentionMs: 15 * 60 * 1000,
  limits: { payloadBytes: 256 * 1024 },
});

const encoder = new TextEncoder();
const DEFAULT_HEARTBEAT_MS = 5_000;

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
  const published = await aiEventsTopic.pub({
    tenantId: event.conversationId,
    orderingKey: event.turnId,
    data: event,
  });
  return { ...event, cursor: published.cursor };
};

export const createAiEventReplayResponse = (input: {
  conversationId: string;
  turnId?: string;
  after?: string | null;
  signal?: AbortSignal;
  heartbeatMs?: number;
}): Response => {
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const liveAbort = new AbortController();
  const heartbeatMs = input.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const abortLive = () => liveAbort.abort();
  const clearHeartbeat = () => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = undefined;
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
          abortLive();
          return false;
        }
      };

      if (heartbeatMs > 0) {
        heartbeat = setInterval(() => {
          enqueue(encodeSseHeartbeat());
        }, heartbeatMs);
      }

      try {
        for await (const event of aiEventsTopic.live({
          tenantId: input.conversationId,
          after: input.after ?? undefined,
          signal: liveAbort.signal,
        })) {
          if (input.turnId && event.data.turnId !== input.turnId) continue;
          if (!enqueue(encodeSseEvent({ ...event.data, cursor: event.cursor }))) break;
          if (input.turnId && (event.data.type === "done" || event.data.type === "error")) break;
        }
      } catch (error) {
        if (!liveAbort.signal.aborted) {
          const message = error instanceof Error ? error.message : "AI event stream failed";
          enqueue(
            encodeSseEvent({
              type: "error",
              turnId: input.turnId ?? "unknown",
              conversationId: input.conversationId,
              message,
            }),
          );
        }
      } finally {
        clearHeartbeat();
        input.signal?.removeEventListener("abort", abortLive);
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
    cancel() {
      closed = true;
      clearHeartbeat();
      abortLive();
    },
  });

  return new Response(stream, { headers: sseHeaders });
};
