import { Hono, type MiddlewareHandler } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { getCapability, listApps } from "..";
import { readBoundedJson } from "../_internal/bounded-json";
import {
  CAPABILITY_PROTOCOL_VERSION,
  CapabilityActionReviewSchema,
  CapabilityErrorSchema,
  CapabilityManifestSchema,
} from "../contracts/capabilities";
import type { AppRegistryEntry, CapabilityRegistryEntry } from "../contracts/registry";
import { type AuthContext, auth, jsonResponse, requiresAuth, v } from "../server";
import { logger } from "../services";

const log = logger("capabilities");
const MAX_BODY_BYTES = 256 * 1024;
const QUERY_TIMEOUT_MS = 15_000;
const ACTION_TIMEOUT_MS = 30_000;
const MAX_APP_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_CATALOG_LIMIT = 10;
const MAX_CATALOG_LIMIT = 25;
const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const MAX_SCHEMA_VALIDATORS = 512;

const schemaValidators = new Map<string, z.ZodType | null>();

const schemaValidator = (key: string, schema: Record<string, unknown>): z.ZodType | null => {
  if (schemaValidators.has(key)) return schemaValidators.get(key) ?? null;
  let validator: z.ZodType | null = null;
  try {
    validator = z.fromJSONSchema(schema);
  } catch {
    // A live manifest with an unsupported schema is unusable, but must not
    // crash the dispatcher serving unrelated applications.
  }
  if (schemaValidators.size >= MAX_SCHEMA_VALIDATORS) {
    const oldest = schemaValidators.keys().next().value;
    if (oldest) schemaValidators.delete(oldest);
  }
  schemaValidators.set(key, validator);
  return validator;
};

const CapabilityInvocationRequestSchema = z.object({ input: z.unknown() }).strict();
const CapabilityCatalogQuerySchema = z
  .object({
    cursor: z.string().max(80).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_CATALOG_LIMIT).default(DEFAULT_CATALOG_LIMIT),
  })
  .strict();
const CapabilityCatalogResponseSchema = z
  .object({
    protocolVersion: z.literal(CAPABILITY_PROTOCOL_VERSION),
    apps: z
      .array(
        z
          .object({
            appId: z.string(),
            appName: z.string(),
            appIcon: z.string(),
            manifest: CapabilityManifestSchema,
          })
          .strict(),
      )
      .max(MAX_CATALOG_LIMIT),
    page: z
      .object({
        nextCursor: z.string().max(80).optional(),
        hasMore: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type CapabilityRouteDependencies = {
  listApps?: () => Promise<AppRegistryEntry[]>;
  getCapability?: (appId: string) => Promise<CapabilityRegistryEntry | null>;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  authenticate?: MiddlewareHandler<AuthContext>;
};

export type CapabilityDispatchDependencies = Pick<CapabilityRouteDependencies, "getCapability" | "fetch">;

export const capabilityCredentialHeaders = (request: Request): Headers => {
  const headers = new Headers({
    "content-type": "application/json",
    accept: "application/json",
  });
  const authorization = request.headers.get("authorization");
  const cookie = request.headers.get("cookie");
  if (authorization) headers.set("authorization", authorization);
  else if (cookie) headers.set("cookie", cookie);
  for (const name of ["x-request-id", "traceparent", "tracestate", "idempotency-key"] as const) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
};

const errorResponse = (code: string, message: string, status: 400 | 404 | 409 | 502 | 503, details?: Record<string, unknown>) => ({
  body: { code, message, ...(details ? { details } : {}) },
  status,
});

const capabilityJsonResponse = (body: unknown, status: number): Response =>
  Response.json(body, {
    status,
    headers: { "content-type": "application/json" },
  });

/**
 * Dispatch one already-parsed capability invocation through the live registry.
 * HTTP, CLI, and MCP callers share this exact app lookup, credential forwarding,
 * schema pinning, timeout, and response validation path.
 */
export const dispatchCapability = async (params: {
  request: Request;
  kind: "queries" | "actions";
  review?: boolean;
  appId: string;
  capabilityId: string;
  input: unknown;
  dependencies?: CapabilityDispatchDependencies;
}): Promise<Response> => {
  const registryEntry = params.dependencies?.getCapability ?? getCapability;
  const fetchUpstream = params.dependencies?.fetch ?? globalThis.fetch;
  const entry = await registryEntry(params.appId);
  if (!entry) {
    const error = errorResponse("APP_UNAVAILABLE", `App ${params.appId} is not currently available`, 404);
    return capabilityJsonResponse(error.body, error.status);
  }

  const operations = params.kind === "queries" ? entry.manifest.queries : entry.manifest.actions;
  const operation = operations.find((candidate) => candidate.localId === params.capabilityId);
  if (!operation) {
    const label = params.kind === "queries" ? "Query" : "Action";
    const error = errorResponse("CAPABILITY_NOT_FOUND", `${label} ${params.appId}.${params.capabilityId} not found`, 404);
    return capabilityJsonResponse(error.body, error.status);
  }
  if (params.review && (params.kind !== "actions" || !("review" in operation) || operation.review !== true)) {
    const error = errorResponse("CAPABILITY_NOT_FOUND", `Review ${params.appId}.${params.capabilityId} not found`, 404);
    return capabilityJsonResponse(error.body, error.status);
  }

  const inputValidator = schemaValidator(`${operation.schemaHash}:input`, operation.inputSchema);
  if (!inputValidator) {
    const invalid = errorResponse("INVALID_APP_RESPONSE", `App ${params.appId} registered an unsupported capability schema`, 502);
    return capabilityJsonResponse(invalid.body, invalid.status);
  }
  const input = inputValidator.safeParse(params.input);
  if (!input.success) {
    const invalid = errorResponse("VALIDATION_FAILED", "Capability input did not match the registered schema", 400, {
      issues: input.error.issues.slice(0, 20).map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
    return capabilityJsonResponse(invalid.body, invalid.status);
  }

  const headers = capabilityCredentialHeaders(params.request);
  headers.set("x-cloud-capability-schema-hash", operation.schemaHash);
  const timeout = AbortSignal.timeout(params.kind === "queries" || params.review ? QUERY_TIMEOUT_MS : ACTION_TIMEOUT_MS);
  const signal = AbortSignal.any([params.request.signal, timeout]);

  let response: Response;
  try {
    response = await fetchUpstream(
      `${entry.endpoint}/${params.kind}/${encodeURIComponent(params.capabilityId)}${params.review ? "/review" : ""}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ input: input.data }),
        signal,
      },
    );
  } catch (error) {
    log.warn("Capability app unavailable", {
      appId: params.appId,
      capabilityId: params.capabilityId,
      kind: params.kind,
      error: error instanceof Error ? error.message : String(error),
    });
    const unavailable = errorResponse("APP_UNAVAILABLE", `App ${params.appId} could not serve the capability`, 503);
    return capabilityJsonResponse(unavailable.body, unavailable.status);
  }

  const upstreamBody = await readBoundedJson(response, MAX_APP_RESPONSE_BYTES);
  if (!upstreamBody.ok) {
    const invalid = errorResponse("INVALID_APP_RESPONSE", `App ${params.appId} returned invalid or oversized capability JSON`, 502);
    return capabilityJsonResponse(invalid.body, invalid.status);
  }

  if (!response.ok) {
    const parsed = CapabilityErrorSchema.safeParse(upstreamBody.data);
    if (parsed.success && response.status >= 400 && response.status <= 599) {
      return capabilityJsonResponse(parsed.data, response.status);
    }
    const invalid = errorResponse("INVALID_APP_RESPONSE", `App ${params.appId} returned an invalid capability error`, 502);
    return capabilityJsonResponse(invalid.body, invalid.status);
  }

  const resultValidator = params.review
    ? CapabilityActionReviewSchema
    : schemaValidator(`${operation.schemaHash}:result`, operation.resultSchema);
  if (!resultValidator || !resultValidator.safeParse(upstreamBody.data).success) {
    const invalid = errorResponse(
      "INVALID_APP_RESPONSE",
      `App ${params.appId} returned data outside its registered capability schema`,
      502,
    );
    return capabilityJsonResponse(invalid.body, invalid.status);
  }

  return capabilityJsonResponse(upstreamBody.data, 200);
};

export const createCapabilityRoutes = (dependencies: CapabilityRouteDependencies = {}) => {
  const registry = dependencies.listApps ?? listApps;
  const capabilityLookup = dependencies.getCapability ?? getCapability;

  return new Hono<AuthContext>()
    .use(dependencies.authenticate ?? auth.requireRole("authenticated"))
    .get(
      "/capabilities/v1/catalog",
      describeRoute({
        tags: ["Capabilities"],
        summary: "List live app capabilities",
        description: "Returns the versioned capability manifests currently advertised by live app leases.",
        ...requiresAuth,
        responses: {
          200: jsonResponse(CapabilityCatalogResponseSchema, "Live capability catalog"),
          401: jsonResponse(CapabilityErrorSchema, "Authentication required"),
        },
      }),
      v("query", CapabilityCatalogQuerySchema),
      async (c) => {
        const query = c.req.valid("query");
        const entries = await registry();
        const liveApps = entries
          .filter((entry) => entry.capabilities?.protocolVersion === CAPABILITY_PROTOCOL_VERSION)
          .sort((left, right) => left.id.localeCompare(right.id));
        const start = query.cursor ? liveApps.findIndex((entry) => entry.id > query.cursor!) : 0;
        const offset = start < 0 ? liveApps.length : start;
        const apps: Array<{ appId: string; appName: string; appIcon: string; manifest: CapabilityRegistryEntry["manifest"] }> = [];
        let bytes = 0;
        let lastScannedAppId: string | undefined;
        for (const entry of liveApps.slice(offset)) {
          if (apps.length === query.limit) break;
          const capability = await capabilityLookup(entry.id);
          if (!capability || capability.manifest.manifestHash !== entry.capabilities?.manifestHash) {
            lastScannedAppId = entry.id;
            continue;
          }
          const projected = {
            appId: capability.appId,
            appName: capability.appName,
            appIcon: capability.appIcon,
            manifest: capability.manifest,
          };
          const projectedBytes = new TextEncoder().encode(JSON.stringify(projected)).byteLength;
          if (apps.length > 0 && bytes + projectedBytes > MAX_CATALOG_BYTES) break;
          apps.push(projected);
          bytes += projectedBytes;
          lastScannedAppId = entry.id;
        }
        const hasMore = lastScannedAppId !== undefined && liveApps.some((entry) => entry.id > lastScannedAppId);
        return c.json({
          protocolVersion: CAPABILITY_PROTOCOL_VERSION,
          apps,
          page: {
            hasMore,
            ...(hasMore && lastScannedAppId ? { nextCursor: lastScannedAppId } : {}),
          },
        });
      },
    )
    .post(
      "/capabilities/v1/actions/:appId/:capabilityId/review",
      describeRoute({
        tags: ["Capabilities"],
        summary: "Review one live app Action",
        description: "Resolves the optional read-only human review for an Action with the caller credential.",
        ...requiresAuth,
        responses: {
          200: jsonResponse(z.unknown(), "Capability Action review"),
          400: jsonResponse(CapabilityErrorSchema, "Invalid request"),
          401: jsonResponse(CapabilityErrorSchema, "Authentication required"),
          404: jsonResponse(CapabilityErrorSchema, "Capability review or app unavailable"),
          409: jsonResponse(CapabilityErrorSchema, "Schema changed"),
          500: jsonResponse(CapabilityErrorSchema, "Capability review failed"),
          502: jsonResponse(CapabilityErrorSchema, "Invalid app response"),
          503: jsonResponse(CapabilityErrorSchema, "App unavailable"),
        },
      }),
      async (c) => {
        const body = await readBoundedJson(c.req.raw, MAX_BODY_BYTES);
        if (!body.ok) {
          const message = body.reason === "too_large" ? "Capability request is too large" : "Capability request body must be JSON";
          const error = errorResponse("BAD_INPUT", message, 400);
          return c.json(error.body, error.status);
        }
        const request = CapabilityInvocationRequestSchema.safeParse(body.data);
        if (!request.success) {
          const error = errorResponse("BAD_INPUT", "Capability request must contain only an input field", 400);
          return c.json(error.body, error.status);
        }
        return dispatchCapability({
          request: c.req.raw,
          kind: "actions",
          review: true,
          appId: c.req.param("appId") ?? "",
          capabilityId: c.req.param("capabilityId") ?? "",
          input: request.data.input,
          dependencies,
        });
      },
    )
    .post(
      "/capabilities/v1/:kind{queries|actions}/:appId/:capabilityId",
      describeRoute({
        tags: ["Capabilities"],
        summary: "Invoke one live app capability",
        description: "Validates the live manifest and dispatches to the framework-owned app endpoint with the caller credential.",
        ...requiresAuth,
        responses: {
          200: jsonResponse(z.unknown(), "Capability result"),
          400: jsonResponse(CapabilityErrorSchema, "Invalid request"),
          401: jsonResponse(CapabilityErrorSchema, "Authentication required"),
          404: jsonResponse(CapabilityErrorSchema, "Capability or app unavailable"),
          409: jsonResponse(CapabilityErrorSchema, "Schema changed"),
          429: jsonResponse(CapabilityErrorSchema, "Capability rate limited"),
          500: jsonResponse(CapabilityErrorSchema, "Capability execution failed"),
          502: jsonResponse(CapabilityErrorSchema, "Invalid app response"),
          503: jsonResponse(CapabilityErrorSchema, "App unavailable"),
        },
      }),
      async (c) => {
        const body = await readBoundedJson(c.req.raw, MAX_BODY_BYTES);
        if (!body.ok) {
          const message = body.reason === "too_large" ? "Capability request is too large" : "Capability request body must be JSON";
          const error = errorResponse("BAD_INPUT", message, 400);
          return c.json(error.body, error.status);
        }
        const request = CapabilityInvocationRequestSchema.safeParse(body.data);
        if (!request.success) {
          const error = errorResponse("BAD_INPUT", "Capability request must contain only an input field", 400);
          return c.json(error.body, error.status);
        }

        return dispatchCapability({
          request: c.req.raw,
          kind: c.req.param("kind") as "queries" | "actions",
          appId: c.req.param("appId") ?? "",
          capabilityId: c.req.param("capabilityId") ?? "",
          input: request.data.input,
          dependencies,
        });
      },
    );
};

export type CapabilityApiType = ReturnType<typeof createCapabilityRoutes>;
