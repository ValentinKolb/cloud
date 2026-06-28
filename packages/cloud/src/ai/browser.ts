import type { AiSseEvent } from "./types";

export const readAiError = async (response: Response, fallback: string): Promise<string> => {
  const body = await response.json().catch(() => null);
  return body && typeof body === "object" && "message" in body && typeof body.message === "string" ? body.message : fallback;
};

export async function* parseAiSse(response: Response): AsyncGenerator<AiSseEvent> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";

  const readChunk = function* (chunk: string): Generator<AiSseEvent> {
    const data = chunk
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data) yield JSON.parse(data) as AiSseEvent;
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";

      for (const chunk of chunks) {
        yield* readChunk(chunk);
      }
    }
    if (buffer.trim()) yield* readChunk(buffer);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export const isAiFinalStreamEvent = (event: AiSseEvent): boolean => event.type === "done" || event.type === "error";
