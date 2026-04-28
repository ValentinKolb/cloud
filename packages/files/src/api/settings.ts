/**
 * app-files's own settings HTTP API. Owns reads/writes for files.* keys.
 *
 * Endpoints:
 *   PUT    /api/admin/files/settings           — bulk update, atomic
 *   DELETE /api/admin/files/settings/:key{.+}  — reset to default
 *
 * Side-effect on save: re-init Filegate client so a changed URL/token takes
 * effect immediately without restart.
 */
import { Hono } from "hono";
import { sql } from "bun";
import { z } from "zod";
import { app } from "../config";
import { auth, v, type AuthContext } from "@valentinkolb/cloud/server";
import { resetFilegateClient } from "../service/operations";

// Source of truth for which keys app-files owns
const FILES_KEYS = new Set([
  "files.filegate_url",
  "files.filegate_token",
  "files.base_homes",
  "files.base_groups",
  "files.home_dir_mode",
  "files.home_file_mode",
  "files.group_dir_mode",
  "files.group_file_mode",
]);
const isFilesKey = (key: string): boolean => FILES_KEYS.has(key);
const filegateAffected = (keys: string[]): boolean =>
  keys.includes("files.filegate_url") || keys.includes("files.filegate_token");

const BulkUpdateSchema = z.record(z.string(), z.unknown());

export const filesSettingsRouter = new Hono<AuthContext>()
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
        if (!isFilesKey(key)) ownership[key] = `Setting "${key}" is not owned by app-files`;
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

      // Re-init Filegate client so URL/token changes take effect immediately.
      if (filegateAffected(keys)) resetFilegateClient();

      return c.body(null, 204);
    },
  )
  .delete(
    "/:key{.+}",
    auth.requireRole("admin"),
    async (c) => {
      const key = c.req.param("key");
      if (!isFilesKey(key)) {
        return c.json({ message: `Setting "${key}" is not owned by app-files` }, 400);
      }
      try {
        await app.settings.remove(key as never);
        if (filegateAffected([key])) resetFilegateClient();
        return c.body(null, 204);
      } catch (error) {
        return c.json({ message: error instanceof Error ? error.message : "Reset failed" }, 500);
      }
    },
  );
