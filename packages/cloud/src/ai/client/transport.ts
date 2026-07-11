import type { AiStreamSseEvent } from "../protocol";

export type AiStreamHandle = { close: () => void };
export type AiStreamFetch = (url: string, init: RequestInit) => Promise<Response>;

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 5_000;

/** Parse an SSE byte stream into decoded data payloads. */
async function* parseSse(response: Response, signal: AbortSignal): AsyncGenerator<AiStreamSseEvent> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const data = chunk
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data) yield JSON.parse(data) as AiStreamSseEvent;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/**
 * Subscribe to a conversation's SSE stream with automatic reconnect. Each
 * (re)connect starts with a fresh `state` event, so the projection self-heals on
 * every reconnect without cursor bookkeeping.
 */
export const subscribeAiStream = (input: {
  url: string;
  onEvent: (event: AiStreamSseEvent) => void;
  onStatus?: (status: "connecting" | "open" | "reconnecting") => void;
  fetch?: AiStreamFetch;
}): AiStreamHandle => {
  const controller = new AbortController();
  const fetchStream: AiStreamFetch = input.fetch ?? fetch;
  let reconnectDelay = RECONNECT_BASE_MS;
  let stopped = false;

  const loop = async () => {
    while (!stopped) {
      try {
        input.onStatus?.(reconnectDelay === RECONNECT_BASE_MS ? "connecting" : "reconnecting");
        const response = await fetchStream(input.url, { signal: controller.signal, headers: { Accept: "text/event-stream" } });
        if (stopped) return;
        if (!response.ok || !response.body) throw new Error(`AI stream failed: ${response.status}`);
        input.onStatus?.("open");
        reconnectDelay = RECONNECT_BASE_MS;
        for await (const event of parseSse(response, controller.signal)) {
          if (stopped) break;
          input.onEvent(event);
        }
      } catch {
        if (stopped) return;
      }
      if (stopped) return;
      await new Promise((resolve) => setTimeout(resolve, reconnectDelay));
      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
    }
  };

  void loop();
  return {
    close: () => {
      stopped = true;
      controller.abort();
    },
  };
};
