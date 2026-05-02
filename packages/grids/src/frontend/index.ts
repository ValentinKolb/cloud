import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/server";
import indexPage from "./page";
import baseDetailPage from "./[baseId]/page";
import adminPage from "./admin";

/** Admin pages mounted at `/admin/grids` — platform-admin only. */
export const adminRoutes = new Hono<AuthContext>().get(
  "/",
  auth.requireRole("admin", auth.redirectToLogin),
  ...adminPage,
);

/** Default export = user-facing app pages mounted at `/app/grids`. */
export default new Hono<AuthContext>()
  .get("/", auth.requireRole("user", auth.redirectToLogin), ...indexPage)
  .get("/:baseId", auth.requireRole("user", auth.redirectToLogin), ...baseDetailPage);
