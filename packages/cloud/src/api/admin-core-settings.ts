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
import { SETTINGS_MAP, validateSettingValue } from "../services/settings/defaults";

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
const storeAiCredentials = async (split: NonNullable<ReturnType<typeof splitAiProfileCredentials>>): Promise<void> => {
  for (const { profileId, secret } of split.credentials) await setAiCredential(profileId, secret);
  // A profile deleted in this save must not leave its key behind.
  await pruneAiCredentials(split.profileIds);
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

    // Strip AI provider keys before anything is validated or written, so the
    // value that gets checked is the value that gets stored.
    const aiSplit = AI_PROFILES_KEY in updates ? splitAiProfileCredentials(updates[AI_PROFILES_KEY]) : null;
    if (AI_PROFILES_KEY in updates && !aiSplit) {
      // Unsplittable means the keys could not be separated out, and storing the
      // value as posted would put them back in a setting the browser reads.
      return c.json({ message: "Invalid values", errors: { [AI_PROFILES_KEY]: "Model profiles must be a JSON array" } }, 400);
    }
    const finalValues: Record<string, unknown> = aiSplit ? { ...updates, [AI_PROFILES_KEY]: aiSplit.profilesJson } : updates;

    // Validate everything up front. settings.set validates as it writes, so a
    // single bad field used to leave the earlier keys already saved — with the
    // AI profiles among them, whose save also prunes credentials.
    const invalid: FieldErrors = {};
    for (const [key, value] of Object.entries(finalValues)) {
      const def = SETTINGS_MAP.get(key);
      if (!def) continue;
      const validated = validateSettingValue(def, value);
      if (!validated.ok) invalid[key] = validated.error;
    }
    if (Object.keys(invalid).length > 0) {
      return c.json({ message: "Invalid values", errors: invalid }, 400);
    }

    const fieldErrors: FieldErrors = {};
    try {
      // Every write runs on the transaction's own connection, so a failure
      // rolls the whole save back rather than leaving the keys ahead of it
      // applied.
      await sql.begin(async (tx) => {
        for (const [key, value] of Object.entries(finalValues)) {
          try {
            await settings.set(key, value, tx);
          } catch (error) {
            fieldErrors[key] = error instanceof Error ? error.message : `Failed to update ${key}`;
            throw error;
          }
        }
        for (const key of resets) {
          try {
            await settings.remove(key, tx);
          } catch (error) {
            fieldErrors[key] = error instanceof Error ? error.message : `Failed to reset ${key}`;
            throw error;
          }
        }
      });
      // Only now: dropping the cache before the commit would let another
      // container miss, read the pre-commit row and cache it for the full TTL.
      await settings.invalidateSettingsCache(keys);
      if (aiSplit) await storeAiCredentials(aiSplit);
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
