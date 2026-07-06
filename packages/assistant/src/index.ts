import { migrateCloudAi, startAiRuntimeRecovery } from "@valentinkolb/cloud/ai";
import { type AuthContext, middleware } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import apiRoutes from "./api";
import { app } from "./config";
import pageRoutes from "./frontend";

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/api/assistant", apiRoutes)
  .route("/app/assistant", pageRoutes);

let stopAiRuntimeRecovery: (() => void) | undefined;

export default await app.start({
  fetch: router.fetch,
  openapi: apiRoutes,
  lifecycle: {
    setup: async () => {
      await migrateCloudAi();
    },
    start: async () => {
      stopAiRuntimeRecovery = startAiRuntimeRecovery();
    },
    stop: async () => {
      stopAiRuntimeRecovery?.();
      stopAiRuntimeRecovery = undefined;
    },
  },
});

export type { ApiType } from "./api";
