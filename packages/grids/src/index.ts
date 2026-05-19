import { Hono } from "hono";
import { app } from "./config";
import { middleware, type AuthContext } from "@valentinkolb/cloud/server";
import apiRoutes from "./api";
import pageRoutes, { adminRoutes, publicRoutes } from "./frontend";
import { gridsService } from "./service";
import { automationRuntime } from "./service/automations-runtime";
import { migrate } from "./migrate";

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/api/grids", apiRoutes)
  .route("/app/grids", pageRoutes)
  .route("/admin/grids", adminRoutes)
  .route("/share/grids", publicRoutes);

export default await app.start({
  fetch: router.fetch,
  openapi: apiRoutes,
  lifecycle: {
    setup: async () => {
      await migrate();
    },
    start: async () => {
      await automationRuntime.start();
    },
    stop: async () => {
      await automationRuntime.stop();
    },
  },
});

export { gridsService as service };
export type { ApiType } from "./api";
