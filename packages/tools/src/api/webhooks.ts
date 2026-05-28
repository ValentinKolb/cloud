import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { auth, type AuthContext, v } from "@valentinkolb/cloud/server";
import { sanitizeHeaders, webhookTesterService } from "../service/webhooks";

const HeaderRecordSchema = z.record(z.string(), z.string().max(4_000)).default({});

const CreateEndpointSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

const SendWebhookSchema = z.object({
  url: z.string().trim().url().max(2_000),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  headers: HeaderRecordSchema,
  body: z.string().max(64_000).default(""),
});

const LogFilterSchema = z.object({
  endpointId: z.string().uuid().optional(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
  q: z.string().trim().max(200).optional(),
});

const readBody = async (c: Context<AuthContext>): Promise<string | null> => {
  const text = await c.req.text().catch(() => "");
  return text || null;
};

const app = new Hono<AuthContext>()
  .all("/receive/:token", async (c) => {
    const token = c.req.param("token")!;
    const url = new URL(c.req.url);
    const log = await webhookTesterService.logIncoming({
      token,
      method: c.req.method,
      url: c.req.url,
      path: url.pathname,
      query: url.search,
      headers: sanitizeHeaders(c.req.raw.headers),
      body: await readBody(c),
      contentType: c.req.header("content-type") ?? null,
    });
    if (!log) return c.json({ ok: false, message: "Webhook endpoint not found" }, 404);
    return c.json({ ok: true, logId: log.id });
  })
  .all("/receive/:token/*", async (c) => {
    const token = c.req.param("token")!;
    const url = new URL(c.req.url);
    const log = await webhookTesterService.logIncoming({
      token,
      method: c.req.method,
      url: c.req.url,
      path: url.pathname,
      query: url.search,
      headers: sanitizeHeaders(c.req.raw.headers),
      body: await readBody(c),
      contentType: c.req.header("content-type") ?? null,
    });
    if (!log) return c.json({ ok: false, message: "Webhook endpoint not found" }, 404);
    return c.json({ ok: true, logId: log.id });
  })

  .use(auth.requireRole("authenticated"))

  .get("/endpoints", async (c) => {
    const user = c.get("user");
    return c.json({ items: await webhookTesterService.listEndpoints(user.id) });
  })
  .post("/endpoints", v("json", CreateEndpointSchema), async (c) => {
    const user = c.get("user");
    const endpoint = await webhookTesterService.createEndpoint(user.id, c.req.valid("json").name);
    return c.json(endpoint, 201);
  })
  .delete("/endpoints/:endpointId", async (c) => {
    const user = c.get("user");
    const deleted = await webhookTesterService.deleteEndpoint(user.id, c.req.param("endpointId")!);
    return deleted ? c.body(null, 204) : c.json({ message: "Endpoint not found" }, 404);
  })
  .get("/endpoints/:endpointId/logs", async (c) => {
    const user = c.get("user");
    const filters = LogFilterSchema.omit({ endpointId: true }).parse(c.req.query());
    return c.json({
      items: await webhookTesterService.listEndpointLogs(user.id, c.req.param("endpointId")!, {
        method: filters.method,
        query: filters.q,
      }),
    });
  })
  .get("/incoming-logs", v("query", LogFilterSchema), async (c) => {
    const user = c.get("user");
    const filters = c.req.valid("query");
    return c.json({
      items: await webhookTesterService.listIncomingLogs(user.id, {
        endpointId: filters.endpointId,
        method: filters.method,
        query: filters.q,
      }),
    });
  })
  .get("/outgoing-logs", v("query", LogFilterSchema.omit({ endpointId: true })), async (c) => {
    const user = c.get("user");
    const filters = c.req.valid("query");
    return c.json({
      items: await webhookTesterService.listOutgoingLogs(user.id, {
        method: filters.method,
        query: filters.q,
      }),
    });
  })
  .post("/send", v("json", SendWebhookSchema), async (c) => {
    const user = c.get("user");
    try {
      const log = await webhookTesterService.send(user.id, c.req.valid("json"));
      return c.json(log);
    } catch (err) {
      return c.json({ message: err instanceof Error ? err.message : "Request failed" }, 400);
    }
  });

export default app;
