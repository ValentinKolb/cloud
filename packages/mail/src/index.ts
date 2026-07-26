import { type AuthContext, auth, middleware } from "@valentinkolb/cloud/server";
import { stopRuntimeResources } from "@valentinkolb/cloud/services";
import { Hono } from "hono";
import { websocket } from "hono/bun";
import apiRoutes from "./api";
import { mailCapabilities } from "./capabilities";
import { app } from "./config";
import pageRoutes from "./frontend";
import adminPage from "./frontend/admin";
import { publicAttachmentRoutes } from "./frontend/public-attachments";
import { mailHelp } from "./help";
import { migrate } from "./migrate";
import { createMailNotificationService } from "./notifications";
import { commandRuntime, mailRuntime, workflowRuntime } from "./service";

const mailNotifications = createMailNotificationService(app.notifications);
const helpRoutes = new Hono<AuthContext>().use(auth.requireRole("user")).route("/", mailHelp.router);

const stopMailRuntimes = (): Promise<void> =>
  stopRuntimeResources([
    () => mailRuntime.stop(),
    () => workflowRuntime.stop(),
    () => commandRuntime.stop(),
    () => mailNotifications.stop(),
  ]);

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/api/mail/help", helpRoutes)
  .route("/api/mail", apiRoutes)
  .route("/app/mail", pageRoutes)
  .get("/admin/mail", auth.requireRole("admin", auth.redirectToLogin), ...adminPage)
  .route("/share/mail", publicAttachmentRoutes);

const result = await app.start({
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
export default { ...result, websocket };

export type { ApiType } from "./api";
export * from "./contracts";
export { mailService as service } from "./service";
