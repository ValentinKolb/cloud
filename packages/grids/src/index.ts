import { type AuthContext, middleware } from "@valentinkolb/cloud/server";
import { createRuntimeLifecycle, stopRuntimeResources } from "@valentinkolb/cloud/services";
import { Hono } from "hono";
import { websocket } from "hono/bun";
import apiRoutes from "./api";
import { app } from "./config";
import pageRoutes, { adminRoutes, publicRoutes } from "./frontend";
import { gridsHelp } from "./help";
import { migrate } from "./migrate";
import { gridsService } from "./service";
import { stopBoundedQueryPool } from "./service/bounded-query";
import { startFieldIndexMaintenance, stopFieldIndexMaintenance } from "./service/field-index-maintenance";
import { startRecordEventOutbox, stopRecordEventOutbox } from "./service/record-event-outbox";
import { startWorkflowRuntime, stopWorkflowRuntime } from "./service/workflow-runtime";

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/api/grids", apiRoutes)
  .route("/app/grids", pageRoutes)
  .route("/admin/grids", adminRoutes)
  .route("/share/grids", publicRoutes);

const gridsRuntimeLifecycle = createRuntimeLifecycle({
  start: async () => {
    await startRecordEventOutbox();
    await startWorkflowRuntime();
    startFieldIndexMaintenance();
  },
  stop: () => stopRuntimeResources([stopFieldIndexMaintenance, stopWorkflowRuntime, stopRecordEventOutbox, stopBoundedQueryPool]),
});

const result = await app.start({
  fetch: router.fetch,
  help: gridsHelp,
  openapi: apiRoutes,
  lifecycle: {
    setup: async () => {
      await migrate();
    },
    start: gridsRuntimeLifecycle.start,
    stop: gridsRuntimeLifecycle.stop,
  },
});

export default { ...result, websocket };

export type { ApiType } from "./api";
export { gridsService as service };
