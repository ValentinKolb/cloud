import { afterEach, describe, expect, test } from "bun:test";
import { jsonFetch } from "./http";

const originalFetch = globalThis.fetch;

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const mockFetch = (handler: (url: string | URL | Request, init?: RequestInit) => Promise<Response>) => {
  globalThis.fetch = Object.assign(handler, { preconnect: () => {} }) as typeof fetch;
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Pulse frontend HTTP helpers", () => {
  test("sends JSON requests and parses JSON responses", async () => {
    const calls: Array<{ url: string | URL | Request; init?: RequestInit }> = [];
    mockFetch(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse({ ok: true });
    });

    await expect(jsonFetch<{ ok: boolean }>("/api/pulse/test", { method: "POST", body: "{}" })).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/api/pulse/test");
    expect(calls[0]?.init?.headers).toBeInstanceOf(Headers);
    expect(new Headers(calls[0]?.init?.headers).get("Content-Type")).toBe("application/json");
  });

  test("preserves caller-provided headers", async () => {
    mockFetch(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      return jsonResponse({
        authorization: headers.get("Authorization"),
        contentType: headers.get("Content-Type"),
      });
    });

    await expect(jsonFetch<Record<string, string | null>>("/api/pulse/test", { headers: { Authorization: "Bearer token" } })).resolves.toEqual({
      authorization: "Bearer token",
      contentType: "application/json",
    });
  });

  test("supports non-object header inputs", async () => {
    mockFetch(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      return jsonResponse({
        contentType: headers.get("Content-Type"),
        requestId: headers.get("X-Request-Id"),
      });
    });

    await expect(
      jsonFetch<Record<string, string | null>>("/api/pulse/test", {
        headers: new Headers([
          ["Content-Type", "application/vnd.pulse+json"],
          ["X-Request-Id", "req_1"],
        ]),
      }),
    ).resolves.toEqual({
      contentType: "application/vnd.pulse+json",
      requestId: "req_1",
    });
  });

  test("returns undefined for empty or non-json success responses", async () => {
    mockFetch(async () => new Response("", { status: 204 }));
    await expect(jsonFetch<void>("/api/pulse/empty")).resolves.toBeUndefined();

    mockFetch(async () => new Response("ok", { headers: { "Content-Type": "text/plain" } }));
    await expect(jsonFetch<void>("/api/pulse/plain")).resolves.toBeUndefined();
  });

  test("uses server error messages when available", async () => {
    mockFetch(async () => jsonResponse({ message: "Source not found" }, 404));
    await expect(jsonFetch<void>("/api/pulse/missing")).rejects.toThrow("Source not found");
  });

  test("falls back for non-json error bodies", async () => {
    mockFetch(async () => new Response("nope", { status: 500, headers: { "Content-Type": "text/plain" } }));
    await expect(jsonFetch<void>("/api/pulse/broken")).rejects.toThrow("Request failed");
  });

  test("supports a custom error fallback", async () => {
    mockFetch(async () => new Response("nope", { status: 500, headers: { "Content-Type": "text/plain" } }));
    await expect(jsonFetch<void>("/api/pulse/broken", undefined, "Failed to create Pulse base")).rejects.toThrow("Failed to create Pulse base");
  });
});
