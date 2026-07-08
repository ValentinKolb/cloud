import { migrateCloudAi, startAiRuntime } from "@valentinkolb/cloud/ai";
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

let stopAiRuntime: (() => void) | undefined;

export default await app.start({
  fetch: router.fetch,
  openapi: apiRoutes,
  lifecycle: {
    setup: async () => {
      await migrateCloudAi();
    },
    start: async () => {
      stopAiRuntime = startAiRuntime();
    },
    stop: async () => {
      stopAiRuntime?.();
      stopAiRuntime = undefined;
    },
  },
});

export type { ApiType } from "./api";
