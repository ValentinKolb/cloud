import { type AuthContext, middleware } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { websocket } from "hono/bun";
import apiRoutes from "./api";
import { app } from "./config";
import pageRoutes, { adminRoutes, publicRoutes } from "./frontend";
import { migrate } from "./migrate";
import { gridsService } from "./service";
import { startRecordEventOutbox, stopRecordEventOutbox } from "./service/record-event-outbox";
import { workflowTriggerRuntime } from "./service/workflow-trigger-runtime";

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/api/grids", apiRoutes)
  .route("/app/grids", pageRoutes)
  .route("/admin/grids", adminRoutes)
  .route("/share/grids", publicRoutes);

const result = await app.start({
  fetch: router.fetch,
  openapi: apiRoutes,
  lifecycle: {
    setup: async () => {
      await migrate();
    },
    start: async () => {
      await startRecordEventOutbox();
      await workflowTriggerRuntime.start();
    },
    stop: async () => {
      await workflowTriggerRuntime.stop();
      await stopRecordEventOutbox();
    },
  },
});

export default { ...result, websocket };

export type { ApiType } from "./api";
export { gridsService as service };
