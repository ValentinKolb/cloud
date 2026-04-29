import { app } from "./config";
import { Hono } from "hono";
import { middleware, type AuthContext } from "@valentinkolb/cloud/server";
import apiRoutes from "./api";
import adminPageRoutes from "./frontend";
import { loggingService } from "./service";

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/api/logging", apiRoutes)
  .route("/admin/logging", adminPageRoutes);

export default await app.start({ fetch: router.fetch, openapi: apiRoutes });
export { loggingService as service };
export type { ApiType } from "./api";
export type { LoggingService } from "./service";
