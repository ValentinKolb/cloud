import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/server";
import expeditionsListPage from "./page";
import expeditionDetailPage from "./[id]/page";
import expeditionsAdminPage from "./admin";

/**
 * Page-route assembly for the expeditions app.
 *
 * Two Hono routers are exported:
 *   - default → mounted at /app/expeditions  (signed-in users)
 *   - adminPages → mounted at /admin/expeditions (admins only)
 *
 * `index.ts` plugs both into the platform's gateway via `app.start({ routes })`.
 *
 * The `auth.requireRole(role, fallback)` middleware enforces the role and
 * redirects to login when the visitor isn't authenticated. Pass page handlers
 * with `...spread` because `ssr()` returns a `[validator, handler]` tuple.
 */
export const adminPages = new Hono<AuthContext>().get(
  "/",
  auth.requireRole("admin", auth.redirectToLogin),
  ...expeditionsAdminPage,
);

export default new Hono<AuthContext>()
  .get("/", auth.requireRole("user", auth.redirectToLogin), ...expeditionsListPage)
  .get("/:id", auth.requireRole("user", auth.redirectToLogin), ...expeditionDetailPage);
