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
import { pruneAiCredentials, setAiCredential, splitAiProfileCredentials } from "../ai/credentials";
import { enrichDirtyAiConversations } from "../ai/enrich";
import { type AuthContext, auth, v } from "../server";
import { settingsDeleteLegacyKeys, settingsListLegacyKeys } from "../services";
import { sendEmail } from "../services/notifications/email";
import { GotenbergRenderError, testGotenberg } from "../services/pdf";
import * as settings from "../services/settings";
import { SETTINGS_MAP } from "../services/settings/defaults";

const BulkSaveSchema = z.union([
  z
    .object({
      updates: z.record(z.string(), z.unknown()).optional().default({}),
      resets: z.array(z.string()).optional().default([]),
    })
    .strict(),
  z.record(z.string(), z.unknown()).transform((updates) => ({ updates, resets: [] as string[] })),
]);
const TestEmailSchema = z.object({
  recipient: z.email(),
});

type FieldErrors = Record<string, string>;

const isKnownSetting = (key: string): boolean => SETTINGS_MAP.has(key);

const AI_PROFILES_KEY = "ai.model_profiles_json";

/**
 * Move provider keys out of the model-profiles value before it is stored.
 *
 * The admin form posts profiles as one value, and a newly typed key rides along
 * on its profile. Keys must not land in the setting — it is a `text` setting and
 * would be handed back to the browser in full — so they go to
 * `ai.model_credentials` here and are stripped from what gets saved. A profile
 * whose key field was left empty keeps whatever is already stored.
 *
 * Doing this in the route rather than the settings service keeps the generic
 * store free of AI knowledge, and keeps the admin page at a single save request.
 */
const storeAiCredentials = async (rawValue: unknown): Promise<unknown> => {
  const split = splitAiProfileCredentials(rawValue);
  if (!split) return rawValue;
  for (const { profileId, secret } of split.credentials) await setAiCredential(profileId, secret);
  // A profile deleted in this save must not leave its key behind.
  await pruneAiCredentials(split.profileIds);
  return split.profilesJson;
};
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
  .post("/run-ai-enrichment", auth.requireRole("admin"), async (c) => {
    try {
      // Small manual batch — the cron handles bulk; this is "kick it now".
      const summary = await enrichDirtyAiConversations({ limit: 25 });
      return c.json({ ok: true, summary });
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : "AI enrichment run failed" }, 500);
    }
  })
  .post("/test-pdf", auth.requireRole("admin"), async (c) => {
    try {
      const result = await testGotenberg();
      return c.json({ ok: true, bytes: result.bytes, contentType: result.contentType });
    } catch (error) {
      if (error instanceof GotenbergRenderError) {
        return c.json({ message: error.message, code: error.code, status: error.status }, error.code === "not_configured" ? 400 : 502);
      }
      return c.json({ message: "Failed to test Gotenberg PDF rendering" }, 500);
    }
  })
  .put("/", auth.requireRole("admin"), v("json", BulkSaveSchema), async (c) => {
    const { updates, resets } = c.req.valid("json");
    const updateKeys = Object.keys(updates);
    const keys = [...updateKeys, ...resets];

    if (keys.length === 0) {
      return c.body(null, 204);
    }

    const ownership: FieldErrors = {};
    for (const key of keys) {
      if (!isKnownSetting(key)) {
        ownership[key] = `Unknown setting "${key}"`;
      }
    }
    for (const key of resets) {
      if (key in updates) {
        ownership[key] = `Setting "${key}" cannot be updated and reset in the same save`;
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
            await settings.set(key, key === AI_PROFILES_KEY ? await storeAiCredentials(value) : value);
          } catch (error) {
            fieldErrors[key] = error instanceof Error ? error.message : `Failed to update ${key}`;
            throw error;
          }
        }
        for (const key of resets) {
          try {
            await settings.remove(key);
          } catch (error) {
            fieldErrors[key] = error instanceof Error ? error.message : `Failed to reset ${key}`;
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
  })
  .delete("/:key{.+}", auth.requireRole("admin"), async (c) => {
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
  });

export default app;
export type ApiType = typeof app;
