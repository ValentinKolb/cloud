import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/lib/server";
import weatherPage from "./frontend/page";
import weatherDetailPage from "./frontend/[id]/page";
import weatherDisplayPage from "./frontend/display/page";

export default new Hono<AuthContext>()
  // Public display endpoint (no auth) - must be before /:id
  .get("/display", ...weatherDisplayPage)
  // Protected routes (require auth)
  .get("/", auth.requireRole("user", auth.redirectToLogin), ...weatherPage)
  .get("/:id", auth.requireRole("user", auth.redirectToLogin), ...weatherDetailPage);
