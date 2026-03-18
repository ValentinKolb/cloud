import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/lib/server";
import spacesPage from "./frontend/page";
import spaceDetailPage from "./frontend/[id]/page";
import spaceSettingsPage from "./frontend/[id]/settings/page";

export default new Hono<AuthContext>()
  .get("/", auth.requireRole("user", auth.redirectToLogin), ...spacesPage)
  .get("/:id/settings", auth.requireRole("user", auth.redirectToLogin), ...spaceSettingsPage)
  .get("/:id", auth.requireRole("user", auth.redirectToLogin), ...spaceDetailPage);
