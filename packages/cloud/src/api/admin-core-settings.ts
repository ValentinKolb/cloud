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
import { auth, v, type AuthContext } from "../server";
import * as settings from "../services/settings";
import { SETTINGS_MAP } from "../services/settings/defaults";

const BulkUpdateSchema = z.record(z.string(), z.unknown());

type FieldErrors = Record<string, string>;

const isKnownSetting = (key: string): boolean => SETTINGS_MAP.has(key);

const app = new Hono<AuthContext>()
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
