import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/server";
import spacesPage from "./page";
import spaceDetailPage from "./[id]/page";
import spaceSettingsPage from "./[id]/settings/page";
import spacesAdminPage from "./admin";

export const adminPages = new Hono<AuthContext>().get("/", auth.requireRole("admin", auth.redirectToLogin), ...spacesAdminPage);

export default new Hono<AuthContext>()
  .get("/", auth.requireRole("user", auth.redirectToLogin), ...spacesPage)
  .get("/:id/settings", auth.requireRole("user", auth.redirectToLogin), ...spaceSettingsPage)
  .get("/:id", auth.requireRole("user", auth.redirectToLogin), ...spaceDetailPage);
