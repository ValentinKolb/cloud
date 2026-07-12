import { aiMaintenanceJobs, migrateCloudAi, startAiRuntime } from "@valentinkolb/cloud/ai";
import { type AuthContext, middleware } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import apiRoutes from "./api";
import { app } from "./config";
import pageRoutes from "./frontend";
import { createAssistantNotificationService } from "./notifications";

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/api/assistant", apiRoutes)
  .route("/app/assistant", pageRoutes);

let stopAiRuntime: (() => void) | undefined;
const assistantNotifications = createAssistantNotificationService(app.notifications);

export default await app.start({
  fetch: router.fetch,
  openapi: apiRoutes,
  lifecycle: {
    setup: async () => {
      await migrateCloudAi();
    },
    start: async () => {
      await assistantNotifications.start();
      try {
        stopAiRuntime = startAiRuntime({
          onTurnFinalized: async ({ turnId, status, kind }) => {
            if (status === "completed" && kind === "chat") await assistantNotifications.notifyTurnCompleted(turnId);
          },
        });
        await aiMaintenanceJobs.start();
      } catch (error) {
        stopAiRuntime?.();
        stopAiRuntime = undefined;
        await aiMaintenanceJobs.stop().catch(() => undefined);
        await assistantNotifications.stop().catch(() => undefined);
        throw error;
      }
    },
    stop: async () => {
      stopAiRuntime?.();
      stopAiRuntime = undefined;
      try {
        await aiMaintenanceJobs.stop();
      } finally {
        await assistantNotifications.stop();
      }
    },
  },
});

export type { ApiType } from "./api";
