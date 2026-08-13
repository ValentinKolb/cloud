import { aiChatTasks, aiMaintenanceJobs, aiProjects, migrateCloudAi, startAiRuntime } from "@valentinkolb/cloud/ai";
import { createAiLiveRoutes } from "@valentinkolb/cloud/ai/live";
import { type AuthContext, middleware } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { websocket } from "hono/bun";
import apiRoutes from "./api";
import { assistantCapabilities } from "./capabilities";
import { assistantChatTaskRuntime } from "./chat-tasks-runtime";
import { app } from "./config";
import pageRoutes from "./frontend";
import { assistantHelp } from "./help";
import { deliverPendingAssistantMessages } from "./inter-chat-messages";
import { createAssistantNotificationService } from "./notifications";

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route(
    "/api/assistant/live",
    createAiLiveRoutes({
      appId: "assistant",
      resolveScopeVersion: (userId) => aiProjects.scopeVersion({ type: "user", userId }, "assistant"),
    }),
  )
  .route("/api/assistant", apiRoutes)
  .route("/app/assistant", pageRoutes);

let stopAiRuntime: (() => void) | undefined;
const assistantNotifications = createAssistantNotificationService(app.notifications);

const result = await app.start({
  fetch: router.fetch,
  capabilities: assistantCapabilities,
  help: assistantHelp,
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
            const task = await aiChatTasks.finalizeTurn({ turnId, status });
            if (task?.failed) await assistantNotifications.notifyTaskNeedsAttention(task.occurrenceId).catch(() => undefined);
            if (status === "completed" && kind === "chat") await assistantNotifications.notifyTurnCompleted(turnId).catch(() => undefined);
            await deliverPendingAssistantMessages();
          },
        });
        await aiMaintenanceJobs.start();
        await assistantChatTaskRuntime.start();
        await deliverPendingAssistantMessages();
      } catch (error) {
        stopAiRuntime?.();
        stopAiRuntime = undefined;
        await aiMaintenanceJobs.stop().catch(() => undefined);
        await assistantChatTaskRuntime.stop().catch(() => undefined);
        await assistantNotifications.stop().catch(() => undefined);
        throw error;
      }
    },
    stop: async () => {
      stopAiRuntime?.();
      stopAiRuntime = undefined;
      try {
        await assistantChatTaskRuntime.stop();
        await aiMaintenanceJobs.stop();
      } finally {
        await assistantNotifications.stop();
      }
    },
  },
});
export default { ...result, websocket };

export type { ApiType } from "./api";
