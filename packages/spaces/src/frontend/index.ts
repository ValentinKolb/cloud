import { type AuthContext, auth } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import spaceDetailPage from "./[id]/page";
import spacesAdminPage from "./admin";
import helpPage from "./help/page";
import spacesPage from "./page";

export const adminPages = new Hono<AuthContext>().get("/", auth.requireRole("admin", auth.redirectToLogin), ...spacesAdminPage);

export default new Hono<AuthContext>()
  .get("/help", auth.requireRole("user", auth.redirectToLogin), ...helpPage)
  .get("/help/:topic", auth.requireRole("user", auth.redirectToLogin), ...helpPage)
  .get("/", auth.requireRole("user", auth.redirectToLogin), ...spacesPage)
  .get("/:id", auth.requireRole("user", auth.redirectToLogin), ...spaceDetailPage);
