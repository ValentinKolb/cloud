import { type AuthContext, middleware } from "@valentinkolb/cloud/server";
import { createRuntimeLifecycle, stopRuntimeResources } from "@valentinkolb/cloud/services";
import { Hono } from "hono";
import { websocket } from "hono/bun";
import apiRoutes from "./api";
import { app } from "./config";
import pageRoutes, { adminRoutes, publicRoutes } from "./frontend";
import { migrate } from "./migrate";
import { gridsService } from "./service";
import { startRecordEventOutbox, stopRecordEventOutbox } from "./service/record-event-outbox";
import { startWorkflowKernelRuntime, stopWorkflowKernelRuntime } from "./service/workflow-kernel-runtime";

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
    await startWorkflowKernelRuntime();
  },
  stop: () => stopRuntimeResources([stopWorkflowKernelRuntime, stopRecordEventOutbox]),
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
