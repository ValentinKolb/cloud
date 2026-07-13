import { describe, expect, test } from "bun:test";
import { parseAiSse, subscribeAiStream } from "./transport";

describe("AI stream transport lifecycle", () => {
  test("parses split SSE chunks and ignores heartbeat comments", async () => {
    const encoder = new TextEncoder();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(': heartbeat\n\nevent: state\ndata: {"type":"state","con'));
          controller.enqueue(
            encoder.encode(
              'versation":{"id":"chat"},"messages":[],"activeTurn":null}\n\nevent: turn_finished\ndata: {"v":1,"type":"turn_finished","conversationId":"chat","turnId":"turn","attempt":1,"seq":2,"status":"completed","error":null}\n\n',
            ),
          );
          controller.close();
        },
      }),
    );
    const events = [];

    for await (const event of parseAiSse(response, new AbortController().signal)) events.push(event);

    expect(events.map((event) => event.type)).toEqual(["state", "turn_finished"]);
  });

  test("emits nothing after close when an in-flight connection resolves late", async () => {
    let resolveFetch!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const statuses: string[] = [];
    const events: unknown[] = [];

    const stream = subscribeAiStream({
      url: "/stream",
      fetch: () => response,
      onStatus: (status) => statuses.push(status),
      onEvent: (event) => events.push(event),
    });

    expect(statuses).toEqual(["connecting"]);
    stream.close();
    resolveFetch(new Response(new ReadableStream(), { status: 200 }));
    await Promise.resolve();
    await Promise.resolve();

    expect(statuses).toEqual(["connecting"]);
    expect(events).toEqual([]);
  });
});
