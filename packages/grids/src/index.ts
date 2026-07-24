import { type AuthContext, auth, middleware } from "@valentinkolb/cloud/server";
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
import { startWorkflowKernelRuntime, stopWorkflowKernelRuntime } from "./service/workflow-kernel-runtime";

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/api/grids/help", new Hono<AuthContext>().use(auth.requireRole("user")).route("/", gridsHelp.router))
  .route("/api/grids", apiRoutes)
  .route("/app/grids", pageRoutes)
  .route("/admin/grids", adminRoutes)
  .route("/share/grids", publicRoutes);

const gridsRuntimeLifecycle = createRuntimeLifecycle({
  start: async () => {
    await startRecordEventOutbox();
    await startWorkflowKernelRuntime();
    startFieldIndexMaintenance();
  },
  stop: () => stopRuntimeResources([stopFieldIndexMaintenance, stopWorkflowKernelRuntime, stopRecordEventOutbox, stopBoundedQueryPool]),
});

const result = await app.start({
  fetch: router.fetch,
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
