import { afterEach, describe, expect, mock, test } from "bun:test";
import { invokeCustomAppWorkflow } from "./workflow-action-client";

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
});

describe("Grids App workflow action client", () => {
  test("follows the scoped status URL until the workflow succeeds", async () => {
    const requests: string[] = [];
    const statuses = [
      { status: "running", message: null },
      { status: "succeeded", message: "Request approved." },
    ];
    globalThis.fetch = (async (input) => {
      const url = String(input);
      requests.push(url);
      return url === "/invoke" ? Response.json({ statusUrl: "/status" }, { status: 202 }) : Response.json(statuses.shift());
    }) as typeof fetch;
    const onRunning = mock(() => undefined);

    const result = await invokeCustomAppWorkflow({ endpoint: "/invoke", signal: new AbortController().signal, onRunning });

    expect(result).toEqual({ kind: "success", message: "Request approved." });
    expect(requests).toEqual(["/invoke", "/status", "/status"]);
    expect(onRunning).toHaveBeenCalledTimes(1);
  });

  test("returns only the sanitized failed outcome", async () => {
    globalThis.fetch = (async (input) =>
      String(input) === "/invoke"
        ? Response.json({ statusUrl: "/status" }, { status: 202 })
        : Response.json({ status: "failed", message: "The request could not be approved." })) as typeof fetch;

    expect(await invokeCustomAppWorkflow({ endpoint: "/invoke", signal: new AbortController().signal })).toEqual({
      kind: "error",
      message: "The request could not be approved.",
    });
  });

  test("rejects missing status scope and an already aborted poll", async () => {
    globalThis.fetch = (async () => Response.json({ runId: crypto.randomUUID() }, { status: 202 })) as unknown as typeof fetch;
    await expect(invokeCustomAppWorkflow({ endpoint: "/invoke", signal: new AbortController().signal })).rejects.toThrow(
      "The workflow status is unavailable.",
    );

    const controller = new AbortController();
    const reason = new Error("closed");
    globalThis.fetch = (async () => {
      controller.abort(reason);
      return Response.json({ statusUrl: "/status" }, { status: 202 });
    }) as unknown as typeof fetch;
    await expect(invokeCustomAppWorkflow({ endpoint: "/invoke", signal: controller.signal })).rejects.toBe(reason);
  });

  test("stops polling after the bounded status window", async () => {
    let statusRequests = 0;
    globalThis.setTimeout = ((handler: TimerHandler) => {
      queueMicrotask(() => {
        if (typeof handler === "function") handler();
      });
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;
    globalThis.fetch = (async (input) => {
      if (String(input) === "/invoke") return Response.json({ statusUrl: "/status" }, { status: 202 });
      statusRequests += 1;
      return Response.json({ status: "running" });
    }) as typeof fetch;

    expect(await invokeCustomAppWorkflow({ endpoint: "/invoke", signal: new AbortController().signal })).toEqual({
      kind: "running",
      message: "The workflow is still running.",
    });
    expect(statusRequests).toBe(150);
  });
});
