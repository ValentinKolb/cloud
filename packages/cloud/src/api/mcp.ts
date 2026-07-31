import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { Hono, type MiddlewareHandler } from "hono";
import { listApps } from "..";
import type { CapabilityActionManifest, CapabilityQueryManifest } from "../contracts/capabilities";
import type { AppRegistryEntry } from "../contracts/registry";
import { type AuthContext, auth } from "../server";
import { dispatchCapability, type CapabilityDispatchDependencies } from "./capabilities";

const MCP_TOOL_PAGE_SIZE = 100;
const MCP_RESULT_LIMIT_BYTES = 256 * 1024;
const IDEMPOTENCY_KEY_FIELD = "idempotencyKey";

type McpRouteDependencies = CapabilityDispatchDependencies & {
  listApps?: () => Promise<AppRegistryEntry[]>;
  authenticate?: MiddlewareHandler<AuthContext>;
};

type CapabilityTool = {
  app: AppRegistryEntry;
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
  app: AppRegistryEntry,
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
      name: capabilityToolName(app.id, kind, operation.localId),
      title: `${app.name}: ${operation.title}`,
      description: operation.description,
      inputSchema: action ? actionInputSchema(action) : cloneObjectSchema(operation.inputSchema),
      outputSchema: cloneObjectSchema(operation.resultSchema),
      annotations: {
        title: operation.title,
        readOnlyHint: !isAction,
        destructiveHint: action?.destructive ?? false,
        idempotentHint: action ? action.idempotency !== "none" : true,
        openWorldHint: action?.openWorld ?? false,
      },
      _meta: {
        "cloud/appId": app.id,
        "cloud/capabilityId": operation.id,
        "cloud/kind": isAction ? "action" : "query",
        "cloud/schemaHash": operation.schemaHash,
        ...(action ? { "cloud/approval": action.approval, "cloud/idempotency": action.idempotency } : {}),
      },
    },
  };
};

const orderedCapabilityEntries = function* (entries: AppRegistryEntry[]): Generator<{
  app: AppRegistryEntry;
  kind: "queries" | "actions";
  operation: CapabilityQueryManifest | CapabilityActionManifest;
}> {
  for (const app of [...entries].sort((left, right) => left.id.localeCompare(right.id))) {
    if (!app.capabilities) continue;
    for (const operation of [...app.capabilities.manifest.actions].sort((left, right) => left.localId.localeCompare(right.localId))) {
      yield { app, kind: "actions", operation };
    }
    for (const operation of [...app.capabilities.manifest.queries].sort((left, right) => left.localId.localeCompare(right.localId))) {
      yield { app, kind: "queries", operation };
    }
  }
};

const capabilityToolPage = (entries: AppRegistryEntry[], cursor: string | undefined): { tools: Tool[]; nextCursor?: string } => {
  const page: Tool[] = [];
  for (const entry of orderedCapabilityEntries(entries)) {
    const name = capabilityToolName(entry.app.id, entry.kind, entry.operation.localId);
    if (cursor && name <= cursor) continue;
    if (page.length === MCP_TOOL_PAGE_SIZE) return { tools: page, nextCursor: page.at(-1)!.name };
    page.push(projectTool(entry.app, entry.kind, entry.operation).tool);
  }
  return { tools: page };
};

const findCapabilityTool = (entries: AppRegistryEntry[], name: string): CapabilityTool | null => {
  for (const entry of orderedCapabilityEntries(entries)) {
    if (capabilityToolName(entry.app.id, entry.kind, entry.operation.localId) === name) {
      return projectTool(entry.app, entry.kind, entry.operation);
    }
  }
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
  const server = new Server(
    { name: "cloud-capabilities", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions: "Use the live namespaced tools. Query tools are read-only. Action tools may require approval and an idempotencyKey.",
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async (message) => {
    return capabilityToolPage(await registry(), message.params?.cursor);
  });

  server.setRequestHandler(CallToolRequestSchema, async (message) => {
    const selected = findCapabilityTool(await registry(), message.params.name);
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
      appId: selected.app.id,
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
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const server = createMcpServer(c.req.raw, dependencies);
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      await transport.close();
      await server.close();
    }
  });

export type McpApiType = ReturnType<typeof createMcpRoutes>;
