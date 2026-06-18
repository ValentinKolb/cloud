/**
 * Admin API for platform-wide runtime settings.
 *
 * This route lives in cloud-lib because `/admin/settings` is a platform page
 * and needs a typed client without depending on the core app package. The
 * core app mounts it under `/api/admin/core/settings`.
 */
import { sql } from "bun";
import { Hono } from "hono";
import { z } from "zod";
import { listApps } from "../_internal/registry";
import { auth, v, type AuthContext } from "../server";
import { settingsDeleteLegacyKeys, settingsListLegacyKeys } from "../services";
import { sendEmail } from "../services/notifications/email";
import * as settings from "../services/settings";
import { SETTINGS_MAP } from "../services/settings/defaults";

const BulkUpdateSchema = z.record(z.string(), z.unknown());
const TestEmailSchema = z.object({
  recipient: z.email(),
});

type FieldErrors = Record<string, string>;

const isKnownSetting = (key: string): boolean => SETTINGS_MAP.has(key);
const liveSettingKeys = async () => (await listApps()).flatMap((app) => [...(app.settingKeys ?? [])]);

const app = new Hono<AuthContext>()
  .get("/legacy", auth.requireRole("admin"), async (c) => {
    return c.json(await settingsListLegacyKeys(await liveSettingKeys()));
  })
  .delete("/legacy", auth.requireRole("admin"), async (c) => {
    return c.json(await settingsDeleteLegacyKeys(await liveSettingKeys()));
  })
  .post("/test-email", auth.requireRole("admin"), v("json", TestEmailSchema), async (c) => {
    const { recipient } = c.req.valid("json");
    const sentAt = new Date().toISOString();

    try {
      await sendEmail(recipient, "Cloud test email", {
        rawHtml: `
          <p>This is a test email from Cloud.</p>
          <p>If you received this message, SMTP delivery is configured correctly.</p>
          <p style="margin-top:24px;color:#71717a;font-size:12px;">Sent at ${sentAt}</p>
        `,
      });
      return c.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to send test email";
      return c.json({ message }, 500);
    }
  })
  .put(
    "/",
    auth.requireRole("admin"),
    v("json", BulkUpdateSchema),
    async (c) => {
      const updates = c.req.valid("json");
      const keys = Object.keys(updates);

      if (keys.length === 0) {
        return c.body(null, 204);
      }

      const ownership: FieldErrors = {};
      for (const key of keys) {
        if (!isKnownSetting(key)) {
          ownership[key] = `Unknown setting "${key}"`;
        }
      }
      if (Object.keys(ownership).length > 0) {
        return c.json({ message: "Invalid keys", errors: ownership }, 400);
      }

      const fieldErrors: FieldErrors = {};
      try {
        await sql.begin(async () => {
          for (const [key, value] of Object.entries(updates)) {
            try {
              await settings.set(key, value);
            } catch (error) {
              fieldErrors[key] = error instanceof Error ? error.message : `Failed to update ${key}`;
              throw error;
            }
          }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Save failed";
        return c.json(
          {
            message,
            errors: Object.keys(fieldErrors).length > 0 ? fieldErrors : { _form: message },
          },
          400,
        );
      }

      return c.body(null, 204);
    },
  )
  .delete(
    "/:key{.+}",
    auth.requireRole("admin"),
    async (c) => {
      const key = c.req.param("key");
      if (!isKnownSetting(key)) {
        return c.json({ message: `Unknown setting "${key}"` }, 400);
      }
      try {
        await settings.remove(key);
        return c.body(null, 204);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Reset failed";
        return c.json({ message }, 500);
      }
    },
  );

export default app;
export type ApiType = typeof app;
