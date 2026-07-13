import { type AuthContext, auth } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import spaceDetailPage from "./[id]/page";
import spaceSettingsPage from "./[id]/settings/page";
import spacesAdminPage from "./admin";
import spacesPage from "./page";

export const adminPages = new Hono<AuthContext>().get("/", auth.requireRole("admin", auth.redirectToLogin), ...spacesAdminPage);

export default new Hono<AuthContext>()
  .get("/", auth.requireRole("user", auth.redirectToLogin), ...spacesPage)
  .get("/:id/settings", auth.requireRole("user", auth.redirectToLogin), ...spaceSettingsPage)
  .get("/:id", auth.requireRole("user", auth.redirectToLogin), ...spaceDetailPage);
