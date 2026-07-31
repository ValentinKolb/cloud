import { describe, expect, test } from "bun:test";
import { ok } from "@k2b/stdlib";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { compileCapabilities } from "../_internal/capabilities";
import { defineCapabilities } from "../contracts/capabilities";
import type { AppRegistryEntry } from "../contracts/registry";
import { createMcpRoutes } from "./mcp";

const compiled = compileCapabilities(
  "demo",
  defineCapabilities({
    version: 1,
    types: { item: { title: "Item", description: "One demo item." } },
    queries: {
      get: {
        title: "Get item",
        description: "Get one item by its stable id.",
        input: z.object({ id: z.string().describe("Stable item id.") }).strict(),
        data: z.object({ id: z.string() }).strict(),
        run: async ({ id }) => ok({ data: { id } }),
      },
    },
    actions: {
      create: {
        title: "Create item",
        description: "Create one demo item.",
        input: z.object({ title: z.string().describe("Item title.") }).strict(),
        data: z.object({ id: z.string() }).strict(),
        destructive: false,
        openWorld: false,
        approval: "once",
        idempotency: "required",
        run: async () => ok({ data: { id: "created" } }),
      },
    },
  }),
);

const app: AppRegistryEntry = {
  id: "demo",
  name: "Demo",
  icon: "ti ti-box",
  description: "Demo app",
  baseUrl: "http://demo:3000",
  routes: [],
  capabilities: {
    endpoint: "http://demo:3000/api/_internal/capabilities/v1",
    manifest: compiled.manifest,
  },
};

const rpc = (routes: ReturnType<typeof createMcpRoutes>, body: unknown) =>
  routes.request("/mcp/v1", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-06-18",
      authorization: "Bearer caller",
    },
    body: JSON.stringify(body),
  });

describe("capability MCP projection", () => {
  test("lists live queries and actions with schemas and safety annotations", async () => {
    const routes = createMcpRoutes({
      listApps: async () => [app],
      authenticate: async (_c, next) => next(),
    });
    const response = await rpc(routes, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });
    expect(response.status).toBe(200);
    const result = (
      (await response.json()) as {
        result: { tools: Array<Record<string, any>> };
      }
    ).result;
    expect(result.tools.map((tool) => tool.name)).toEqual(["demo__action__create", "demo__query__get"]);
    expect(result.tools[0]?.inputSchema.required).toContain("idempotencyKey");
    expect(result.tools[0]?.annotations).toMatchObject({
      readOnlyHint: false,
      idempotentHint: true,
      destructiveHint: false,
    });
    expect(result.tools[0]?._meta).toMatchObject({
      "cloud/approval": "once",
      "cloud/schemaHash": expect.any(String),
    });
    expect(result.tools[1]?.annotations).toMatchObject({
      readOnlyHint: true,
      idempotentHint: true,
    });
  });

  test("paginates large live catalogs without materializing every tool schema", async () => {
    const apps = Array.from({ length: 101 }, (_, index): AppRegistryEntry => {
      const id = `demo-${String(index).padStart(3, "0")}`;
      return {
        ...app,
        id,
        name: id,
        capabilities: app.capabilities
          ? {
              ...app.capabilities,
              manifest: {
                ...app.capabilities.manifest,
                appId: id,
                actions: [],
              },
            }
          : undefined,
      };
    });
    const routes = createMcpRoutes({
      listApps: async () => apps,
      authenticate: async (_c, next) => next(),
    });
    const firstResponse = await rpc(routes, {
      jsonrpc: "2.0",
      id: 10,
      method: "tools/list",
      params: {},
    });
    const first = (
      (await firstResponse.json()) as {
        result: { tools: Tool[]; nextCursor?: string };
      }
    ).result;
    expect(first.tools).toHaveLength(100);
    expect(first.nextCursor).toBe(first.tools.at(-1)?.name);

    const secondResponse = await rpc(routes, {
      jsonrpc: "2.0",
      id: 11,
      method: "tools/list",
      params: { cursor: first.nextCursor },
    });
    const second = (
      (await secondResponse.json()) as {
        result: { tools: Tool[]; nextCursor?: string };
      }
    ).result;
    expect(second.tools).toHaveLength(1);
    expect(second.nextCursor).toBeUndefined();
  });

  test("calls the shared dispatcher with caller credentials and structured results", async () => {
    let forwarded: Headers | undefined;
    const routes = createMcpRoutes({
      listApps: async () => [app],
      getApp: async () => app,
      authenticate: async (_c, next) => next(),
      fetch: async (_input, init) => {
        forwarded = new Headers(init?.headers);
        return Response.json({
          data: { id: "created" },
          refs: [{ type: "demo.item", id: "created" }],
          links: [{ rel: "edit", href: "/app/demo/created", title: "Edit item" }],
        });
      },
    });
    const response = await rpc(routes, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "demo__action__create",
        arguments: { title: "Test", idempotencyKey: "create-1" },
      },
    });
    expect(response.status).toBe(200);
    const result = ((await response.json()) as { result: Record<string, any> }).result;
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ data: { id: "created" } });
    expect(result.content).toContainEqual(
      expect.objectContaining({
        type: "resource_link",
        uri: "http://localhost/app/demo/created",
        name: "Edit item",
      }),
    );
    expect(forwarded?.get("authorization")).toBe("Bearer caller");
    expect(forwarded?.get("idempotency-key")).toBe("create-1");
  });

  test("returns an actionable structured error when a live tool disappears", async () => {
    const routes = createMcpRoutes({
      listApps: async () => [],
      authenticate: async (_c, next) => next(),
    });
    const response = await rpc(routes, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "demo__query__get", arguments: { id: "one" } },
    });
    const result = ((await response.json()) as { result: Record<string, any> }).result;
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      code: "TOOL_UNAVAILABLE",
      message: "Tool demo__query__get is not in the current live capability catalog",
    });
  });

  test("preserves app authorization failures as structured tool errors", async () => {
    const routes = createMcpRoutes({
      listApps: async () => [app],
      getApp: async () => app,
      authenticate: async (_c, next) => next(),
      fetch: async () => Response.json({ code: "FORBIDDEN", message: "No access to this item" }, { status: 403 }),
    });
    const response = await rpc(routes, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "demo__query__get", arguments: { id: "private" } },
    });
    const result = ((await response.json()) as { result: Record<string, any> }).result;
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      code: "FORBIDDEN",
      message: "No access to this item",
    });
  });
});
