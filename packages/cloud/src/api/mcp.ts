import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, type CallToolResult, ListToolsRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { Hono, type MiddlewareHandler } from "hono";
import { getCapability, listApps } from "..";
import { readBoundedJson } from "../_internal/bounded-json";
import { CAPABILITY_PROTOCOL_VERSION, type CapabilityActionManifest, type CapabilityQueryManifest } from "../contracts/capabilities";
import type { AppRegistryEntry, CapabilityRegistryEntry } from "../contracts/registry";
import { type AuthContext, auth } from "../server";
import { type CapabilityDispatchDependencies, dispatchCapability } from "./capabilities";

const MCP_TOOL_PAGE_SIZE = 100;
const MCP_TOOL_PAGE_BYTES = 1024 * 1024;
const MCP_REQUEST_LIMIT_BYTES = 256 * 1024;
const MCP_RESULT_LIMIT_BYTES = 256 * 1024;
const IDEMPOTENCY_KEY_FIELD = "idempotencyKey";

type McpRouteDependencies = CapabilityDispatchDependencies & {
  listApps?: () => Promise<AppRegistryEntry[]>;
  authenticate?: MiddlewareHandler<AuthContext>;
};

type CapabilityTool = {
  app: CapabilityRegistryEntry;
  kind: "queries" | "actions";
  operation: CapabilityQueryManifest | CapabilityActionManifest;
  tool: Tool;
};

const cloneObjectSchema = (schema: Record<string, unknown>): Tool["inputSchema"] => structuredClone(schema) as Tool["inputSchema"];

const actionInputSchema = (operation: CapabilityActionManifest): Tool["inputSchema"] => {
  const schema = cloneObjectSchema(operation.inputSchema);
  if (operation.idempotency === "none") return schema;
  const properties = { ...(schema.properties ?? {}) };
  properties[IDEMPOTENCY_KEY_FIELD] = {
    type: "string",
    minLength: 1,
    maxLength: 300,
    description: "Stable key that makes retries of this action safe.",
  };
  const required = new Set(schema.required ?? []);
  if (operation.idempotency === "required") required.add(IDEMPOTENCY_KEY_FIELD);
  return { ...schema, properties, ...(required.size > 0 ? { required: [...required] } : {}) };
};

const capabilityToolName = (appId: string, kind: "queries" | "actions", localId: string): string =>
  `${appId}__${kind === "queries" ? "query" : "action"}__${localId}`;

const projectTool = (
  app: CapabilityRegistryEntry,
  kind: "queries" | "actions",
  operation: CapabilityQueryManifest | CapabilityActionManifest,
): CapabilityTool => {
  const isAction = kind === "actions";
  const action = isAction ? (operation as CapabilityActionManifest) : null;
  return {
    app,
    kind,
    operation,
    tool: {
      name: capabilityToolName(app.appId, kind, operation.localId),
      title: `${app.appName}: ${operation.title}`,
      description: operation.description,
      inputSchema: action ? actionInputSchema(action) : cloneObjectSchema(operation.inputSchema),
      outputSchema: cloneObjectSchema(operation.resultSchema),
      annotations: {
        title: operation.title,
        readOnlyHint: !isAction,
        destructiveHint: action?.destructive ?? false,
        idempotentHint: action ? action.idempotency === "required" : true,
        openWorldHint: operation.openWorld,
      },
      _meta: {
        "cloud/appId": app.appId,
        "cloud/capabilityId": operation.id,
        "cloud/kind": isAction ? "action" : "query",
        "cloud/schemaHash": operation.schemaHash,
        ...(action ? { "cloud/approval": action.approval, "cloud/idempotency": action.idempotency } : {}),
      },
    },
  };
};

const orderedCapabilityEntries = function* (app: CapabilityRegistryEntry): Generator<{
  app: CapabilityRegistryEntry;
  kind: "queries" | "actions";
  operation: CapabilityQueryManifest | CapabilityActionManifest;
}> {
  for (const operation of [...app.manifest.actions].sort((left, right) => left.localId.localeCompare(right.localId))) {
    yield { app, kind: "actions", operation };
  }
  for (const operation of [...app.manifest.queries].sort((left, right) => left.localId.localeCompare(right.localId))) {
    yield { app, kind: "queries", operation };
  }
};

const capabilityToolPage = async (
  summaries: AppRegistryEntry[],
  cursor: string | undefined,
  lookup: (appId: string) => Promise<CapabilityRegistryEntry | null>,
): Promise<{ tools: Tool[]; nextCursor?: string }> => {
  const page: Tool[] = [];
  let bytes = 0;
  const cursorAppId = cursor?.split("__", 1)[0];
  for (const summary of [...summaries].sort((left, right) => left.id.localeCompare(right.id))) {
    if (summary.capabilities?.protocolVersion !== CAPABILITY_PROTOCOL_VERSION || (cursorAppId && summary.id < cursorAppId)) continue;
    const app = await lookup(summary.id);
    if (!app || app.manifest.manifestHash !== summary.capabilities.manifestHash) continue;
    for (const entry of orderedCapabilityEntries(app)) {
      const name = capabilityToolName(entry.app.appId, entry.kind, entry.operation.localId);
      if (cursor && name <= cursor) continue;
      if (page.length === MCP_TOOL_PAGE_SIZE) return { tools: page, nextCursor: page.at(-1)!.name };
      const tool = projectTool(entry.app, entry.kind, entry.operation).tool;
      const toolBytes = new TextEncoder().encode(JSON.stringify(tool)).byteLength;
      if (page.length > 0 && bytes + toolBytes > MCP_TOOL_PAGE_BYTES) return { tools: page, nextCursor: page.at(-1)!.name };
      page.push(tool);
      bytes += toolBytes;
    }
  }
  return { tools: page };
};

const findCapabilityTool = async (
  name: string,
  lookup: (appId: string) => Promise<CapabilityRegistryEntry | null>,
): Promise<CapabilityTool | null> => {
  const match = /^([a-z][a-z0-9-]*)__(query|action)__(.+)$/.exec(name);
  if (!match) return null;
  const [, appId, kind, localId] = match;
  if (!appId || !kind || !localId) return null;
  const app = await lookup(appId);
  if (!app) return null;
  const operations = kind === "query" ? app.manifest.queries : app.manifest.actions;
  const operation = operations.find((candidate) => candidate.localId === localId);
  if (operation) return projectTool(app, kind === "query" ? "queries" : "actions", operation);
  return null;
};

const parseResponse = async (response: Response): Promise<Record<string, unknown>> => {
  const value = (await response.json()) as unknown;
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { code: "INVALID_CAPABILITY_RESULT", message: "Capability returned a non-object result" };
};

const boundedToolResult = (body: Record<string, unknown>, isError: boolean): CallToolResult => {
  const text = JSON.stringify(body);
  if (new TextEncoder().encode(text).byteLength > MCP_RESULT_LIMIT_BYTES) {
    const error = {
      code: "RESULT_TOO_LARGE",
      message: "Capability result is too large for an MCP tool response; narrow the query and retry",
    };
    return { isError: true, structuredContent: error, content: [{ type: "text", text: JSON.stringify(error) }] };
  }
  return { ...(isError ? { isError: true } : {}), structuredContent: body, content: [{ type: "text", text }] };
};

const semanticResourceLinks = (body: Record<string, unknown>, request: Request): CallToolResult["content"] => {
  const links = Array.isArray(body.links) ? body.links : [];
  return links.flatMap((value) => {
    if (typeof value !== "object" || value === null) return [];
    const link = value as { rel?: unknown; href?: unknown; title?: unknown };
    if (typeof link.href !== "string") return [];
    return [
      {
        type: "resource_link" as const,
        uri: new URL(link.href, request.url).href,
        name: typeof link.title === "string" ? link.title : typeof link.rel === "string" ? link.rel : "Open in Cloud",
        ...(typeof link.title === "string" ? { title: link.title } : {}),
      },
    ];
  });
};

const createMcpServer = (request: Request, dependencies: McpRouteDependencies): Server => {
  const registry = dependencies.listApps ?? listApps;
  const capabilityLookup = dependencies.getCapability ?? getCapability;
  const server = new Server(
    { name: "cloud-capabilities", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions: "Use the live namespaced tools. Query tools are read-only. Action tools may require approval and an idempotencyKey.",
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async (message) => {
    return capabilityToolPage(await registry(), message.params?.cursor, capabilityLookup);
  });

  server.setRequestHandler(CallToolRequestSchema, async (message) => {
    const selected = await findCapabilityTool(message.params.name, capabilityLookup);
    if (!selected) {
      return boundedToolResult(
        { code: "TOOL_UNAVAILABLE", message: `Tool ${message.params.name} is not in the current live capability catalog` },
        true,
      );
    }

    const args = { ...(message.params.arguments ?? {}) };
    const idempotencyKey = selected.kind === "actions" ? args[IDEMPOTENCY_KEY_FIELD] : undefined;
    if (selected.kind === "actions") delete args[IDEMPOTENCY_KEY_FIELD];
    const headers = new Headers(request.headers);
    if (typeof idempotencyKey === "string") headers.set("idempotency-key", idempotencyKey);
    const response = await dispatchCapability({
      request: new Request(request.url, { method: "POST", headers, signal: request.signal }),
      kind: selected.kind,
      appId: selected.app.appId,
      capabilityId: selected.operation.localId,
      input: args,
      dependencies,
    });
    const body = await parseResponse(response);
    const result = boundedToolResult(body, !response.ok);
    if (response.ok) result.content.push(...semanticResourceLinks(body, request));
    return result;
  });

  return server;
};

/** One authenticated, stateless MCP endpoint projected from live capabilities. */
export const createMcpRoutes = (dependencies: McpRouteDependencies = {}) =>
  new Hono<AuthContext>().use(dependencies.authenticate ?? auth.requireRole("authenticated")).all("/mcp/v1", async (c) => {
    let request = c.req.raw;
    if (request.method === "POST") {
      const parsed = await readBoundedJson(request, MCP_REQUEST_LIMIT_BYTES);
      if (!parsed.ok) {
        return c.json(
          {
            jsonrpc: "2.0",
            id: null,
            error: {
              code: parsed.reason === "too_large" ? -32600 : -32700,
              message: parsed.reason === "too_large" ? "MCP request is too large" : "MCP request body must be JSON",
            },
          },
          parsed.reason === "too_large" ? 413 : 400,
        );
      }
      const headers = new Headers(request.headers);
      headers.delete("content-length");
      request = new Request(request.url, {
        method: "POST",
        headers,
        body: JSON.stringify(parsed.data),
        signal: request.signal,
      });
    }
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const server = createMcpServer(request, dependencies);
    await server.connect(transport);
    try {
      return await transport.handleRequest(request);
    } finally {
      await transport.close();
      await server.close();
    }
  });

export type McpApiType = ReturnType<typeof createMcpRoutes>;
