/**
 * app-weather's own settings HTTP API. Owns reads/writes for weather.* keys.
 *
 *   PUT    /api/admin/weather/settings           — bulk update, atomic
 *   DELETE /api/admin/weather/settings/:key{.+}  — reset to default
 *
 * No special side-effect on save — weather queries on demand and picks up
 * fresh values via the per-request snapshot or async coreSettings reads.
 */
import { Hono } from "hono";
import { sql } from "bun";
import { z } from "zod";
import { app } from "../config";
import { auth, v, type AuthContext } from "@valentinkolb/cloud/server";

const WEATHER_KEYS = new Set([
  "weather.default_lat",
  "weather.default_lon",
  "weather.cache_minutes",
  "weather.geo_url",
]);
const isWeatherKey = (key: string): boolean => WEATHER_KEYS.has(key);

const BulkUpdateSchema = z.record(z.string(), z.unknown());

export const weatherSettingsRouter = new Hono<AuthContext>()
  .put(
    "/",
    auth.requireRole("admin"),
    v("json", BulkUpdateSchema),
    async (c) => {
      const updates = c.req.valid("json");
      const keys = Object.keys(updates);
      if (keys.length === 0) return c.body(null, 204);

      const ownership: Record<string, string> = {};
      for (const key of keys) {
        if (!isWeatherKey(key)) ownership[key] = `Setting "${key}" is not owned by app-weather`;
      }
      if (Object.keys(ownership).length > 0) {
        return c.json({ message: "Invalid keys", errors: ownership }, 400);
      }

      const fieldErrors: Record<string, string> = {};
      try {
        await sql.begin(async () => {
          for (const [key, value] of Object.entries(updates)) {
            try {
              await app.settings.set(key as never, value as never);
            } catch (error) {
              fieldErrors[key] = error instanceof Error ? error.message : `Failed to update ${key}`;
              throw error;
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
  .delete(
    "/:key{.+}",
    auth.requireRole("admin"),
    async (c) => {
      const key = c.req.param("key");
      if (!isWeatherKey(key)) {
        return c.json({ message: `Setting "${key}" is not owned by app-weather` }, 400);
      }
      try {
        await app.settings.remove(key as never);
        return c.body(null, 204);
      } catch (error) {
        return c.json({ message: error instanceof Error ? error.message : "Reset failed" }, 500);
      }
    },
  );
