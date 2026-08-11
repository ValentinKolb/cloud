import { describe, expect, test } from "bun:test";
import { createComponent, createSignal } from "solid-js";
import { isServer, render } from "solid-js/web";
import { createDomTestHarness } from "../../../../ui/test/dom";
import { createWebhookQueries, type WebhookQuerySource } from "./webhook-queries";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("Webhook tester owner-local queries", () => {
  if (isServer) {
    test.skip("runs with browser export conditions", () => {});
    return;
  }

  test("aborts stale URL-owned log reads and disposes the current owner", async () => {
    const dom = createDomTestHarness();
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; signal: AbortSignal; response: ReturnType<typeof deferred<Response>> }> = [];
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const response = deferred<Response>();
      requests.push({ url: request?.url ?? String(input), signal: (init?.signal ?? request?.signal) as AbortSignal, response });
      return response.promise;
    }) as typeof fetch;

    let dispose: (() => void) | undefined;
    try {
      let setSource!: (source: WebhookQuerySource) => void;
      let controls!: ReturnType<typeof createWebhookQueries>;
      dispose = render(() => {
        const [source, updateSource] = createSignal<WebhookQuerySource>({
          mode: "receive",
          endpointId: null,
          method: null,
          query: "",
          requestId: null,
        });
        setSource = updateSource;
        controls = createWebhookQueries(source);
        return dom.document.createTextNode("");
      }, dom.root);
      await flush();
      const endpoints = requests.find((request) => request.url.includes("/endpoints"))!;
      const incoming = requests.find((request) => request.url.includes("/incoming-logs"))!;
      endpoints.response.resolve(Response.json({ items: [] }));
      await flush();

      setSource({ mode: "send", endpointId: null, method: null, query: "", requestId: null });
      await flush();
      expect(incoming.signal.aborted).toBe(true);
      const outgoing = requests.find((request) => request.url.includes("/outgoing-logs"))!;
      expect(outgoing).toBeDefined();
      expect(controls.logs.data()).toBeUndefined();

      dispose();
      dispose = undefined;
      expect(outgoing.signal.aborted).toBe(true);
    } finally {
      dispose?.();
      dom.cleanup();
      globalThis.fetch = originalFetch;
    }
  });

  test("keeps a newer popstate route when a sent request completes", async () => {
    const dom = createDomTestHarness();
    const { default: WebhookTester } = await import("./WebhookTester.island");
    const originalFetch = globalThis.fetch;
    const requests: Array<{
      method: string;
      signal: AbortSignal;
      url: string;
      response: ReturnType<typeof deferred<Response>>;
    }> = [];
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const response = deferred<Response>();
      requests.push({
        method: request?.method ?? init?.method ?? "GET",
        signal: (init?.signal ?? request?.signal) as AbortSignal,
        url: request?.url ?? String(input),
        response,
      });
      return response.promise;
    }) as typeof fetch;

    let dispose: (() => void) | undefined;
    try {
      dispose = render(
        () =>
          createComponent(WebhookTester, {
            baseHref: "/tools/webhooks",
            initialState: { mode: "send", endpointId: null, method: null, query: "", requestId: null },
          }),
        dom.root,
      );
      await flush();
      for (const request of requests.filter((entry) => entry.method === "GET")) {
        request.response.resolve(Response.json({ items: [] }));
      }
      await flush();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const target = dom.document.querySelector<HTMLInputElement>('input[placeholder="https://example.com/webhook"]')!;
      target.value = "https://example.test/hook";
      target.dispatchEvent(new Event("input", { bubbles: true }));
      const send = target.closest("section")!.querySelector<HTMLButtonElement>("button")!;
      expect(send.disabled).toBe(false);
      send.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();

      const pendingSend = requests.find((request) => request.method === "POST" && request.url.includes("/webhooks/send"))!;
      expect(pendingSend).toBeDefined();

      dom.window.history.pushState(null, "", "/tools/webhooks");
      dom.window.dispatchEvent(new dom.window.PopStateEvent("popstate"));
      await flush();
      for (const request of requests.filter((entry) => entry.url.includes("/incoming-logs"))) {
        request.response.resolve(Response.json({ items: [] }));
      }
      pendingSend.response.resolve(
        Response.json({
          id: "request-1",
          endpointId: null,
          direction: "outgoing",
          method: "POST",
          url: "https://example.test/hook",
          path: "",
          query: "",
          requestHeaders: {},
          requestBody: null,
          requestContentType: null,
          responseStatus: 200,
          responseHeaders: {},
          responseBody: "ok",
          durationMs: 1,
          error: null,
          createdAt: "2026-08-11T10:00:00.000Z",
        }),
      );
      await flush();
      await flush();

      expect(dom.window.location.pathname).toBe("/tools/webhooks");
      expect(dom.window.location.search).toBe("");
      expect(requests.filter((request) => request.url.includes("/incoming-logs"))).toHaveLength(1);
    } finally {
      dispose?.();
      dom.cleanup();
      globalThis.fetch = originalFetch;
    }
  });

  test("does not rewrite the route after a pending delete is disposed", async () => {
    const dom = createDomTestHarness();
    const { default: WebhookTester } = await import("./WebhookTester.island");
    const originalFetch = globalThis.fetch;
    const endpointId = "123e4567-e89b-42d3-a456-426614174000";
    const requests: Array<{
      method: string;
      signal: AbortSignal;
      url: string;
      response: ReturnType<typeof deferred<Response>>;
    }> = [];
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const response = deferred<Response>();
      requests.push({
        method: request?.method ?? init?.method ?? "GET",
        signal: (init?.signal ?? request?.signal) as AbortSignal,
        url: request?.url ?? String(input),
        response,
      });
      return response.promise;
    }) as typeof fetch;

    dom.window.history.replaceState(null, "", `/tools/webhooks?endpoint=${endpointId}`);
    let dispose: (() => void) | undefined;
    try {
      dispose = render(
        () =>
          createComponent(WebhookTester, {
            baseHref: "/tools/webhooks",
            initialState: { mode: "receive", endpointId, method: null, query: "", requestId: null },
          }),
        dom.root,
      );
      await flush();
      const endpoint = {
        id: endpointId,
        token: "token",
        name: "Disposable endpoint",
        urlPath: `/hooks/${endpointId}`,
        requestCount: 0,
        lastRequestAt: null,
        createdAt: "2026-08-11T10:00:00.000Z",
      };
      requests.find((request) => request.url.includes("/endpoints"))!.response.resolve(Response.json({ items: [endpoint] }));
      requests.find((request) => request.url.includes("/incoming-logs"))!.response.resolve(Response.json({ items: [] }));
      await flush();
      await flush();

      dom.document.querySelector<HTMLButtonElement>(`button[aria-label="Delete endpoint ${endpoint.name}"]`)!.click();
      await flush();
      const pendingDelete = requests.find((request) => request.method === "DELETE")!;
      expect(pendingDelete).toBeDefined();

      dispose();
      dispose = undefined;
      expect(pendingDelete.signal.aborted).toBe(true);
      pendingDelete.response.resolve(Response.json({ ok: true }));
      await flush();
      await flush();

      expect(dom.window.location.search).toBe(`?endpoint=${endpointId}`);
    } finally {
      dispose?.();
      dom.cleanup();
      globalThis.fetch = originalFetch;
    }
  });

  test("reconciles endpoints and logs after deleting from the all-endpoints view", async () => {
    const dom = createDomTestHarness();
    const { default: WebhookTester } = await import("./WebhookTester.island");
    const originalFetch = globalThis.fetch;
    const endpointId = "123e4567-e89b-42d3-a456-426614174000";
    const requests: Array<{
      method: string;
      url: string;
      response: ReturnType<typeof deferred<Response>>;
    }> = [];
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const response = deferred<Response>();
      requests.push({
        method: request?.method ?? init?.method ?? "GET",
        url: request?.url ?? String(input),
        response,
      });
      return response.promise;
    }) as typeof fetch;

    dom.window.history.replaceState(null, "", "/tools/webhooks");
    let dispose: (() => void) | undefined;
    try {
      dispose = render(
        () =>
          createComponent(WebhookTester, {
            baseHref: "/tools/webhooks",
            initialState: { mode: "receive", endpointId: null, method: null, query: "", requestId: null },
          }),
        dom.root,
      );
      await flush();
      const endpoint = {
        id: endpointId,
        token: "token",
        name: "All-view endpoint",
        urlPath: `/hooks/${endpointId}`,
        requestCount: 1,
        lastRequestAt: "2026-08-11T10:00:00.000Z",
        createdAt: "2026-08-11T10:00:00.000Z",
      };
      requests.find((request) => request.url.includes("/endpoints"))!.response.resolve(Response.json({ items: [endpoint] }));
      requests.find((request) => request.url.includes("/incoming-logs"))!.response.resolve(Response.json({ items: [] }));
      await flush();
      await flush();

      dom.document.querySelector<HTMLButtonElement>(`button[aria-label="Delete endpoint ${endpoint.name}"]`)!.click();
      await flush();
      requests.find((request) => request.method === "DELETE")!.response.resolve(Response.json({ ok: true }));
      await flush();
      await flush();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const endpointReads = requests.filter((request) => request.method === "GET" && request.url.includes("/endpoints"));
      const logReads = requests.filter((request) => request.method === "GET" && request.url.includes("/incoming-logs"));
      expect(endpointReads).toHaveLength(2);
      expect(logReads).toHaveLength(2);

      endpointReads[1]!.response.resolve(Response.json({ items: [] }));
      logReads[1]!.response.resolve(Response.json({ items: [] }));
      await flush();
      await flush();
      expect(dom.window.location.search).toBe("");
    } finally {
      dispose?.();
      dom.cleanup();
      globalThis.fetch = originalFetch;
    }
  });

  test("keeps writes blocked while failed reads are retrying", async () => {
    const dom = createDomTestHarness();
    const { default: WebhookTester } = await import("./WebhookTester.island");
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; response: ReturnType<typeof deferred<Response>> }> = [];
    globalThis.fetch = ((input: string | URL | Request) => {
      const request = input instanceof Request ? input : null;
      const response = deferred<Response>();
      requests.push({ url: request?.url ?? String(input), response });
      return response.promise;
    }) as typeof fetch;

    let dispose: (() => void) | undefined;
    try {
      dispose = render(
        () =>
          createComponent(WebhookTester, {
            baseHref: "/tools/webhooks",
            initialState: { mode: "receive", endpointId: null, method: null, query: "", requestId: null },
          }),
        dom.root,
      );
      await flush();
      for (const request of requests) request.response.resolve(Response.json({ message: "unavailable" }, { status: 503 }));
      await flush();
      await flush();

      const buttons = () => Array.from(dom.document.querySelectorAll<HTMLButtonElement>("button"));
      const add = buttons().find((button) => button.textContent?.trim() === "Add")!;
      const retry = buttons().find((button) => button.textContent?.trim() === "Retry")!;
      expect(add.disabled).toBe(true);

      retry.click();
      await flush();
      expect(requests.filter((request) => request.url.includes("/endpoints"))).toHaveLength(2);
      expect(requests.filter((request) => request.url.includes("/incoming-logs"))).toHaveLength(2);
      expect(add.disabled).toBe(true);
    } finally {
      dispose?.();
      dom.cleanup();
      globalThis.fetch = originalFetch;
    }
  });
});
