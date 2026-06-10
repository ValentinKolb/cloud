import { listApps } from "@valentinkolb/cloud";
import { type AuthContext, auth, rateLimit, respond, v } from "@valentinkolb/cloud/server";
import { settingsDeleteLegacyKeys, settingsListLegacyKeys, settingsService } from "@valentinkolb/cloud/services";
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
import { updateHealthSchedule } from "./lifecycle";
import { metricsApiRoutes } from "./observability/metrics/api";
import { removeOfflineRegisteredApp } from "./registered-apps";

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

const liveSettingKeys = async () => (await listApps()).flatMap((app) => [...(app.settingKeys ?? [])]);

export const apiRoutes = new Hono<AuthContext>()
  .use(rateLimit())
  .use(auth.requireRole("admin"))
  .route("/metrics", metricsApiRoutes)
  .delete("/apps/:id", async (c) => {
    const id = c.req.param("id");
    return respond(c, removeOfflineRegisteredApp(id, await listApps()));
  })
  .get("/settings", async (c) => {
    const result = await settingsService.entry.list({ filter: { group: GATEWAY_SETTING_GROUP } });
    return respond(c, ok(result.items));
  })
  .get("/settings/legacy", async (c) => respond(c, ok(await settingsListLegacyKeys(await liveSettingKeys()))))
  .delete("/settings/legacy", async (c) => respond(c, ok(await settingsDeleteLegacyKeys(await liveSettingKeys()))))
  .put("/settings/:key{.+}", v("json", UpdateSettingSchema), async (c) => {
    const key = c.req.param("key") ?? "";
    if (!key.startsWith(GATEWAY_SETTING_PREFIX)) return respond(c, fail(err.badInput(`Setting "${key}" is not in the gateway namespace`)));
    const body = c.req.valid("json");
    const result = await settingsService.entry.update({ key, value: body.value });
    if (!result.ok) return respond(c, result);
    if (key === "gateway.health_check_schedule" && typeof body.value === "string") await updateHealthSchedule(body.value);
    return respond(c, ok({ message: "Setting updated" }));
  })
  .get("/health", async (c) => respond(c, ok(await buildGatewayHealth())))
  .get("/health/webhooks", async (c) => respond(c, ok(await listHealthWebhooks())))
  .post("/health/webhooks", v("json", HealthWebhookInputSchema), async (c) => {
    try {
      return respond(c, ok(await createHealthWebhook(c.req.valid("json"))));
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
      return respond(c, ok(webhook));
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
