import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthContext } from "../server";
import { defineAiResource, requireAiResourceAccess } from "./resource";

const actor = {
  kind: "user",
  user: {
    id: "11111111-1111-4111-8111-111111111111",
    uid: "tester",
    roles: ["user"],
    provider: "local",
  },
} as AuthContext["Variables"]["actor"];

describe("AI resource adapters", () => {
  test("parses path params through the resource schema", () => {
    const resource = defineAiResource({
      appId: "grids",
      id: "base",
      path: "/bases/:baseId",
      params: z.object({ baseId: z.string().min(1) }),
      access: async () => ({ allowed: true, data: { canRead: true } }),
    });

    expect(resource.parseParams({ baseId: "base-1", ignored: "value" })).toEqual({ baseId: "base-1" });
  });

  test("rejects path and params schema mismatches at typecheck time", () => {
    defineAiResource({
      appId: "grids",
      id: "base",
      path: "/bases/:baseId",
      // @ts-expect-error params must include the path param name.
      params: z.object({ gridId: z.string() }),
      access: async () => ({ allowed: true, data: {} }),
    });
  });

  test("requireAiResourceAccess returns access data only when allowed", async () => {
    const allowed = defineAiResource({
      appId: "grids",
      id: "base",
      path: "/bases/:baseId",
      params: z.object({ baseId: z.string() }),
      access: async () => ({ allowed: true, data: { permission: "read" } }),
    });

    await expect(
      requireAiResourceAccess(allowed, { params: { baseId: "base-1" }, actor, signal: new AbortController().signal }),
    ).resolves.toEqual({ permission: "read" });

    const denied = defineAiResource({
      appId: "grids",
      id: "base",
      path: "/bases/:baseId",
      params: z.object({ baseId: z.string() }),
      access: async () => ({ allowed: false, reason: "No access" }),
    });

    await expect(
      requireAiResourceAccess(denied, { params: { baseId: "base-1" }, actor, signal: new AbortController().signal }),
    ).rejects.toThrow("No access");
  });

  test("resource routes stop before context when access is denied", async () => {
    let accessCalls = 0;
    let contextCalls = 0;
    const resource = defineAiResource({
      appId: "grids",
      id: "base",
      path: "/bases/:baseId",
      params: z.object({ baseId: z.string() }),
      access: async () => {
        accessCalls += 1;
        return { allowed: false, reason: "Revoked" };
      },
      context: async () => {
        contextCalls += 1;
        return "hidden context";
      },
    });

    const app = new Hono<AuthContext>()
      .use("*", async (c, next) => {
        c.set("actor", actor);
        await next();
      })
      .route("/ai", resource.routes());

    const response = await app.request("/ai/bases/base-1/conversations");

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ message: "Revoked", code: "FORBIDDEN" });
    expect(accessCalls).toBe(1);
    expect(contextCalls).toBe(0);
  });

  test("resource routes re-check access before every protected surface", async () => {
    let accessCalls = 0;
    const hookCalls = {
      resourceTitle: 0,
      modelPolicy: 0,
      systemPrompt: 0,
      context: 0,
      tools: 0,
    };
    const resource = defineAiResource({
      appId: "grids",
      id: "base",
      path: "/bases/:baseId",
      params: z.object({ baseId: z.string() }),
      access: async () => {
        accessCalls += 1;
        return { allowed: false, reason: "Revoked" };
      },
      resourceTitle: async () => {
        hookCalls.resourceTitle += 1;
        return "Hidden base";
      },
      modelPolicy: async () => {
        hookCalls.modelPolicy += 1;
        return { kind: "platform-default" };
      },
      systemPrompt: async () => {
        hookCalls.systemPrompt += 1;
        return "hidden prompt";
      },
      context: async () => {
        hookCalls.context += 1;
        return "hidden context";
      },
      tools: async () => {
        hookCalls.tools += 1;
        return [];
      },
    });

    const app = new Hono<AuthContext>()
      .use("*", async (c, next) => {
        c.set("actor", actor);
        await next();
      })
      .route("/ai", resource.routes());

    const requests: Array<[string, RequestInit | undefined]> = [
      ["/ai/bases/base-1/status", undefined],
      ["/ai/bases/base-1/conversations", undefined],
      [
        "/ai/bases/base-1/conversations",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "Chat" }),
        },
      ],
      ["/ai/bases/base-1/conversations/22222222-2222-4222-8222-222222222222", undefined],
      [
        "/ai/bases/base-1/conversations/22222222-2222-4222-8222-222222222222/turns",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: "hello" }),
        },
      ],
      [
        "/ai/bases/base-1/conversations/22222222-2222-4222-8222-222222222222/turns/33333333-3333-4333-8333-333333333333/abort",
        { method: "POST" },
      ],
      [
        "/ai/bases/base-1/conversations/22222222-2222-4222-8222-222222222222/turns/33333333-3333-4333-8333-333333333333/actions/call-1",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "approval_response", approved: true }),
        },
      ],
      [
        "/ai/bases/base-1/conversations/22222222-2222-4222-8222-222222222222/turns/33333333-3333-4333-8333-333333333333/events?after=0-0",
        undefined,
      ],
    ];

    for (const [path, init] of requests) {
      const response = await app.request(path, init);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ message: "Revoked", code: "FORBIDDEN" });
    }

    expect(accessCalls).toBe(requests.length);
    expect(hookCalls).toEqual({
      resourceTitle: 0,
      modelPolicy: 0,
      systemPrompt: 0,
      context: 0,
      tools: 0,
    });
  });
});
