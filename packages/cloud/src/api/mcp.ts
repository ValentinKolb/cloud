import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  type Resource,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { Hono, type MiddlewareHandler } from "hono";
import { readBoundedJson } from "../_internal/bounded-json";
import {
  findHelpDocument,
  HELP_SEARCH_MAX_LIMIT,
  type HelpCatalogDocument,
  helpResourceUri,
  loadHelpCatalog,
  parseHelpResourceUri,
  readHelpCatalog,
  searchHelpCatalog,
} from "../_internal/help-catalog";
import { getCapability, listApps, listHelp } from "../_internal/registry";
import {
  CAPABILITY_FRAMEWORK_ERROR_CODES,
  CAPABILITY_MAX_REQUEST_BYTES,
  CAPABILITY_MAX_RESULT_BYTES,
  CAPABILITY_PROTOCOL_VERSION,
  type CapabilityActionManifest,
  type CapabilityQueryManifest,
  capabilityResultJsonSchema,
} from "../contracts/capabilities";
import type { AppRegistryEntry, CapabilityRegistryEntry, HelpRegistryEntry } from "../contracts/registry";
import { type AuthContext, auth } from "../server";
import { get } from "../services/settings";
import { type CapabilityDispatchDependencies, dispatchCapability } from "./capabilities";

const MCP_TOOL_PAGE_SIZE = 100;
const MCP_TOOL_PAGE_BYTES = 1024 * 1024;
const MCP_RESOURCE_PAGE_SIZE = 100;
const IDEMPOTENCY_KEY_FIELD = "idempotencyKey";
const HELP_SEARCH_TOOL = "cloud__help__search";
const HELP_READ_TOOL = "cloud__help__read";
export const CLOUD_MCP_PATH = "/api/mcp/v1";
export const CLOUD_MCP_PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource/api/mcp/v1";
const MCP_INSTRUCTIONS =
  "Use Capability tools for live Cloud data and changes. When product behavior, settings, workflows, permissions, or errors are unclear, call cloud__help__search and then cloud__help__read. Help is static product guidance and does not prove current state, access, or successful execution. Queries are read-only. Actions mutate state and remain subject to client approval and current app authorization. Use returned Cloud resource links instead of inventing application routes.";

type McpRouteDependencies = CapabilityDispatchDependencies & {
  listApps?: () => Promise<AppRegistryEntry[]>;
  listHelp?: () => Promise<HelpRegistryEntry[]>;
  getAppUrl?: () => Promise<string>;
  authenticate?: MiddlewareHandler<AuthContext>;
};

export const publicCloudOrigin = (value: string): string => {
  const raw = value.trim().replace(/\/+$/, "");
  const configured = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  const local = configured.hostname === "localhost" || configured.hostname === "127.0.0.1" || configured.hostname === "::1";
  return new URL(/^https?:\/\//i.test(raw) || !local ? configured : `http://${raw}`).origin;
};

export const cloudMcpResourceUri = (appUrl: string): string => `${publicCloudOrigin(appUrl)}${CLOUD_MCP_PATH}`;

const defaultAppUrl = () => get<string>("app.url");

const mcpResourceMetadataUrl = (appUrl: string): string => `${publicCloudOrigin(appUrl)}${CLOUD_MCP_PROTECTED_RESOURCE_PATH}`;

const helpCatalogItemJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    appId: { type: "string" },
    appName: { type: "string" },
    kind: { type: "string", const: "help" },
    documentId: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
  },
  required: ["appId", "appName", "kind", "documentId", "title"],
} as const;

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
    maxLength: 200,
    pattern: "^[!-~]+$",
    description: "Stable key that makes retries of this action safe.",
  };
  const required = new Set(schema.required ?? []);
  if (operation.idempotency === "required") required.add(IDEMPOTENCY_KEY_FIELD);
  return { ...schema, properties, ...(required.size > 0 ? { required: [...required] } : {}) };
};

const capabilityToolName = (appId: string, kind: "queries" | "actions", localId: string): string =>
  `${appId}__${kind === "queries" ? "query" : "action"}__${localId}`;

const helpTools: Tool[] = [
  {
    name: HELP_SEARCH_TOOL,
    title: "Search Cloud Help",
    description:
      "Search current installed-app Help for product behavior, settings, workflows, permissions, and errors. Use concise product terms, then read the best matching document.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", minLength: 1, maxLength: 200, description: "Concise product task or concept." },
        appId: { type: "string", minLength: 1, description: "Optional exact installed Cloud app id." },
        limit: { type: "integer", minimum: 1, maximum: HELP_SEARCH_MAX_LIMIT, description: "Maximum matches to return." },
      },
      required: ["query"],
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { documents: { type: "array", items: helpCatalogItemJsonSchema } },
      required: ["documents"],
    },
    annotations: { title: "Search Cloud Help", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { "cloud/kind": "help-search" },
  },
  {
    name: HELP_READ_TOOL,
    title: "Read Cloud Help",
    description:
      "Read one exact Help document returned by cloud__help__search. Product Help is static guidance and never proves current access or live state.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        appId: { type: "string", minLength: 1, description: "Exact installed Cloud app id." },
        documentId: { type: "string", minLength: 1, description: "Exact Help document id." },
        query: { type: "string", minLength: 1, maxLength: 200, description: "Optional search terms for a relevant bounded excerpt." },
      },
      required: ["appId", "documentId"],
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        document: {
          anyOf: [
            {
              ...helpCatalogItemJsonSchema,
              properties: {
                ...helpCatalogItemJsonSchema.properties,
                markdown: { type: "string" },
                truncated: { type: "boolean" },
              },
              required: [...helpCatalogItemJsonSchema.required, "markdown", "truncated"],
            },
            { type: "null" },
          ],
        },
      },
      required: ["document"],
    },
    annotations: { title: "Read Cloud Help", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { "cloud/kind": "help-read" },
  },
];

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
      outputSchema: cloneObjectSchema(capabilityResultJsonSchema(operation.dataSchema)),
      annotations: {
        title: operation.title,
        readOnlyHint: !isAction,
        destructiveHint: action?.destructive ?? false,
        idempotentHint: action ? action.idempotency === "required" : true,
        openWorldHint: operation.openWorld,
      },
      _meta: {
        "cloud/appId": app.appId,
        "cloud/capabilityId": `${app.appId}.${operation.localId}`,
        "cloud/kind": isAction ? "action" : "query",
        "cloud/schemaHash": operation.schemaHash,
        ...(action ? { "cloud/idempotency": action.idempotency } : {}),
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
  const helpCursorIndex = cursor?.startsWith("cloud__help__") ? helpTools.findIndex((tool) => tool.name === cursor) : -1;
  if (!cursor || helpCursorIndex >= 0) {
    for (const [index, tool] of helpTools.entries()) {
      if (index <= helpCursorIndex) continue;
      page.push(tool);
      bytes += new TextEncoder().encode(JSON.stringify(tool)).byteLength;
    }
  }
  const cursorAppId = cursor && helpCursorIndex < 0 ? cursor.split("__", 1)[0] : undefined;
  for (const summary of [...summaries].sort((left, right) => left.id.localeCompare(right.id))) {
    if (summary.capabilities?.protocolVersion !== CAPABILITY_PROTOCOL_VERSION || (cursorAppId && summary.id < cursorAppId)) continue;
    const app = await lookup(summary.id);
    if (!app || app.manifest.manifestHash !== summary.capabilities.manifestHash) continue;
    for (const entry of orderedCapabilityEntries(app)) {
      const name = capabilityToolName(entry.app.appId, entry.kind, entry.operation.localId);
      if (cursorAppId && cursor && name <= cursor) continue;
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
    : { code: CAPABILITY_FRAMEWORK_ERROR_CODES.invalidAppResponse, message: "Capability returned a non-object result" };
};

const boundedToolResult = (body: Record<string, unknown>, isError: boolean): CallToolResult => {
  const text = JSON.stringify(body);
  if (new TextEncoder().encode(text).byteLength > CAPABILITY_MAX_RESULT_BYTES) {
    const error = {
      code: CAPABILITY_FRAMEWORK_ERROR_CODES.responseTooLarge,
      message: "Capability result is too large for an MCP tool response; narrow the query and retry",
    };
    return { isError: true, structuredContent: error, content: [{ type: "text", text: JSON.stringify(error) }] };
  }
  return { ...(isError ? { isError: true } : {}), structuredContent: body, content: [{ type: "text", text }] };
};

const externalRequestOrigin = (request: Request): string => {
  const host = request.headers.get("x-forwarded-host")?.trim();
  const protocol = request.headers.get("x-forwarded-proto")?.trim().replace(/:$/, "");
  if (host && (protocol === "http" || protocol === "https")) return `${protocol}://${host}`;
  return new URL(request.url).origin;
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
        uri: new URL(link.href, externalRequestOrigin(request)).href,
        name: typeof link.title === "string" ? link.title : typeof link.rel === "string" ? link.rel : "Open in Cloud",
        ...(typeof link.title === "string" ? { title: link.title } : {}),
      },
    ];
  });
};

const helpResource = (document: HelpCatalogDocument): Resource => ({
  uri: helpResourceUri(document.appId, document.documentId),
  name: `${document.appName}: ${document.title}`,
  title: document.title,
  description: document.description ?? `Product Help from ${document.appName}.`,
  mimeType: "text/markdown",
  size: new TextEncoder().encode(document.markdown).byteLength,
  annotations: { audience: ["assistant"], priority: 0.8 },
  _meta: {
    "cloud/appId": document.appId,
    "cloud/documentId": document.documentId,
    "cloud/manifestHash": document.manifestHash,
  },
});

const helpResourcePage = (catalog: readonly HelpCatalogDocument[], cursor?: string): { resources: Resource[]; nextCursor?: string } => {
  const resources = catalog
    .map(helpResource)
    .sort((left, right) => left.uri.localeCompare(right.uri))
    .filter((resource) => !cursor || resource.uri > cursor)
    .slice(0, MCP_RESOURCE_PAGE_SIZE);
  const hasMore =
    resources.length === MCP_RESOURCE_PAGE_SIZE &&
    catalog.some((document) => helpResourceUri(document.appId, document.documentId) > resources.at(-1)!.uri);
  return { resources, ...(hasMore ? { nextCursor: resources.at(-1)!.uri } : {}) };
};

const helpArguments = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key));

const validationToolError = (message: string): CallToolResult =>
  boundedToolResult({ code: CAPABILITY_FRAMEWORK_ERROR_CODES.validationFailed, message }, true);

const callHelpTool = async (name: string, argsValue: unknown, catalog: readonly HelpCatalogDocument[]): Promise<CallToolResult | null> => {
  const args = helpArguments(argsValue);
  if (name === HELP_SEARCH_TOOL) {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    const appId = typeof args.appId === "string" && args.appId.trim() ? args.appId.trim() : undefined;
    const limit = typeof args.limit === "number" && Number.isInteger(args.limit) ? args.limit : undefined;
    if (
      !hasOnlyKeys(args, ["query", "appId", "limit"]) ||
      !query ||
      query.length > 200 ||
      (args.appId !== undefined && !appId) ||
      (args.limit !== undefined && limit === undefined) ||
      (limit !== undefined && (limit < 1 || limit > HELP_SEARCH_MAX_LIMIT))
    ) {
      return validationToolError("cloud__help__search requires query (1-200 characters) and an optional limit from 1 to 25");
    }
    const documents = searchHelpCatalog(catalog, { query, appId, limit });
    const result = boundedToolResult({ documents }, false);
    result.content.push(
      ...documents.map((document) => ({
        type: "resource_link" as const,
        uri: helpResourceUri(document.appId, document.documentId),
        name: `${document.appName}: ${document.title}`,
        title: document.title,
        description: document.description,
        mimeType: "text/markdown",
      })),
    );
    return result;
  }
  if (name === HELP_READ_TOOL) {
    const appId = typeof args.appId === "string" ? args.appId.trim() : "";
    const documentId = typeof args.documentId === "string" ? args.documentId.trim() : "";
    const query = typeof args.query === "string" && args.query.trim() ? args.query.trim() : undefined;
    if (
      !hasOnlyKeys(args, ["appId", "documentId", "query"]) ||
      !appId ||
      !documentId ||
      (args.query !== undefined && !query) ||
      (query !== undefined && query.length > 200)
    ) {
      return validationToolError(
        "cloud__help__read requires exact appId and documentId values and accepts an optional query up to 200 characters",
      );
    }
    const document = readHelpCatalog(catalog, { appId, documentId, query });
    if (!document) return boundedToolResult({ code: "HELP_NOT_FOUND", message: "Help document is not in the current live catalog" }, true);
    const result = boundedToolResult({ document }, false);
    result.content.push(
      {
        type: "resource_link",
        uri: helpResourceUri(appId, documentId),
        name: `${document.appName}: ${document.title}`,
        title: document.title,
        description: document.description,
        mimeType: "text/markdown",
      },
      {
        type: "resource",
        resource: { uri: helpResourceUri(appId, documentId), mimeType: "text/markdown", text: document.markdown },
        annotations: { audience: ["assistant"], priority: 0.8 },
      },
    );
    return result;
  }
  return null;
};

const createMcpServer = (request: Request, dependencies: McpRouteDependencies): Server => {
  const registry = dependencies.listApps ?? listApps;
  const capabilityLookup = dependencies.getCapability ?? getCapability;
  const helpCatalog = () => loadHelpCatalog({ listApps: registry, listHelp: dependencies.listHelp ?? listHelp });
  const server = new Server(
    { name: "cloud", version: "1.0.0" },
    {
      capabilities: { resources: {}, tools: {} },
      instructions: MCP_INSTRUCTIONS,
    },
  );

  server.setRequestHandler(ListResourcesRequestSchema, async (message) => {
    try {
      return helpResourcePage(await helpCatalog(), message.params?.cursor);
    } catch {
      throw new McpError(ErrorCode.InternalError, "Help registry is currently unavailable", {
        code: CAPABILITY_FRAMEWORK_ERROR_CODES.appUnavailable,
      });
    }
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (message) => {
    const identity = parseHelpResourceUri(message.params.uri);
    if (!identity) throw new McpError(ErrorCode.InvalidParams, "Unknown Cloud Help resource URI");
    let catalog: HelpCatalogDocument[];
    try {
      catalog = await helpCatalog();
    } catch {
      throw new McpError(ErrorCode.InternalError, "Help registry is currently unavailable", {
        code: CAPABILITY_FRAMEWORK_ERROR_CODES.appUnavailable,
      });
    }
    const document = findHelpDocument(catalog, identity.appId, identity.documentId);
    if (!document) throw new McpError(ErrorCode.InvalidParams, "Help resource is not in the current live catalog");
    return { contents: [{ uri: message.params.uri, mimeType: "text/markdown", text: document.markdown }] };
  });

  server.setRequestHandler(ListToolsRequestSchema, async (message) => {
    try {
      return await capabilityToolPage(await registry(), message.params?.cursor, capabilityLookup);
    } catch {
      throw new McpError(ErrorCode.InternalError, "Capability registry is currently unavailable", {
        code: CAPABILITY_FRAMEWORK_ERROR_CODES.appUnavailable,
      });
    }
  });

  server.setRequestHandler(CallToolRequestSchema, async (message) => {
    if (message.params.name === HELP_SEARCH_TOOL || message.params.name === HELP_READ_TOOL) {
      try {
        return (await callHelpTool(message.params.name, message.params.arguments, await helpCatalog()))!;
      } catch {
        return boundedToolResult(
          { code: CAPABILITY_FRAMEWORK_ERROR_CODES.appUnavailable, message: "Help registry is currently unavailable" },
          true,
        );
      }
    }
    let selected: CapabilityTool | null;
    try {
      selected = await findCapabilityTool(message.params.name, capabilityLookup);
    } catch {
      return boundedToolResult(
        {
          code: CAPABILITY_FRAMEWORK_ERROR_CODES.appUnavailable,
          message: "Capability registry is currently unavailable",
        },
        true,
      );
    }
    if (!selected) {
      return boundedToolResult(
        {
          code: CAPABILITY_FRAMEWORK_ERROR_CODES.capabilityNotFound,
          message: `Tool ${message.params.name} is not in the current live capability catalog`,
        },
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

const validateMcpOrigin: MiddlewareHandler<AuthContext> = async (c, next) => {
  const origin = c.req.header("Origin");
  if (origin) {
    try {
      if (new URL(origin).origin !== externalRequestOrigin(c.req.raw)) {
        return c.json({ code: "INVALID_ORIGIN", message: "MCP requests with Origin must be same-origin" }, 403);
      }
    } catch {
      return c.json({ code: "INVALID_ORIGIN", message: "MCP Origin header is invalid" }, 403);
    }
  }
  return next();
};

const mcpAuthentication =
  (getAppUrl: () => Promise<string>): MiddlewareHandler<AuthContext> =>
  async (c, next) => {
    const appUrl = await getAppUrl();
    const resource = cloudMcpResourceUri(appUrl);
    return auth.requireRole("authenticated", {
      oauthAudience: resource,
      onReject: (_context, reason) => {
        if (reason === "forbidden") {
          return Response.json({ message: "Insufficient permissions" }, { status: 403 });
        }
        return Response.json(
          { message: "Authentication required" },
          {
            status: 401,
            headers: {
              "WWW-Authenticate": `Bearer resource_metadata="${mcpResourceMetadataUrl(appUrl)}", scope="read write"`,
            },
          },
        );
      },
    })(c, next);
  };

export const createMcpProtectedResourceRoutes = (dependencies: Pick<McpRouteDependencies, "getAppUrl"> = {}) =>
  new Hono().get(CLOUD_MCP_PROTECTED_RESOURCE_PATH, async (c) => {
    const appUrl = await (dependencies.getAppUrl ?? defaultAppUrl)();
    const origin = publicCloudOrigin(appUrl);
    return c.json({
      resource: cloudMcpResourceUri(appUrl),
      authorization_servers: [origin],
      scopes_supported: ["read", "write"],
      bearer_methods_supported: ["header"],
      resource_name: "Cloud MCP",
    });
  });

/** One authenticated, stateless MCP endpoint projected from live capabilities. */
export const createMcpRoutes = (dependencies: McpRouteDependencies = {}) =>
  new Hono<AuthContext>()
    .use("/mcp/v1", validateMcpOrigin)
    .use(dependencies.authenticate ?? mcpAuthentication(dependencies.getAppUrl ?? defaultAppUrl))
    .all("/mcp/v1", async (c) => {
      let request = c.req.raw;
      if (request.method === "POST") {
        const parsed = await readBoundedJson(request, CAPABILITY_MAX_REQUEST_BYTES);
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
