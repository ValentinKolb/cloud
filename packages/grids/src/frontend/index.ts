import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/server";
import indexPage from "./page";
import baseDetailPage from "./[baseId]/page";
import baseSettingsPage from "./[baseId]/settings/page";
import adminPage from "./admin";
import publicFormPage from "./public/forms/[token]/page";

/** Admin pages mounted at `/admin/grids` — platform-admin only. */
export const adminRoutes = new Hono<AuthContext>().get(
  "/",
  auth.requireRole("admin", auth.redirectToLogin),
  ...adminPage,
);

/** Public pages mounted at `/public/grids` — anonymous-friendly. */
export const publicRoutes = new Hono<AuthContext>().get(
  "/forms/:token",
  auth.requireRole("*"),
  ...publicFormPage,
);

/** Default export = user-facing app pages mounted at `/app/grids`. */
export default new Hono<AuthContext>()
  .get("/", auth.requireRole("user", auth.redirectToLogin), ...indexPage)
  // Specific routes (settings) MUST come before the catch-all :baseId so
  // Hono's matcher tries them first; otherwise /<base>/settings would
  // match the :baseId param-route and 404 on the unrouted suffix.
  .get("/:baseId/settings", auth.requireRole("user", auth.redirectToLogin), ...baseSettingsPage)
  .get("/:baseId", auth.requireRole("user", auth.redirectToLogin), ...baseDetailPage);
