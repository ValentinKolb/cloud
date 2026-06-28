import { describe, expect, test } from "bun:test";
import { parseAiSse, readAiError } from "./browser";

const encoder = new TextEncoder();

describe("AI browser streaming helpers", () => {
  test("parses SSE data events into AI stream envelopes", async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'id: 1-0\nevent: text\ndata: {"type":"nessi","turnId":"turn-1","conversationId":"conversation-1","event":{"type":"text","agentId":"cloud","delta":"Hi"},"cursor":"1-0"}\n\n',
            ),
          );
          controller.close();
        },
      }),
    );

    const events = [];
    for await (const event of parseAiSse(response)) events.push(event);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "nessi",
      turnId: "turn-1",
      cursor: "1-0",
      event: { type: "text", delta: "Hi" },
    });
  });

  test("reads JSON API errors with a fallback", async () => {
    await expect(readAiError(Response.json({ message: "No model" }, { status: 400 }), "Fallback")).resolves.toBe("No model");
    await expect(readAiError(new Response("not json", { status: 500 }), "Fallback")).resolves.toBe("Fallback");
  });
});
