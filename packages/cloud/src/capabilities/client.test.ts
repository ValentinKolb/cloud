import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { invokeCapability, invokeCapabilityWithDataSchema, listCapabilityCatalog, reviewCapabilityAction } from "./client";

describe("public capability client", () => {
  test("uses the public route and forwards the idempotency key", async () => {
    let url = "";
    let request: RequestInit | undefined;
    const result = await invokeCapabilityWithDataSchema(
      {
        appId: "demo app",
        capabilityId: "item.rename",
        kind: "action",
        input: { id: "one" },
        idempotencyKey: "attempt-1",
      },
      z.object({ id: z.string() }).passthrough(),
      {
        fetch: async (input, init) => {
          url = String(input);
          request = init;
          return Response.json({ data: { id: "one" } });
        },
      },
    );

    expect(result).toEqual({ ok: true, data: { data: { id: "one" } } });
    expect(url).toBe("/api/capabilities/v1/actions/demo%20app/item.rename");
    expect(new Headers(request?.headers).get("idempotency-key")).toBe("attempt-1");
    expect(request?.credentials).toBe("same-origin");
  });

  test("requires a runtime schema for typed data and validates it", async () => {
    const result = await invokeCapabilityWithDataSchema(
      { appId: "demo", capabilityId: "get", kind: "query", input: {} },
      z.object({ id: z.string() }).passthrough(),
      { fetch: async () => Response.json({ data: { id: 42 } }) },
    );
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_APP_RESPONSE", status: 502 } });
  });

  test("loads and validates the public catalog", async () => {
    let url = "";
    const result = await listCapabilityCatalog({
      cursor: "demo",
      limit: 10,
      fetch: async (input) => {
        url = String(input);
        return Response.json({ protocolVersion: 1, apps: [], page: { hasMore: false } });
      },
    });
    expect(result).toEqual({ ok: true, data: { protocolVersion: 1, apps: [], page: { hasMore: false } } });
    expect(url).toBe("/api/capabilities/v1/catalog?cursor=demo&limit=10");
  });

  test("returns structured Cloud errors without throwing", async () => {
    const result = await invokeCapability(
      { appId: "demo", capabilityId: "get", kind: "query", input: {} },
      {
        fetch: async () => Response.json({ code: "FORBIDDEN", message: "No access" }, { status: 403 }),
      },
    );

    expect(result).toEqual({ ok: false, error: { code: "FORBIDDEN", message: "No access", status: 403 } });
  });

  test("fails closed on invalid success envelopes and network failures", async () => {
    const invalid = await invokeCapability(
      { appId: "demo", capabilityId: "get", kind: "query", input: {} },
      {
        fetch: async () => Response.json({ value: 1 }),
      },
    );
    const unavailable = await invokeCapability(
      { appId: "demo", capabilityId: "get", kind: "query", input: {} },
      {
        fetch: async () => {
          throw new Error("offline");
        },
      },
    );

    expect(invalid).toMatchObject({ ok: false, error: { code: "INVALID_APP_RESPONSE", status: 502 } });
    expect(unavailable).toMatchObject({ ok: false, error: { code: "APP_UNAVAILABLE", status: 503 } });
  });

  test("uses the Action review route", async () => {
    let url = "";
    const result = await reviewCapabilityAction(
      { appId: "demo", capabilityId: "rename", input: { id: "one" } },
      {
        fetch: async (input) => {
          url = String(input);
          return Response.json({ message: "Rename one." });
        },
      },
    );

    expect(result).toEqual({ ok: true, data: { message: "Rename one." } });
    expect(url).toBe("/api/capabilities/v1/actions/demo/rename/review");
  });
});
