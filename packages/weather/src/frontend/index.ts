import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/server";
import weatherPage from "./page";
import weatherDetailPage from "./[id]/page";
import weatherDisplayPage from "./display/page";
import weatherAdminPage from "./admin";

export const adminPages = new Hono<AuthContext>().get("/", auth.requireRole("admin", auth.redirectToLogin), ...weatherAdminPage);

export default new Hono<AuthContext>()
  // Public display endpoint (no auth) - must be before /:id
  .get("/display", ...weatherDisplayPage)
  // Protected routes (require auth)
  .get("/", auth.requireRole("user", auth.redirectToLogin), ...weatherPage)
  .get("/:id", auth.requireRole("user", auth.redirectToLogin), ...weatherDetailPage);
