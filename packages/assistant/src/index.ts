import { type AuthContext, middleware } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { websocket } from "hono/bun";
import apiRoutes from "./api";
import { app } from "./config";
import pageRoutes from "./frontend";
import { assistantHelp } from "./help";

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/api/assistant", apiRoutes)
  .route("/app/assistant", pageRoutes);

const result = await app.start({
  fetch: router.fetch,
  help: assistantHelp,
  openapi: apiRoutes,
});
export default { ...result, websocket };

export type { ApiType } from "./api";
