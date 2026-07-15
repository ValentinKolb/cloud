import { type AuthContext, middleware } from "@valentinkolb/cloud/server";
import { stopRuntimeResources } from "@valentinkolb/cloud/services";
import { Hono } from "hono";
import apiRoutes from "./api";
import { mailCapabilities } from "./capabilities";
import { app } from "./config";
import pageRoutes from "./frontend";
import { migrate } from "./migrate";
import { createMailNotificationService } from "./notifications";
import { commandRuntime, mailRuntime, workflowMaterializationRuntime, workflowRuntime } from "./service";

const mailNotifications = createMailNotificationService(app.notifications);

const stopMailRuntimes = (): Promise<void> =>
  stopRuntimeResources([
    () => mailRuntime.stop(),
    () => workflowMaterializationRuntime.stop(),
    () => workflowRuntime.stop(),
    () => commandRuntime.stop(),
    () => mailNotifications.stop(),
  ]);

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/api/mail", apiRoutes)
  .route("/app/mail", pageRoutes);

export default await app.start({
  capabilities: mailCapabilities,
  fetch: router.fetch,
  openapi: apiRoutes,
  lifecycle: {
    setup: migrate,
    start: async () => {
      try {
        await mailNotifications.start();
        await mailRuntime.start();
        await commandRuntime.start();
        await workflowMaterializationRuntime.start();
        await workflowRuntime.start();
      } catch (startError) {
        try {
          await stopMailRuntimes();
        } catch (cleanupError) {
          throw new AggregateError([startError, cleanupError], "Mail startup and cleanup failed");
        }
        throw startError;
      }
    },
    stop: stopMailRuntimes,
  },
});

export type { ApiType } from "./api";
export * from "./contracts";
export { mailService as service } from "./service";
