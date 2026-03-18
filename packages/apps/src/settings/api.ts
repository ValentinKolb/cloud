import { Hono } from "hono";
import { rateLimit } from "@valentinkolb/cloud/lib/server";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { v } from "@valentinkolb/cloud/lib/server";
import { jsonResponse, requiresAdmin } from "@valentinkolb/cloud/lib/server";
import { auth, type AuthContext } from "@valentinkolb/cloud/lib/server";
import { respond } from "@valentinkolb/cloud/lib/server";
import { ok } from "@valentinkolb/cloud/lib/server";
import { settingsService } from "./service";

const SettingKindSchema = z.enum([
  "string",
  "text",
  "email",
  "url",
  "secret",
  "image",
  "boolean",
  "number",
  "enum",
  "string_list",
  "number_list",
  "cron",
  "timezone",
  "template",
]);

const SettingEntrySchema = z.object({
  key: z.string(),
  label: z.string(),
  kind: SettingKindSchema,
  description: z.string(),
  placeholder: z.string().optional(),
  group: z.string(),
  value: z.unknown(),
  default: z.unknown(),
  isCustom: z.boolean(),
  templateVars: z.array(z.string()).optional(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

const app = new Hono<AuthContext>()
  .use(rateLimit())
  .use(auth.requireRole("admin"))

  .get(
    "/",
    describeRoute({
      tags: ["Settings"],
      summary: "Get all settings",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(z.object({ settings: z.array(SettingEntrySchema) }), "All settings with current values"),
      },
    }),
    async (c) => {
      const allPage = await settingsService.entry.list();
      return respond(c, ok({ settings: allPage.items }));
    },
  )

  .put(
    "/:key{.+}",
    describeRoute({
      tags: ["Settings"],
      summary: "Set a setting value",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(z.object({ message: z.string() }), "Setting updated"),
        400: jsonResponse(z.object({ message: z.string() }), "Unknown setting key"),
      },
    }),
    v("json", z.object({ value: z.unknown() })),
    async (c) => {
      const key = c.req.param("key");
      const { value } = c.req.valid("json");
      return respond(c, async () => {
        const result = await settingsService.entry.update({ key, value });
        if (!result.ok) return result;
        return ok({ message: "Setting updated" });
      });
    },
  )

  .delete(
    "/:key{.+}",
    describeRoute({
      tags: ["Settings"],
      summary: "Reset a setting to default",
      ...requiresAdmin,
      responses: {
        200: jsonResponse(z.object({ message: z.string() }), "Setting reset to default"),
        400: jsonResponse(z.object({ message: z.string() }), "Unknown setting key"),
      },
    }),
    async (c) => {
      const key = c.req.param("key");
      return respond(c, async () => {
        const result = await settingsService.entry.reset({ key });
        if (!result.ok) return result;
        return ok({ message: "Setting reset to default" });
      });
    },
  );

export default app;
export type ApiType = typeof app;
