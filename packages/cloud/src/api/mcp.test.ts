import { describe, expect, test } from "bun:test";
import { ok } from "@k2b/stdlib";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { Hono } from "hono";
import { z } from "zod";
import { compileCapabilities } from "../_internal/capabilities";
import { defineCapabilities } from "../contracts/capabilities";
import type { AppRegistryEntry, CapabilityRegistryEntry, HelpRegistryEntry } from "../contracts/registry";
import type { AuthContext } from "../server";
import { createCapabilityRoutes } from "./capabilities";
import { cloudMcpResourceUri, createMcpProtectedResourceRoutes, createMcpRoutes } from "./mcp";

const compiled = compileCapabilities(
  "demo",
  defineCapabilities({
    protocolVersion: 1,
    types: { item: { title: "Item", description: "One demo item." } },
    queries: {
      get: {
        title: "Get item",
        description: "Get one item by its stable id.",
        input: z.object({ id: z.string().describe("Stable item id.") }).strict(),
        data: z.object({ id: z.string() }).strict(),
        openWorld: true,
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
        idempotency: "required",
        run: async () => ok({ data: { id: "created" } }),
      },
      update: {
        title: "Update item",
        description: "Update one demo item.",
        input: z.object({ id: z.string().describe("Stable item id.") }).strict(),
        data: z.object({ id: z.string() }).strict(),
        destructive: true,
        openWorld: false,
        idempotency: "none",
        run: async ({ id }) => ok({ data: { id } }),
      },
    },
  }),
);

const app: CapabilityRegistryEntry = {
  appId: "demo",
  appName: "Demo",
  appIcon: "ti ti-box",
  appDescription: "",
  endpoint: "http://demo:3000/api/_internal/capabilities/v1",
  manifest: compiled.manifest,
};

const help: HelpRegistryEntry = {
  appId: "demo",
  appName: "Demo",
  appIcon: "ti ti-box",
  manifestHash: "help-hash",
  documents: [
    {
      id: "getting-started",
      title: "Getting started",
      description: "Create and inspect demo items.",
      order: 10,
      markdown: "# Getting started\n\nCreate an item, then inspect its current state.",
      searchText: "getting started create inspect demo items current state",
    },
  ],
};

const summary = (capability: CapabilityRegistryEntry): AppRegistryEntry => ({
  id: capability.appId,
  name: capability.appName,
  icon: capability.appIcon,
  description: `${capability.appName} app`,
  baseUrl: `http://${capability.appId}:3000`,
  routes: [],
  capabilities: {
    protocolVersion: capability.manifest.protocolVersion,
    manifestHash: capability.manifest.manifestHash,
  },
});

const helpSummary = (): AppRegistryEntry => ({
  ...summary(app),
  help: {
    manifestHash: help.manifestHash,
    pageBase: "/app/demo/help",
    documents: [
      {
        id: "getting-started",
        title: "Getting started",
        description: "Create and inspect demo items.",
        order: 10,
        searchUrl: "/api/help/v1/demo/search",
        url: "/api/help/v1/demo/documents/getting-started",
      },
    ],
  },
});

const rpc = (
  routes: ReturnType<typeof createMcpRoutes>,
  body: unknown,
  protocolVersion = "2025-06-18",
  headers: Record<string, string> = {},
) =>
  routes.request("/mcp/v1", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": protocolVersion,
      authorization: "Bearer caller",
      ...headers,
    },
    body: JSON.stringify(body),
  });

describe("capability MCP projection", () => {
  test("works through the official Streamable HTTP client", async () => {
    const routes = createMcpRoutes({
      listApps: async () => [helpSummary()],
      listHelp: async () => [help],
      getCapability: async () => app,
      authenticate: async (_c, next) => next(),
    });
    const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp/v1"), {
      requestInit: { headers: { authorization: "Bearer caller" } },
      fetch: async (input, init) => routes.fetch(new Request(input, init)),
    });
    const client = new Client({ name: "cloud-mcp-test", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);
    try {
      expect((await client.listTools()).tools.map((tool) => tool.name)).toContain("demo__query__get");
      expect((await client.listResources()).resources).toMatchObject([{ uri: "cloud://help/demo/getting-started" }]);
      expect((await client.readResource({ uri: "cloud://help/demo/getting-started" })).contents[0]).toMatchObject({
        mimeType: "text/markdown",
        text: expect.stringContaining("Create an item"),
      });
    } finally {
      await client.close();
    }
  });

  test("initializes current and compatible clients with self-contained server guidance", async () => {
    const routes = createMcpRoutes({ authenticate: async (_c, next) => next() });
    for (const version of ["2025-11-25", "2025-06-18"]) {
      const response = await rpc(
        routes,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: version, capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } },
        },
        version,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        result: {
          capabilities: { resources: {}, tools: {} },
          instructions: expect.stringContaining("cloud__help__search"),
          serverInfo: { name: "cloud", version: "1.0.0" },
        },
      });
    }
  });

  test("rejects oversized JSON-RPC bodies before the MCP transport parses them", async () => {
    const routes = createMcpRoutes({ authenticate: async (_c, next) => next() });
    const response = await rpc(routes, {
      jsonrpc: "2.0",
      id: 99,
      method: "tools/list",
      params: { padding: "x".repeat(300 * 1024) },
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: -32600, message: "MCP request is too large" } });
  });

  test("lists live queries and actions with schemas and safety annotations", async () => {
    const routes = createMcpRoutes({
      listApps: async () => [summary(app)],
      getCapability: async () => app,
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
    expect(result.tools.map((tool) => tool.name)).toEqual([
      "cloud__help__search",
      "cloud__help__read",
      "demo__action__create",
      "demo__action__update",
      "demo__query__get",
    ]);
    const create = result.tools.find((tool) => tool.name === "demo__action__create")!;
    const update = result.tools.find((tool) => tool.name === "demo__action__update")!;
    const get = result.tools.find((tool) => tool.name === "demo__query__get")!;
    expect(create.inputSchema.required).toContain("idempotencyKey");
    expect(create.annotations).toMatchObject({
      readOnlyHint: false,
      idempotentHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
    expect(create._meta).toMatchObject({
      "cloud/capabilityId": "demo.create",
      "cloud/idempotency": "required",
      "cloud/schemaHash": expect.any(String),
    });
    expect(update.inputSchema.properties).not.toHaveProperty("idempotencyKey");
    expect(update.annotations).toMatchObject({
      readOnlyHint: false,
      idempotentHint: false,
      destructiveHint: true,
      openWorldHint: false,
    });
    expect(get.annotations).toMatchObject({
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    });
  });

  test("returns structured registry failures for list and call", async () => {
    const routes = createMcpRoutes({
      listApps: async () => {
        throw new Error("registry offline");
      },
      getCapability: async () => {
        throw new Error("registry offline");
      },
      authenticate: async (_c, next) => next(),
    });
    const listed = await rpc(routes, { jsonrpc: "2.0", id: 20, method: "tools/list", params: {} });
    expect(await listed.json()).toMatchObject({
      error: { data: { code: "APP_UNAVAILABLE" }, message: expect.stringContaining("Capability registry is currently unavailable") },
    });

    const called = await rpc(routes, {
      jsonrpc: "2.0",
      id: 21,
      method: "tools/call",
      params: { name: "demo__query__get", arguments: { id: "one" } },
    });
    expect(await called.json()).toMatchObject({
      result: {
        isError: true,
        structuredContent: { code: "APP_UNAVAILABLE", message: "Capability registry is currently unavailable" },
      },
    });
  });

  test("paginates large live catalogs without materializing every tool schema", async () => {
    const apps = Array.from({ length: 150 }, (_, index): CapabilityRegistryEntry => {
      const id = `demo-${String(index).padStart(3, "0")}`;
      return {
        ...app,
        appId: id,
        appName: id,
        manifest: { ...app.manifest, appId: id, actions: [] },
      };
    });
    const byId = new Map(apps.map((candidate) => [candidate.appId, candidate]));
    let lookups = 0;
    const routes = createMcpRoutes({
      listApps: async () => apps.map(summary),
      getCapability: async (appId) => {
        lookups += 1;
        return byId.get(appId) ?? null;
      },
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
    expect(lookups).toBe(99);

    lookups = 0;
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
    expect(second.tools).toHaveLength(52);
    expect(second.nextCursor).toBeUndefined();
    expect(lookups).toBe(53);

    const afterHelpResponse = await rpc(routes, {
      jsonrpc: "2.0",
      id: 12,
      method: "tools/list",
      params: { cursor: "cloud__help__search" },
    });
    const afterHelp = ((await afterHelpResponse.json()) as { result: { tools: Tool[] } }).result;
    expect(afterHelp.tools[0]?.name).toBe("cloud__help__read");
    expect(afterHelp.tools.some((tool) => tool.name === "demo-000__query__get")).toBe(true);
  });

  test("lists, reads, searches, and embeds the same live Help resource", async () => {
    const routes = createMcpRoutes({
      listApps: async () => [helpSummary()],
      listHelp: async () => [help],
      getCapability: async () => app,
      authenticate: async (_c, next) => next(),
    });
    const listed = await rpc(routes, { jsonrpc: "2.0", id: 30, method: "resources/list", params: {} }, "2025-11-25");
    expect(await listed.json()).toMatchObject({
      result: {
        resources: [
          {
            uri: "cloud://help/demo/getting-started",
            mimeType: "text/markdown",
            _meta: { "cloud/manifestHash": "help-hash" },
          },
        ],
      },
    });

    const read = await rpc(
      routes,
      { jsonrpc: "2.0", id: 31, method: "resources/read", params: { uri: "cloud://help/demo/getting-started" } },
      "2025-11-25",
    );
    expect(await read.json()).toMatchObject({ result: { contents: [{ text: expect.stringContaining("Create an item") }] } });

    const searched = await rpc(routes, {
      jsonrpc: "2.0",
      id: 32,
      method: "tools/call",
      params: { name: "cloud__help__search", arguments: { query: "create item" } },
    });
    const searchResult = (await searched.json()) as { result: { structuredContent: unknown; content: Array<Record<string, unknown>> } };
    expect(searchResult).toMatchObject({
      result: {
        structuredContent: { documents: [{ appId: "demo", documentId: "getting-started" }] },
      },
    });
    expect(searchResult.result.content).toContainEqual(
      expect.objectContaining({ type: "resource_link", uri: "cloud://help/demo/getting-started" }),
    );

    const toolRead = await rpc(routes, {
      jsonrpc: "2.0",
      id: 33,
      method: "tools/call",
      params: { name: "cloud__help__read", arguments: { appId: "demo", documentId: "getting-started", query: "current state" } },
    });
    const readResult = (await toolRead.json()) as { result: { structuredContent: unknown; content: Array<Record<string, unknown>> } };
    expect(readResult).toMatchObject({
      result: {
        structuredContent: { document: { markdown: expect.stringContaining("current state"), truncated: false } },
      },
    });
    expect(readResult.result.content).toContainEqual(
      expect.objectContaining({
        type: "resource",
        resource: expect.objectContaining({ uri: "cloud://help/demo/getting-started", mimeType: "text/markdown" }),
      }),
    );
  });

  test("rejects cross-origin browser requests and advertises protected-resource discovery", async () => {
    const routes = createMcpRoutes({ authenticate: async (_c, next) => next() });
    const rejected = await routes.request("http://cloud.example/mcp/v1", {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(rejected.status).toBe(403);
    const forwarded = await rpc(
      createMcpRoutes({ listApps: async () => [], authenticate: async (_c, next) => next() }),
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      "2025-11-25",
      { origin: "https://cloud.example", "x-forwarded-host": "cloud.example", "x-forwarded-proto": "https" },
    );
    expect(forwarded.status).toBe(200);

    const protectedRoutes = createMcpRoutes({ getAppUrl: async () => "cloud.example" });
    const unauthenticated = await protectedRoutes.request("/mcp/v1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get("www-authenticate")).toBe(
      'Bearer resource_metadata="https://cloud.example/.well-known/oauth-protected-resource/api/mcp/v1", scope="read write"',
    );

    const discovery = createMcpProtectedResourceRoutes({ getAppUrl: async () => "cloud.example" });
    expect(await (await discovery.request("/.well-known/oauth-protected-resource/api/mcp/v1")).json()).toEqual({
      resource: cloudMcpResourceUri("cloud.example"),
      authorization_servers: ["https://cloud.example"],
      scopes_supported: ["read", "write"],
      bearer_methods_supported: ["header"],
      resource_name: "Cloud MCP",
    });
  });

  test("keeps the MCP authorization challenge when Core composes capability routes first", async () => {
    const routes = new Hono<AuthContext>()
      .route("/", createCapabilityRoutes({ authenticate: async (c) => c.json({ message: "Capability authentication" }, 401) }))
      .route("/", createMcpRoutes({ listApps: async () => [], getAppUrl: async () => "cloud.example" }));
    const response = await routes.request("/mcp/v1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      'resource_metadata="https://cloud.example/.well-known/oauth-protected-resource/api/mcp/v1"',
    );
  });

  test("calls the shared dispatcher with caller credentials and structured results", async () => {
    let forwarded: Headers | undefined;
    const routes = createMcpRoutes({
      getCapability: async () => app,
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
    const response = await rpc(
      routes,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "demo__action__create",
          arguments: { title: "Test", idempotencyKey: "create-1" },
        },
      },
      "2025-06-18",
      { "x-forwarded-host": "cloud.example", "x-forwarded-proto": "https" },
    );
    expect(response.status).toBe(200);
    const result = ((await response.json()) as { result: Record<string, any> }).result;
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ data: { id: "created" } });
    expect(result.content).toContainEqual(
      expect.objectContaining({
        type: "resource_link",
        uri: "https://cloud.example/app/demo/created",
        name: "Edit item",
      }),
    );
    expect(forwarded?.get("authorization")).toBe("Bearer caller");
    expect(forwarded?.get("idempotency-key")).toBe("create-1");
  });

  test("returns an actionable structured error when a live tool disappears", async () => {
    const routes = createMcpRoutes({
      getCapability: async () => null,
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
      code: "CAPABILITY_NOT_FOUND",
      message: "Tool demo__query__get is not in the current live capability catalog",
    });
  });

  test("preserves app authorization failures as structured tool errors", async () => {
    const routes = createMcpRoutes({
      getCapability: async () => app,
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
