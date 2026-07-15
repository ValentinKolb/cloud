import { type AuthContext, middleware } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import apiRoutes from "./api";
import { mailCapabilities } from "./capabilities";
import { app } from "./config";
import pageRoutes from "./frontend";
import { migrate } from "./migrate";
import { createMailNotificationService } from "./notifications";
import { commandRuntime, mailRuntime, workflowMaterializationRuntime, workflowRuntime } from "./service";

const mailNotifications = createMailNotificationService(app.notifications);

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
      await mailNotifications.start();
      try {
        await mailRuntime.start();
        await commandRuntime.start();
        await workflowMaterializationRuntime.start();
        await workflowRuntime.start();
      } catch (error) {
        await workflowRuntime.stop().catch(() => undefined);
        await workflowMaterializationRuntime.stop().catch(() => undefined);
        await commandRuntime.stop().catch(() => undefined);
        await mailRuntime.stop().catch(() => undefined);
        await mailNotifications.stop().catch(() => undefined);
        throw error;
      }
    },
    stop: async () => {
      try {
        await workflowRuntime.stop();
        await workflowMaterializationRuntime.stop();
        await commandRuntime.stop();
        await mailRuntime.stop();
      } finally {
        await mailNotifications.stop();
      }
    },
  },
});

export type { ApiType } from "./api";
export * from "./contracts";
export { mailService as service } from "./service";
