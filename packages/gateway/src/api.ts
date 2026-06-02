import { listApps } from "@valentinkolb/cloud";
import { type AuthContext, auth, respond, v } from "@valentinkolb/cloud/server";
import { settingsService } from "@valentinkolb/cloud/services";
import { err, fail, ok } from "@valentinkolb/stdlib";
import { Hono } from "hono";
import { z } from "zod";
import { buildGatewayHealth } from "./health";
import {
  createHealthWebhook,
  deleteHealthWebhook,
  type HealthWebhookInput,
  listHealthWebhooks,
  testHealthWebhook,
  updateHealthWebhook,
} from "./health-webhooks";
import { removeOfflineRegisteredApp } from "./registered-apps";
import { updateHealthSchedule } from "./runtime";

const GATEWAY_SETTING_GROUP = "gateway";
const GATEWAY_SETTING_PREFIX = "gateway.";

const UpdateSettingSchema = z.object({ value: z.unknown() });
const HealthWebhookInputSchema = z.object({
  name: z.string(),
  url: z.string(),
  method: z.enum(["GET", "POST"]),
  enabled: z.boolean(),
  scopeKind: z.enum(["all", "include", "exclude"]),
  scopeAppIds: z.array(z.string()),
  sendOn: z.array(z.enum(["ok", "warn", "error", "recovery", "every_check"])),
  minStatus: z.enum(["ok", "warn", "error"]),
  repeatIntervalMs: z.number(),
  timeoutMs: z.number(),
}) satisfies z.ZodType<HealthWebhookInput>;

export const apiRoutes = new Hono<AuthContext>()
  .use(auth.requireRole("admin"))
  .delete("/apps/:id", async (c) => {
    const id = c.req.param("id");
    return respond(c, removeOfflineRegisteredApp(id, await listApps()));
  })
  .get("/settings", async (c) => {
    const result = await settingsService.entry.list({ filter: { group: GATEWAY_SETTING_GROUP } });
    return respond(c, ok(result.items));
  })
  .put("/settings/:key{.+}", v("json", UpdateSettingSchema), async (c) => {
    const key = c.req.param("key") ?? "";
    if (!key.startsWith(GATEWAY_SETTING_PREFIX)) return respond(c, fail(err.badInput(`Setting "${key}" is not in the gateway namespace`)));
    const body = c.req.valid("json");
    const result = await settingsService.entry.update({ key, value: body.value });
    if (!result.ok) return respond(c, result);
    if (key === "gateway.health_check_schedule" && typeof body.value === "string") await updateHealthSchedule(body.value);
    return respond(c, ok({ message: "Setting updated" }));
  })
  .get("/health", async (c) => c.json(await buildGatewayHealth()))
  .get("/health/webhooks", async (c) => c.json(await listHealthWebhooks()))
  .post("/health/webhooks", v("json", HealthWebhookInputSchema), async (c) => {
    try {
      return c.json(await createHealthWebhook(c.req.valid("json")));
    } catch (error) {
      return respond(c, fail(err.badInput(error instanceof Error ? error.message : String(error))));
    }
  })
  .put("/health/webhooks/:id", v("json", HealthWebhookInputSchema), async (c) => {
    const id = c.req.param("id");
    if (!id) return respond(c, fail(err.badInput("Missing health webhook id")));
    try {
      const webhook = await updateHealthWebhook(id, c.req.valid("json"));
      if (!webhook) return respond(c, fail(err.notFound("Health webhook")));
      return c.json(webhook);
    } catch (error) {
      return respond(c, fail(err.badInput(error instanceof Error ? error.message : String(error))));
    }
  })
  .delete("/health/webhooks/:id", async (c) => {
    if (!(await deleteHealthWebhook(c.req.param("id")))) return respond(c, fail(err.notFound("Health webhook")));
    return respond(c, ok({ message: "Webhook deleted" }));
  })
  .post("/health/webhooks/:id/test", async (c) => {
    const webhook = await testHealthWebhook(c.req.param("id"));
    return respond(c, ok({ message: "Webhook test submitted", webhook }));
  });

export type ApiType = typeof apiRoutes;
