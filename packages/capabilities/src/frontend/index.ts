import { type AuthContext, auth } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import appPage from "./app.page";
import page from "./page";
import runnerPage from "./runner.page";

const requireAuth = auth.requireRole("authenticated", auth.redirectToLogin);

export default new Hono<AuthContext>()
  .get("/", requireAuth, ...page)
  .get("/:appId/:kind{query|action}/:capabilityId", requireAuth, ...runnerPage)
  .get("/:appId", requireAuth, ...appPage);
