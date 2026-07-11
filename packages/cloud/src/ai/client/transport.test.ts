import { describe, expect, test } from "bun:test";
import { subscribeAiStream } from "./transport";

describe("AI stream transport lifecycle", () => {
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
