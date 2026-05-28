import { sql } from "bun";

export type WebhookEndpoint = {
  id: string;
  token: string;
  name: string;
  urlPath: string;
  requestCount: number;
  lastRequestAt: string | null;
  createdAt: string;
};

export type WebhookLog = {
  id: string;
  endpointId: string | null;
  direction: "incoming" | "outgoing";
  method: string;
  url: string;
  path: string;
  query: string;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  requestContentType: string | null;
  responseStatus: number | null;
  responseHeaders: Record<string, string> | null;
  responseBody: string | null;
  durationMs: number | null;
  error: string | null;
  createdAt: string;
};

export type SendWebhookInput = {
  url: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers: Record<string, string>;
  body: string;
};

export type WebhookLogFilters = {
  endpointId?: string | null;
  method?: string | null;
  query?: string | null;
};

type EndpointRow = {
  id: string;
  token: string;
  name: string;
  request_count: number;
  last_request_at: string | null;
  created_at: string;
};

type LogRow = {
  id: string;
  endpoint_id: string | null;
  direction: "incoming" | "outgoing";
  method: string;
  url: string;
  path: string;
  query: string;
  request_headers: Record<string, string>;
  request_body: string | null;
  request_content_type: string | null;
  response_status: number | null;
  response_headers: Record<string, string> | null;
  response_body: string | null;
  duration_ms: number | null;
  error: string | null;
  created_at: string;
};

const MAX_BODY_CHARS = 64_000;
const MAX_LOGS_PER_ENDPOINT = 200;
const MAX_OUTGOING_LOGS_PER_USER = 200;
const LOG_RETENTION_DAYS = 30;

const normalizeLogFilters = (filters: WebhookLogFilters = {}) => ({
  endpointId: filters.endpointId?.trim() || null,
  method: filters.method?.trim().toUpperCase() || null,
  query: filters.query?.trim() || null,
});

const redactHeader = (name: string, value: string): string => {
  const lower = name.toLowerCase();
  if (lower === "authorization" || lower === "cookie" || lower === "set-cookie") return "[redacted]";
  return value;
};

export const sanitizeHeaders = (headers: Headers): Record<string, string> => {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = redactHeader(key, value);
  });
  return out;
};

const truncate = (value: string | null | undefined): string | null => {
  if (!value) return value ?? null;
  if (value.length <= MAX_BODY_CHARS) return value;
  return `${value.slice(0, MAX_BODY_CHARS)}\n\n[truncated]`;
};

const createToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

const mapEndpoint = (row: EndpointRow): WebhookEndpoint => ({
  id: row.id,
  token: row.token,
  name: row.name,
  urlPath: `/tools/api/webhooks/receive/${row.token}`,
  requestCount: Number(row.request_count ?? 0),
  lastRequestAt: row.last_request_at,
  createdAt: row.created_at,
});

const mapLog = (row: LogRow): WebhookLog => ({
  id: row.id,
  endpointId: row.endpoint_id,
  direction: row.direction,
  method: row.method,
  url: row.url,
  path: row.path,
  query: row.query,
  requestHeaders: row.request_headers ?? {},
  requestBody: row.request_body,
  requestContentType: row.request_content_type,
  responseStatus: row.response_status,
  responseHeaders: row.response_headers,
  responseBody: row.response_body,
  durationMs: row.duration_ms,
  error: row.error,
  createdAt: row.created_at,
});

const isPrivateIpv4 = (hostname: string): boolean => {
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const a = parts[0]!;
  const b = parts[1]!;
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
};

const isBlockedTargetUrl = (url: URL): boolean => {
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return true;
  return isPrivateIpv4(host);
};

const cleanupLogs = async (ownerUserId: string, endpointId?: string | null) => {
  await sql`
    DELETE FROM tools.webhook_logs
    WHERE owner_user_id = ${ownerUserId}::uuid
      AND created_at < now() - (${LOG_RETENTION_DAYS} || ' days')::interval
  `;

  if (endpointId) {
    await sql`
      DELETE FROM tools.webhook_logs
      WHERE id IN (
        SELECT id
        FROM tools.webhook_logs
        WHERE endpoint_id = ${endpointId}::uuid
        ORDER BY created_at DESC
        OFFSET ${MAX_LOGS_PER_ENDPOINT}
      )
    `;
    return;
  }

  await sql`
    DELETE FROM tools.webhook_logs
    WHERE id IN (
      SELECT id
      FROM tools.webhook_logs
      WHERE owner_user_id = ${ownerUserId}::uuid
        AND direction = 'outgoing'
      ORDER BY created_at DESC
      OFFSET ${MAX_OUTGOING_LOGS_PER_USER}
    )
  `;
};

export const webhookTesterService = {
  async listEndpoints(ownerUserId: string): Promise<WebhookEndpoint[]> {
    const rows: EndpointRow[] = await sql`
      SELECT e.id,
             e.token,
             e.name,
             e.created_at,
             COUNT(l.id)::int AS request_count,
             MAX(l.created_at)::text AS last_request_at
      FROM tools.webhook_endpoints e
      LEFT JOIN tools.webhook_logs l ON l.endpoint_id = e.id
      WHERE e.owner_user_id = ${ownerUserId}::uuid
        AND e.deleted_at IS NULL
      GROUP BY e.id
      ORDER BY e.created_at DESC
    `;
    return rows.map(mapEndpoint);
  },

  async createEndpoint(ownerUserId: string, name: string): Promise<WebhookEndpoint> {
    const cleanName = name.trim().slice(0, 120) || "Webhook endpoint";
    const [row]: EndpointRow[] = await sql`
      INSERT INTO tools.webhook_endpoints (owner_user_id, token, name)
      VALUES (${ownerUserId}::uuid, ${createToken()}, ${cleanName})
      RETURNING id, token, name, created_at, 0::int AS request_count, NULL::text AS last_request_at
    `;
    if (!row) throw new Error("Endpoint could not be created.");
    return mapEndpoint(row);
  },

  async deleteEndpoint(ownerUserId: string, endpointId: string): Promise<boolean> {
    const rows = await sql`
      UPDATE tools.webhook_endpoints
      SET deleted_at = now()
      WHERE id = ${endpointId}::uuid
        AND owner_user_id = ${ownerUserId}::uuid
        AND deleted_at IS NULL
      RETURNING id
    `;
    return rows.length > 0;
  },

  async listIncomingLogs(ownerUserId: string, filters: WebhookLogFilters = {}): Promise<WebhookLog[]> {
    const clean = normalizeLogFilters(filters);
    const rows: LogRow[] = await sql`
      SELECT *
      FROM tools.webhook_logs
      WHERE owner_user_id = ${ownerUserId}::uuid
        AND direction = 'incoming'
        AND (${clean.endpointId}::uuid IS NULL OR endpoint_id = ${clean.endpointId}::uuid)
        AND (${clean.method}::text IS NULL OR method = ${clean.method})
        AND (
          ${clean.query}::text IS NULL
          OR url ILIKE '%' || ${clean.query} || '%'
          OR path ILIKE '%' || ${clean.query} || '%'
          OR query ILIKE '%' || ${clean.query} || '%'
          OR COALESCE(request_content_type, '') ILIKE '%' || ${clean.query} || '%'
          OR COALESCE(request_body, '') ILIKE '%' || ${clean.query} || '%'
          OR COALESCE(error, '') ILIKE '%' || ${clean.query} || '%'
        )
      ORDER BY created_at DESC
      LIMIT 100
    `;
    return rows.map(mapLog);
  },

  async listEndpointLogs(
    ownerUserId: string,
    endpointId: string,
    filters: Omit<WebhookLogFilters, "endpointId"> = {},
  ): Promise<WebhookLog[]> {
    return webhookTesterService.listIncomingLogs(ownerUserId, { ...filters, endpointId });
  },

  async listOutgoingLogs(ownerUserId: string, filters: WebhookLogFilters = {}): Promise<WebhookLog[]> {
    const clean = normalizeLogFilters(filters);
    const rows: LogRow[] = await sql`
      SELECT *
      FROM tools.webhook_logs
      WHERE owner_user_id = ${ownerUserId}::uuid
        AND direction = 'outgoing'
        AND (${clean.method}::text IS NULL OR method = ${clean.method})
        AND (
          ${clean.query}::text IS NULL
          OR url ILIKE '%' || ${clean.query} || '%'
          OR path ILIKE '%' || ${clean.query} || '%'
          OR query ILIKE '%' || ${clean.query} || '%'
          OR COALESCE(request_content_type, '') ILIKE '%' || ${clean.query} || '%'
          OR COALESCE(request_body, '') ILIKE '%' || ${clean.query} || '%'
          OR COALESCE(response_body, '') ILIKE '%' || ${clean.query} || '%'
          OR COALESCE(error, '') ILIKE '%' || ${clean.query} || '%'
        )
      ORDER BY created_at DESC
      LIMIT 100
    `;
    return rows.map(mapLog);
  },

  async logIncoming(params: {
    token: string;
    method: string;
    url: string;
    path: string;
    query: string;
    headers: Record<string, string>;
    body: string | null;
    contentType: string | null;
  }): Promise<WebhookLog | null> {
    const [endpoint]: { id: string; owner_user_id: string }[] = await sql`
      SELECT id, owner_user_id
      FROM tools.webhook_endpoints
      WHERE token = ${params.token}
        AND deleted_at IS NULL
      LIMIT 1
    `;
    if (!endpoint) return null;

    const [row]: LogRow[] = await sql`
      INSERT INTO tools.webhook_logs (
        endpoint_id,
        owner_user_id,
        direction,
        method,
        url,
        path,
        query,
        request_headers,
        request_body,
        request_content_type,
        response_status
      )
      VALUES (
        ${endpoint.id}::uuid,
        ${endpoint.owner_user_id}::uuid,
        'incoming',
        ${params.method},
        ${params.url},
        ${params.path},
        ${params.query},
        ${JSON.stringify(params.headers)}::jsonb,
        ${truncate(params.body)},
        ${params.contentType},
        200
      )
      RETURNING *
    `;
    if (!row) throw new Error("Incoming request could not be logged.");
    await cleanupLogs(endpoint.owner_user_id, endpoint.id);
    return mapLog(row);
  },

  async send(ownerUserId: string, input: SendWebhookInput): Promise<WebhookLog> {
    const parsedUrl = new URL(input.url);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error("Only HTTP and HTTPS URLs are allowed.");
    if (isBlockedTargetUrl(parsedUrl)) throw new Error("Private, local, and link-local targets are blocked.");

    const headers = new Headers(input.headers);
    const started = performance.now();
    let responseStatus: number | null = null;
    let responseHeaders: Record<string, string> | null = null;
    let responseBody: string | null = null;
    let error: string | null = null;

    try {
      const response = await fetch(parsedUrl, {
        method: input.method,
        headers,
        body: input.method === "GET" ? undefined : input.body,
        redirect: "manual",
      });
      responseStatus = response.status;
      responseHeaders = sanitizeHeaders(response.headers);
      responseBody = truncate(await response.text());
    } catch (err) {
      error = err instanceof Error ? err.message : "Request failed";
    }

    const [row]: LogRow[] = await sql`
      INSERT INTO tools.webhook_logs (
        owner_user_id,
        direction,
        method,
        url,
        path,
        query,
        request_headers,
        request_body,
        request_content_type,
        response_status,
        response_headers,
        response_body,
        duration_ms,
        error
      )
      VALUES (
        ${ownerUserId}::uuid,
        'outgoing',
        ${input.method},
        ${parsedUrl.toString()},
        ${parsedUrl.pathname},
        ${parsedUrl.search},
        ${JSON.stringify(sanitizeHeaders(headers))}::jsonb,
        ${input.method === "GET" ? null : truncate(input.body)},
        ${headers.get("content-type")},
        ${responseStatus},
        ${responseHeaders ? JSON.stringify(responseHeaders) : null}::jsonb,
        ${responseBody},
        ${Math.round(performance.now() - started)},
        ${error}
      )
      RETURNING *
    `;
    if (!row) throw new Error("Outgoing request could not be logged.");
    await cleanupLogs(ownerUserId, null);
    return mapLog(row);
  },
};
