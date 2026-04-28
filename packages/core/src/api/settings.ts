/**
 * Core's own settings HTTP API. Owns reads/writes for core-declared keys
 * (everything declared in `core/src/_settings.ts:CORE_SETTINGS`).
 *
 * Endpoints:
 *   PUT    /api/admin/core/settings           — bulk update {"key1":val1, "key2":val2}, atomic
 *   DELETE /api/admin/core/settings/:key{.+}  — reset to default
 *
 * Mounted by core's index.ts under `/admin/core/settings`. Other apps that
 * declare their own settings (files, weather) follow the same pattern with
 * `/admin/{app}/settings` paths and validate ownership against their own
 * keys (replacing the central /api/admin/settings router that's removed in
 * phase H).
 */
import { Hono } from "hono";
import { sql } from "bun";
import { z } from "zod";
import { app } from "../config";
import { CORE_SETTINGS } from "../_settings";
import { auth, v, type AuthContext } from "@valentinkolb/cloud/server";

const CORE_KEYS = new Set(Object.keys(CORE_SETTINGS));
const isCoreKey = (key: string): boolean => CORE_KEYS.has(key);

const BulkUpdateSchema = z.record(z.string(), z.unknown());

type FieldErrors = Record<string, string>;

export const coreSettingsRouter = new Hono<AuthContext>()
  /**
   * Bulk update — accepts {"key1": val1, "key2": val2}, validates each key
   * belongs to core, applies all in a single transaction. On any failure no
   * key is committed; field-level errors returned per failing key.
   */
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

      // Validate ownership before touching DB
      const ownership: FieldErrors = {};
      for (const key of keys) {
        if (!isCoreKey(key)) {
          ownership[key] = `Setting "${key}" is not owned by core`;
        }
      }
      if (Object.keys(ownership).length > 0) {
        return c.json({ message: "Invalid keys", errors: ownership }, 400);
      }

      // Apply atomically. app.settings.set validates each value against the
      // declared kind/min/max — invalid values throw, the transaction rolls back.
      const fieldErrors: FieldErrors = {};
      try {
        await sql.begin(async () => {
          for (const [key, value] of Object.entries(updates)) {
            try {
              // The `as never` casts work around the typed map: we know the key
              // is in CORE_SETTINGS because we validated above, but the union
              // type makes overload resolution finicky.
              await app.settings.set(key as never, value as never);
            } catch (error) {
              fieldErrors[key] = error instanceof Error ? error.message : `Failed to update ${key}`;
              throw error; // trigger rollback
            }
          }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Save failed";
        return c.json({ message, errors: Object.keys(fieldErrors).length > 0 ? fieldErrors : { _form: message } }, 400);
      }

      return c.body(null, 204);
    },
  )
  /** Reset a setting to its declared default (deletes the DB row). */
  .delete(
    "/:key{.+}",
    auth.requireRole("admin"),
    async (c) => {
      const key = c.req.param("key");
      if (!isCoreKey(key)) {
        return c.json({ message: `Setting "${key}" is not owned by core` }, 400);
      }
      try {
        await app.settings.remove(key as never);
        return c.body(null, 204);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Reset failed";
        return c.json({ message }, 500);
      }
    },
  );
