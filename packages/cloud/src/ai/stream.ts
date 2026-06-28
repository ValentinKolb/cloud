import { topic } from "@valentinkolb/sync";
import type { AiSseEvent, AiStreamEvent } from "./types";

export const aiEventsTopic = topic<AiStreamEvent>({
  id: "cloud-ai-events",
  retentionMs: 15 * 60 * 1000,
  limits: { payloadBytes: 256 * 1024 },
});

const encoder = new TextEncoder();

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
}): Response => {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of aiEventsTopic.live({
          tenantId: input.conversationId,
          after: input.after ?? undefined,
          signal: input.signal,
          timeoutMs: 30_000,
        })) {
          if (input.turnId && event.data.turnId !== input.turnId) continue;
          controller.enqueue(encodeSseEvent({ ...event.data, cursor: event.cursor }));
          if (input.turnId && (event.data.type === "done" || event.data.type === "error")) break;
        }
      } catch (error) {
        if (!input.signal?.aborted) {
          const message = error instanceof Error ? error.message : "AI event stream failed";
          controller.enqueue(
            encodeSseEvent({
              type: "error",
              turnId: input.turnId ?? "unknown",
              conversationId: input.conversationId,
              message,
            }),
          );
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: sseHeaders });
};
